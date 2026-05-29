import type { AgentTool, LoopEvent, ToolContext, ToolResult } from "./interface.js"
import type { ToolCall } from "./types.js"

export class StreamingToolExecutor {
  private tools: Map<string, AgentTool>
  private sessionId: string

  constructor(tools: Map<string, AgentTool>, sessionId: string) {
    this.tools = tools
    this.sessionId = sessionId
  }

  async *run(toolCalls: ToolCall[], signal: AbortSignal, appendToolResult: (tc: ToolCall, result: ToolResult) => void): AsyncGenerator<LoopEvent> {
    let sharedBatch: Array<{ tc: ToolCall; index: number }> = []

    const flushSharedBatch = async function* (
      exec: StreamingToolExecutor,
      batch: Array<{ tc: ToolCall; index: number }>,
    ): AsyncGenerator<LoopEvent> {
      if (batch.length === 0) return

      for (const { tc, index } of batch) {
        yield { role: "tool_start", toolName: tc.function.name, toolCallIndex: index }
      }

      const pending = batch.map(({ tc, index }) => ({
        index,
        promise: exec.executeToolCall(tc, index, signal, appendToolResult),
      }))

      while (pending.length > 0) {
        const completed = await Promise.race(
          pending.map(({ index, promise }) => promise.then((event) => ({ index, event }))),
        )
        const pendingIndex = pending.findIndex((item) => item.index === completed.index)
        if (pendingIndex >= 0) pending.splice(pendingIndex, 1)
        yield completed.event
      }
    }

    for (let index = 0; index < toolCalls.length; index++) {
      const tc = toolCalls[index]
      const handler = this.tools.get(tc.function.name)

      if (handler?.concurrency === "shared") {
        sharedBatch.push({ tc, index })
        continue
      }

      yield* flushSharedBatch(this, sharedBatch)
      sharedBatch = []

      yield { role: "tool_start", toolName: tc.function.name, toolCallIndex: index }
      yield await this.executeToolCall(tc, index, signal, appendToolResult)
    }

    yield* flushSharedBatch(this, sharedBatch)
  }

  private async executeToolCall(
    tc: ToolCall,
    index: number,
    signal: AbortSignal,
    appendToolResult: (tc: ToolCall, result: ToolResult) => void,
  ): Promise<LoopEvent> {
    const handler = this.tools.get(tc.function.name)
    const toolCtx: ToolContext = { cwd: process.cwd(), sessionId: this.sessionId, signal }

    if (!handler) {
      const result = makeToolError(`Unknown tool: ${tc.function.name}`)
      appendToolResult(tc, result)
      return {
        role: "error",
        content: result.content,
        toolName: tc.function.name,
        toolCallIndex: index,
        severity: "error",
        metadata: result.metadata,
      }
    }

    let args: Record<string, unknown>
    try {
      args = parseToolArguments(tc.function.arguments)
    } catch (e) {
      const result = makeToolError(`Invalid arguments for ${tc.function.name}: ${errorMessage(e)}`)
      appendToolResult(tc, result)
      return {
        role: "error",
        content: result.content,
        toolName: tc.function.name,
        toolCallIndex: index,
        severity: "error",
        metadata: result.metadata,
      }
    }

    try {
      const result = normalizeToolResult(await handler.execute(args, toolCtx))
      appendToolResult(tc, result)
      return {
        role: result.isError ? "error" : "tool",
        toolName: tc.function.name,
        toolCallIndex: index,
        content: result.content,
        severity: result.isError ? "error" : undefined,
        metadata: result.metadata,
      }
    } catch (e) {
      const result = makeToolError(errorMessage(e))
      appendToolResult(tc, result)
      return {
        role: "error",
        content: result.content,
        toolName: tc.function.name,
        toolCallIndex: index,
        severity: "error",
        metadata: result.metadata,
      }
    }
  }
}

function normalizeToolResult(result: ToolResult): ToolResult {
  return {
    content: result.content,
    isError: result.isError,
    metadata: result.metadata,
  }
}

function makeToolError(message: string): ToolResult {
  return {
    content: JSON.stringify({ error: message }),
    isError: true,
    metadata: { error: message },
  }
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("arguments must be a JSON object")
  }
  return parsed as Record<string, unknown>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

