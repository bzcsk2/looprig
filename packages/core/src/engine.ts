import { randomUUID } from "node:crypto"
import type { DeepicodeConfig } from "./config.js"
import { ContextManager } from "./context/manager.js"
import type { ToolCall, ToolSpec } from "./types.js"
import type { CoreEngine, AgentConfig, AgentTool, LoopEvent, AgentState, SessionStats, ToolResult } from "./interface.js"
import { DeepSeekClient, isToolUseFinishReason } from "./client.js"
import { StreamingToolExecutor } from "./streaming-executor.js"
import { AsyncSessionWriter, SessionLoader } from "./session.js"

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
      engine.ctx.log.appendMany(messages)
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

  /**
   * 核心驱动方法 —— 一个异步生成器。
   * 接收用户输入，进入"请求-响应-工具调用"循环，逐步 yield 事件。
   *
   * 工作流程：
   * 1. 将用户输入追加到上下文
   * 2. 构建工具规范列表
   * 3. 进入最大 10 轮的请求循环
   *    每次循环：
   *    a. 向 API 发起流式请求
   *    b. 逐块 yield 文本/推理/工具调用事件
   *    c. 如果是工具调用，执行工具并 yield 结果
   *    d. 如果不是工具调用，yield done 并结束
   *    e. 如果发生流错误，自动重试（最多连续 3 次）
   * 4. 超出最大轮数后给出警告
   */
  async *submit(userInput: string, _agentConfig?: AgentConfig): AsyncGenerator<LoopEvent> {
    this._interrupted = false
    const abortController = new AbortController()
    this.activeAbortController = abortController
    this.ctx.startTurn()
    this.ctx.log.append({ role: "user", content: userInput })
    this.sessionWriter?.enqueue({ ts: Date.now(), type: "messages", payload: this.ctx.buildMessages() })

    try {
      // 将注册的工具转换为 API 可识别的 tool_spec 格式
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

      // 重建前缀指纹（tool schema 变化会影响 prefix cache）
      this.ctx.prefix.build(this.ctx.prefix.messages[0]?.content ?? "", toolSpecs)

      let turnCount = 0
      const maxTurns = 10
      let consecutiveErrors = 0

      while (turnCount < maxTurns) {
        turnCount++
        if (this._interrupted) {
          yield { role: "status", content: "interrupted" }
          return
        }

        // 每次循环，收集流式输出
        let fullContent = ""          // 完整文本输出
        let fullReasoning = ""        // 完整推理过程
        const toolCalls: ToolCall[] = []  // 本次的工具调用列表
        let streamError: LoopEvent | null = null
        let finishedWithToolUse = false   // 标记本次是否以工具调用结束

        for await (const event of this.client.chatCompletionsStream(this.ctx.buildMessages(), {
          apiKey: this.config.apiKey,
          baseUrl: this.config.baseUrl,
          model: this.config.model,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
          signal: abortController.signal,
          tools: toolSpecs.length > 0 ? toolSpecs : undefined,
        })) {
          if (this._interrupted) {
            yield { role: "status", content: "interrupted" }
            return
          }

          switch (event.type) {
            // 文本增量：累积后 yield 给调用者
            case "text_delta":
              fullContent += event.delta
              yield { role: "assistant_delta", content: event.delta }
              this.sessionWriter?.enqueue({ ts: Date.now(), type: "event", payload: { role: "assistant_delta", content: event.delta } })
              break

            // 推理增量：模型的思考过程
            case "reasoning_delta":
              fullReasoning += event.delta
              yield { role: "reasoning_delta", content: event.delta }
              this.sessionWriter?.enqueue({ ts: Date.now(), type: "event", payload: { role: "reasoning_delta", content: event.delta } })
              break

            // 工具调用完成：收集工具调用信息
            case "tool_call_end": {
              const tc: ToolCall = {
                id: event.id,
                type: "function",
                function: {
                  name: event.name,
                  arguments: event.arguments,
                },
              }
              toolCalls.push(tc)
              yield { role: "tool_call_delta", toolName: event.name, content: event.arguments }
              this.sessionWriter?.enqueue({ ts: Date.now(), type: "event", payload: { role: "tool_call_delta", toolName: event.name, content: event.arguments } })
              break
            }

            // token 用量统计
            case "usage":
              this.stats.promptTokens += event.usage.promptTokens
              this.stats.completionTokens += event.usage.completionTokens
              this.stats.cacheHitTokens += event.usage.cacheHitTokens ?? 0
              this.stats.cacheMissTokens += event.usage.cacheMissTokens ?? 0
              this.stats.apiCalls++
              this.sessionWriter?.enqueue({ ts: Date.now(), type: "stats", payload: { ...this.stats } })
              break

            // 流结束：根据 finish_reason 决定下一步
            case "done": {
              const reason = event.finishReason ?? "stop"
              const isToolUse = isToolUseFinishReason(reason)

              // 先 yield 最终助手消息（包含完整内容和推理）
              yield { role: "assistant_final", content: fullContent, metadata: { reasoning: fullReasoning || undefined } }

              if (isToolUse) {
                // 防御：API 宣称 tool_calls 但无实际调用，视为错误
                if (toolCalls.length === 0) {
                  yield { role: "warning", content: "API returned tool_calls finish_reason but no tool calls found", severity: "warning" }
                  break
                }
                // 本次需要执行工具调用
                finishedWithToolUse = true
                // 将助手响应及工具调用存入上下文
                // reasoning_content 不入库——用户可通过 assistant_final 查看，不参与 API 上下文
                this.ctx.log.append({
                  role: "assistant",
                  content: fullContent || null,
                  tool_calls: toolCalls,
                })
                this.sessionWriter?.enqueue({ ts: Date.now(), type: "messages", payload: this.ctx.buildMessages() })

                // 依次执行所有工具调用（流式输出执行过程），结果自动追加到上下文
                for await (const toolEvent of this.toolExecutor.run(toolCalls, abortController.signal, (tc, result) => this.appendToolResult(tc, result))) {
                  yield toolEvent
                  this.sessionWriter?.enqueue({ ts: Date.now(), type: "event", payload: toolEvent })
                }
                yield { role: "status", content: "tools_completed" }
                this.sessionWriter?.enqueue({ ts: Date.now(), type: "event", payload: { role: "status", content: "tools_completed" } })
              } else if (finishedWithToolUse) {
                // 防御性分支：client fix 后二次 done 不应出现，但保留以防 API 行为变化
              } else {
                // 纯文本响应（无工具调用），保存后结束
                this.ctx.log.append({ role: "assistant", content: fullContent })
                yield { role: "done", metadata: { reason } as Record<string, unknown> }
                this.sessionWriter?.enqueue({ ts: Date.now(), type: "messages", payload: this.ctx.buildMessages() })
                this.sessionWriter?.enqueue({ ts: Date.now(), type: "event", payload: { role: "done", metadata: { reason } } })
                return
              }

              break
            }

            // 流式错误
            case "error":
              streamError = { role: "error", content: event.message, severity: "error", metadata: event.status ? { status: event.status } : undefined }
              yield streamError
              this.sessionWriter?.enqueue({ ts: Date.now(), type: "event", payload: streamError })
              break
          }
        }

        if (streamError) {
          // 用户主动中断时立即退出，不进入重试
          if (this._interrupted) {
            yield { role: "status", content: "interrupted" }
            return
          }
          // 如果有部分内容，先保存再重试
          if (fullContent) {
            this.ctx.log.append({ role: "assistant", content: fullContent })
          }
          consecutiveErrors++
          if (consecutiveErrors >= 3) {
            yield { role: "error", content: `Stream failed after ${consecutiveErrors} consecutive attempts`, severity: "error" }
            return
          }
          // 继续 while 循环重试
          continue
        }
        consecutiveErrors = 0
      }

      // 超出最大工具循环次数
      yield { role: "warning", content: `Reached maximum tool loop count (${maxTurns}).`, severity: "warning" }
      yield { role: "done", metadata: { reason: "maxTurns" } }
    } finally {
      // 如果当前 abortController 仍然是活动的，清理引用
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