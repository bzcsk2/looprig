import http from "node:http"
import { AddressInfo } from "node:net"
import { Socket } from "node:net"

const SCENARIOS: Record<string, () => { chunks: SseChunk[]; status: number }> = {
  normal: () => ({
    status: 200,
    chunks: [
      { data: `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n` },
      { data: `data: {"choices":[{"delta":{"content":" world"}}]}\n\n` },
      { data: `data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\n` },
      { data: "data: [DONE]\n\n" },
    ],
  }),

  tool_calls: () => ({
    status: 200,
    chunks: [
      { data: `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":""}}]}}]}\n\n` },
      { data: `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"test.txt\\""}}}]}}]}\n\n` },
      { data: `data: {"choices":[{"delta":{"content":""},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":5,"total_tokens":25}}\n\n` },
      { data: "data: [DONE]\n\n" },
    ],
  }),

  reasoning: () => ({
    status: 200,
    chunks: [
      { data: `data: {"choices":[{"delta":{"reasoning_content":"Let me think"}}]}\n\n` },
      { data: `data: {"choices":[{"delta":{"reasoning_content":" step by step"}}]}\n\n` },
      { data: `data: {"choices":[{"delta":{"content":"The answer is 42"}}]}\n\n` },
      { data: `data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":8,"total_tokens":18}}\n\n` },
      { data: "data: [DONE]\n\n" },
    ],
  }),

  error_429: () => ({
    status: 429,
    chunks: [{ data: `{"error":{"message":"Rate limit exceeded","type":"rate_limit_error"}}` }],
  }),

  error_500: () => ({
    status: 500,
    chunks: [{ data: `{"error":{"message":"Internal server error"}}` }],
  }),
}

export interface SseChunk {
  data: string
  delay?: number
}

function buildScenarioChunks(scenario: string): { chunks: SseChunk[]; status: number } {
  const builder = SCENARIOS[scenario]
  if (builder) return builder()
  return SCENARIOS.normal()
}

export class MockSseServer {
  #server: http.Server
  #url = ""
  #scenario = "normal"
  #chunks: SseChunk[] = []
  #statusCode = 200
  #delayMs = 30
  #chunkSize = 0
  #requestCount = 0
  #maxRequests = Infinity
  #failFirst = 0
  #sockets = new Set<Socket>()

  constructor() {
    this.#server = http.createServer((req, res) => {
      res.on("close", () => this.#sockets.delete(req.socket))
      this.#sockets.add(req.socket)
      this.#requestCount++
      if (this.#requestCount > this.#maxRequests) {
        res.writeHead(503)
        res.end("request limit exceeded")
        return
      }
      if (this.#requestCount <= this.#failFirst) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" })
        res.end(JSON.stringify({ error: { message: "Rate limit exceeded", type: "rate_limit_error" } }))
        return
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const scenario = url.searchParams.get("scenario") ?? this.#scenario
      const { chunks, status } = buildScenarioChunks(scenario)
      const effectiveChunks = this.#chunks.length > 0 ? this.#chunks : chunks
      const effectiveStatus = this.#statusCode !== 200 ? this.#statusCode : status

      if (effectiveStatus !== 200) {
        res.writeHead(effectiveStatus, { "Content-Type": "application/json" })
        for (const c of effectiveChunks) {
          res.write(c.data)
        }
        res.end()
        return
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      })

      let idx = 0
      const emit = () => {
        if (idx >= effectiveChunks.length) {
          res.end()
          return
        }
        const c = effectiveChunks[idx++]
        const delay = c.delay ?? this.#delayMs
        const body = this.#chunkSize > 0 ? splitChunk(c.data, this.#chunkSize) : c.data
        res.write(body)
        if (delay > 0) {
          setTimeout(emit, delay)
        } else {
          setImmediate(emit)
        }
      }
      emit()
    })
  }

  async start(): Promise<void> {
    if (this.#url) return
    await new Promise<void>((resolve) => this.#server.listen(0, resolve))
    const port = (this.#server.address() as AddressInfo).port
    this.#url = `http://localhost:${port}`
  }

  async stop(): Promise<void> {
    if (!this.#url) return
    for (const sock of this.#sockets) {
      sock.destroy()
    }
    this.#sockets.clear()
    await new Promise<void>((resolve, reject) => {
      this.#server.close((err) => (err ? reject(err) : resolve()))
    })
    this.#url = ""
  }

  get url(): string {
    if (!this.#url) throw new Error("MockSseServer not started")
    return this.#url
  }

  get baseUrl(): string {
    return this.url + "/"
  }

  setScenario(name: string): this {
    this.#scenario = name
    this.#chunks = []
    this.#statusCode = 200
    return this
  }

  setChunks(chunks: SseChunk[], statusCode = 200): this {
    this.#chunks = chunks
    this.#statusCode = statusCode
    return this
  }

  setDelay(ms: number): this {
    this.#delayMs = ms
    return this
  }

  setChunkSize(bytes: number): this {
    this.#chunkSize = bytes
    return this
  }

  setMaxRequests(n: number): this {
    this.#maxRequests = n
    return this
  }

  setFailFirst(n: number): this {
    this.#failFirst = n
    return this
  }

  get requestCount(): number {
    return this.#requestCount
  }

  reset(): void {
    this.#requestCount = 0
    this.#maxRequests = Infinity
    this.#failFirst = 0
    this.#scenario = "normal"
    this.#chunks = []
    this.#statusCode = 200
    this.#delayMs = 30
    this.#chunkSize = 0
  }
}

function splitChunk(data: string, size: number): string {
  if (size <= 0 || data.length <= size) return data
  const parts: string[] = []
  for (let i = 0; i < data.length; i += size) {
    parts.push(data.slice(i, i + size))
  }
  return parts.join("")
}
