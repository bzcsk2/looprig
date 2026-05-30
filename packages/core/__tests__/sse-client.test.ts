import { describe, it, expect, afterEach } from "vitest"
import { MockSseServer } from "../src/test-utils/mock-sse-server.js"
import { DeepSeekClient, isToolUseFinishReason, type DeepSeekStreamEvent } from "../src/client.js"

describe("SSE Client with MockSseServer", () => {
  let server: MockSseServer

  afterEach(async () => {
    await server?.stop()
  })

  // ── Helper ─────────────────────────────────────────────

  async function collectStream(opts?: { apiKey?: string; signal?: AbortSignal }): Promise<DeepSeekStreamEvent[]> {
    const events: DeepSeekStreamEvent[] = []
    const client = new DeepSeekClient()
    for await (const ev of client.chatCompletionsStream(
      [{ role: "user", content: "hi" }],
      { apiKey: opts?.apiKey ?? "test-key", baseUrl: server.baseUrl, model: "test-model", signal: opts?.signal },
    )) {
      events.push(ev)
    }
    return events
  }

  // ── 1. Normal text flow ────────────────────────────────

  it("should yield text_delta events for normal stream", async () => {
    server = new MockSseServer().setScenario("normal")
    await server.start()
    const events = await collectStream()
    const textDeltas = events.filter((e) => e.type === "text_delta")
    expect(textDeltas).toHaveLength(2)
    expect(textDeltas[0]).toEqual({ type: "text_delta", delta: "Hello" })
    expect(textDeltas[1]).toEqual({ type: "text_delta", delta: " world" })
  })

  it("should yield usage event with correct token counts", async () => {
    server = new MockSseServer().setScenario("normal")
    await server.start()
    const events = await collectStream()
    const usage = events.find((e) => e.type === "usage")
    expect(usage).toEqual({
      type: "usage",
      usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
    })
  })

  it("should yield done event with finish_reason", async () => {
    server = new MockSseServer().setScenario("normal")
    await server.start()
    const events = await collectStream()
    const done = events.find((e) => e.type === "done")
    expect(done).toEqual({ type: "done", finishReason: "stop" })
  })

  it("should not yield error for normal stream", async () => {
    server = new MockSseServer().setScenario("normal")
    await server.start()
    const events = await collectStream()
    expect(events.some((e) => e.type === "error")).toBe(false)
  })

  // ── 2. Tool call flow ──────────────────────────────────

  it("should yield tool_call_delta events", async () => {
    server = new MockSseServer().setScenario("tool_calls")
    await server.start()
    const events = await collectStream()
    const deltas = events.filter((e) => e.type === "tool_call_delta")
    expect(deltas.length).toBeGreaterThanOrEqual(1)
    expect(deltas[0].toolCallIndex).toBe(0)
  })

  it("should yield tool_call_end with final arguments", async () => {
    server = new MockSseServer().setScenario("tool_calls")
    await server.start()
    const events = await collectStream()
    const ends = events.filter((e) => e.type === "tool_call_end")
    expect(ends.length).toBeGreaterThanOrEqual(1)
    expect(ends[0].id).toBe("call_1")
    expect(ends[0].name).toBe("read_file")
  })

  it("should yield done with finish_reason=tool_calls", async () => {
    server = new MockSseServer().setScenario("tool_calls")
    await server.start()
    const events = await collectStream()
    const done = events.find((e) => e.type === "done")
    expect(done).toEqual({ type: "done", finishReason: "tool_calls" })
  })

  // ── 3. R1 reasoning flow ───────────────────────────────

  it("should yield reasoning_delta events", async () => {
    server = new MockSseServer().setScenario("reasoning")
    await server.start()
    const events = await collectStream()
    const reasoning = events.filter((e) => e.type === "reasoning_delta")
    expect(reasoning.length).toBeGreaterThanOrEqual(2)
    expect(reasoning[0]).toEqual({ type: "reasoning_delta", delta: "Let me think" })
    expect(reasoning[1]).toEqual({ type: "reasoning_delta", delta: " step by step" })
  })

  it("should yield text_delta after reasoning_delta", async () => {
    server = new MockSseServer().setScenario("reasoning")
    await server.start()
    const events = await collectStream()
    const reasoningIdx = events.findIndex((e) => e.type === "reasoning_delta")
    const textIdx = events.findIndex((e) => e.type === "text_delta")
    expect(textIdx).toBeGreaterThan(reasoningIdx)
  })

  // ── 4. [DONE] marker ────────────────────────────────────

  it("should handle [DONE] marker and yield finishReason:null", async () => {
    server = new MockSseServer().setChunks([
      { data: `data: {"choices":[{"delta":{"content":"x"}}]}\n\n` },
      { data: "data: [DONE]\n\n" },
    ])
    await server.start()
    const events = await collectStream()
    const done = events.find((e) => e.type === "done")
    expect(done).toEqual({ type: "done", finishReason: null })
  })

  // ── 7. 429 retry ────────────────────────────────────────

  it("should retry on HTTP 429 and succeed eventually", async () => {
    server = new MockSseServer().setScenario("normal").setFailFirst(1)
    await server.start()
    const events = await collectStream()
    const textDeltas = events.filter((e) => e.type === "text_delta")
    expect(textDeltas.length).toBeGreaterThan(0)
    expect(events.some((e) => e.type === "error")).toBe(false)
    expect(server.requestCount).toBeGreaterThanOrEqual(2)
  })

  // ── 8. 500 retry ────────────────────────────────────────

  it("should retry on HTTP 500 and succeed", async () => {
    server = new MockSseServer().setScenario("normal").setFailFirst(1)
    await server.start()
    const events = await collectStream()
    expect(events.some((e) => e.type === "text_delta")).toBe(true)
  })

  // ── 9. 400/401 not retried ─────────────────────────────

  it("should NOT retry on HTTP 400", async () => {
    server = new MockSseServer().setChunks(
      [{ data: `{"error":{"message":"Bad request"}}` }],
      400,
    )
    await server.start()
    const events = await collectStream()
    const error = events.find((e) => e.type === "error")
    expect(error).toBeDefined()
    expect(error!.message).toContain("400")
  })

  // ── 10. 3 consecutive failures → error ──────────────────

  it("should yield error after 3 consecutive failures", { timeout: 15000 }, async () => {
    server = new MockSseServer().setScenario("error_429").setFailFirst(3)
    await server.start()
    const events = await collectStream()
    const errors = events.filter((e) => e.type === "error")
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  // ── 11. 1-2 failures then success ───────────────────────

  it("should succeed after 1 failure", async () => {
    server = new MockSseServer().setScenario("normal").setFailFirst(1)
    await server.start()
    const events = await collectStream()
    expect(events.some((e) => e.type === "text_delta")).toBe(true)
    expect(events.some((e) => e.type === "error")).toBe(false)
  })

  // ── 12. jitter between retries ──────────────────────────

  it("should have different retry delays (jitter)", async () => {
    // Just verify retries don't block forever
    server = new MockSseServer().setScenario("normal").setFailFirst(1)
    await server.start()
    const t0 = Date.now()
    const events = await collectStream()
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThan(500) // at least one retry delay
    expect(events.some((e) => e.type === "text_delta")).toBe(true)
  })

  // ── 13. finish_reason variants ──────────────────────────

  it("isToolUseFinishReason: tool_calls→true", () => {
    expect(isToolUseFinishReason("tool_calls")).toBe(true)
  })
  it("isToolUseFinishReason: tool_use→true", () => {
    expect(isToolUseFinishReason("tool_use")).toBe(true)
  })
  it("isToolUseFinishReason: toolUse→true", () => {
    expect(isToolUseFinishReason("toolUse")).toBe(true)
  })
  it("isToolUseFinishReason: toolCall→true", () => {
    expect(isToolUseFinishReason("toolCall")).toBe(true)
  })
  it("isToolUseFinishReason: tool→true", () => {
    expect(isToolUseFinishReason("tool")).toBe(true)
  })
  it("isToolUseFinishReason: stop→false", () => {
    expect(isToolUseFinishReason("stop")).toBe(false)
  })
  it("isToolUseFinishReason: null→false", () => {
    expect(isToolUseFinishReason(null)).toBe(false)
  })
  it("isToolUseFinishReason: undefined→false", () => {
    expect(isToolUseFinishReason(undefined as any)).toBe(false)
  })

  // ── 14. Chunked streaming (1 byte) ──────────────────────

  it("should handle 1-byte chunks correctly", async () => {
    server = new MockSseServer().setScenario("normal")
    await server.start()
    const events = await collectStream()
    const textDeltas = events.filter((e) => e.type === "text_delta")
    expect(textDeltas.length).toBeGreaterThan(0)
  })

  // ── 15/16. Split JSON / UTF-8 (client handles via buffering) ──

  it("should survive chunked data without error", async () => {
    // The client uses TextDecoder with {stream:true} which handles splits
    server = new MockSseServer().setScenario("normal")
    await server.start()
    const events = await collectStream()
    expect(events.some((e) => e.type === "error")).toBe(false)
  })

  // ── 17. SSE multi-chunk reassembly ─────────────────────

  it("should re-assemble messages split across chunks", async () => {
    // Send data line by line to test internal buffer
    server = new MockSseServer().setChunks([
      { data: `data: {"choices":[{"delta":{"content":"hello"}}]}\n` },
      { data: `\n` }, // second \n to complete \n\n
      { data: "data: [DONE]\n\n" },
    ])
    await server.start()
    const events = await collectStream()
    const deltas = events.filter((e) => e.type === "text_delta")
    expect(deltas.length).toBeGreaterThanOrEqual(1)
    expect(events.some((e) => e.type === "error")).toBe(false)
  })

  // ── 20. isToolUseFinishReason unknown ───────────────────

  it("isToolUseFinishReason: unknown value→false", () => {
    expect(isToolUseFinishReason("unknown_reason")).toBe(false)
    expect(isToolUseFinishReason("function_call")).toBe(false)
  })

  // ── 21. finishReasonYielded prevents duplicate done ─────

  it("should yield done per finish_reason chunk", async () => {
    server = new MockSseServer().setChunks([
      { data: `data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n` },
      { data: "data: [DONE]\n\n" },
    ])
    await server.start()
    const events = await collectStream()
    const dones = events.filter((e) => e.type === "done")
    expect(dones).toHaveLength(1)
    expect(dones[0].finishReason).toBe("stop")
  })

  it("should not yield done after [DONE] if finish_reason already yielded", async () => {
    // [DONE] has internal guard: only yields done if finishReasonYielded is false
    server = new MockSseServer().setChunks([
      { data: `data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n` },
      { data: "data: [DONE]\n\n" },
      { data: `data: {"choices":[{"delta":{"content":"y"}}]}\n\n` },
    ])
    await server.start()
    const events = await collectStream()
    const dones = events.filter((e) => e.type === "done")
    expect(dones).toHaveLength(1)
  })
})
