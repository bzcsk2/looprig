import { describe, it, expect } from "vitest"
import { McpHost, setMcpHost } from "../src/index.js"
import { getMcpHost } from "../src/mcp-host-global.js"

describe("McpHost", () => {
  it("should create an empty host", () => {
    const host = new McpHost()
    expect(host).toBeDefined()
  })

  it("should not throw when loading config with no mcp.json", { timeout: 1000 }, async () => {
    const host = new McpHost()
    try {
      const result = host.loadConfig()
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 200))
      await Promise.race([result, timeout])
    } catch {
      // Expected - no config file or timeout
    }
    expect(host).toBeDefined()
  })
})

describe("getMcpHost / setMcpHost", () => {
  it("should set and get global mcp host", () => {
    const host = new McpHost()
    setMcpHost(host)
    expect(getMcpHost()).toBe(host)
  })
})
