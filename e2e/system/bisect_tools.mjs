import { loadConfig } from "@covalo/core"
import { ReasonixEngine } from "@covalo/core"
import { buildSystemPrompt } from "@covalo/core"
import { createDefaultTools, clearReadTracker, normalizePlatform, resolveShellBackend } from "@covalo/tools"
import { McpHost, setMcpHost } from "@covalo/mcp"

const config = loadConfig()
const mcpHost = new McpHost()
setMcpHost(mcpHost)

const engine = new ReasonixEngine(config, clearReadTracker)
const platform = normalizePlatform()
const shellBackend = await resolveShellBackend(platform)
engine.setSystemPrompt(buildSystemPrompt(process.cwd(), {
  osPlatform: platform,
  shellBackend: `${shellBackend.id} (${shellBackend.executable})`,
}))

const tools = createDefaultTools()
for (let i = 0; i < tools.length; i++) {
  engine.registerTool(tools[i])
  console.log('Registered tool:', i, tools[i].name)
}

console.log('init done')
await engine.shutdown()
console.log('shutdown done')
