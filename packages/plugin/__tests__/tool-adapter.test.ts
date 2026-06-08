import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { loadPlugins } from "../src/loader.js"
import { extractToolsFromPlugins, pluginToolsToToolSpecs, executePluginTool } from "../src/tool-adapter.js"
import { mkdirSync, writeFileSync, unlinkSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("Plugin Tool Adapter", () => {
  const tmpDir = join(tmpdir(), "plugin-tool-test-" + Date.now())
  let pluginPath: string
  let counter = 0

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    pluginPath = join(tmpDir, `test-plugin-${counter++}.ts`)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("extracts tools from plugin hooks", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          greet: (args) => "Hello, " + args.name,
          add: (args) => args.a + args.b
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    expect(loadResult.loaded.length).toBe(1)

    const result = await extractToolsFromPlugins(loadResult.loaded)
    expect(result.tools.length).toBe(2)
    expect(result.tools[0].name).toBe("my-plugin.greet")
    expect(result.tools[1].name).toBe("my-plugin.add")
    expect(result.errors.length).toBe(0)
  })

  it("converts tools to ToolSpec format", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          greet: (args) => "Hello, " + args.name
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    const toolsResult = await extractToolsFromPlugins(loadResult.loaded)
    const toolSpecs = pluginToolsToToolSpecs(toolsResult.tools)

    expect(toolSpecs.length).toBe(1)
    expect(toolSpecs[0].type).toBe("function")
    expect(toolSpecs[0].function.name).toBe("my-plugin.greet")
    expect(toolSpecs[0].function.description).toBe("Plugin tool my-plugin.greet")
    expect(toolSpecs[0].function.parameters.type).toBe("object")
  })

  it("executes plugin tool and returns string", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          greet: (args) => "Hello, " + args.name
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    const toolsResult = await extractToolsFromPlugins(loadResult.loaded)
    const result = await executePluginTool(toolsResult.tools[0], { name: "World" })
    expect(result).toBe("Hello, World")
  })

  it("executes plugin tool and returns { title, output, metadata }", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          greet: (args) => ({ title: "Greeting", output: "Hello, " + args.name, metadata: { timestamp: Date.now() } })
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    const toolsResult = await extractToolsFromPlugins(loadResult.loaded)
    const result = await executePluginTool(toolsResult.tools[0], { name: "World" })

    const parsed = JSON.parse(result)
    expect(parsed.title).toBe("Greeting")
    expect(parsed.output).toBe("Hello, World")
    expect(parsed.metadata).toBeDefined()
  })

  it("executes plugin tool and returns object", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          getData: (args) => ({ key: "value", count: 42 })
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    const toolsResult = await extractToolsFromPlugins(loadResult.loaded)
    const result = await executePluginTool(toolsResult.tools[0], {})

    const parsed = JSON.parse(result)
    expect(parsed.key).toBe("value")
    expect(parsed.count).toBe(42)
  })

  it("handles plugin tool execution error", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          fail: (args) => { throw new Error("Tool failed") }
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    const toolsResult = await extractToolsFromPlugins(loadResult.loaded)

    await expect(executePluginTool(toolsResult.tools[0], {})).rejects.toThrow("Tool failed")
  })

  it("plugin tool cannot override built-in tools", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          bash: (args) => "Should not override"
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    const toolsResult = await extractToolsFromPlugins(loadResult.loaded)

    expect(toolsResult.tools[0].name).toBe("my-plugin.bash")
    expect(toolsResult.tools[0].name).not.toBe("bash")
  })

  it("skips non-function hooks", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({
          valid: (args) => "result"
        })
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    const toolsResult = await extractToolsFromPlugins(loadResult.loaded)

    expect(toolsResult.tools.length).toBe(1)
    expect(toolsResult.tools[0].name).toBe("my-plugin.valid")
  })

  it("returns empty tools for plugin without hooks", async () => {
    writeFileSync(
      pluginPath,
      `export default {
        id: "my-plugin",
        server: () => ({})
      }`,
    )
    const loadResult = await loadPlugins([{ spec: pluginPath, options: {}, source: "file", deprecated: false }])
    const toolsResult = await extractToolsFromPlugins(loadResult.loaded)

    expect(toolsResult.tools.length).toBe(0)
    expect(toolsResult.errors.length).toBe(0)
  })
})
