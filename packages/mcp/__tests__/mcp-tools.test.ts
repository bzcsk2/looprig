import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { setMcpHost, McpHost } from "../src/index.js"

describe("McpAuth", () => {
  it("should return list action with empty configured array", async () => {
    const { createMcpAuthTool } = await import("../src/auth.js")
    const tool = createMcpAuthTool()
    const r = await tool.execute({ action: "list" }, {} as any)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.configured).toEqual([])
  })

  it("should reject set action without server", async () => {
    const { createMcpAuthTool } = await import("../src/auth.js")
    const tool = createMcpAuthTool()
    const r = await tool.execute({ action: "set", api_key: "sk-xxx" }, {} as any)
    expect(r.isError).toBe(true)
  })

  it("should reject set action without api_key", async () => {
    const { createMcpAuthTool } = await import("../src/auth.js")
    const tool = createMcpAuthTool()
    const r = await tool.execute({ action: "set", server: "my-server" }, {} as any)
    expect(r.isError).toBe(true)
  })

  it("should reject unknown action", async () => {
    const { createMcpAuthTool } = await import("../src/auth.js")
    const tool = createMcpAuthTool()
    const r = await tool.execute({ action: "delete" }, {} as any)
    expect(r.isError).toBe(true)
  })

  it("should reject missing action", async () => {
    const { createMcpAuthTool } = await import("../src/auth.js")
    const tool = createMcpAuthTool()
    const r = await tool.execute({} as any, {} as any)
    expect(r.isError).toBe(true)
  })
})

describe("ListMcpResources", () => {
  beforeEach(() => {
    // Reset global MCP host
    setMcpHost(undefined as any)
  })

  it("should return error when MCP host not initialized", async () => {
    const { createListMcpResourcesTool } = await import("../src/list-resources.js")
    const tool = createListMcpResourcesTool()
    const r = await tool.execute({}, {} as any)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("not initialized")
  })
})

describe("ReadMcpResource", () => {
  beforeEach(() => {
    setMcpHost(undefined as any)
  })

  it("should reject missing uri", async () => {
    const { createReadMcpResourceTool } = await import("../src/read-resource.js")
    const tool = createReadMcpResourceTool()
    const r = await tool.execute({} as any, {} as any)
    expect(r.isError).toBe(true)
  })

  it("should reject empty uri", async () => {
    const { createReadMcpResourceTool } = await import("../src/read-resource.js")
    const tool = createReadMcpResourceTool()
    const r = await tool.execute({ uri: "" }, {} as any)
    expect(r.isError).toBe(true)
  })

  it("should return error when MCP host not initialized", async () => {
    const { createReadMcpResourceTool } = await import("../src/read-resource.js")
    const tool = createReadMcpResourceTool()
    const r = await tool.execute({ uri: "test://resource" }, {} as any)
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content as string).error).toContain("not initialized")
  })
})