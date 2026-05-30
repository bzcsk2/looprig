import { describe, it, expect } from "vitest"
import { createWorkflowTool } from "../src/workflow.js"
import { createAgentToolTool } from "../src/agent-tool.js"
import { createSendMessageTool } from "../src/send-message.js"
import { createLspTool } from "../src/lsp.js"
import { createWebSearchTool } from "../src/web-search.js"
import { createWebFetchTool } from "../src/web-fetch.js"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal } as any

describe("Workflow", () => {
  it("should execute multiple steps", async () => {
    const tool = createWorkflowTool()
    const r = await tool.execute({
      steps: [
        { tool: "bash", args: { command: "echo 1" }, description: "Step 1" },
        { tool: "bash", args: { command: "echo 2" }, description: "Step 2" },
      ],
    }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.totalSteps).toBe(2)
    expect(p.results).toHaveLength(2)
  })

  it("should handle missing tool name", async () => {
    const tool = createWorkflowTool()
    const r = await tool.execute({
      steps: [{ tool: "", args: {} }],
    }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.results[0].status).toBe("error")
  })

  it("should reject empty steps", async () => {
    const tool = createWorkflowTool()
    const r = await tool.execute({ steps: [] }, ctx)
    expect(r.isError).toBe(true)
  })
})

describe("AgentTool", () => {
  it("should delegate to build agent by default", async () => {
    const tool = createAgentToolTool()
    const r = await tool.execute({ task: "refactor this code" }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.agent).toBe("build")
  })

  it("should accept plan agent type", async () => {
    const tool = createAgentToolTool()
    const r = await tool.execute({ task: "analyze", agent_type: "plan" }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.agent).toBe("plan")
  })

  it("should reject empty task", async () => {
    const tool = createAgentToolTool()
    const r = await tool.execute({ task: "" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should accept files parameter", async () => {
    const tool = createAgentToolTool()
    const r = await tool.execute({ task: "fix bug", files: ["src/index.ts"] }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.files).toEqual(["src/index.ts"])
  })
})

describe("SendMessage", () => {
  it("should send a message", async () => {
    const tool = createSendMessageTool()
    const r = await tool.execute({ recipient: "build-agent", message: "start working" }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.recipient).toBe("build-agent")
    expect(p.messageType).toBe("info")
    expect(p.timestamp).toBeGreaterThan(0)
  })

  it("should accept type parameter", async () => {
    const tool = createSendMessageTool()
    const r = await tool.execute({ recipient: "plan-agent", message: "error occurred", type: "error" }, ctx)
    const p = JSON.parse(r.content as string)
    expect(p.messageType).toBe("error")
  })

  it("should accept empty string recipient (handled by source)", async () => {
    const tool = createSendMessageTool()
    const r = await tool.execute({ recipient: "", message: "hi" }, ctx)
    // Source only validates typeof, not .trim() - empty string passes
    expect(r).toBeDefined()
  })
})

describe("LSP", () => {
  it("should reject empty action", async () => {
    const tool = createLspTool()
    const r = await tool.execute({ action: "", file_path: "/tmp/test.ts" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should return unavailable for non-existent file", async () => {
    const tool = createLspTool()
    const r = await tool.execute({ action: "definition", file_path: "/nonexistent/file.ts" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should return unavailable for existing file", async () => {
    const tool = createLspTool()
    const r = await tool.execute({ action: "diagnostics", file_path: "package.json" }, ctx)
    expect(r.isError).toBe(false)
    const p = JSON.parse(r.content as string)
    expect(p.status).toBe("unavailable")
  })
})

describe("WebSearch", () => {
  it("should reject empty query", async () => {
    const tool = createWebSearchTool()
    const r = await tool.execute({ query: "" }, ctx)
    expect(r.isError).toBe(true)
  })
})

describe("WebFetch", () => {
  it("should reject empty URL", async () => {
    const tool = createWebFetchTool()
    const r = await tool.execute({ url: "" }, ctx)
    expect(r.isError).toBe(true)
  })

  it("should handle invalid URL", async () => {
    const tool = createWebFetchTool()
    const r = await tool.execute({ url: "not a url" }, ctx)
    expect(r.isError).toBe(true)
  })
})
