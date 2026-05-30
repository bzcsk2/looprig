import { describe, it, expect } from "vitest"
import type { LoopEvent } from "../src/interface.js"

describe("QueryEngine", () => {
  function makeMockEngine(yieldEvents: LoopEvent[]) {
    return {
      lastInput: "",
      lastAgentConfig: undefined as any,
      async *submit(input: string, agentConfig?: any) {
        this.lastInput = input
        this.lastAgentConfig = agentConfig
        for (const ev of yieldEvents) yield ev
      },
      interrupt() {},
    }
  }

  async function collectStream(qe: any, input: string, agentConfig?: any): Promise<LoopEvent[]> {
    const events: LoopEvent[] = []
    for await (const ev of qe.stream(input, agentConfig)) events.push(ev)
    return events
  }

  it("should stream engine.submit events", async () => {
    const { QueryEngine } = await import("../src/query-engine.js")
    const mockEngine = makeMockEngine([
      { role: "assistant_delta", content: "Hello" } as LoopEvent,
      { role: "done" } as LoopEvent,
    ])
    const qe = new QueryEngine(mockEngine as any)
    const events = await collectStream(qe, "test input")
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ role: "assistant_delta", content: "Hello" })
  })

  it("should pass input to engine.submit", async () => {
    const { QueryEngine } = await import("../src/query-engine.js")
    const mockEngine = makeMockEngine([{ role: "done" } as LoopEvent])
    const qe = new QueryEngine(mockEngine as any)
    await collectStream(qe, "my input")
    expect(mockEngine.lastInput).toBe("my input")
  })

  it("should pass agentConfig to engine.submit", async () => {
    const { QueryEngine } = await import("../src/query-engine.js")
    const mockEngine = makeMockEngine([{ role: "done" } as LoopEvent])
    const qe = new QueryEngine(mockEngine as any)
    const config = { name: "plan", systemPrompt: "be concise" }
    await collectStream(qe, "hi", config)
    expect(mockEngine.lastAgentConfig).toEqual(config)
  })

  it("should invoke onEvent callbacks during stream", async () => {
    const { QueryEngine } = await import("../src/query-engine.js")
    const mockEngine = makeMockEngine([
      { role: "assistant_delta", content: "A" } as LoopEvent,
      { role: "done" } as LoopEvent,
    ])
    const qe = new QueryEngine(mockEngine as any)
    const received: LoopEvent[] = []
    qe.onEvent((ev) => received.push(ev))
    await collectStream(qe, "test")
    expect(received).toHaveLength(2)
  })

  it("should unsubscribe from events", async () => {
    const { QueryEngine } = await import("../src/query-engine.js")
    const mockEngine = makeMockEngine([
      { role: "assistant_delta", content: "A" } as LoopEvent,
      { role: "done" } as LoopEvent,
    ])
    const qe = new QueryEngine(mockEngine as any)
    const received: LoopEvent[] = []
    const unsubscribe = qe.onEvent((ev) => received.push(ev))
    unsubscribe()
    await collectStream(qe, "test")
    expect(received).toHaveLength(0)
  })

  it("should survive onEvent callback throwing", async () => {
    const { QueryEngine } = await import("../src/query-engine.js")
    const mockEngine = makeMockEngine([
      { role: "assistant_delta", content: "A" } as LoopEvent,
      { role: "done" } as LoopEvent,
    ])
    const qe = new QueryEngine(mockEngine as any)
    qe.onEvent(() => { throw new Error("oops") })
    const events = await collectStream(qe, "test")
    expect(events).toHaveLength(2)
  })

  it("should call onEvent callbacks in registration order", async () => {
    const { QueryEngine } = await import("../src/query-engine.js")
    const mockEngine = makeMockEngine([
      { role: "assistant_delta", content: "X" } as LoopEvent,
      { role: "done" } as LoopEvent,
    ])
    const qe = new QueryEngine(mockEngine as any)
    const order: number[] = []
    qe.onEvent(() => order.push(1))
    qe.onEvent(() => order.push(2))
    await collectStream(qe, "test")
    // 2 events → each callback fires once per event
    expect(order).toEqual([1, 2, 1, 2])
  })

  it("should collect full response via query()", async () => {
    const { QueryEngine } = await import("../src/query-engine.js")
    const mockEngine = makeMockEngine([
      { role: "assistant_delta", content: "Hello" } as LoopEvent,
      { role: "assistant_delta", content: " world" } as LoopEvent,
      { role: "done" } as LoopEvent,
    ])
    const qe = new QueryEngine(mockEngine as any)
    const result = await qe.query("test")
    expect(result).toBe("Hello world")
  })

  it("should delegate interrupt to engine", async () => {
    const { QueryEngine } = await import("../src/query-engine.js")
    let interrupted = false
    const mockEngine = {
      submit: async function* () {},
      interrupt() { interrupted = true },
    }
    const qe = new QueryEngine(mockEngine as any)
    qe.interrupt()
    expect(interrupted).toBe(true)
  })
})
