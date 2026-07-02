import { loadConfig } from "@covalo/core"
import { ReasonixEngine } from "@covalo/core"
import { buildSystemPrompt } from "@covalo/core"
import { createDefaultTools, clearReadTracker, normalizePlatform, resolveShellBackend } from "@covalo/tools"
import { McpHost, setMcpHost } from "@covalo/mcp"

const config = loadConfig()
config.baseUrl = 'http://127.0.0.1:21008/'
config.apiKey = 'test'

const mcpHost = new McpHost()
setMcpHost(mcpHost)
const mcpLoadPromise = mcpHost.loadConfig().catch(() => {})

const engine = new ReasonixEngine(config, clearReadTracker)
const platform = normalizePlatform()
const shellBackend = await resolveShellBackend(platform)
engine.setSystemPrompt(buildSystemPrompt(process.cwd(), {
  osPlatform: platform,
  shellBackend: `${shellBackend.id} (${shellBackend.executable})`,
}))
for (const tool of createDefaultTools()) {
  engine.registerTool(tool)
}

console.log('starting submit')
for await (const event of engine.submit('hi')) {
  console.log('event:', event.role)
}
console.log('submit done')

await engine.shutdown()
await Promise.race([mcpLoadPromise, new Promise(r => setTimeout(r, 2000))])
await mcpHost.disconnectAll()
console.log('shutdown done')
