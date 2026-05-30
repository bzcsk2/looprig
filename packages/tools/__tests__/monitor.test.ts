import { describe, it, expect } from "vitest"
import { createMonitorTool } from "../src/monitor.js"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal } as any

describe("Monitor", () => {
  it("should reject invalid target", async () => {
    const tool = createMonitorTool()
    const r = await tool.execute({ target: "cpu" }, ctx)
    expect(r.isError).toBe(true)
    const p = JSON.parse(r.content as string)
    expect(p.error).toContain("target")
  })

  it("should reject missing target", async () => {
    const tool = createMonitorTool()
    const r = await tool.execute({} as any, ctx)
    expect(r.isError).toBe(true)
  })

  it("should reject file mode without path", async () => {
    const tool = createMonitorTool()
    const r = await tool.execute({ target: "file" }, ctx)
    expect(r.isError).toBe(true)
    const p = JSON.parse(r.content as string)
    expect(p.error).toContain("path")
  })

  it("should accept valid targets without starting monitor", async () => {
    const tool = createMonitorTool()
    // With an already-aborted signal, the monitor should return immediately
    const abortCtx = { cwd: process.cwd(), signal: AbortSignal.abort() } as any
    const r = await tool.execute({ target: "process", interval_ms: 100, timeout_ms: 100 }, abortCtx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.target).toBe("process")
    expect(p.samples).toEqual([])
  })

  it("should accept file mode with path and aborted signal", async () => {
    const tool = createMonitorTool()
    const abortCtx = { cwd: process.cwd(), signal: AbortSignal.abort() } as any
    const r = await tool.execute({ target: "file", path: "/tmp", interval_ms: 100, timeout_ms: 100 }, abortCtx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.target).toBe("file")
  })
})
