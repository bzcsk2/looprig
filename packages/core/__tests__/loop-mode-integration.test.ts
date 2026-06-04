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
  it("auto mode: simple query triggers switch from off to open", async () => {
    mockClient.setGenerators([
      (async function* () {
        yield { type: "text_delta", delta: "hello" }
        yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        yield { type: "done", finishReason: "stop" }
      })(),
    ])
    const engine = makeEngine()
    engine.setThinkingMode("auto")
    const events: LoopEvent[] = []
    for await (const e of engine.submit("hi")) events.push(e)

    const modeSwitch = events.find(e => e.role === "status" && e.content === "thinking_mode_switch")
    expect(modeSwitch).toBeDefined()
    expect(modeSwitch!.metadata).toMatchObject({ from: "off", to: "open" })
  })

  it("manual open mode: no auto-switching", async () => {
    mockClient.setGenerators([
      (async function* () {
        yield { type: "text_delta", delta: "hello" }
        yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        yield { type: "done", finishReason: "stop" }
      })(),
    ])
    const engine = makeEngine()
    engine.setThinkingMode("open")
    const events: LoopEvent[] = []
    for await (const e of engine.submit("hi")) events.push(e)

    const modeSwitch = events.find(e => e.role === "status" && e.content === "thinking_mode_switch")
    expect(modeSwitch).toBeUndefined()
  })

  it("manual off mode: no auto-switching", async () => {
    mockClient.setGenerators([
      (async function* () {
        yield { type: "text_delta", delta: "hello" }
        yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        yield { type: "done", finishReason: "stop" }
      })(),
    ])
    const engine = makeEngine()
    engine.setThinkingMode("off")
    const events: LoopEvent[] = []
    for await (const e of engine.submit("hi")) events.push(e)

    const modeSwitch = events.find(e => e.role === "status" && e.content === "thinking_mode_switch")
    expect(modeSwitch).toBeUndefined()
  })
})
