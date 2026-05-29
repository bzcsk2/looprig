import { describe, it, expect, vi } from "vitest"
import { ReasonixEngine } from "../src/engine.js"
import type { AgentTool, LoopEvent } from "../src/interface.js"
import type { DeepSeekStreamEvent } from "../src/client.js"

type StreamEvent = DeepSeekStreamEvent

const streamMock = vi.fn<(..._args: any[]) => AsyncGenerator<StreamEvent>>()

vi.mock("../src/client.js", () => {
  return {
    DeepSeekClient: class {
      chatCompletionsStream(...args: any[]) {
        return streamMock(...args)
      }
    },
  }
})

describe("ReasonixEngine tool loop regressions", () => {
  it("should preserve toolCallIndex mapping and write tool content as string", async () => {
    streamMock.mockReset()

    streamMock
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "tool_call_end", toolCallIndex: 0, id: "tc-0", name: "shared_ok", arguments: "{\"x\":1}" }
          yield { type: "tool_call_end", toolCallIndex: 1, id: "tc-1", name: "exclusive_done", arguments: "{\"y\":2}" }
          yield { type: "usage", usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 } }
          yield { type: "done", finishReason: "tool_calls" }
        })(),
      )
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "text_delta", delta: "ok" }
          yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
          yield { type: "done", finishReason: "stop" }
        })(),
      )

    const engine = new ReasonixEngine({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      maxTokens: 256,
      temperature: 0.1,
    })

    const sharedTool: AgentTool = {
      name: "shared_ok",
      description: "shared tool",
      parameters: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
      concurrency: "shared",
      approval: "read",
      async execute() {
        return { content: "ok", isError: false }
      },
    }

    const exclusiveTool: AgentTool = {
      name: "exclusive_done",
      description: "exclusive tool",
      parameters: { type: "object", properties: { y: { type: "number" } }, required: ["y"] },
      concurrency: "exclusive",
      approval: "read",
      async execute() {
        return { content: "done", isError: false }
      },
    }

    engine.registerTool(sharedTool)
    engine.registerTool(exclusiveTool)

    const events: LoopEvent[] = []
    for await (const e of engine.submit("hi")) events.push(e)

    const toolStarts = events.filter((e) => e.role === "tool_start")
    expect(toolStarts.map((e) => e.toolCallIndex)).toEqual([0, 1])

    const toolResults = events.filter((e) => e.role === "tool")
    expect(toolResults.map((e) => e.toolCallIndex)).toEqual([0, 1])

    const toolMsgs = engine.getContextManager().log.messages.filter((m) => m.role === "tool")
    expect(toolMsgs).toHaveLength(2)
    for (const m of toolMsgs) expect(typeof m.content).toBe("string")
  })

  it("should mark tool failures as error events and persist is_error=true", async () => {
    streamMock.mockReset()

    streamMock
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "tool_call_end", toolCallIndex: 0, id: "tc-err", name: "shared_fail", arguments: "{\"q\":\"x\"}" }
          yield { type: "usage", usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }
          yield { type: "done", finishReason: "tool_calls" }
        })(),
      )
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "text_delta", delta: "after" }
          yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
          yield { type: "done", finishReason: "stop" }
        })(),
      )

    const engine = new ReasonixEngine({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      maxTokens: 256,
      temperature: 0.1,
    })

    const failTool: AgentTool = {
      name: "shared_fail",
      description: "fails",
      parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      concurrency: "shared",
      approval: "read",
      async execute() {
        return { content: JSON.stringify({ error: "nope" }), isError: true, metadata: { code: "EFAIL" } }
      },
    }
    engine.registerTool(failTool)

    const events: LoopEvent[] = []
    for await (const e of engine.submit("hi")) events.push(e)

    const errorEvents = events.filter((e) => e.role === "error" && e.toolName === "shared_fail")
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].toolCallIndex).toBe(0)

    const toolMsgs = engine.getContextManager().log.messages.filter((m) => m.role === "tool")
    expect(toolMsgs).toHaveLength(1)
    expect(toolMsgs[0].is_error).toBe(true)
    expect(typeof toolMsgs[0].content).toBe("string")
  })
})

