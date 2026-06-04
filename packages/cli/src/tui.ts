import { stdin as input, stdout as output, stderr as errorOutput } from "node:process"
import { readFileSync, writeSync } from "node:fs"
import { resolve } from "node:path"
import { loadConfig, ReasonixEngine, SessionLoader } from "@deepicode/core"
import { buildSystemPrompt } from "@deepicode/core"
import { createDefaultTools, clearReadTracker, normalizePlatform, resolveShellBackend } from "@deepicode/tools"
import { McpHost, createListMcpResourcesTool, createReadMcpResourceTool, createMcpAuthTool, createListMcpToolsTool, createCallMcpToolTool, setMcpHost } from "@deepicode/mcp"
import React from "react"
import { wrappedRender as render } from "@deepicode/ink"
import { App } from "@deepicode/tui"

function printHelp(): void {
  output.write(`deepicode

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
  const mcpLoadPromise = mcpHost.loadConfig().then((summary) => {
    if (summary.failed.length > 0) {
      errorOutput.write(`[deepicode] MCP loaded with ${summary.failed.length}/${summary.serverCount} server failure(s)\n`)
    }
  }).catch((error) => {
    errorOutput.write(`[deepicode] MCP config load failed: ${error instanceof Error ? error.message : String(error)}\n`)
  })

  const engine = sessionId
    ? await ReasonixEngine.recover(config, sessionId)
    : new ReasonixEngine(config, clearReadTracker)
  SessionLoader.cleanup().catch(() => {})
  const platform = normalizePlatform()
  const shellBackend = await resolveShellBackend(platform)
  engine.setSystemPrompt(buildSystemPrompt(process.cwd(), {
    osPlatform: platform,
    shellBackend: `${shellBackend.id} (${shellBackend.executable})`,
  }))
  for (const tool of createDefaultTools()) {
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

    await runTUIMode(engine, config)
  } finally {
    // LIFE-01: close engine (tokenizer worker, logger, session writer)
    await engine.shutdown()
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

async function runTUIMode(engine: ReasonixEngine, config: ReturnType<typeof loadConfig>): Promise<void> {
  const pluginCount = readConfiguredPluginCount()
  const mcpCount = readConfiguredMcpCount()
  try {
    const { waitUntilExit } = await render(
      React.createElement(App, { engine, config, pluginCount, mcpCount }),
      { exitOnCtrlC: false }  // Don't let Ink intercept \x03 — we handle SIGINT ourselves
    );
    await waitUntilExit();
  } finally {
    // Ensure terminal is restored even if render throws
    try { writeSync(1, '\x1b[?1049l'); } catch {} // EXIT_ALT_SCREEN
    try { writeSync(1, '\x1b[?25h'); } catch {}   // SHOW_CURSOR
  }
}

function readConfiguredPluginCount(): number {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".deepicode", "plugins.json"), "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return 0
    return parsed.filter((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return (item as { options?: { enabled?: boolean } }).options?.enabled !== false
      }
      return true
    }).length
  } catch {
    return 0
  }
}

function readConfiguredMcpCount(): number {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".deepicode", "mcp.json"), "utf8")
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
