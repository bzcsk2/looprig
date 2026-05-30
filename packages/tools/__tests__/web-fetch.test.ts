import { describe, it, expect } from "vitest"
import { createWebFetchTool } from "../src/web-fetch.js"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal } as any

describe("WebFetch validation", () => {
  it("should reject empty url", async () => {
    const tool = createWebFetchTool()
    const r = await tool.execute({ url: "" }, ctx)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("url")
  })

  it("should reject missing url", async () => {
    const tool = createWebFetchTool()
    const r = await tool.execute({} as any, ctx)
    expect(r.isError).toBe(true)
  })

  it("should reject invalid URL", async () => {
    const tool = createWebFetchTool()
    const r = await tool.execute({ url: "not a valid url" }, ctx)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("Invalid URL")
  })

  it("should reject URL with username:password", async () => {
    const tool = createWebFetchTool()
    const r = await tool.execute({ url: "https://user:pass@example.com" }, ctx)
    expect(r.isError).toBe(true)
    const p = JSON.parse(r.content as string)
    expect(p.error).toContain("credentials")
  })

  it("should reject private IP address", async () => {
    const tool = createWebFetchTool()
    const r = await tool.execute({ url: "http://127.0.0.1:8080" }, ctx)
    expect(r.isError).toBe(true)
    const p = JSON.parse(r.content as string)
    expect(p.error).toContain("internal network")
  })

  it("should reject private IP via 10.x.x.x", async () => {
    const tool = createWebFetchTool()
    const r = await tool.execute({ url: "http://10.0.0.1" }, ctx)
    expect(r.isError).toBe(true)
  })
})
