import { loadConfig } from "@deepicode/core"
import { ReasonixEngine } from "@deepicode/core"
import { buildSystemPrompt } from "@deepicode/core"
import { createDefaultTools, clearReadTracker, normalizePlatform, resolveShellBackend } from "@deepicode/tools"
import { McpHost, setMcpHost } from "@deepicode/mcp"

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
