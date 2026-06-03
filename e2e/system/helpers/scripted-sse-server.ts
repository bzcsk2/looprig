import { createServer, type Server } from "node:http"

export interface ScriptedSseServerOptions {
  port?: number
  responses?: string[]
}

export function startScriptedSseServer(options: ScriptedSseServerOptions = {}): Promise<{ server: Server; url: string; stop: () => Promise<void> }> {
  const responses = options.responses ?? ["hello", " world", "done"]
  const server = createServer((req, res) => {
    if (req.method === "POST") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      })
      for (const text of responses) {
        const chunk = JSON.stringify({ choices: [{ delta: { content: text } }] })
        res.write(`data: ${chunk}\n\n`)
      }
      res.write("data: [DONE]\n\n")
      res.end()
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 0)
      const url = `http://127.0.0.1:${port}/`
      resolve({
        server,
        url,
        stop: () => new Promise<void>((res) => server.close(() => res())),
      })
    })
  })
}
