import type { AgentTool, LoopEvent, ToolContext, ToolResult, ToolProgressUpdate } from "./interface.js"
import type { ToolCall } from "./types.js"
import { repairToolArguments } from "./context/repair.js"
import type { PermissionEngine, HookManager, PermissionDecision } from "@deepicode/security"
import { maybePersistResult, type ResultPersistenceConfig } from "./result-persistence.js"
import { noopRuntimeLogger, type RuntimeLogger } from "./runtime-logger.js"

export class StreamingToolExecutor {
  private tools: Map<string, AgentTool>
  private sessionId: string
  private cwd: string
  private permissionEngine?: PermissionEngine
  private hookManager?: HookManager
  private requestPermission?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>
  private delegateTask?: (task: string, agentType: "build" | "plan", files: string[]) => Promise<string>
  private switchAgent?: (name: "build" | "plan") => string
  private resultPersistenceConfig?: ResultPersistenceConfig
  private logger: RuntimeLogger

  setSessionId(id: string): void {
    this.sessionId = id
  }

  constructor(
    tools: Map<string, AgentTool>,
    sessionId: string,
    cwd?: string,
    permissionEngine?: PermissionEngine,
    hookManager?: HookManager,
    requestPermission?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>,
    delegateTask?: (task: string, agentType: "build" | "plan", files: string[]) => Promise<string>,
    switchAgent?: (name: "build" | "plan") => string,
    resultPersistenceConfig?: ResultPersistenceConfig,
    logger: RuntimeLogger = noopRuntimeLogger,
  ) {
    this.tools = tools
    this.sessionId = sessionId
    this.cwd = cwd ?? process.cwd()
    this.permissionEngine = permissionEngine
    this.hookManager = hookManager
    this.requestPermission = requestPermission
    this.delegateTask = delegateTask
    this.switchAgent = switchAgent
    this.resultPersistenceConfig = resultPersistenceConfig
    this.logger = logger
  }

  async *run(toolCalls: ToolCall[], signal: AbortSignal, appendToolResult: (tc: ToolCall, result: ToolResult) => void, traceContext?: Record<string, unknown>): AsyncGenerator<LoopEvent> {
    const logger = traceContext && this.logger.isEnabled("error")
      ? this.logger.child(traceContext)
      : this.logger
    // P1: settled set tracks which tool call indices have already written a result.
    // Every branch (success, error, permission deny, user deny, abort) must go through
    // the settle() helper which checks this set before calling appendToolResult.
    const settled = new Set<number>()

    const settle = (tc: ToolCall, index: number, result: ToolResult): boolean => {
      if (settled.has(index)) return false
      settled.add(index)
      appendToolResult(tc, result)
      return true
    }

    let sharedBatch: Array<{ tc: ToolCall; index: number }> = []

    const flushSharedBatch = async function* (
      exec: StreamingToolExecutor,
      batch: Array<{ tc: ToolCall; index: number }>,
    ): AsyncGenerator<LoopEvent> {
      if (batch.length === 0) return
      const diagnosticsEnabled = logger.isEnabled("error")
      const batchStartedAt = diagnosticsEnabled ? Date.now() : 0
      if (diagnosticsEnabled) {
        const sharedCount = batch.filter(({ tc }) => exec.tools.get(tc.function.name)?.concurrency === "shared").length
        logger.debug("tool.batch.start", { count: batch.length, sharedCount, exclusiveCount: batch.length - sharedCount })
      }

      // Permission check for all tools in batch (must run before dispatching)
      const allowedBatch: Array<{ tc: ToolCall; index: number }> = []
      for (const { tc, index } of batch) {
        const permResult = await exec.checkAskPermission(tc, index)
        if (permResult === "deny") {
          const result = makeToolError(`Tool call denied: ${tc.function.name} requires manual approval`)
          settle(tc, index, result)
          yield { role: "error", content: result.content, toolName: tc.function.name, toolCallIndex: index, severity: "error" }
          continue
        }
        if (permResult === "ask") {
          let args: Record<string, unknown>
          try { args = JSON.parse(tc.function.arguments) } catch { args = {} }
          const permPromise = exec.requestPermission!(tc.function.name, args)
          yield { role: "permission_ask", toolName: tc.function.name, content: JSON.stringify(args) }
          const allowed = await permPromise
          if (!allowed) {
            const result = makeToolError(`Tool call denied by user: ${tc.function.name}`)
            settle(tc, index, result)
            if (diagnosticsEnabled) logger.warn("tool.execute.denied", { permissionSource: "user", durationMs: Date.now() - batchStartedAt })
            yield { role: "error", content: result.content, toolName: tc.function.name, toolCallIndex: index, severity: "error" }
            continue
          }
        }
        allowedBatch.push({ tc, index })
      }
      if (allowedBatch.length === 0) return

      // P1: Start executing tools BEFORE yielding events, so tools that complete
      // synchronously finish before the consumer can abort.
      const pending = allowedBatch.map(({ tc, index }) =>
        exec.executeToolResult(tc, index, signal, logger).then((r) => ({ index, tc, ...r })) as Promise<{ index: number; tc: ToolCall; event: LoopEvent; result: ToolResult }>,
      )

      for (const { tc, index } of allowedBatch) {
        yield { role: "tool_start", toolName: tc.function.name, toolCallIndex: index }
        yield { role: "tool_progress", toolName: tc.function.name, toolCallIndex: index, content: "running" }
      }

      const completed = await Promise.allSettled(pending)
      // Reorder by declaration index before yielding
      const settled_results: Array<{ index: number; tc: ToolCall; event: LoopEvent; result: ToolResult }> = []
      for (let i = 0; i < completed.length; i++) {
        const entry = completed[i]
        if (entry.status === "fulfilled") {
          settled_results.push(entry.value)
        } else {
          // Promise rejected (shouldn't happen since executeToolResult catches, but defensive)
          const { tc, index } = allowedBatch[i]
          const result = makeToolError(`Tool execution failed: ${errorMessage(entry.reason)}`)
          settle(tc, index, result)
          yield { role: "error", content: result.content, toolName: tc.function.name, toolCallIndex: index, severity: "error" }
        }
      }
      settled_results.sort((a, b) => a.index - b.index)

      for (const { index, tc, event, result } of settled_results) {
        settle(tc, index, result)
        yield event
        yield { role: "tool_progress", toolName: event.toolName, toolCallIndex: index, content: "done" }
      }
      if (diagnosticsEnabled) {
        const errorCount = settled_results.filter(r => r.result.isError).length
        logger.debug("tool.batch.done", { durationMs: Date.now() - batchStartedAt, errorCount })
      }
    }

    try {
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
        yield* this.executeToolCall(tc, index, signal, settle, logger)
      }

      yield* flushSharedBatch(this, sharedBatch)
    } catch {
      // P1: On generator abort, settle any remaining unsettled tool calls.
      // This replaces the blind batch补写 in loop.ts.
      for (let index = 0; index < toolCalls.length; index++) {
        if (!settled.has(index)) {
          const tc = toolCalls[index]
          const result = makeToolError("tool execution interrupted")
          settle(tc, index, result)
          yield { role: "error", content: result.content, toolName: tc.function.name, toolCallIndex: index, severity: "error" }
        }
      }
    }
  }

  // Check "ask" permission decision. Returns:
  //   "allow" — hook allowed or no "ask" decision
  //   "deny"  — hook denied or no confirmation channel
  //   "ask"   — need to yield permission_ask event and await user response
  private async checkAskPermission(tc: ToolCall, _index: number): Promise<"allow" | "deny" | "ask"> {
    const handler = this.tools.get(tc.function.name)
    if (!handler || !this.permissionEngine) return "allow"
    let args: Record<string, unknown>
    try { args = parseToolArguments(tc.function.arguments) } catch { args = {} }
    const check = this.permissionEngine.decide(tc.function.name, args, handler.approval)
    if (check?.decision !== "ask") return "allow"
    let hookDecision: PermissionDecision | void
    try {
      hookDecision = await this.hookManager?.runBeforeToolCall({
        toolName: tc.function.name, args, tier: handler.approval,
        permissionDecision: "ask", permissionReason: check.reason,
      })
    } catch { hookDecision = "deny" }
    if (hookDecision === "allow") return "allow"
    if (hookDecision === "deny") return "deny"
    if (this.requestPermission) return "ask"
    return "deny" // no confirmation channel
  }

  // Execute tool and return result without appending to context
  private async executeToolResult(tc: ToolCall, index: number, signal: AbortSignal, baseLogger = this.logger, reportProgress?: (update: ToolProgressUpdate) => void): Promise<{ event: LoopEvent; result: ToolResult }> {
    const diagnosticsEnabled = baseLogger.isEnabled("error")
    const startedAt = diagnosticsEnabled ? Date.now() : 0
    const logger = diagnosticsEnabled
      ? baseLogger.child({ toolCallId: tc.id, toolName: tc.function.name, toolCallIndex: index })
      : baseLogger
    const handler = this.tools.get(tc.function.name)
    const toolCtx = this.createToolContext(signal, [tc.function.name], reportProgress)

    if (!handler) {
      const result = makeToolError(`Unknown tool: ${tc.function.name}`)
      if (diagnosticsEnabled) logger.warn("tool.execute.unknown", { durationMs: Date.now() - startedAt })
      return { event: makeErrorEvent(result, tc.function.name, index), result }
    }
    if (diagnosticsEnabled) logger.info("tool.execute.start", { concurrency: handler.concurrency, approval: handler.approval })

    let args: Record<string, unknown>
    try {
      args = parseToolArguments(tc.function.arguments)
    } catch {
      const repaired = repairToolArguments(tc.function.arguments)
      if (!repaired.success) {
        const result = makeToolError(`Invalid arguments for ${tc.function.name}: failed all repair stages`)
        if (diagnosticsEnabled) logger.warn("tool.arguments.invalid", { durationMs: Date.now() - startedAt })
        return { event: makeErrorEvent(result, tc.function.name, index), result }
      }
      if (repaired.partial) {
        // AUD-08: Reject partial repairs — storm() with >1 KV pair is unreliable
        const result = makeToolError(`Partial argument repair for ${tc.function.name}: ${JSON.stringify(repaired.args)} — cannot determine complete arguments, skipping`)
        if (diagnosticsEnabled) logger.warn("tool.arguments.partial", { durationMs: Date.now() - startedAt })
        return { event: makeErrorEvent(result, tc.function.name, index), result }
      }
      args = repaired.args
      if (diagnosticsEnabled) logger.warn("tool.arguments.repaired")
    }

    try {
      const check = this.permissionEngine?.decide(tc.function.name, args, handler.approval)
      if (check?.decision === "deny") {
        const result = makeToolError(check.reason ?? "Permission denied")
        if (diagnosticsEnabled) logger.warn("tool.execute.denied", { durationMs: Date.now() - startedAt })
        return { event: makeErrorEvent(result, tc.function.name, index), result }
      }
      // "ask" decisions are handled upstream in executeToolCall (async generator)
      // where yield is available for UI confirmation events.
      // Here we only enforce deny; allow or unhandled-ask fall through to execution.

      // P1: If signal already aborted before execution starts, fail immediately
      // rather than letting the tool run and produce a result that will be ignored.
      if (signal.aborted) {
        const result = makeToolError("tool execution interrupted")
        if (diagnosticsEnabled) logger.warn("tool.execute.aborted", { durationMs: Date.now() - startedAt })
        return { event: makeErrorEvent(result, tc.function.name, index), result }
      }

      const rawResult = normalizeToolResult(await handler.execute(args, toolCtx))

      // P4: Check if result needs overflow persistence
      let result = rawResult
      if (!rawResult.isError && this.resultPersistenceConfig) {
        const persisted = await maybePersistResult(
          rawResult.content,
          this.sessionId,
          tc.function.name,
          this.resultPersistenceConfig,
          logger,
        )
        result = { ...rawResult, content: persisted.content }
        if (persisted.persisted) {
          result.metadata = { ...result.metadata, ...persisted.persisted }
        }
        if (persisted.warning) {
          // Emit warning via hook (non-blocking)
          this.hookManager?.runAfterToolCall(tc.function.name, { content: persisted.warning, isError: false, metadata: { warning: true } })
        }
      }

      this.hookManager?.runAfterToolCall(tc.function.name, { content: result.content, isError: result.isError, metadata: result.metadata })
      if (diagnosticsEnabled) logger.info("tool.execute.done", { durationMs: Date.now() - startedAt, isError: result.isError })
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
      this.hookManager?.runAfterToolCall(tc.function.name, { content: result.content, isError: true, metadata: result.metadata })
      if (diagnosticsEnabled) logger.error("tool.execute.error", e, { durationMs: Date.now() - startedAt })
      return { event: makeErrorEvent(result, tc.function.name, index), result }
    }
  }

  private createToolContext(signal: AbortSignal, stack: string[], reportProgress?: (update: ToolProgressUpdate) => void): ToolContext {
    return {
      cwd: this.cwd,
      sessionId: this.sessionId,
      signal,
      reportProgress,
      delegateTask: this.delegateTask,
      switchAgent: this.switchAgent,
      invokeTool: async (name, args) => {
        if (stack.includes(name)) {
          return makeToolError(`Recursive tool invocation is not allowed: ${[...stack, name].join(" -> ")}`)
        }
        const handler = this.tools.get(name)
        if (!handler) return makeToolError(`Unknown tool: ${name}`)
        const permission = this.permissionEngine?.decide(name, args, handler.approval)
        if (permission?.decision === "deny") return makeToolError(permission.reason ?? `Permission denied: ${name}`)
        // Workflow itself is exec-tier and its complete step list was already
        // confirmed by the user. Deny rules still take precedence above.
        if (permission?.decision === "ask" && stack[0] !== "Workflow") {
          return makeToolError(`Nested tool requires direct confirmation and was not executed: ${name}`)
        }
        try {
          return normalizeToolResult(await handler.execute(args, this.createToolContext(signal, [...stack, name])))
        } catch (e) {
          return makeToolError(errorMessage(e))
        }
      },
    }
  }

  private async *executeToolCall(
    tc: ToolCall,
    index: number,
    signal: AbortSignal,
    settle: (tc: ToolCall, index: number, result: ToolResult) => boolean,
    logger: RuntimeLogger,
  ): AsyncGenerator<LoopEvent, void> {
    yield { role: "tool_progress", toolName: tc.function.name, toolCallIndex: index, content: "running" }

    // P5.5: Progress buffer — tools push updates via reportProgress, flushed after execution
    const progressBuffer: ToolProgressUpdate[] = []
    const reportProgress = (update: ToolProgressUpdate) => {
      progressBuffer.push(update)
    }

    const permResult = await this.checkAskPermission(tc, index)
    if (permResult === "deny") {
      const result = makeToolError(`Tool call denied: ${tc.function.name} requires manual approval`)
      settle(tc, index, result)
      yield { role: "error", content: result.content, toolName: tc.function.name, toolCallIndex: index, severity: "error" }
      return
    }
    if (permResult === "ask") {
      let args: Record<string, unknown>
      try { args = parseToolArguments(tc.function.arguments) } catch { args = {} }
      const permPromise = this.requestPermission!(tc.function.name, args) // create Promise before yielding
      yield { role: "permission_ask", toolName: tc.function.name, content: JSON.stringify(args) }
      const allowed = await permPromise
      if (!allowed) {
        const result = makeToolError(`Tool call denied by user: ${tc.function.name}`)
        settle(tc, index, result)
        yield { role: "error", content: result.content, toolName: tc.function.name, toolCallIndex: index, severity: "error" }
        return
      }
    }

    const { event, result } = await this.executeToolResult(tc, index, signal, logger, reportProgress)
    settle(tc, index, result)
    // P5.5: Flush buffered progress before "done"
    for (const p of progressBuffer) {
      yield { role: "tool_progress", toolName: tc.function.name, toolCallIndex: index, content: p.content, metadata: p.metadata }
    }
    yield event
    yield { role: "tool_progress", toolName: tc.function.name, toolCallIndex: index, content: "done" }
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
