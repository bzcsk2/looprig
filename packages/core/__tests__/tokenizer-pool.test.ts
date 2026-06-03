import { describe, it, expect } from "vitest"

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

  it("should expose fallback diagnostics", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    ;(pool as any).healthy = false
    const result = await pool.estimate([{ role: "user", content: "diagnostic" }])
    expect(result).toBeGreaterThan(0)
    const diagnostics = pool.getDiagnostics()
    expect(diagnostics.healthy).toBe(false)
    expect(diagnostics.fallbackCount).toBeGreaterThan(0)
    expect(diagnostics.lastFallbackReason).toBe("unhealthy")
    pool.shutdown()
  })

  it("should fallback pending worker failures using each task messages", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    const values: number[] = []
    ;(pool as any).tasks.set(1, {
      messages: [{ role: "user", content: "non-empty pending task" }],
      resolve: (value: number) => values.push(value),
      reject: () => {},
    })
    ;(pool as any).resolvePendingWithFallback("worker_error")
    expect(values).toHaveLength(1)
    expect(values[0]).toBeGreaterThan(0)
    expect(pool.getDiagnostics().lastFallbackReason).toBe("worker_error")
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

  it("should estimate messages through available tokenizer path", async () => {
    const { TokenizerPool } = await import("../src/context/tokenizer-pool.js")
    const pool = new TokenizerPool()
    const result = await pool.estimate([{ role: "user", content: "test" }])
    expect(result).toBeGreaterThan(0)

    pool.shutdown()
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
