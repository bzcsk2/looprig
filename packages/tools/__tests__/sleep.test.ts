import { describe, it, expect } from "vitest"
import { createSleepTool } from "../src/sleep.js"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal } as any

describe("Sleep", () => {
  it("should reject negative duration", async () => {
    const tool = createSleepTool()
    const r = await tool.execute({ duration_ms: -1 }, ctx)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("positive")
  })

  it("should reject non-number duration", async () => {
    const tool = createSleepTool()
    const r = await tool.execute({ duration_ms: "abc" as any }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should return immediately for 0ms", async () => {
    const tool = createSleepTool()
    const t0 = Date.now()
    const r = await tool.execute({ duration_ms: 0 }, ctx)
    const elapsed = Date.now() - t0
    expect(r.isError).toBe(false)
    expect(elapsed).toBeLessThan(100)
    expect(JSON.parse(r.content as string).slept_ms).toBe(0)
  })

  it("should clamp >300s duration to 300000ms", async () => {
    const tool = createSleepTool()
    const abortCtx = { cwd: process.cwd(), signal: AbortSignal.abort() } as any
    const r = await tool.execute({ duration_ms: 500000 }, abortCtx)
    expect(r.isError).toBe(true)
    const p = JSON.parse(r.content as string)
    expect(p.slept_ms).toBe(300000)
    expect(p.error).toContain("aborted")
  })

  it("should reject missing duration_ms", async () => {
    const tool = createSleepTool()
    const r = await tool.execute({} as any, ctx)
    expect(r.isError).toBe(true)
  })
})
