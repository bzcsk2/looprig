import type { AgentTool, LoopEvent, ToolContext, ToolResult } from "./interface.js"
import type { ToolCall } from "./types.js"
import { repairToolArguments } from "./context/repair.js"

export class StreamingToolExecutor {
  private tools: Map<string, AgentTool>
  private sessionId: string
  private cwd: string

  constructor(tools: Map<string, AgentTool>, sessionId: string, cwd?: string) {
    this.tools = tools
    this.sessionId = sessionId
    this.cwd = cwd ?? process.cwd()
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
        yield { role: "tool_progress", toolName: tc.function.name, toolCallIndex: index, content: "running" }
      }

      // Run all shared tools concurrently, collect results
      const pending = batch.map(({ tc, index }) =>
        exec.executeToolResult(tc, index, signal).then((r) => ({ index, ...r })) as Promise<{ index: number; event: LoopEvent; result: ToolResult }>,
      )

      const completed = await Promise.all(pending)
      // Reorder by declaration index before yielding/appending
      completed.sort((a, b) => a.index - b.index)

      for (const { index, event, result } of completed) {
        const originalTc = batch.find((b) => b.index === index)!.tc
        appendToolResult(originalTc, result)
        yield event
        yield { role: "tool_progress", toolName: event.toolName, toolCallIndex: index, content: "done" }
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
      yield* this.executeToolCall(tc, index, signal, appendToolResult)
    }

    yield* flushSharedBatch(this, sharedBatch)
  }

  // Execute tool and return result without appending to context
  private async executeToolResult(tc: ToolCall, index: number, signal: AbortSignal): Promise<{ event: LoopEvent; result: ToolResult }> {
    const handler = this.tools.get(tc.function.name)
    const toolCtx: ToolContext = { cwd: this.cwd, sessionId: this.sessionId, signal }

    if (!handler) {
      const result = makeToolError(`Unknown tool: ${tc.function.name}`)
      return { event: makeErrorEvent(result, tc.function.name, index), result }
    }

    let args: Record<string, unknown>
    try {
      args = parseToolArguments(tc.function.arguments)
    } catch {
      const repaired = repairToolArguments(tc.function.arguments)
      if (!repaired.success) {
        const result = makeToolError(`Invalid arguments for ${tc.function.name}: failed all repair stages`)
        return { event: makeErrorEvent(result, tc.function.name, index), result }
      }
      args = repaired.args
    }

    try {
      const result = normalizeToolResult(await handler.execute(args, toolCtx))
      return {
        event: {
          role: result.isError ? "error" : "tool",
          toolName: tc.function.name,
          toolCallIndex: index,
          content: result.content,
          severity: result.isError ? "error" : undefined,
          metadata: result.metadata,
        },
        result,
      }
    } catch (e) {
      const result = makeToolError(errorMessage(e))
      return { event: makeErrorEvent(result, tc.function.name, index), result }
    }
  }

  private async *executeToolCall(
    tc: ToolCall,
    index: number,
    signal: AbortSignal,
    appendToolResult: (tc: ToolCall, result: ToolResult) => void,
  ): AsyncGenerator<LoopEvent, void> {
    yield { role: "tool_progress", toolName: tc.function.name, toolCallIndex: index, content: "running" }
    const { event, result } = await this.executeToolResult(tc, index, signal)
    yield { role: "tool_progress", toolName: tc.function.name, toolCallIndex: index, content: "done" }
    appendToolResult(tc, result)
    yield event
  }
}

function makeErrorEvent(result: ToolResult, toolName: string, index: number): LoopEvent {
  return {
    role: "error",
    content: result.content,
    toolName,
    toolCallIndex: index,
    severity: "error",
    metadata: result.metadata,
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

