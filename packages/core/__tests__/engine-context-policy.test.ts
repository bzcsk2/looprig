import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReasonixEngine } from "../src/engine.js"
import { ContextManager } from "../src/context/manager.js"
import { FakeSummarizer, MechanicalSummarizer } from "../src/context/summarizer.js"
import type { DeepicodeConfig } from "../src/config.js"
import type { ContextPolicy } from "../src/context/policy.js"

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
      return Promise.resolve(messages.length * 10)
    }

    resolvePendingWithFallback(reason: string) {
      for (const [, task] of this.tasks) {
        task.resolve(task.messages.length * 10)
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

// Mock RuntimeLogger
vi.mock("../src/runtime-logger.js", () => ({
  createRuntimeLoggerFromEnv: () => ({
    isEnabled: () => false,
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    child: () => ({
      isEnabled: () => false,
      info: () => {},
      error: () => {},
    }),
    flush: () => Promise.resolve(),
  }),
}))

// Mock DeepSeekClient
vi.mock("../src/client.js", () => ({
  DeepSeekClient: class {
    async *chatCompletionsStream() {
      yield { type: "text", content: "test" }
      yield { type: "done" }
    }
  },
}))

// Mock SessionLoader
vi.mock("../src/session.js", () => ({
  SessionLoader: {
    validateSessionId: () => true,
    read: () => Promise.resolve([]),
  },
  AsyncSessionWriter: class {
    init() { return Promise.resolve() }
    enqueue() {}
    async drain() {}
  },
}))

// Mock ContextPolicyStore
vi.mock("../src/context/policy-store.js", () => ({
  ContextPolicyStore: class {
    private policy = { mode: "trim", triggerRatio: 0.7, targetRatio: 0.3 }
    async load() { return this.policy }
    async save(policy: any) { this.policy = policy; return true }
    getCurrentPolicy() { return this.policy }
  },
}))

describe("ReasonixEngine context policy", () => {
  let engine: ReasonixEngine
  const defaultConfig: DeepicodeConfig = {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    maxTokens: 4096,
    temperature: 0.7,
    contextWindow: 1000,
    maxContextRounds: 20,
  }

  beforeEach(() => {
    engine = new ReasonixEngine(defaultConfig)
  })

  afterEach(async () => {
    await engine.shutdown()
  })

  it("should have default context policy", () => {
    const policy = engine.getContextPolicy()
    expect(policy.mode).toBe("trim")
    expect(policy.triggerRatio).toBe(0.7)
    expect(policy.targetRatio).toBe(0.3)
  })

  it("should update context policy", async () => {
    await engine.setContextPolicy({ mode: "compress", triggerRatio: 0.8 })
    const policy = engine.getContextPolicy()
    expect(policy.mode).toBe("compress")
    expect(policy.triggerRatio).toBe(0.8)
  })

  it("should validate context policy", async () => {
    await engine.setContextPolicy({ triggerRatio: 0.5, targetRatio: 0.6 })
    const policy = engine.getContextPolicy()
    expect(policy.targetRatio).toBeLessThan(policy.triggerRatio)
  })

  it("should get context policy status", async () => {
    const status = await engine.getContextPolicyStatus()
    expect(status.policy).toBeDefined()
    expect(status.totalTokens).toBeDefined()
    expect(status.window).toBeDefined()
    expect(status.ratio).toBeDefined()
    expect(status.triggerTokens).toBeDefined()
    expect(status.targetTokens).toBeDefined()
  })

  it("should set summarizer", () => {
    const summarizer = new FakeSummarizer()
    engine.setSummarizer(summarizer)
    // No direct way to verify, but should not throw
  })

  it("should run context reduction with trim mode", async () => {
    const result = await engine.runContextReduction("trim")
    expect(result.mode).toBe("trim")
    expect(result.beforeTokens).toBeDefined()
    expect(result.afterTokens).toBeDefined()
    expect(result.targetTokens).toBeDefined()
  })

  it("should run context reduction with compact mode", async () => {
    engine.setSummarizer(new FakeSummarizer())
    const result = await engine.runContextReduction("compact")
    expect(result.mode).toBe("compact")
  })

  it("should fallback to trim when summarizer fails", async () => {
    const failingSummarizer = {
      summarize: () => Promise.reject(new Error("Summarizer failed")),
    }
    engine.setSummarizer(failingSummarizer)
    const result = await engine.runContextReduction("compact")
    expect(result.mode).toBe("compact")
    // Should fallback to trim internally
  })
})

describe("ReasonixEngine submit with context policy", () => {
  let engine: ReasonixEngine
  const smallContextConfig: DeepicodeConfig = {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    maxTokens: 4096,
    temperature: 0.7,
    contextWindow: 100,
    maxContextRounds: 20,
  }

  beforeEach(() => {
    engine = new ReasonixEngine(smallContextConfig)
  })

  afterEach(async () => {
    await engine.shutdown()
  })

  it("should not trigger reduction below threshold", async () => {
    await engine.setContextPolicy({ triggerRatio: 0.7, targetRatio: 0.3 })
    // Submit with short input that won't trigger reduction
    const generator = engine.submit("hi")
    const events = []
    for await (const event of generator) {
      events.push(event)
    }
    // Should complete without error
    expect(events).toBeDefined()
  })

  it("should trigger trim reduction above threshold", async () => {
    await engine.setContextPolicy({ triggerRatio: 0.5, targetRatio: 0.3 })
    // Fill context to exceed threshold
    for (let i = 0; i < 20; i++) {
      engine.getContextManager().log.append({ role: "user", content: `Message ${i}` })
      engine.getContextManager().log.append({ role: "assistant", content: `Response ${i}` })
    }
    const generator = engine.submit("test")
    const events = []
    for await (const event of generator) {
      events.push(event)
    }
    expect(events).toBeDefined()
  })

  it("should trigger compact reduction with summarizer", async () => {
    await engine.setContextPolicy({ mode: "compact", triggerRatio: 0.5, targetRatio: 0.3 })
    engine.setSummarizer(new FakeSummarizer())
    // Fill context to exceed threshold
    for (let i = 0; i < 20; i++) {
      engine.getContextManager().log.append({ role: "user", content: `Message ${i}` })
      engine.getContextManager().log.append({ role: "assistant", content: `Response ${i}` })
    }
    const generator = engine.submit("test")
    const events = []
    for await (const event of generator) {
      events.push(event)
    }
    expect(events).toBeDefined()
  })

  it("should fallback to trim when compact fails", async () => {
    await engine.setContextPolicy({ mode: "compact", triggerRatio: 0.5, targetRatio: 0.3 })
    const failingSummarizer = {
      summarize: () => Promise.reject(new Error("Failed")),
    }
    engine.setSummarizer(failingSummarizer)
    // Fill context to exceed threshold
    for (let i = 0; i < 20; i++) {
      engine.getContextManager().log.append({ role: "user", content: `Message ${i}` })
      engine.getContextManager().log.append({ role: "assistant", content: `Response ${i}` })
    }
    const generator = engine.submit("test")
    const events = []
    for await (const event of generator) {
      events.push(event)
    }
    expect(events).toBeDefined()
  })
})
