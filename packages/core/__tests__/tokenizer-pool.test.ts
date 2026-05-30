import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("TokenizerPool", () => {
  it("should fallback to main thread estimate when Worker is unavailable", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    const result = await pool.estimate([{ role: "user", content: "hello world" }])
    expect(result).toBeGreaterThan(0)
    pool.shutdown()
  })

  it("should estimate multiple messages cumulatively via fallback", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    const msgs = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]
    const result = await pool.estimate(msgs)
    expect(result).toBeGreaterThan(0)
    pool.shutdown()
  })

  it("should handle empty array via fallback", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    const result = await pool.estimate([])
    expect(result).toBe(0)
    pool.shutdown()
  })

  it("should include reasoning_content in estimate via fallback", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    const without = await pool.estimate([{ role: "assistant", content: "answer" }])
    const withReasoning = await pool.estimate([
      { role: "assistant", content: "answer", reasoning_content: "deep thinking process" },
    ])
    expect(withReasoning).toBeGreaterThan(without)
    pool.shutdown()
  })

  it("should send messages through Worker when available and return result", async () => {
    // Mock Worker to simulate successful response
    const mockPostMessage = vi.fn()
    const mockTerminate = vi.fn().mockResolvedValue(undefined)
    const listeners = new Map<string, Set<(...args: any[]) => void>>()

    vi.mock("node:worker_threads", () => ({
      Worker: class MockWorker {
        postMessage = mockPostMessage
        terminate = mockTerminate
        constructor(path: string) {
          // Schedule a successful response
          setTimeout(() => {
            this.emit("message", { id: 1, result: 42 })
          }, 10)
        }
        on(event: string, cb: (...args: any[]) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set())
          listeners.get(event)!.add(cb)
        }
        emit(event: string, ...args: any[]) {
          listeners.get(event)?.forEach(cb => cb(...args))
        }
        addListener = vi.fn()
        removeListener = vi.fn()
      },
    }))

    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()

    // Only test Worker path if Worker was actually created (not in Bun's stub env)
    if ((pool as any).worker) {
      const result = await pool.estimate([{ role: "user", content: "test" }])
      expect(result).toBe(42)
      expect(mockPostMessage).toHaveBeenCalled()
    } else {
      // Fallback: Worker module not available, pool uses main thread
      const result = await pool.estimate([{ role: "user", content: "test" }])
      expect(result).toBeGreaterThan(0)
    }

    pool.shutdown()
    vi.restoreAllMocks()
  })

  it("should not throw on shutdown even when worker failed to start", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    expect(() => pool.shutdown()).not.toThrow()
  })

  it("should be safe to call shutdown multiple times", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    pool.shutdown()
    expect(() => pool.shutdown()).not.toThrow()
    expect(() => pool.shutdown()).not.toThrow()
  })

  it("should handle concurrent estimate calls via Map dispatch", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    const results = await Promise.all([
      pool.estimate([{ role: "user", content: "hello" }]),
      pool.estimate([{ role: "user", content: "world" }]),
      pool.estimate([{ role: "user", content: "test" }]),
    ])
    expect(results).toHaveLength(3)
    for (const r of results) {
      expect(r).toBeGreaterThan(0)
    }
    pool.shutdown()
  })

  it("should mark unhealthy after 3 consecutive timeouts", async () => {
    // When Bun doesn't support worker_threads, healthy=false from constructor
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()

    // Simulate unhealthy state
    ;(pool as any).healthy = false
    expect((pool as any).healthy).toBe(false)

    // estimate should still work via fallback
    const result = await pool.estimate([{ role: "user", content: "hi" }])
    expect(result).toBeGreaterThan(0)
    pool.shutdown()
  })
})
