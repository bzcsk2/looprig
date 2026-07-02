import type { HookManager, ToolCallHooks, BeforeToolCallContext, ToolCallResult } from "@covalo/security"
import type { PermissionDecision } from "@covalo/security"
import type { PluginLoaded } from "./loader.js"

export interface PluginHookAdapter {
  register(plugin: PluginLoaded, hookManager: HookManager): void
  unregister(plugin: PluginLoaded, hookManager: HookManager): void
}

export type HookAdapterError =
  | { type: "hook_timeout"; pluginId: string; hookType: string; timeoutMs: number }
  | { type: "hook_failed"; pluginId: string; hookType: string; cause: string }

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Hook timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ])
}

function createHooksFromPlugin(
  plugin: PluginLoaded,
  timeoutMs: number = 5000,
): ToolCallHooks {
  const hooks = plugin.hooks ?? {}

  const beforeToolCall = hooks.beforeToolCall as
    | ((context: BeforeToolCallContext) => Promise<PermissionDecision | void>)
    | undefined

  const afterToolCall = hooks.afterToolCall as
    | ((toolName: string, result: ToolCallResult) => Promise<void>)
    | undefined

  const onLoopEvent = hooks.onLoopEvent as ((event: Record<string, unknown>) => Promise<void>) | undefined

  const wrappedBefore = beforeToolCall
    ? async (context: BeforeToolCallContext) => {
        try {
          return await withTimeout(beforeToolCall(context), timeoutMs)
        } catch (e) {
          throw e
        }
      }
    : undefined

  const wrappedAfter = afterToolCall
    ? async (toolName: string, result: ToolCallResult) => {
        try {
          await withTimeout(afterToolCall(toolName, result), timeoutMs)
        } catch {
          // after hook failure must not interrupt main flow
        }
      }
    : undefined

  const wrappedEvent = onLoopEvent
    ? async (event: Record<string, unknown>) => {
        try {
          await withTimeout(onLoopEvent(event), timeoutMs)
        } catch {
          // event hook failure must not interrupt main flow
        }
      }
    : undefined

  return {
    beforeToolCall: wrappedBefore,
    afterToolCall: wrappedAfter,
    onLoopEvent: wrappedEvent,
  }
}

export class PluginHookRegistry {
  private registered = new Map<string, ToolCallHooks>()

  register(plugin: PluginLoaded, hookManager: HookManager, timeoutMs: number = 5000): void {
    const hooks = createHooksFromPlugin(plugin, timeoutMs)
    this.registered.set(plugin.mod.id, hooks)
    hookManager.addHooks(hooks)
  }

  unregister(plugin: PluginLoaded, hookManager: HookManager): void {
    const hooks = this.registered.get(plugin.mod.id)
    if (hooks) {
      hookManager.removeHooks(hooks)
      this.registered.delete(plugin.mod.id)
    }
  }

  dispose(hookManager: HookManager): void {
    for (const [id, hooks] of this.registered) {
      hookManager.removeHooks(hooks)
    }
    this.registered.clear()
  }

  getRegisteredIds(): string[] {
    return Array.from(this.registered.keys())
  }
}
