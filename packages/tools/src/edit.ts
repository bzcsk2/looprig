import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { AgentTool } from "../../core/src/interface.js"
import { hashAnchoredReplaceOnce } from "./hash-edit.js"
import { fuzzyReplaceOnce } from "./fuzzy-edit.js"
import { checkStale } from "./stale-read.js"
import { isSensitive } from "./sensitive.js"

export function createEditTool(): AgentTool {
  return {
    name: "edit",
    description: "Edit a text file by replacing an old_string with new_string. Uses hash-anchored edit with fuzzy fallback.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path." },
        old_string: { type: "string", description: "Exact old text to replace." },
        new_string: { type: "string", description: "New text to insert." },
      },
      required: ["path", "old_string", "new_string"],
    },
    concurrency: "exclusive",
    approval: "write",
    async execute(args, ctx) {
      if (typeof args.path !== "string" || !args.path) {
        return { content: JSON.stringify({ error: "path is required" }), isError: true }
      }
      if (typeof args.old_string !== "string") {
        return { content: JSON.stringify({ error: "old_string is required" }), isError: true }
      }
      if (typeof args.new_string !== "string") {
        return { content: JSON.stringify({ error: "new_string is required" }), isError: true }
      }

      const path = resolve(ctx.cwd, args.path)
      const oldString = args.old_string
      const newString = args.new_string

      if (isSensitive(path)) {
        return { content: JSON.stringify({ error: `Editing sensitive file is denied: ${args.path}` }), isError: true }
      }

      const staleCheck = await checkStale(path)
      if (staleCheck.isStale) {
        return { content: JSON.stringify({ error: staleCheck.message, path: args.path }), isError: true }
      }

      const hashRes = await hashAnchoredReplaceOnce(path, oldString, newString)
      if (hashRes) {
        return { content: JSON.stringify({ path: args.path, replaced: hashRes.replacedCount, method: hashRes.method, cwd: ctx.cwd }), isError: false }
      }

      // fallback: load into memory and do fuzzy replace once
      const raw = await readFile(path, "utf-8")
      const fuzzy = fuzzyReplaceOnce(raw, oldString, newString)
      if (!fuzzy) {
        return { content: JSON.stringify({ error: "old_string not found", path: args.path }), isError: true }
      }
      await writeFile(path, fuzzy.edited, "utf-8")
      return { content: JSON.stringify({ path: args.path, replaced: fuzzy.replacedCount, method: fuzzy.method, cwd: ctx.cwd }), isError: false }
    },
  }
}

