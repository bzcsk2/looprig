import { stdin as input, stdout as output } from "node:process"
import { loadConfig } from "../../core/src/config.js"
import { ReasonixEngine } from "../../core/src/engine.js"
import { buildSystemPrompt } from "../../core/src/system-prompt.js"
import { createBashTool, createEditTool, createReadFileTool, createWriteFileTool, createListDirTool, createGrepTool, createTodoWriteTool } from "../../tools/src/index.js"
import { clearReadTracker } from "../../tools/src/stale-read.js"
import { TUI, ProcessTerminal, ChatView, ToolCallView, StatusLine, Input, Spacer } from "../../tui/src/index.js"
import { processEvents } from "../../tui/src/bridge.js"

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
  const sessionId = sessionIdx >= 0 ? process.argv[sessionIdx + 1] : undefined
  const config = loadConfig()

  const engine = sessionId
    ? await ReasonixEngine.recover(config, sessionId)
    : new ReasonixEngine(config, clearReadTracker)
  engine.setSystemPrompt(buildSystemPrompt(process.cwd()))
  engine.registerTool(createReadFileTool())
  engine.registerTool(createBashTool())
  engine.registerTool(createEditTool())
  engine.registerTool(createWriteFileTool())
  engine.registerTool(createListDirTool())
  engine.registerTool(createGrepTool())
  engine.registerTool(createTodoWriteTool())

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
      case "done":
        output.write("\n")
        break
      case "tool_start":
        output.write(`\n[tool] ${event.toolName ?? "unknown"} ...\n`)
        break
      case "tool": {
        const c = event.content ?? ""
        try { const p = JSON.parse(c) as Record<string,unknown>; output.write(JSON.stringify(p, null, 2) + "\n") }
        catch { output.write(c + "\n") }
        break
      }
      case "error":
        output.write(`\nerror: ${event.content ?? ""}\n`)
        break
    }
  }
}

async function runTUIMode(engine: ReasonixEngine, config: ReturnType<typeof loadConfig>): Promise<void> {
  const terminal = new ProcessTerminal()
  const tui = new TUI(terminal)

  const chatView = new ChatView()
  const toolView = new ToolCallView()
  const statusLine = new StatusLine()
  const inputC = new Input()

  // layout: spacer(top) → chat → tools → input → status(bottom)
  // spacer pushes content down so input anchors to terminal bottom
  const spacerH = Math.max(0, terminal.rows - 4)  // 4 = input+status+tools+safety
  tui.addChild(new Spacer(spacerH))
  tui.addChild(chatView)
  tui.addChild(toolView)
  tui.addChild(inputC)
  tui.addChild(statusLine)
  tui.setFocus(inputC)

  // initial status
  statusLine.setModel(`${config.model}`)

  tui.start()

  inputC.onSubmit = (text: string) => {
    if (text === "__CANCEL__") { tui.stop(); process.exit(0); return }
    if (text === "/exit" || text === "/bye") { tui.stop(); process.exit(0); return }
    if (text === "/help") { printHelp(); return }
    if (!text.trim()) return

    chatView.addMessage("user", text)
    const events = engine.submit(text)
    processEvents(tui, chatView, toolView, null as any, statusLine, inputC, events)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
