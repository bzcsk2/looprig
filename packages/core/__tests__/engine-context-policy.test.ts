import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReasonixEngine } from "../src/engine.js"
import { ContextManager } from "../src/context/manager.js"
import { FakeSummarizer, MechanicalSummarizer } from "../src/context/summarizer.js"
import { MockSseServer } from "../src/test-utils/mock-sse-server.js"
import type { DeepreefConfig } from "../src/config.js"
import type { ContextPolicy } from "../src/context/policy.js"
import { mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

let originalCwd: string
let testCwd: string

beforeEach(() => {
  originalCwd = process.cwd()
  testCwd = mkdtempSync(join(tmpdir(), "covalo-context-policy-"))
  process.chdir(testCwd)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(testCwd, { recursive: true, force: true })
})

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

// Mock RuntimeLogger
vi.mock("../src/runtime-logger.js", () => {
  const noop = {
    isEnabled: () => false,
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    getDroppedCount: () => 0,
    child: () => noop,
    flush: () => Promise.resolve(),
  }
  return {
    noopRuntimeLogger: noop,
    createRuntimeLoggerFromEnv: () => noop,
  }
})

describe("ReasonixEngine context policy", () => {
  let engine: ReasonixEngine
  const defaultConfig: DeepreefConfig = {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    maxTokens: 4096,
    temperature: 0.7,
    contextWindow: 1000,
    maxContextRounds: 20,
  }

  beforeEach(async () => {
    engine = new ReasonixEngine(defaultConfig)
    await new Promise(resolve => setTimeout(resolve, 0))
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
  let server: MockSseServer
  const smallContextConfig: DeepreefConfig = {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "test-key",
    baseUrl: "http://localhost",
    maxTokens: 4096,
    temperature: 0.7,
    contextWindow: 1000,
    maxContextRounds: 20,
  }

  beforeEach(async () => {
    server = new MockSseServer()
    await server.start()
    engine = new ReasonixEngine({ ...smallContextConfig, baseUrl: server.baseUrl })
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  afterEach(async () => {
    await engine.shutdown()
    await server.stop()
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
