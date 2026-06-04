import { describe, it, expect } from "vitest"
import { ReasonixEngine } from "../src/engine.js"
import type { AgentTool, LoopEvent } from "../src/interface.js"

class MockClient {
  private generators: Array<AsyncGenerator<any>> = []
  setGenerators(gs: Array<AsyncGenerator<any>>): void { this.generators = [...gs] }
  chatCompletionsStream(): AsyncGenerator<any> {
    return this.generators.shift() ?? (async function* () {})()
  }
}

const mockClient = new MockClient()

function makeEngine() {
  return new ReasonixEngine({
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    maxTokens: 256,
    temperature: 0.1,
  }, undefined, undefined, mockClient as any)
}

describe("AS3: Controller and loop integration", () => {
  it("simple query triggers switch from off to high", async () => {
    mockClient.setGenerators([
      (async function* () {
        yield { type: "text_delta", delta: "hello" }
        yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        yield { type: "done", finishReason: "stop" }
      })(),
    ])
    const engine = makeEngine()
    const events: LoopEvent[] = []
    for await (const e of engine.submit("hi")) events.push(e)

    const modeSwitch = events.find(e => e.role === "status" && e.content === "thinking_mode_switch")
    expect(modeSwitch).toBeDefined()
    expect(modeSwitch!.metadata).toMatchObject({ from: "off", to: "open" })
  })

  it("complex tool chain triggers switch from high to off", async () => {
    mockClient.setGenerators([
      (async function* () {
        yield { type: "tool_call_end", toolCallIndex: 0, id: "tc-1", name: "ok", arguments: "{}" }
        yield { type: "usage", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } }
        yield { type: "done", finishReason: "tool_calls" }
      })(),
      (async function* () {
        yield { type: "tool_call_end", toolCallIndex: 0, id: "tc-2", name: "ok", arguments: "{}" }
        yield { type: "usage", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } }
        yield { type: "done", finishReason: "tool_calls" }
      })(),
      (async function* () {
        yield { type: "tool_call_end", toolCallIndex: 0, id: "tc-3", name: "ok", arguments: "{}" }
        yield { type: "usage", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } }
        yield { type: "done", finishReason: "tool_calls" }
      })(),
      (async function* () {
        yield { type: "tool_call_end", toolCallIndex: 0, id: "tc-4", name: "ok", arguments: "{}" }
        yield { type: "usage", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } }
        yield { type: "done", finishReason: "tool_calls" }
      })(),
      (async function* () {
        yield { type: "tool_call_end", toolCallIndex: 0, id: "tc-5", name: "ok", arguments: "{}" }
        yield { type: "usage", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } }
        yield { type: "done", finishReason: "tool_calls" }
      })(),
      (async function* () {
        yield { type: "tool_call_end", toolCallIndex: 0, id: "tc-6", name: "ok", arguments: "{}" }
        yield { type: "usage", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } }
        yield { type: "done", finishReason: "tool_calls" }
      })(),
      (async function* () {
        yield { type: "text_delta", delta: "done" }
        yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        yield { type: "done", finishReason: "stop" }
      })(),
    ])
    const engine = makeEngine()
    engine.setThinkingMode("high")
    engine.registerTool({ name: "ok", description: "ok", parameters: { type: "object", properties: {} }, concurrency: "shared", approval: "read", async execute() { return { content: "ok", isError: false } } })

    // Start with high mode
    const events: LoopEvent[] = []
    for await (const e of engine.submit("do many tools")) events.push(e)

    const modeSwitches = events.filter(e => e.role === "status" && e.content === "thinking_mode_switch")
    expect(modeSwitches.length).toBeGreaterThanOrEqual(1)
    const toOff = modeSwitches.find(e => (e.metadata as any)?.to === "off")
    expect(toOff).toBeDefined()
  })

  it("cooldown suppresses rapid switching", async () => {
    mockClient.setGenerators([
      (async function* () {
        yield { type: "text_delta", delta: "first" }
        yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        yield { type: "done", finishReason: "stop" }
      })(),
      (async function* () {
        yield { type: "text_delta", delta: "second" }
        yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        yield { type: "done", finishReason: "stop" }
      })(),
    ])
    const engine = makeEngine()
    const events1: LoopEvent[] = []
    for await (const e of engine.submit("first")) events1.push(e)

    // Second submit immediately after - cooldown should suppress
    const events2: LoopEvent[] = []
    for await (const e of engine.submit("second")) events2.push(e)

    // Only first submit should trigger mode switch
    const switches1 = events1.filter(e => e.role === "status" && e.content === "thinking_mode_switch")
    const switches2 = events2.filter(e => e.role === "status" && e.content === "thinking_mode_switch")
    expect(switches1.length).toBe(1)
    expect(switches2.length).toBe(0)
  })
})
