import type { ChatMessage } from "../types.js"

export interface SummarizeInput {
  messages: ChatMessage[]
  currentSummary: string
  targetTokens: number
  workspacePath?: string
}

export interface SummarizeOutput {
  summary: string
  tokensUsed?: number
}

export interface ContextSummarizer {
  summarize(input: SummarizeInput, signal?: AbortSignal): Promise<SummarizeOutput>
}

export class FakeSummarizer implements ContextSummarizer {
  private summaryText: string

  constructor(summaryText?: string) {
    this.summaryText = summaryText ?? "Fake summary of previous conversation."
  }

  async summarize(input: SummarizeInput, signal?: AbortSignal): Promise<SummarizeOutput> {
    if (signal?.aborted) {
      throw new Error("Summarizer aborted")
    }

    const existing = input.currentSummary
    const newContent = input.messages
      .map(m => {
        const content = m.content ?? ""
        const truncated = content.length > 100 ? content.slice(0, 97) + "..." : content
        return `${m.role}: ${truncated}`
      })
      .filter(line => !line.endsWith(": "))
      .join("\n")

    const summary = existing
      ? `${existing}\n\n${this.summaryText}\n${newContent}`
      : `${this.summaryText}\n${newContent}`

    return {
      summary,
      tokensUsed: 0,
    }
  }
}

export class MechanicalSummarizer implements ContextSummarizer {
  async summarize(input: SummarizeInput, signal?: AbortSignal): Promise<SummarizeOutput> {
    if (signal?.aborted) {
      throw new Error("Summarizer aborted")
    }

    const existing = input.currentSummary
    const lines = input.messages.map(m => {
      const content = m.content ?? ""
      const truncated = content.length > 240 ? content.slice(0, 239) + "..." : content
      return `${m.role}: ${truncated}`
    }).filter(line => !line.endsWith(": "))

    const summary = [
      "Previous conversation summary:",
      existing,
      lines.join("\n"),
      "This summary was generated to reduce context usage. Newer messages override this summary when conflicts exist.",
    ].filter(Boolean).join("\n\n")

    return {
      summary,
      tokensUsed: 0,
    }
  }
}
