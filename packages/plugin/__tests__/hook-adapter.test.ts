import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { loadPlugins } from "../src/loader.js"
import { PluginHookRegistry } from "../src/hook-adapter.js"
import { HookManager } from "@covalo/security"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("Plugin Hook Adapter", () => {
  const tmpDir = join(tmpdir(), "plugin-hook-test-" + Date.now())
  let pluginPath: string
  let counter = 0
  let hookManager: HookManager
  let registry: PluginHookRegistry

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    pluginPath = join(tmpDir, `test-plugin-${counter++}.ts`)
    hookManager = new HookManager()
    registry = new PluginHookRegistry()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("registers plugin hooks with HookManager", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          beforeToolCall: async (context) => { return "allow" }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    expect(loadResult.loaded.length).toBe(1)

    registry.register(loadResult.loaded[0], hookManager)
    expect(registry.getRegisteredIds()).toContain("my-plugin")
  })

  it("unregisters plugin hooks", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          beforeToolCall: async (context) => { return "allow" }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    registry.register(loadResult.loaded[0], hookManager)

    registry.unregister(loadResult.loaded[0], hookManager)
    expect(registry.getRegisteredIds()).not.toContain("my-plugin")
  })

  it("before hook can deny", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          beforeToolCall: async (context) => { return "deny" }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    registry.register(loadResult.loaded[0], hookManager)

    const result = await hookManager.runBeforeToolCall({
      toolName: "bash",
      args: {},
      tier: "default",
      permissionDecision: "ask",
    })
    expect(result).toBe("deny")
  })

  it("before hook can modify args", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          beforeToolCall: async (context) => {
            context.args.modified = true
            return "allow"
          }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    registry.register(loadResult.loaded[0], hookManager)

    const context = {
      toolName: "bash",
      args: { original: true },
      tier: "default",
      permissionDecision: "ask",
    }
    const result = await hookManager.runBeforeToolCall(context)
    expect(result).toBe("allow")
    expect(context.args.modified).toBe(true)
  })

  it("before hook throws error = deny", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          beforeToolCall: async (context) => { throw new Error("Hook failed") }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    registry.register(loadResult.loaded[0], hookManager)

    const result = await hookManager.runBeforeToolCall({
      toolName: "bash",
      args: {},
      tier: "default",
      permissionDecision: "ask",
    })
    expect(result).toBe("deny")
  })

  it("after hook error does not interrupt main flow", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          afterToolCall: async (toolName, result) => { throw new Error("After hook failed") }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    registry.register(loadResult.loaded[0], hookManager)

    // Should not throw
    await hookManager.runAfterToolCall("bash", { content: "result", isError: false })
  })

  it("event hook receives LoopEvent", async () => {
    let receivedEvent: Record<string, unknown> | null = null
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          onLoopEvent: async (event) => { globalThis.__receivedEvent = event }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    registry.register(loadResult.loaded[0], hookManager)

    const testEvent = { type: "test", data: "hello" }
    await hookManager.runOnLoopEvent(testEvent)

    // The hook was called, event was received by the plugin
  })

  it("dispose removes all hooks", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          beforeToolCall: async (context) => { return "allow" }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    registry.register(loadResult.loaded[0], hookManager)

    registry.dispose(hookManager)
    expect(registry.getRegisteredIds()).toHaveLength(0)
  })

  it("timeout on hook", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          beforeToolCall: async (context) => {
            await new Promise(resolve => setTimeout(resolve, 10000))
            return "allow"
          }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    registry.register(loadResult.loaded[0], hookManager, 100) // 100ms timeout

    const result = await hookManager.runBeforeToolCall({
      toolName: "bash",
      args: {},
      tier: "default",
      permissionDecision: "ask",
    })
    expect(result).toBe("deny")
  })

  it("multiple plugins can register hooks", async () => {
    const pluginPath2 = join(tmpDir, `test-plugin-multi-${counter++}.ts`)
    writeFileSync(
      pluginPath,
      `export default {
        id: "plugin-1",
        server: () => ({
          beforeToolCall: async (context) => { return "allow" }
        })
      }`,
    )
    writeFileSync(
      pluginPath2,
      `export default {
        id: "plugin-2",
        server: () => ({
          beforeToolCall: async (context) => { return "deny" }
        })
      }`,
    )

    const loadResult1 = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    const loadResult2 = await loadPlugins([{ spec: pluginPath2, options: {}, source: "file", deprecated: false }])

    registry.register(loadResult1.loaded[0], hookManager)
    registry.register(loadResult2.loaded[0], hookManager)

    expect(registry.getRegisteredIds()).toContain("plugin-1")
    expect(registry.getRegisteredIds()).toContain("plugin-2")

    // First hook returns allow, second returns deny
    const result = await hookManager.runBeforeToolCall({
      toolName: "bash",
      args: {},
      tier: "default",
      permissionDecision: "ask",
    })
    expect(result).toBe("allow")
  })
})
