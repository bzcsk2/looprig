import { readFile, writeFile } from "node:fs/promises"
import type { AgentTool } from "../../core/src/interface.js"
import { hashAnchoredReplaceOnce } from "./hash-edit.js"
import { fuzzyReplaceOnce } from "./fuzzy-edit.js"

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
      const path = String(args.path)
      const oldString = String(args.old_string)
      const newString = String(args.new_string)

      const hashRes = await hashAnchoredReplaceOnce(path, oldString, newString)
      if (hashRes) {
        return { content: JSON.stringify({ path, replaced: hashRes.replacedCount, method: hashRes.method, cwd: ctx.cwd }), isError: false }
      }

      // fallback: load into memory and do fuzzy replace once
      const raw = await readFile(path, "utf-8")
      const fuzzy = fuzzyReplaceOnce(raw, oldString, newString)
      if (!fuzzy) {
        return { content: JSON.stringify({ error: "old_string not found", path }), isError: true }
      }
      await writeFile(path, fuzzy.edited, "utf-8")
      return { content: JSON.stringify({ path, replaced: fuzzy.replacedCount, method: fuzzy.method, cwd: ctx.cwd }), isError: false }
    },
  }
}

