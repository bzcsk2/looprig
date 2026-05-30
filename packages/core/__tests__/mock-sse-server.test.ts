import { describe, it, expect, afterEach } from "vitest"
import { MockSseServer } from "../src/test-utils/mock-sse-server.js"

describe("MockSseServer", () => {
  let server: MockSseServer

  afterEach(async () => {
    await server?.stop()
  })

  it("should start and return a URL", async () => {
    server = new MockSseServer()
    await server.start()
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/)
    expect(server.baseUrl).toMatch(/\/$/)
  })

  it("should serve normal text stream", async () => {
    server = new MockSseServer().setScenario("normal")
    await server.start()
    const resp = await fetch(`${server.url}/chat/completions`, { method: "POST" })
    expect(resp.status).toBe(200)
    expect(resp.headers.get("content-type")).toBe("text/event-stream")
    const text = await resp.text()
    expect(text).toContain("Hello")
    expect(text).toContain("[DONE]")
  })

  it("should serve tool_calls scenario", async () => {
    server = new MockSseServer().setScenario("tool_calls")
    await server.start()
    const resp = await fetch(`${server.url}/chat/completions`, { method: "POST" })
    expect(resp.status).toBe(200)
    const text = await resp.text()
    expect(text).toContain("tool_calls")
    expect(text).toContain("read_file")
    expect(text).toContain('[DONE]')
  })

  it("should serve reasoning scenario", async () => {
    server = new MockSseServer().setScenario("reasoning")
    await server.start()
    const resp = await fetch(`${server.url}/chat/completions`, { method: "POST" })
    expect(resp.status).toBe(200)
    const text = await resp.text()
    expect(text).toContain("reasoning_content")
    expect(text).toContain("The answer is 42")
  })

  it("should return 429 for error_429 scenario", async () => {
    server = new MockSseServer().setScenario("error_429")
    await server.start()
    const resp = await fetch(`${server.url}/chat/completions`, { method: "POST" })
    expect(resp.status).toBe(429)
    const text = await resp.text()
    expect(text).toContain("rate_limit")
  })

  it("should return 500 for error_500 scenario", async () => {
    server = new MockSseServer().setScenario("error_500")
    await server.start()
    const resp = await fetch(`${server.url}/chat/completions`, { method: "POST" })
    expect(resp.status).toBe(500)
  })

  it("should support scenario via URL query param", async () => {
    server = new MockSseServer()
    await server.start()
    const resp = await fetch(`${server.url}/chat/completions?scenario=error_429`, { method: "POST" })
    expect(resp.status).toBe(429)
  })

  it("should support custom chunks", async () => {
    server = new MockSseServer().setChunks([
      { data: `data: {"choices":[{"delta":{"content":"custom"}}]}\n\n` },
      { data: "data: [DONE]\n\n" },
    ])
    await server.start()
    const resp = await fetch(`${server.url}/chat/completions`, { method: "POST" })
    const text = await resp.text()
    expect(text).toContain("custom")
  })

  it("should reject after maxRequests", async () => {
    server = new MockSseServer().setMaxRequests(1)
    await server.start()
    const r1 = await fetch(`${server.url}/chat/completions`, { method: "POST" })
    expect(r1.status).toBe(200)
    const r2 = await fetch(`${server.url}/chat/completions`, { method: "POST" })
    expect(r2.status).toBe(503)
  })

  it("should track request count", async () => {
    server = new MockSseServer()
    await server.start()
    expect(server.requestCount).toBe(0)
    await fetch(`${server.url}/chat/completions`, { method: "POST" })
    await fetch(`${server.url}/chat/completions`, { method: "POST" })
    expect(server.requestCount).toBe(2)
  })

  it("should stop and restart", async () => {
    server = new MockSseServer().setScenario("error_429")
    await server.start()
    await server.stop()
    server.setScenario("normal")
    await server.start()
    const resp = await fetch(`${server.url}/chat/completions`, { method: "POST" })
    expect(resp.status).toBe(200)
    const text = await resp.text()
    expect(text).toContain("[DONE]")
  })
})
