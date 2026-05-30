import type { PermissionDecision } from "./permission.js"

export interface BeforeToolCallContext {
  toolName: string
  args: Record<string, unknown>
  tier: string
  permissionDecision: PermissionDecision
  permissionReason?: string
}

export interface ToolCallResult {
  content: string
  isError: boolean
  metadata?: Record<string, unknown>
}

export interface ToolCallHooks {
  beforeToolCall?: (context: BeforeToolCallContext) => Promise<PermissionDecision | void>
  afterToolCall?: (toolName: string, result: ToolCallResult) => Promise<void>
  onLoopEvent?: (event: Record<string, unknown>) => Promise<void>
}

export class HookManager {
  private hooks: ToolCallHooks[] = []

  addHooks(hooks: ToolCallHooks): void {
    this.hooks.push(hooks)
  }

  removeHooks(hooks: ToolCallHooks): void {
    this.hooks = this.hooks.filter(h => h !== hooks)
  }

  clear(): void {
    this.hooks = []
  }

  async runBeforeToolCall(context: BeforeToolCallContext): Promise<PermissionDecision | void> {
    for (const hooks of this.hooks) {
      if (hooks.beforeToolCall) {
        const result = await hooks.beforeToolCall(context)
        if (result === "deny" || result === "allow") return result
      }
    }
  }

  async runAfterToolCall(toolName: string, result: ToolCallResult): Promise<void> {
    for (const hooks of this.hooks) {
      if (hooks.afterToolCall) {
        await hooks.afterToolCall(toolName, result)
      }
    }
  }

  async runOnLoopEvent(event: Record<string, unknown>): Promise<void> {
    for (const hooks of this.hooks) {
      if (hooks.onLoopEvent) {
        await hooks.onLoopEvent(event)
      }
    }
  }
}
