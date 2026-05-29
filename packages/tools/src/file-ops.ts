import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
import type { AgentTool } from "../../core/src/interface.js"

const SENSITIVE_FILE_PATTERNS = [
  /(^|\/|\\)api-key$/,
  /(^|\/|\\)\.env$/,
  /(^|\/|\\)\.env\.local$/,
  /(^|\/|\\)\.git\//,
  /(^|\/|\\)id_rsa$/,
  /(^|\/|\\)id_ed25519$/,
  /(^|\/|\\)\.ssh\//,
  /(^|\/|\\)known_hosts$/,
]

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

function isSensitive(path: string): boolean {
  const normalized = path.replace(/\\/g, "/")
  for (const p of SENSITIVE_FILE_PATTERNS) {
    if (p.test(normalized)) return true
  }
  return false
}

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
      if (typeof args.path !== "string" || !args.path) {
        return { content: JSON.stringify({ error: "path is required" }), isError: true }
      }
      const path = resolve(ctx.cwd, args.path)

      if (isSensitive(path)) {
        return { content: JSON.stringify({ error: `Reading sensitive file is denied: ${args.path}` }), isError: true }
      }

      let fileStat
      try {
        fileStat = await stat(path)
      } catch {
        return { content: JSON.stringify({ error: `File not found: ${args.path}` }), isError: true }
      }

      if (!fileStat.isFile()) {
        return { content: JSON.stringify({ error: `Not a file: ${args.path}` }), isError: true }
      }

      if (fileStat.size > MAX_FILE_SIZE) {
        return { content: JSON.stringify({ error: `File too large (${fileStat.size} bytes). Max allowed: ${MAX_FILE_SIZE} bytes.` }), isError: true }
      }

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
        content: JSON.stringify({ path: args.path, content: out, cwd: ctx.cwd }),
        isError: false,
      }
    },
  }
}

