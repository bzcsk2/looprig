import { loadConfig } from "@covalo/core"
import { ReasonixEngine } from "@covalo/core"
import { buildSystemPrompt } from "@covalo/core"
import { createDefaultTools, clearReadTracker, normalizePlatform, resolveShellBackend } from "@covalo/tools"
import { McpHost, setMcpHost } from "@covalo/mcp"

const config = loadConfig()
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

console.log('init done')
await engine.shutdown()
await Promise.race([mcpLoadPromise, new Promise(r => setTimeout(r, 2000))])
await mcpHost.disconnectAll()
console.log('shutdown done')
