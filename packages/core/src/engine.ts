import { randomUUID } from "node:crypto"
import type { DeepicodeConfig } from "./config.js"
import { ContextManager } from "./context/manager.js"
import type { ToolCall, ToolSpec } from "./types.js"
import type { CoreEngine, AgentConfig, AgentTool, LoopEvent, AgentState, SessionStats, ToolResult } from "./interface.js"
import { DeepSeekClient } from "./client.js"
import { StreamingToolExecutor } from "./streaming-executor.js"
import { AsyncSessionWriter, SessionLoader } from "./session.js"
import { runLoop } from "./loop.js"
import type { LoopOptions } from "./loop.js"

/**
 * ReasonixEngine 是 Deepicode 的核心引擎，负责：
 * - 管理对话上下文（ContextManager）
 * - 与 DeepSeek API 进行流式通信
 * - 执行工具调用（tool calling）
 * - 记录会话统计信息和持久化
 *
 * 整个驱动循环（submit 方法）是一个状态机：
 *   用户输入 → API 流式响应 → 工具调用（可选）→ 继续循环 → 最终输出
 */
export class ReasonixEngine implements CoreEngine {
  /** Deepicode 全局配置 */
  private config: DeepicodeConfig
  /** 上下文管理器，负责维护消息历史和 system prompt */
  private ctx: ContextManager
  /** 注册的工具集合，key 为工具名 */
  private tools: Map<string, AgentTool> = new Map()
  /** DeepSeek API 客户端 */
  private client: DeepSeekClient
  /** 流式工具执行器，负责并发执行工具调用并流式返回结果 */
  private toolExecutor: StreamingToolExecutor
  /** 中断标记，由外部调用 interrupt() 设置 */
  private _interrupted = false
  /** 当前活动的 AbortController，用于中断正在进行的 API 请求 */
  private activeAbortController?: AbortController
  /** 当前会话 ID */
  private sessionId: string
  /** 会话持久化写入器（best-effort，失败静默忽略） */
  private sessionWriter?: AsyncSessionWriter
  /** 会话级别的 token 用量和成本统计 */
  private stats: SessionStats = {
    promptTokens: 0, completionTokens: 0,
    cacheHitTokens: 0, cacheMissTokens: 0,
    apiCalls: 0, toolCalls: 0, totalCost: 0,
  }
  /** 可选：新引擎初始化时调用的清理钩子（如清除全局 stale-read tracker） */
  private onStart?: () => void

  /** prefix.build 缓存：避免每次 submit 重复重建（P3-4-2） */
  private prefixCacheKey = ""

  constructor(config: DeepicodeConfig, onStart?: () => void, sessionId?: string) {
    this.config = config
    this.ctx = new ContextManager(config.maxContextRounds, config.contextWindow)
    this.client = new DeepSeekClient()
    this.sessionId = sessionId ?? randomUUID()
    this.toolExecutor = new StreamingToolExecutor(this.tools, this.sessionId)
    this.onStart = onStart
    this.onStart?.()

    // 尝试初始化会话持久化（best-effort，失败则不记录）
    const sessionPath = `${process.cwd()}/.deepicode/sessions/${this.sessionId}.jsonl`
    const writer = new AsyncSessionWriter(sessionPath)
    writer.init().catch(() => {})
    this.sessionWriter = writer
  }

  static async recover(config: DeepicodeConfig, sessionId: string): Promise<ReasonixEngine> {
    const engine = new ReasonixEngine(config, undefined, sessionId)
    const messages = await SessionLoader.read(sessionId)
    if (messages.length > 0) {
      // 过滤 system 消息——prefix.build() 会重新生成，避免重复
      const nonSystem = messages.filter(m => m.role !== "system")
      engine.ctx.log.appendMany(nonSystem)
    }
    return engine
  }

  /** 设置系统级 system prompt */
  setSystemPrompt(prompt: string): void {
    this.ctx.prefix.build(prompt)
  }

  /** 获取上下文管理器实例 */
  getContextManager(): ContextManager {
    return this.ctx
  }

  /** 注册一个工具到引擎 */
  registerTool(tool: AgentTool): void {
    this.tools.set(tool.name, tool)
  }

  /** 标记中断，终止当前正在进行的请求和工具执行 */
  interrupt(): void {
    this._interrupted = true
    this.activeAbortController?.abort()
  }

  /** 预留：切换 agent（当前为空实现） */
  switchAgent(_agentName: string): void {}
  /** 预留：处理 tier 决策（当前为空实现） */
  resolveTierDecision(_tier: string): void {}

  /**
   * 获取当前引擎状态的快照，包括消息列表、流式状态、待执行工具等
   * @param isStreaming 是否正在流式输出
   * @param streamingMessage 当前已流式输出的内容
   * @param pendingToolCalls 待执行的工具调用列表
   */
  getState(isStreaming = false, streamingMessage = "", pendingToolCalls: Array<{ name: string; args: string }> = []): AgentState {
    return {
      sessionId: this.sessionId,
      messages: [...this.ctx.buildMessages()],
      isStreaming,
      streamingMessage,
      pendingToolCalls,
      currentAgent: "build",
      stats: { ...this.stats },
    }
  }

  async *submit(userInput: string, _agentConfig?: AgentConfig): AsyncGenerator<LoopEvent> {
    this._interrupted = false
    const abortController = new AbortController()
    this.activeAbortController = abortController
    this.ctx.startTurn()
    this.ctx.log.append({ role: "user", content: userInput })
    this.sessionWriter?.enqueue({ ts: Date.now(), type: "messages", payload: this.ctx.buildMessages() })

    try {
      const toolSpecs: ToolSpec[] = []
      for (const tool of this.tools.values()) {
        toolSpecs.push({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })
      }

      const systemPrompt = this.ctx.prefix.messages[0]?.content ?? ""
      const toolSpecsKey = JSON.stringify(toolSpecs)
      const cacheKey = `${systemPrompt}|${toolSpecsKey}`
      if (cacheKey !== this.prefixCacheKey) {
        this.ctx.prefix.build(systemPrompt, toolSpecs)
        this.prefixCacheKey = cacheKey
      }

      const loopOpts: LoopOptions = {
        ctx: this.ctx,
        client: this.client,
        toolExecutor: this.toolExecutor,
        toolSpecs,
        config: {
          apiKey: this.config.apiKey,
          baseUrl: this.config.baseUrl,
          model: this.config.model,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        },
        signal: abortController.signal,
        sessionWriter: this.sessionWriter,
        stats: this.stats,
        isInterrupted: () => this._interrupted,
        appendToolResult: (tc, result) => this.appendToolResult(tc, result),
      }

      yield* runLoop(loopOpts)
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = undefined
      }
    }
  }

  /** 将工具调用的结果追加到对话上下文中 */
  private appendToolResult(tc: ToolCall, result: ToolResult): void {
    this.stats.toolCalls++
    this.ctx.log.append({
      role: "tool",
      tool_call_id: tc.id,
      content: result.content,
      name: tc.function.name,
      is_error: result.isError,
    })
  }
}

// buildOmpContext removed: engine now talks directly to DeepSeek official API.