import { resolve } from "node:path"
import { execSync } from "node:child_process"
import type { AgentTool } from "../../core/src/interface.js"

export function createGrepTool(): AgentTool {
  return {
    name: "grep",
    description: "Search file contents using regular expressions. Returns matching files with line numbers. Uses ripgrep (rg) if available, otherwise falls back to grep.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for." },
        path: { type: "string", description: "Directory or file to search in (optional, defaults to working directory)." },
        include: { type: "string", description: "File pattern to include (e.g. '*.ts', '*.{ts,tsx}')." },
      },
      required: ["pattern"],
    },
    concurrency: "shared",
    approval: "read",
    async execute(args, ctx) {
      if (typeof args.pattern !== "string" || !args.pattern) {
        return { content: JSON.stringify({ error: "pattern is required" }), isError: true }
      }

      const searchPath = typeof args.path === "string" ? resolve(ctx.cwd, args.path) : ctx.cwd
      const pattern = args.pattern
      const include = typeof args.include === "string" ? args.include : undefined

      let stdout: string
      try {
        stdout = runSearch(pattern, searchPath, include)
      } catch {
        return { content: JSON.stringify({ error: "Search failed. Pattern may be invalid or path not found." }), isError: true }
      }

      const lines = stdout.split("\n").filter(Boolean)
      const maxResults = 200
      const truncated = lines.length > maxResults
      const results = truncated ? lines.slice(0, maxResults) : lines

      return {
        content: JSON.stringify({
          pattern,
          path: args.path ?? ctx.cwd,
          results,
          totalMatches: lines.length,
          truncated,
          cwd: ctx.cwd,
        }),
        isError: false,
      }
    },
  }
}

function runSearch(pattern: string, searchPath: string, include?: string): string {
  try {
    const rgCmd = ["rg", "-n", "--no-heading"]
    if (include) rgCmd.push("-g", include)
    rgCmd.push(pattern, searchPath)
    return execSync(rgCmd.join(" "), { encoding: "utf-8", timeout: 15000 })
  } catch {
    // rg not found or failed, fallback to grep
    const grepCmd = ["grep", "-rn"]
    if (include) grepCmd.push(`--include=${include}`)
    grepCmd.push(pattern, searchPath)
    try {
      return execSync(grepCmd.join(" "), { encoding: "utf-8", timeout: 15000 })
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; status?: number }
      // grep returns exit code 1 when no matches found
      if (err.status === 1) return ""
      throw e
    }
  }
}
