import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  ContextSummary,
  isSummaryMessage,
  SUMMARY_MARKER,
  SUMMARY_END_MARKER,
} from "../src/context/summary.js"
import {
  FakeSummarizer,
  MechanicalSummarizer,
} from "../src/context/summarizer.js"
import { ContextManager } from "../src/context/manager.js"
import type { ChatMessage } from "../src/types.js"

// Mock TokenizerPool to use deterministic fallback
vi.mock("../src/context/tokenizer-pool.js", () => ({
  TokenizerPool: class {
    healthy = true
    fallbackCount = 0
    timeoutCount = 0
    workerErrorCount = 0
    lastFallbackReason: string | undefined
    tasks = new Map<number, { messages: any[]; resolve: (value: number) => void }>()

    estimate(messages: any[]) {
      if (!this.healthy) {
        this.fallbackCount += 1
        this.lastFallbackReason = "unhealthy"
      }
      const reasoningTokens = messages.reduce(
        (sum, message) => sum + (message.reasoning_content ? 10 : 0),
        0,
      )
      return Promise.resolve(messages.length * 10 + reasoningTokens)
    }

    resolvePendingWithFallback(reason: string) {
      for (const [, task] of this.tasks) {
        const reasoningTokens = task.messages.reduce(
          (sum, message) => sum + (message.reasoning_content ? 10 : 0),
          0,
        )
        task.resolve(task.messages.length * 10 + reasoningTokens)
      }
      this.tasks.clear()
      this.fallbackCount += 1
      this.lastFallbackReason = reason
      if (reason.includes("timeout")) this.timeoutCount += 1
      if (reason.includes("worker")) this.workerErrorCount += 1
    }

    getDiagnostics() {
      return {
        healthy: this.healthy,
        pendingTasks: this.tasks.size,
        fallbackCount: this.fallbackCount,
        timeoutCount: this.timeoutCount,
        workerErrorCount: this.workerErrorCount,
        lastFallbackReason: this.lastFallbackReason,
      }
    }

    shutdown() {}
  },
}))

describe("ContextSummary", () => {
  let summary: ContextSummary

  beforeEach(() => {
    summary = new ContextSummary()
  })

  it("should start empty", () => {
    expect(summary.hasSummary()).toBe(false)
    expect(summary.getMessages()).toEqual([])
    expect(summary.getMessage()).toBeNull()
    expect(summary.getContent()).toBe("")
    expect(summary.getRawContent()).toBe("")
  })

  it("should replace with content", () => {
    summary.replace("This is a summary")
    expect(summary.hasSummary()).toBe(true)
    expect(summary.getRawContent()).toBe("This is a summary")
    expect(summary.getMessages()).toHaveLength(1)
    expect(summary.getMessages()[0].role).toBe("system")
  })

  it("should wrap content with markers", () => {
    summary.replace("This is a summary")
    const content = summary.getContent()
    expect(content).toContain(SUMMARY_MARKER)
    expect(content).toContain(SUMMARY_END_MARKER)
  })

  it("should not double-wrap markers", () => {
    summary.replace(`${SUMMARY_MARKER}\nAlready marked\n${SUMMARY_END_MARKER}`)
    const content = summary.getContent()
    const markerCount = (content.split(SUMMARY_MARKER).length - 1)
    expect(markerCount).toBe(1)
  })

  it("should clear summary", () => {
    summary.replace("This is a summary")
    summary.clear()
    expect(summary.hasSummary()).toBe(false)
    expect(summary.getMessages()).toEqual([])
  })

  it("should replace with message", () => {
    const message: ChatMessage = { role: "system", content: "Message content" }
    summary.replaceWithMessage(message)
    expect(summary.hasSummary()).toBe(true)
    expect(summary.getRawContent()).toBe("Message content")
  })

  it("should clear when replaceWithMessage has no content", () => {
    summary.replace("Initial")
    const message: ChatMessage = { role: "system", content: undefined }
    summary.replaceWithMessage(message)
    expect(summary.hasSummary()).toBe(false)
  })

  it("should return a copy of message", () => {
    summary.replace("Test")
    const msg1 = summary.getMessage()
    const msg2 = summary.getMessage()
    expect(msg1).not.toBe(msg2)
    expect(msg1).toEqual(msg2)
  })
})

describe("isSummaryMessage", () => {
  it("should return true for system message with markers", () => {
    const msg: ChatMessage = {
      role: "system",
      content: `${SUMMARY_MARKER}\nSummary content\n${SUMMARY_END_MARKER}`,
    }
    expect(isSummaryMessage(msg)).toBe(true)
  })

  it("should return false for regular system message", () => {
    const msg: ChatMessage = {
      role: "system",
      content: "Regular system message",
    }
    expect(isSummaryMessage(msg)).toBe(false)
  })

  it("should return false for user message", () => {
    const msg: ChatMessage = {
      role: "user",
      content: `${SUMMARY_MARKER}\nContent\n${SUMMARY_END_MARKER}`,
    }
    expect(isSummaryMessage(msg)).toBe(false)
  })

  it("should return false for message without content", () => {
    const msg: ChatMessage = {
      role: "system",
      content: undefined,
    }
    expect(isSummaryMessage(msg)).toBe(false)
  })
})

describe("FakeSummarizer", () => {
  it("should return default summary text", async () => {
    const summarizer = new FakeSummarizer()
    const result = await summarizer.summarize({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
      currentSummary: "",
      targetTokens: 100,
    })
    expect(result.summary).toContain("Fake summary")
  })

  it("should use custom summary text", async () => {
    const summarizer = new FakeSummarizer("Custom summary")
    const result = await summarizer.summarize({
      messages: [{ role: "user", content: "Test" }],
      currentSummary: "",
      targetTokens: 100,
    })
    expect(result.summary).toContain("Custom summary")
  })

  it("should append to existing summary", async () => {
    const summarizer = new FakeSummarizer()
    const result = await summarizer.summarize({
      messages: [{ role: "user", content: "Test" }],
      currentSummary: "Existing summary",
      targetTokens: 100,
    })
    expect(result.summary).toContain("Existing summary")
    expect(result.summary).toContain("Fake summary")
  })

  it("should handle abort signal", async () => {
    const summarizer = new FakeSummarizer()
    const controller = new AbortController()
    controller.abort()
    await expect(
      summarizer.summarize(
        {
          messages: [{ role: "user", content: "Test" }],
          currentSummary: "",
          targetTokens: 100,
        },
        controller.signal,
      ),
    ).rejects.toThrow("Summarizer aborted")
  })
})

describe("MechanicalSummarizer", () => {
  it("should create summary from messages", async () => {
    const summarizer = new MechanicalSummarizer()
    const result = await summarizer.summarize({
      messages: [
        { role: "user", content: "Hello world" },
        { role: "assistant", content: "Hi there!" },
      ],
      currentSummary: "",
      targetTokens: 100,
    })
    expect(result.summary).toContain("Previous conversation summary")
    expect(result.summary).toContain("user: Hello world")
    expect(result.summary).toContain("assistant: Hi there!")
  })

  it("should truncate long content", async () => {
    const summarizer = new MechanicalSummarizer()
    const longContent = "x".repeat(300)
    const result = await summarizer.summarize({
      messages: [{ role: "user", content: longContent }],
      currentSummary: "",
      targetTokens: 100,
    })
    expect(result.summary).toContain("...")
  })

  it("should combine with existing summary", async () => {
    const summarizer = new MechanicalSummarizer()
    const result = await summarizer.summarize({
      messages: [{ role: "user", content: "New message" }],
      currentSummary: "Old summary",
      targetTokens: 100,
    })
    expect(result.summary).toContain("Old summary")
    expect(result.summary).toContain("user: New message")
  })
})

describe("ContextManager summary integration", () => {
  let manager: ContextManager

  beforeEach(() => {
    manager = new ContextManager(20, 100)
  })

  it("should start with empty summary", () => {
    const summary = manager.getSummary()
    expect(summary.hasSummary()).toBe(false)
  })

  it("should include summary in buildMessages", () => {
    manager.getSummary().replace("Test summary")
    const messages = manager.buildMessages()
    const summaryMsg = messages.find(m => isSummaryMessage(m))
    expect(summaryMsg).toBeDefined()
    expect(summaryMsg?.content).toContain("Test summary")
  })

  it("should maintain correct order: prefix, summary, log, scratch", () => {
    manager.prefix.build("System prompt")
    manager.getSummary().replace("Summary content")
    manager.log.append({ role: "user", content: "User message" })
    manager.scratch.append({ role: "assistant", content: "Scratch" })

    const messages = manager.buildMessages()
    const roles = messages.map(m => m.role)
    expect(roles).toEqual(["system", "system", "user", "assistant"])
  })

  it("should count summary tokens in budget", async () => {
    manager.getSummary().replace("Test summary")
    const budget = await manager.getBudget()
    expect(budget.summaryTokens).toBeGreaterThan(0)
  })

  it("should update summary when compress mode is used", () => {
    manager.prefix.build("System prompt")
    for (let i = 0; i < 10; i++) {
      manager.log.append({ role: "user", content: `Message ${i}` })
      manager.log.append({ role: "assistant", content: `Response ${i}` })
    }

    manager.reduceToTarget("compress", 0.3)
    expect(manager.getSummary().hasSummary()).toBe(true)
  })

  it("should not update summary when trim mode is used", () => {
    manager.prefix.build("System prompt")
    for (let i = 0; i < 10; i++) {
      manager.log.append({ role: "user", content: `Message ${i}` })
      manager.log.append({ role: "assistant", content: `Response ${i}` })
    }

    manager.reduceToTarget("trim", 0.3)
    expect(manager.getSummary().hasSummary()).toBe(false)
  })
})
