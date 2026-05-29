import { readFile } from "node:fs/promises"
import type { AgentTool } from "../../core/src/interface.js"

export function createReadFileTool(): AgentTool {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file. Optionally slice by line range.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path." },
        start_line: { type: "number", description: "0-based start line (inclusive)." },
        end_line: { type: "number", description: "0-based end line (inclusive)." },
        max_chars: { type: "number", description: "Max characters to return." },
      },
      required: ["path"],
    },
    concurrency: "shared",
    approval: "read",
    async execute(args, ctx) {
      const path = String(args.path)
      const maxChars = typeof args.max_chars === "number" ? Math.max(0, args.max_chars) : 200_000
      const raw = await readFile(path, "utf-8")
      let out = raw

      const start = typeof args.start_line === "number" ? Math.max(0, Math.floor(args.start_line)) : undefined
      const end = typeof args.end_line === "number" ? Math.max(0, Math.floor(args.end_line)) : undefined

      if (start !== undefined || end !== undefined) {
        const lines = raw.split("\n")
        const s = start ?? 0
        const e = end ?? (lines.length - 1)
        out = lines.slice(s, e + 1).join("\n")
      }

      if (out.length > maxChars) out = out.slice(0, maxChars)
      return {
        content: JSON.stringify({ path, content: out, cwd: ctx.cwd }),
        isError: false,
      }
    },
  }
}

