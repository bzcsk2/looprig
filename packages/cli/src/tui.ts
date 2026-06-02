import { stdin as input, stdout as output, stderr as errorOutput } from "node:process"
import { writeSync } from "node:fs"
import { loadConfig } from "@deepicode/core"
import { ReasonixEngine } from "@deepicode/core"
import { buildSystemPrompt } from "@deepicode/core"
import { createDefaultTools, clearReadTracker } from "@deepicode/tools"
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
  mcpHost.loadConfig().catch(() => { /* no mcp.json or connection failure */ })

  const engine = sessionId
    ? await ReasonixEngine.recover(config, sessionId)
    : new ReasonixEngine(config, clearReadTracker)
  engine.setSystemPrompt(buildSystemPrompt(process.cwd()))
  for (const tool of createDefaultTools()) {
    engine.registerTool(tool)
  }
  // MCP tools are registered separately (dynamic, discovered at runtime)
  engine.registerTool(createListMcpResourcesTool())
  engine.registerTool(createReadMcpResourceTool())
  engine.registerTool(createMcpAuthTool())
  engine.registerTool(createListMcpToolsTool())
  engine.registerTool(createCallMcpToolTool())

  if (!input.isTTY) {
    await runPipeMode(engine)
    return
  }

  await runTUIMode(engine, config)
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
  try {
    const { waitUntilExit } = await render(
      React.createElement(App, { engine, config }),
      { exitOnCtrlC: false }  // Don't let Ink intercept \x03 — we handle SIGINT ourselves
    );
    await waitUntilExit();
  } finally {
    // Ensure terminal is restored even if render throws
    try { writeSync(1, '\x1b[?1049l'); } catch {} // EXIT_ALT_SCREEN
    try { writeSync(1, '\x1b[?25h'); } catch {}   // SHOW_CURSOR
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
