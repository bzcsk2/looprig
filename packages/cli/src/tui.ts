import { stdin as input, stdout as output, stderr as errorOutput } from "node:process"
import { readFileSync, writeSync } from "node:fs"
import { resolve } from "node:path"
import { loadConfig, ReasonixEngine, SessionLoader, defaultAgentRegistry } from "@deepreef/core"
import { buildSystemPrompt } from "@deepreef/core"
import { createDefaultTools, clearReadTracker, normalizePlatform, resolveShellBackend } from "@deepreef/tools"
import { McpHost, createListMcpResourcesTool, createReadMcpResourceTool, createMcpAuthTool, createListMcpToolsTool, createCallMcpToolTool, setMcpHost } from "@deepreef/mcp"
import { PluginRuntime, pluginToolsToAgentTools } from "@deepreef/plugin"
import { MemoryService, DeepreefMemoryBridge, createMemoryRecallTool, createMemorySaveTool, createMemorySmartSearchTool, createMemoryForgetTool, createMemoryTimelineTool, createMemoryStatusTool } from "@deepreef/memory"
import React from "react"
import { wrappedRender as render } from "@deepreef/ink"
import { App } from "@deepreef/tui"

function printHelp(): void {
  output.write(`deepreef

Usage:
  bun run packages/cli/src/index.ts
  echo "你好" | bun run packages/cli/src/index.ts

Commands:
  /exit, /bye    exit the interactive session
  /help          show this help
`)
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp()
    return
  }

  const sessionIdx = process.argv.indexOf("--session")
  const sessionId = (sessionIdx >= 0 && sessionIdx + 1 < process.argv.length) ? process.argv[sessionIdx + 1] : undefined
  const config = loadConfig()

  // Initialize MCP host in background — don't block startup
  const mcpHost = new McpHost()
  setMcpHost(mcpHost)
  let mcpLoadPromise = mcpHost.loadConfig().then((summary) => {
    if (summary.failed.length > 0) {
      errorOutput.write(`[deepreef] MCP loaded with ${summary.failed.length}/${summary.serverCount} server failure(s)\n`)
    }
  }).catch((error) => {
    errorOutput.write(`[deepreef] MCP config load failed: ${error instanceof Error ? error.message : String(error)}\n`)
  })

  const engine = sessionId
    ? await ReasonixEngine.recover(config, sessionId)
    : new ReasonixEngine(config, clearReadTracker)
  SessionLoader.cleanup().catch(() => {})
  const platform = normalizePlatform()
  const shellBackend = await resolveShellBackend(platform)
  let baseSystemPrompt = buildSystemPrompt(process.cwd(), {
    osPlatform: platform,
    shellBackend: `${shellBackend.id} (${shellBackend.executable})`,
  })

  // Initialize plugin runtime (loads executable plugins and content packs)
  const pluginRuntime = new PluginRuntime({ hookManager: engine.hookManager })
  await pluginRuntime.init()
  const pluginToolAgentTools = pluginToolsToAgentTools(pluginRuntime.getTools())
  const skillDirs = pluginRuntime.getSkillDirs()

  // Register content pack agents into default registry
  for (const agent of pluginRuntime.loadAgents()) {
    defaultAgentRegistry.register(agent)
  }

  // Inject compiled rules into system prompt
  const rulesResult = pluginRuntime.compileRules()
  if (rulesResult.systemPrompt) {
    baseSystemPrompt += "\n\n" + rulesResult.systemPrompt
  }
  engine.setSystemPrompt(baseSystemPrompt)

  // Phase C: Initialize memory subsystem (non-blocking, best-effort)
  let memoryService: MemoryService | undefined
  let memoryBridge: DeepreefMemoryBridge | undefined
  const enableMemory = process.env.DEEPREEF_MEMORY !== "false"
  if (enableMemory) {
    try {
      memoryService = new MemoryService({
        autoObserve: true,
        injectContext: true,
        advancedTools: process.env.DEEPREEF_MEMORY_ADVANCED === "true",
        enableGraph: process.env.DEEPREEF_MEMORY_GRAPH === "true",
        enableConsolidation: process.env.DEEPREEF_MEMORY_CONSOLIDATE === "true",
        enableReflect: process.env.DEEPREEF_MEMORY_REFLECT === "true",
        enableSlots: process.env.DEEPREEF_MEMORY_SLOTS === "true",
      })
      await memoryService.start()
      memoryBridge = new DeepreefMemoryBridge(memoryService, { autoObserve: true, injectContext: true })

      // Inject initial memory context into system prompt
      const memContext = await memoryService.trigger("mem::context", { sessionId: engine.getSessionId(), maxChars: 2000 }).catch(() => null)
      if (memContext && typeof memContext === "object" && "context" in memContext) {
        const ctx = (memContext as { context: string }).context
        if (ctx) baseSystemPrompt += `\n\n<deepreef-memory-context>\n${ctx}\n</deepreef-memory-context>`
      }

      // Wire bridge hooks into engine's HookManager
      engine.hookManager.addHooks({
        afterToolCall: async (toolName, result) => {
          if (result.isError) {
            await memoryBridge?.onPostToolFailure(engine.getSessionId(), toolName, result.content).catch(() => {})
          } else {
            await memoryBridge?.onPostToolUse(engine.getSessionId(), toolName, result).catch(() => {})
          }
        },
        onLoopEvent: async (event) => {
          const ev = event as { role?: string; content?: string }
          if (ev.role === "assistant_delta" && ev.content && ev.content.length > 10) {
            await memoryBridge?.onPromptSubmit(engine.getSessionId(), ev.content).catch(() => {})
          }
        },
      })

      // Register memory tools
      engine.registerTool(createMemoryRecallTool(memoryService))
      engine.registerTool(createMemorySaveTool(memoryService))
      engine.registerTool(createMemorySmartSearchTool(memoryService))
      engine.registerTool(createMemoryForgetTool(memoryService))
      engine.registerTool(createMemoryTimelineTool(memoryService))
      engine.registerTool(createMemoryStatusTool(memoryService))

      process.stderr.write(`[deepreef] Memory initialized\n`)
    } catch (e) {
      process.stderr.write(`[deepreef] Memory init skipped: ${e instanceof Error ? e.message : String(e)}\n`)
      memoryService = undefined
      memoryBridge = undefined
    }
  }

  // Load content pack command skills (when mode=skill)
  // and rule skills (when rules.mode=skill)
  const commandSkills = pluginRuntime.loadCommandSkills()
  const preloadedSkills: import('@deepreef/tools').SkillDef[] = []
  for (const cs of commandSkills) {
    preloadedSkills.push({
      name: cs.name,
      description: cs.description,
      content: cs.content,
    })
  }
  // Load ECC skill defs (prevents loadSkillsDirs from bypassing selective install)
  for (const sd of pluginRuntime.loadSkillDefs()) {
    preloadedSkills.push({
      name: sd.name,
      description: sd.description,
      content: sd.content,
      source: sd.source,
    })
  }
  // Add rule skills from compileRules
  for (const rs of rulesResult.skillRules) {
    preloadedSkills.push({
      name: rs.name,
      description: rs.description,
      content: rs.content,
    })
  }

  // Load content pack MCP servers into McpHost
  const mcpConfigs = pluginRuntime.loadMcpConfigs()
  if (mcpConfigs.length > 0) {
    mcpLoadPromise = mcpLoadPromise.then(() => mcpHost.addSources(mcpConfigs)).then((summary) => {
      if (summary.failed.length > 0) {
        errorOutput.write(`[deepreef] Content pack MCP: ${summary.failed.length}/${summary.serverCount} server failure(s)\n`)
      }
    })
  }

  for (const tool of createDefaultTools(skillDirs, preloadedSkills)) {
    engine.registerTool(tool)
  }
  for (const tool of pluginToolAgentTools) {
    engine.registerTool(tool)
  }
  // MCP tools are registered separately (dynamic, discovered at runtime)
  engine.registerTool(createListMcpResourcesTool())
  engine.registerTool(createReadMcpResourceTool())
  engine.registerTool(createMcpAuthTool())
  engine.registerTool(createListMcpToolsTool())
  engine.registerTool(createCallMcpToolTool())

  try {
    if (!input.isTTY) {
      await runPipeMode(engine)
      return
    }

    await runTUIMode(engine, config, pluginRuntime, mcpConfigs.length)
  } finally {
    // Phase C: Stop memory subsystem before engine (best-effort)
    await memoryBridge?.onSessionEnd(engine.getSessionId()).catch(() => {})
    await memoryService?.stop().catch(() => {})
    // LIFE-01: close engine (tokenizer worker, logger, session writer)
    await engine.shutdown()
    pluginRuntime.dispose()
    // Wait for background MCP load to settle before disconnecting (best-effort, 2s cap)
    await Promise.race([mcpLoadPromise, new Promise<void>(r => setTimeout(r, 2000))])
    await mcpHost.disconnectAll()
  }
}

async function runPipeMode(engine: ReasonixEngine): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of input) chunks.push(Buffer.from(chunk))
  const prompt = Buffer.concat(chunks).toString("utf8").trim()
  if (!prompt) return
  for await (const event of engine.submit(prompt)) {
    switch (event.role) {
      case "assistant_delta":
        output.write(event.content ?? "")
        break
      case "assistant_final":
        output.write("\n")
        break
      case "reasoning_delta":
        break
      case "tool_call_delta":
        break
      case "tool_start":
        output.write(`\n[tool] ${event.toolName ?? "unknown"} ...\n`)
        break
      case "tool_progress":
        break
      case "tool": {
        const c = event.content ?? ""
        try { const p = JSON.parse(c) as Record<string,unknown>; output.write(JSON.stringify(p, null, 2) + "\n") }
        catch { output.write(c + "\n") }
        break
      }
      case "status":
        if (event.content && event.content !== "tools_completed" && event.content !== "interrupted") {
          output.write(`\n# ${event.content}\n`)
        }
        break
      case "warning":
        errorOutput.write(`\nwarning: ${event.content ?? ""}\n`)
        break
      case "error":
        errorOutput.write(`\nerror: ${event.content ?? ""}\n`)
        break
      case "done":
        break
    }
  }
}

async function runTUIMode(engine: ReasonixEngine, config: ReturnType<typeof loadConfig>, pluginRuntime: PluginRuntime, mcpConfigCount: number = 0): Promise<void> {
  const status = pluginRuntime.getStatus()
  const pluginCount = status.loadedPlugins.length
  const contentPackCount = status.contentPacks.length
  const assetCounts = status.assets
  // Count error/warning diagnostics
  const diagnosticCounts = {
    errors: status.diagnostics.filter(d => d.startsWith("[error]")).length,
    warnings: status.diagnostics.filter(d => d.startsWith("[warn]")).length,
  }
  try {
    const { waitUntilExit } = await render(
      React.createElement(App, { engine, config, pluginCount, contentPackCount, assetCounts, diagnosticCounts }),
      { exitOnCtrlC: false }
    );
    await waitUntilExit();
  } finally {
    try { writeSync(1, '\x1b[?1049l'); } catch {}
    try { writeSync(1, '\x1b[?25h'); } catch {}
  }
}

function readConfiguredMcpCount(): number {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".deepreef", "mcp.json"), "utf8")
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> }
    return Object.keys(parsed.mcpServers ?? {}).length
  } catch {
    return 0
  }
}

main()
  .then(() => {
    // LIFE-01: Bun's fetch() keep-alive connections prevent natural process exit.
    // All resources are already closed in the finally block above.
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
