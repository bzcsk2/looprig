import { readFile, access } from "node:fs/promises"
import { resolve, delimiter } from "node:path"
import { McpClient } from "./client.js"
import type { McpTool, McpResource } from "./client.js"
import type { DiagnosticLogger } from "./diagnostics.js"
import { noopDiagnosticLogger } from "./diagnostics.js"
import { McpConfigSchema, McpAuthStoreSchema } from "./schemas.js"

interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>
}

/**
 * Built-in MCP servers that ship with deepreef.
 * User config in `.deepreef/mcp.json` takes precedence — if the user has
 * already configured a server with the same name, the built-in is skipped.
 *
 * Built-in server connection failures are silent: if the command is not
 * installed (e.g. `codegraph` not on PATH), deepreef simply skips it.
 */
const BUILTIN_MCP_SERVERS: Record<string, McpServerConfig> = {
  codegraph: {
    command: "codegraph",
    args: ["serve", "--mcp"],
  },
}

const WIN_EXTS = [".cmd", ".exe", ".bat"]

/**
 * Check if a command is available on PATH (cross-platform, non-blocking,
 * **no shell**).
 *
 * Walks each directory in PATH and tests `fs.access(path, F_OK)` directly,
 * avoiding shell interpolation entirely.  On Windows, also checks common
 * executable extensions (`.cmd`, `.exe`, `.bat`).
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    const fullPath = resolve(dir, command)
    try {
      await access(fullPath)
      return true
    } catch {
      // continue
    }
    if (process.platform === "win32") {
      for (const ext of WIN_EXTS) {
        try {
          await access(fullPath + ext)
          return true
        } catch {
          // continue
        }
      }
    }
  }
  return false
}

export interface McpLoadSummary {
  serverCount: number
  connected: number
  failed: Array<{ name: string; error: string }>
}

export class McpHost {
  private clients = new Map<string, McpClient>()
  private tools = new Map<string, { client: McpClient; tool: McpTool }>()
  private resources = new Map<string, { client: McpClient; resource: McpResource }>()
  private logger: DiagnosticLogger
  private builtinServers: Record<string, McpServerConfig>
  private checkCommand: (command: string) => Promise<boolean>
  private lastLoadSummary: McpLoadSummary = { serverCount: 0, connected: 0, failed: [] }

  constructor(
    logger: DiagnosticLogger = noopDiagnosticLogger,
    options?: {
      builtinServers?: Record<string, McpServerConfig>
      checkCommand?: (command: string) => Promise<boolean>
    },
  ) {
    this.logger = logger
    this.builtinServers = options?.builtinServers ?? BUILTIN_MCP_SERVERS
    this.checkCommand = options?.checkCommand ?? isCommandAvailable
  }

  get allTools(): Array<{ client: string; tool: McpTool }> {
    return Array.from(this.tools.values()).map(({ client, tool }) => ({ client: client.serverName, tool }))
  }

  get allResources(): Array<{ client: string; resource: McpResource }> {
    return Array.from(this.resources.values()).map(({ client, resource }) => ({ client: client.serverName, resource }))
  }

  getStatus(): McpLoadSummary {
    return {
      serverCount: this.lastLoadSummary.serverCount,
      connected: this.clients.size,
      failed: [...this.lastLoadSummary.failed],
    }
  }

  /**
   * Load MCP server configuration and connect to all servers.
   *
   * @param configPath  Path to a JSON config file.  When omitted the default
   *                    `.deepreef/mcp.json` in `cwd` is used.
   * @param options.loadBuiltins  When `true`, built-in servers are merged
   *        regardless of whether `configPath` was provided.  When `false`,
   *        built-in loading is skipped entirely.  When omitted, the original
   *        behaviour applies: built-ins are only loaded when `configPath` is
   *        **not** provided (i.e. the default config is used).
   */
  async loadConfig(
    configPath?: string,
    options?: { loadBuiltins?: boolean },
  ): Promise<McpLoadSummary> {
    const paths = configPath ? [configPath] : [
      resolve(process.cwd(), ".deepreef/mcp.json"),
    ]

    let config: McpConfig = {}
    for (const p of paths) {
      try {
        const raw = await readFile(p, "utf-8")
        const parsed = JSON.parse(raw)
        const result = await McpConfigSchema["~standard"].validate(parsed)
        if ("value" in result) {
          config = result.value as McpConfig
        } else {
          config = {}
        }
        break
      } catch { continue }
    }

    const auth = await readAuthStore()
    const userEntries = Object.entries(config.mcpServers ?? {})

    // --- Built-in servers: merge with user config (user takes precedence) ---
    const builtinEntries: Array<[string, McpServerConfig]> = []
    const shouldLoadBuiltins = options?.loadBuiltins ?? !configPath
    if (shouldLoadBuiltins) {
      for (const [name, serverConfig] of Object.entries(this.builtinServers)) {
        // Skip if user already configured a server with the same name
        if (config.mcpServers?.[name]) continue
        // Skip if the command is not available on PATH
        if (!await this.checkCommand(serverConfig.command)) continue
        builtinEntries.push([name, serverConfig])
      }
    }

    const allEntries = [...userEntries, ...builtinEntries]
    if (this.logger.isEnabled("info")) {
      this.logger.info("mcp.host.start", { serverCount: allEntries.length, builtinCount: builtinEntries.length })
    }

    const failed: McpLoadSummary["failed"] = []
    let builtinFailedCount = 0

    await Promise.all(allEntries.map(([name, serverConfig]) => {
      const isBuiltin = builtinEntries.some(([n]) => n === name)
      return this.connect(name, withCredential(serverConfig, auth[name]?.apiKey), { silent: isBuiltin }).catch((error) => {
        // Built-in server failures are silent — the command may simply not be installed
        if (isBuiltin) {
          builtinFailedCount++
        } else {
          failed.push({ name, error: error instanceof Error ? error.message : String(error) })
        }
      })
    }))

    // Only count servers that the user cares about: user-configured + successfully
    // connected built-in servers.  Failed built-in servers are invisible to the user.
    this.lastLoadSummary = {
      serverCount: allEntries.length - builtinFailedCount,
      connected: allEntries.length - builtinFailedCount - failed.length,
      failed,
    }
    if (failed.length > 0 && this.logger.isEnabled("warn")) {
      this.logger.warn("mcp.load.warning", { serverCount: allEntries.length - builtinFailedCount, failedCount: failed.length, failedServers: failed.map(f => f.name) })
    }
    return this.getStatus()
  }

  /**
   * Connect to an MCP server by spawning it as a child process.
   *
   * @param options.silent When true, suppresses **all** warning-level logs
   *   emitted during the connection attempt — both from the host itself and
   *   from the underlying McpClient (initialize handshake, request timeouts,
   *   JSON-RPC errors, etc.).  Used for built-in servers (e.g. codegraph)
   *   whose absence is expected and should not alarm the user.
   */
  async connect(name: string, config: McpServerConfig, options?: { silent?: boolean }): Promise<void> {
    if (this.clients.has(name)) return

    const startedAt = this.logger.isEnabled("info") ? Date.now() : 0
    if (this.logger.isEnabled("info")) {
      this.logger.info("mcp.server.connect.start", { mcpServer: name })
    }

    // When silent, suppress all warning/debug logs from the client too
    const clientLogger: DiagnosticLogger = options?.silent
      ? noopDiagnosticLogger
      : this.logger

    const client = new McpClient(name, clientLogger)
    this.clients.set(name, client)

    try {
      await client.connect(config.command, config.args ?? [], config.env)

      // Register tools (sorted for stable prefix cache)
      const tools = (await client.listTools()).sort((a, b) => a.name.localeCompare(b.name))
      for (const tool of tools) {
        this.tools.set(`${name}:${tool.name}`, { client, tool })
      }

      // Register resources
      try {
        const resources = await client.listResources()
        for (const resource of resources) {
          this.resources.set(`${name}:${resource.uri}`, { client, resource })
        }
      } catch {
        // resources/list is optional
      }

      // Register prompts
      try {
        await client.listPrompts()
      } catch {
        // prompts/list is optional
      }

      if (this.logger.isEnabled("info")) {
        this.logger.info("mcp.server.connect.done", { mcpServer: name, durationMs: Date.now() - startedAt, toolCount: tools.length })
      }
    } catch (e) {
      // Only log when not silenced (e.g. built-in servers whose absence is expected)
      if (!options?.silent && this.logger.isEnabled("warn")) {
        this.logger.warn("mcp.server.connect.error", { mcpServer: name, durationMs: Date.now() - startedAt, errorClass: e instanceof Error ? e.name : "Unknown" })
      }
      if (this.clients.get(name) === client) {
        this.clients.delete(name)
      }
      await client.disconnect().catch(() => {})
      throw e
    }
  }

  async addSources(sources: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>): Promise<McpLoadSummary> {
    const auth = await readAuthStore()
    const failed: McpLoadSummary["failed"] = []
    await Promise.all(sources.map(({ name, command, args, env }) =>
      this.connect(name, { command, args, env: { ...env, ...(auth[name]?.apiKey ? { MCP_API_KEY: auth[name].apiKey, DEEPREEF_MCP_API_KEY: auth[name].apiKey } : {}) } }).catch((error) => {
        failed.push({ name, error: error instanceof Error ? error.message : String(error) })
      })
    ))
    this.lastLoadSummary = { serverCount: this.lastLoadSummary.serverCount + sources.length, connected: this.clients.size, failed: [...this.lastLoadSummary.failed, ...failed] }
    return this.getStatus()
  }

  async disconnectAll(): Promise<void> {
    for (const [, client] of this.clients) {
      await client.disconnect()
    }
    this.clients.clear()
    this.tools.clear()
    this.resources.clear()
  }

  async callTool(clientName: string, toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const client = this.clients.get(clientName)
    if (!client) throw new Error(`MCP client not found: ${clientName}`)
    return client.callTool(toolName, args)
  }

  async readResource(resourceUri: string): Promise<unknown> {
    for (const [, entry] of this.resources) {
      if (entry.resource.uri === resourceUri) {
        return entry.client.readResource(resourceUri)
      }
    }
    throw new Error(`Resource not found: ${resourceUri}`)
  }
}

async function readAuthStore(): Promise<Record<string, { apiKey: string }>> {
  try {
    const raw = await readFile(resolve(process.cwd(), ".deepreef/mcp-auth.json"), "utf8")
    const parsed = JSON.parse(raw)
    const result = await McpAuthStoreSchema["~standard"].validate(parsed)
    if ("value" in result) {
      return result.value as Record<string, { apiKey: string }>
    }
    return {}
  } catch {
    return {}
  }
}

function withCredential(config: McpServerConfig, apiKey?: string): McpServerConfig {
  if (!apiKey) return config
  return {
    ...config,
    env: {
      MCP_API_KEY: apiKey,
      DEEPREEF_MCP_API_KEY: apiKey,
      ...config.env,
    },
  }
}
