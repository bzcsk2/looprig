import { writeFile as fsWriteFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { AgentTool } from "../../core/src/interface.js"
import { isSensitive } from "./sensitive.js"

export function createWriteFileTool(): AgentTool {
  return {
    name: "write_file",
    description: "Create a new file with content. Will overwrite if file already exists.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to create." },
        content: { type: "string", description: "File content." },
      },
      required: ["path", "content"],
    },
    concurrency: "exclusive",
    approval: "write",
    async execute(args, ctx) {
      if (typeof args.path !== "string" || !args.path) {
        return { content: JSON.stringify({ error: "path is required" }), isError: true }
      }
      if (typeof args.content !== "string") {
        return { content: JSON.stringify({ error: "content is required" }), isError: true }
      }

      const path = resolve(ctx.cwd, args.path)

      if (isSensitive(path)) {
        return { content: JSON.stringify({ error: `Writing to sensitive file is denied: ${args.path}` }), isError: true }
      }

      await fsWriteFile(path, args.content, "utf-8")
      return { content: JSON.stringify({ path: args.path, size: args.content.length, cwd: ctx.cwd }), isError: false }
    },
  }
}
