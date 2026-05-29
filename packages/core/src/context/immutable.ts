import type { ChatMessage } from "../types.js"
import { createHash } from "node:crypto"
import { cloneChatMessages } from "./message.js"

export class ImmutablePrefix {
  private prefix: ChatMessage[] = []
  private hash = ""

  build(systemPrompt: string): void {
    this.prefix = [{ role: "system", content: systemPrompt }]
    this.hash = this.computeHash(this.prefix)
  }

  get messages(): readonly ChatMessage[] {
    return cloneChatMessages(this.prefix)
  }

  get cacheKey(): string {
    return this.hash
  }

  private computeHash(msgs: readonly ChatMessage[]): string {
    const stablePayload = JSON.stringify(
      msgs.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls ?? null,
        tool_call_id: m.tool_call_id ?? null,
        name: m.name ?? null,
        is_error: m.is_error ?? false,
      })),
    )
    return createHash("sha256").update(stablePayload).digest("hex")
  }
}
