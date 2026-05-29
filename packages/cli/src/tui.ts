import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { loadConfig } from "../../core/src/config.js"
import { ReasonixEngine } from "../../core/src/engine.js"
import { createBashTool, createEditTool, createReadFileTool } from "../../tools/src/index.js"

const SYSTEM_PROMPT = "你是一个高效的编码助手。你简洁、精确，只输出必要的内容。"

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

async function runPrompt(engine: ReasonixEngine, prompt: string): Promise<void> {
  let wroteAssistantText = false

  for await (const event of engine.submit(prompt)) {
    switch (event.role) {
      case "assistant_delta":
        output.write(event.content ?? "")
        wroteAssistantText = true
        break
      case "tool_start":
        output.write(`\n[tool] ${event.toolName ?? "unknown"} ...\n`)
        break
      case "tool":
        output.write(formatToolEvent(event.toolName ?? "unknown", event.content ?? ""))
        break
      case "warning":
        output.write(`\nwarning: ${event.content ?? ""}\n`)
        break
      case "error":
        output.write(`\nerror: ${event.content ?? ""}\n`)
        break
      case "done":
        if (wroteAssistantText) output.write("\n")
        break
    }
  }
}

function formatToolEvent(toolName: string, content: string): string {
  const rendered = renderToolContent(toolName, content)
  if (!rendered) return `[tool] ${toolName} done\n`
  return `[tool] ${toolName} done\n${rendered}\n`
}

function renderToolContent(toolName: string, content: string): string {
  const parsed = parseJsonObject(content)
  if (!parsed) return content.trim()

  if (toolName === "bash") {
    const stdout = typeof parsed.stdout === "string" ? parsed.stdout : ""
    const stderr = typeof parsed.stderr === "string" ? parsed.stderr : ""
    const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : undefined
    const timedOut = parsed.timedOut === true
    const parts: string[] = []
    if (stdout.trim()) parts.push(stdout.trimEnd())
    if (stderr.trim()) parts.push(stderr.trimEnd())
    if (exitCode !== undefined && (exitCode !== 0 || timedOut)) {
      parts.push(`exitCode=${exitCode}${timedOut ? " timedOut=true" : ""}`)
    }
    return parts.join("\n")
  }

  if (toolName === "read_file") {
    if (typeof parsed.content === "string") return parsed.content.trimEnd()
  }

  if (toolName === "edit") {
    if (typeof parsed.error === "string") return `error: ${parsed.error}`
    const path = typeof parsed.path === "string" ? parsed.path : "(unknown path)"
    const method = typeof parsed.method === "string" ? parsed.method : "edit"
    const replaced = typeof parsed.replaced === "number" ? parsed.replaced : 0
    return `${path}: replaced ${replaced} occurrence(s) via ${method}`
  }

  return JSON.stringify(parsed, null, 2)
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp()
    return
  }

  const engine = new ReasonixEngine(loadConfig())
  engine.setSystemPrompt(SYSTEM_PROMPT)
  engine.registerTool(createReadFileTool())
  engine.registerTool(createBashTool())
  engine.registerTool(createEditTool())

  if (!input.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of input) chunks.push(Buffer.from(chunk))
    const prompt = Buffer.concat(chunks).toString("utf8").trim()
    if (prompt) await runPrompt(engine, prompt)
    return
  }

  const rl = createInterface({ input, output })
  output.write("deepicode\n")

  try {
    while (true) {
      const prompt = (await rl.question("> ")).trim()
      if (!prompt) continue
      if (prompt === "/exit" || prompt === "/bye") break
      if (prompt === "/help") {
        printHelp()
        continue
      }
      await runPrompt(engine, prompt)
    }
  } finally {
    rl.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
