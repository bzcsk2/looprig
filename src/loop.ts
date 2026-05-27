// Deepicode agent loop built on pi-ai's streamSimple.
// Pi source: pi/packages/ai/src/stream.ts
// Uses pi-ai's OpenAI SDK wrapper for streaming with provider-specific compat.
// The three-region context partitioning (prefix + log + scratch) is our custom
// value-add for DeepSeek prefix-cache optimization.

// 从 pi-ai vendor 中导入流式对话核心函数
import { streamSimple } from "./vendor/pi.js"
// 导入 pi-ai 的类型：Model 表示模型配置，SimpleStreamOptions 表示流式请求选项
import type { Model, SimpleStreamOptions } from "./vendor/pi.js"
// 用户配置类型
import type { DeepicodeConfig } from "./config.js"
// 将 DeepicodeConfig 转换为 pi-ai Model 对象的工厂函数
import { buildPiModel } from "./config.js"
// 三区域上下文管理器：prefix（系统提示词）+ log（对话历史）+ scratch（临时）
import { ContextManager } from "./context/manager.js"
// 内部使用的类型：AgentEvent——产出的事件；ChatMessage——对话消息；ToolCall/ToolSpec——工具调用规范；Usage——token用量
import type { AgentEvent, ChatMessage, ToolCall, ToolSpec, Usage as DeepUsage } from "./types.js"

// 工具处理器接口：spec 描述工具给 LLM 看，execute 是实际执行逻辑
export interface ToolHandler {
  // 工具元信息（名称、描述、参数 schema），发送给 LLM 使其知道有哪些工具可用
  spec: ToolSpec
  // 执行工具的异步函数，接收 JSON 对象参数，返回执行结果的字符串
  execute: (args: Record<string, unknown>) => Promise<string>
}

// AgentLoop：核心循环类，管理一次对话的生命周期
// 职责：组装上下文 → 调用 LLM 流式接口 → 解析事件 → 分发 tool call → 循环直到结束
export class AgentLoop {
  // 用户配置，包含 apiKey、baseUrl、model、maxTokens、temperature 等
  private config: DeepicodeConfig
  // pi-ai 模型封装对象，内部持有 baseUrl 和模型名
  private model: Model
  // 上下文管理器，维护 prefix + log + scratch 三段式上下文
  private ctx: ContextManager
  // 已注册的工具映射表，key 为工具名（function name），value 为 ToolHandler
  private tools: Map<string, ToolHandler> = new Map()

  // 构造函数：接收配置，构建 pi-ai model，初始化上下文管理器
  constructor(config: DeepicodeConfig) {
    this.config = config
    this.model = buildPiModel(config)
    this.ctx = new ContextManager()
  }

  // 设置系统提示词：代理调用 ContextManager.prefix.build 写入 prefix 区域
  setSystemPrompt(prompt: string): void {
    this.ctx.prefix.build(prompt)
  }

  // 注册一个工具处理器，存入 tools Map 中，key 为 function name
  registerTool(handler: ToolHandler): void {
    this.tools.set(handler.spec.function.name, handler)
  }

  // 暴露上下文管理器（给外部使用，例如设置 scratch 区域内容）
  getContextManager(): ContextManager {
    return this.ctx
  }

  // chat 是核心方法：async generator，接收用户输入，产出 AgentEvent 流
  // AgentEvent 类型包括：text（文本块）、reasoning（思考过程）、tool_call_start/end（工具调用）、usage（用量）、error（错误）
  async *chat(userInput: string): AsyncGenerator<AgentEvent> {
    // 开始新一轮对话：清空 scratch，将 log 中的消息合并到 baseMessages
    this.ctx.startTurn()
    // 把用户本次输入追加到 log 区域（对话历史）
    this.ctx.log.append({ role: "user", content: userInput })

    // 如果注册了工具，提取所有 ToolSpec 传给 LLM，使其能调用工具
    const toolSpecs = this.tools.size > 0
      ? Array.from(this.tools.values()).map((t) => t.spec)
      : undefined

    // 轮次计数器，防止无限循环（每次 LLM 返回 toolUse 会触发新的一轮）
    let turnCount = 0
    const maxTurns = 10

    // 最大 10 轮 tool call 循环
    while (turnCount < maxTurns) {
      turnCount++
      // 构建完整的消息数组（prefix + baseMessages（log 聚合）+ scratch）
      const messages = this.ctx.buildMessages()

      // 构建 pi-ai 流式请求选项
      // 核心技巧：onPayload 回调在每次请求前拦截请求体，
      // 我们用自己组装好的 messages 替换掉 pi-ai 内部生成的消息
      const options: SimpleStreamOptions = {
        apiKey: this.config.apiKey,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        onPayload: (payload) => ({
          ...(payload as Record<string, unknown>),
          messages: messages.map(toOpenAIMessage),
          ...(toolSpecs ? { tools: toolSpecs } : {}),
        }),
      }

      // 调用 pi-ai 的流式接口
      // 传入的 systemPrompt/messages/tools 是占位符，实际通过 onPayload 注入
      const stream = streamSimple(this.model, { systemPrompt: undefined, messages: [], tools: undefined }, options)

      // 累计本次 LLM 回复的完整文本（用于后续追加到对话历史）
      let fullContent = ""
      // 累计思考链内容（DeepSeek 的 reasoning_content 字段）
      let fullReasoning = ""
      // 本轮 LLM 发起的工具调用列表
      const toolCalls: ToolCall[] = []

      // 逐事件消费流
      for await (const event of stream) {
        // 文本增量事件：LLM 正在输出文字
        if (event.type === "text_delta") {
          fullContent += event.delta
          yield { type: "text", content: event.delta }
        // 思考过程增量事件：DeepSeek 的 reasoning 模式
        } else if (event.type === "thinking_delta") {
          fullReasoning += event.delta
          yield { type: "reasoning", content: event.delta }
        // 工具调用完成事件：LLM 决定调用某个工具
        } else if (event.type === "toolcall_end") {
          toolCalls.push({
            id: event.toolCall.id,
            type: "function",
            function: {
              name: event.toolCall.name,
              arguments: JSON.stringify(event.toolCall.arguments),
            },
          })
          yield { type: "tool_call_start", toolCall: toolCalls[toolCalls.length - 1] }
        // 流结束事件：携带结束原因和用量信息
        } else if (event.type === "done") {
          // 如果有用量信息，转换格式后产出
          if (event.message.usage) {
            yield { type: "usage", usage: mapUsage(event.message.usage) }
          }

          // 结束原因为 toolUse：LLM 要求调用工具，需要继续下一轮
          if (event.reason === "toolUse") {
            // 将助手消息（含 tool_calls 数组）追加到对话历史
            this.ctx.log.append({
              role: "assistant",
              content: fullContent || fullReasoning || null,
              tool_calls: toolCalls,
            })

            // 遍历每一个 tool call，依次执行
            for (const tc of toolCalls) {
              yield { type: "tool_call_end", toolCall: tc }
              try {
                // 解析工具参数 JSON
                const args = JSON.parse(tc.function.arguments) as Record<string, unknown>
                // 根据工具名查找已注册的处理器
                const handler = this.tools.get(tc.function.name)
                if (handler) {
                  // 找到处理器：执行并获取结果
                  const result = await handler.execute(args)
                  // 将工具执行结果追加到对话历史
                  this.ctx.log.append({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: result,
                    name: tc.function.name,
                  })
                } else {
                  // 未找到处理器：返回错误信息
                  this.ctx.log.append({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({ error: `Unknown tool: ${tc.function.name}` }),
                    name: tc.function.name,
                  })
                }
              } catch (e) {
                // 工具执行抛出异常：捕获并返回错误信息
                this.ctx.log.append({
                  role: "tool",
                  tool_call_id: tc.id,
                  content: JSON.stringify({ error: String(e) }),
                  name: tc.function.name,
                })
              }
            }
          } else {
            // 结束原因不是 toolUse（如 stop、length）：直接追加助手回复到历史，本轮结束
            this.ctx.log.append({ role: "assistant", content: fullContent })
          }

          // 只有 toolUse 才会继续 while 循环进入下一轮，否则退出 chat
          if (event.reason !== "toolUse") return
          break
        // 错误事件：LLM 调用出错，产出错误事件后退出
        } else if (event.type === "error") {
          yield { type: "error", error: event.error.errorMessage || "Unknown error" }
          return
        }
      }
    }
  }
}

// 将内部 ChatMessage 格式转换为 OpenAI ChatCompletionMessageParam 格式
// pi-ai 内部使用 OpenAI SDK，通过 onPayload 注入我们自己转换的消息
// 这样既利用了 pi-ai 的流式能力，又能完全控制上下文内容
function toOpenAIMessage(msg: ChatMessage): Record<string, unknown> {
  const base: Record<string, unknown> = { role: msg.role }
  switch (msg.role) {
    // system 角色：仅包含 content 文本
    case "system":
      base.content = msg.content
      break
    // user 角色：content 不可为 null，兜底为空字符串
    case "user":
      base.content = msg.content ?? ""
      break
    // assistant 角色：可能包含 content 和 tool_calls
    case "assistant":
      base.content = msg.content
      if (msg.tool_calls?.length) {
        base.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }))
      }
      break
    // tool 角色：包含 tool_call_id（关联哪个 tool call）和 content
    case "tool":
      base.tool_call_id = msg.tool_call_id ?? ""
      base.content = msg.content ?? ""
      break
    default:
      throw new Error(`Unknown message role: ${msg.role}`)
  }
  return base
}

// 将 pi-ai 的用量格式映射为内部 Usage 格式
// pi-ai 返回的对象字段是 input/output/totalTokens/cacheRead/cacheWrite
// 内部类型使用 prompt_tokens/completion_tokens/total_tokens/prompt_cache_hit_tokens/prompt_cache_miss_tokens
function mapUsage(u: { input: number; output: number; totalTokens: number; cacheRead: number; cacheWrite: number }): DeepUsage {
  return {
    prompt_tokens: u.input,
    completion_tokens: u.output,
    total_tokens: u.totalTokens,
    prompt_cache_hit_tokens: u.cacheRead,
    prompt_cache_miss_tokens: u.cacheWrite,
  }
}
