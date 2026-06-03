import type { ChatMessage } from "../types.js"

export const SUMMARY_MARKER = "[CONTEXT_SUMMARY]"
export const SUMMARY_END_MARKER = "[/CONTEXT_SUMMARY]"

export class ContextSummary {
  private summary: ChatMessage | null = null

  replace(content: string): void {
    const rawContent = this.unwrapMarkers(content)
    const markedContent = this.wrapWithMarkers(rawContent)
    this.summary = { role: "system", content: markedContent }
  }

  replaceWithMessage(message: ChatMessage): void {
    if (!message.content) {
      this.clear()
      return
    }
    const markedContent = this.wrapWithMarkers(message.content)
    this.summary = { role: "system", content: markedContent }
  }

  clear(): void {
    this.summary = null
  }

  getMessages(): ChatMessage[] {
    if (!this.summary) return []
    return [this.summary]
  }

  getMessage(): ChatMessage | null {
    return this.summary ? { ...this.summary } : null
  }

  hasSummary(): boolean {
    return this.summary !== null
  }

  getContent(): string {
    return this.summary?.content ?? ""
  }

  getRawContent(): string {
    if (!this.summary?.content) return ""
    return this.unwrapMarkers(this.summary.content)
  }

  private wrapWithMarkers(content: string): string {
    const trimmed = content.trim()
    if (trimmed.startsWith(SUMMARY_MARKER) && trimmed.endsWith(SUMMARY_END_MARKER)) {
      return trimmed
    }
    return `${SUMMARY_MARKER}\n${trimmed}\n${SUMMARY_END_MARKER}`
  }

  private unwrapMarkers(content: string): string {
    const trimmed = content.trim()
    if (trimmed.startsWith(SUMMARY_MARKER) && trimmed.endsWith(SUMMARY_END_MARKER)) {
      return trimmed
        .slice(SUMMARY_MARKER.length)
        .slice(0, -SUMMARY_END_MARKER.length)
        .trim()
    }
    return trimmed
  }
}

export function isSummaryMessage(message: ChatMessage): boolean {
  if (message.role !== "system") return false
  const content = message.content ?? ""
  return content.includes(SUMMARY_MARKER) && content.includes(SUMMARY_END_MARKER)
}
