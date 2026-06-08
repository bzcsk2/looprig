import { readFileSync } from "node:fs"
import { readPluginConfig, type PluginConfigError } from "./config.js"
import { loadPlugins, type PluginLoaded, type PluginLoadError } from "./loader.js"
import { extractToolsFromPlugins, pluginToolsToToolSpecs, type PluginTool, type PluginToolError } from "./tool-adapter.js"
import { PluginHookRegistry } from "./hook-adapter.js"
import type { HookManager } from "@deepicode/security"
import type { AgentDefinition, ToolSpec } from "@deepicode/core"
import { resolve } from "node:path"
import { resolveContentPack } from "./content-pack/resolver.js"
import { isDirectory } from "./content-pack/discovery.js"
import { parseEccAgentMarkdown } from "./content-pack/agent-parser.js"
import { compileRules } from "./content-pack/rules-compiler.js"
import { parseEccHooks } from "./content-pack/hook-bridge.js"
import type { BridgedHook } from "./content-pack/hook-bridge.js"
import { convertCommandsToSkills } from "./content-pack/command-to-skill.js"
import type { CommandSkillEntry } from "./content-pack/command-to-skill.js"
import type { ResolvedContentPack, ContentPackDiagnostic, ContentPackPluginOptions } from "./content-pack/types.js"

export interface PluginRuntimeOptions {
  workspaceRoot?: string
  configPath?: string
  hookManager?: HookManager
  hookTimeoutMs?: number
}

export interface PluginRuntimeStatus {
  initialized: boolean
  loadedPlugins: string[]
  contentPacks: string[]
  tools: string[]
  hooks: string[]
  assets: {
    skills: number
    agents: number
    rules: number
    commands: number
    mcp: number
    hooks: number
  }
  errors: PluginRuntimeError[]
  diagnostics: string[]
}

export type PluginRuntimeError = PluginConfigError | PluginLoadError | PluginToolError

export class PluginRuntime {
  private initialized = false
  private loadedPlugins: PluginLoaded[] = []
  private pluginTools: PluginTool[] = []
  private contentPacks: ResolvedContentPack[] = []
  private hookRegistry = new PluginHookRegistry()
  private errors: PluginRuntimeError[] = []
  private diagnostics: string[] = []
  private options: PluginRuntimeOptions

  constructor(options: PluginRuntimeOptions = {}) {
    this.options = options
  }

  async init(): Promise<void> {
    if (this.initialized) return

    const workspaceRoot = this.options.workspaceRoot ?? process.cwd()
    const configPath = this.options.configPath ?? resolve(workspaceRoot, ".deepicode", "plugins.json")

    const configResult = readPluginConfig(configPath)
    if (configResult.errors.length > 0) {
      this.errors.push(...configResult.errors)
    }

    // Split items into runtime plugins and content-pack entries
    const runtimeItems: typeof configResult.items = []
    const contentPackItems: Array<{ spec: string; options: ContentPackPluginOptions }> = []

    for (const item of configResult.items) {
      const opts = item.options as ContentPackPluginOptions
      const type = opts.type ?? "auto"

      if (type === "content-pack" || (type === "auto" && isDirectory(item.spec))) {
        contentPackItems.push({ spec: item.spec, options: opts })
      } else {
        runtimeItems.push(item)
      }
    }

    // Load runtime plugins
    if (runtimeItems.length > 0) {
      const loadResult = await loadPlugins(runtimeItems)
      this.loadedPlugins = loadResult.loaded
      this.errors.push(...loadResult.errors)

      const toolsResult = await extractToolsFromPlugins(this.loadedPlugins)
      this.pluginTools = toolsResult.tools
      this.errors.push(...toolsResult.errors)

      if (this.options.hookManager) {
        for (const plugin of this.loadedPlugins) {
          this.hookRegistry.register(plugin, this.options.hookManager, this.options.hookTimeoutMs)
        }
      }
    }

    // Load content packs
    for (const cp of contentPackItems) {
      try {
        const resolved = resolveContentPack(cp.spec, cp.options)
        this.contentPacks.push(resolved)
        for (const d of resolved.diagnostics) {
          this.diagnostics.push(`[${d.type}] ${d.pluginId}: ${d.message}${d.detail ? " (" + d.detail + ")" : ""}`)
        }
      } catch (e) {
        this.diagnostics.push(`[error] Failed to resolve content pack ${cp.spec}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    this.initialized = true
  }

  getToolSpecs(): ToolSpec[] {
    return pluginToolsToToolSpecs(this.pluginTools)
  }

  getTools(): PluginTool[] {
    return this.pluginTools
  }

  getTool(name: string): PluginTool | undefined {
    return this.pluginTools.find((t) => t.name === name)
  }

  getContentPacks(): ResolvedContentPack[] {
    return this.contentPacks
  }

  getSkillDirs(): string[] {
    const dirs: string[] = []
    for (const cp of this.contentPacks) {
      for (const skill of cp.assets.skills) {
        if (skill.path.endsWith("/skills") || !skill.path.includes(".")) {
          dirs.push(skill.path)
        }
      }
    }
    return dirs
  }

  getAgentAssets() {
    return this.contentPacks.flatMap((cp) => cp.assets.agents)
  }

  getRuleAssets() {
    return this.contentPacks.flatMap((cp) => cp.assets.rules)
  }

  getMcpAssets() {
    return this.contentPacks.flatMap((cp) => cp.assets.mcp)
  }

  loadAgents(): AgentDefinition[] {
    const agents: AgentDefinition[] = []
    for (const cp of this.contentPacks) {
      for (const asset of cp.assets.agents) {
        const parsed = parseEccAgentMarkdown(asset.path)
        if (parsed.agent) {
          agents.push(parsed.agent)
        }
        for (const w of parsed.warnings) {
          this.diagnostics.push(`[warn] ${w}`)
        }
      }
    }
    return agents
  }

  compileRules(): { systemPrompt: string; count: number; warnings: string[] } {
    const rules = this.getRuleAssets()
    if (rules.length === 0) return { systemPrompt: "", count: 0, warnings: [] }
    const result = compileRules(rules)
    for (const w of result.warnings) {
      this.diagnostics.push(`[warn] ${w}`)
    }
    return { systemPrompt: result.systemPrompt, count: result.count, warnings: result.warnings }
  }

  loadCommandSkills(): CommandSkillEntry[] {
    const skills: CommandSkillEntry[] = []
    for (const cp of this.contentPacks) {
      const result = convertCommandsToSkills(cp.assets.commands)
      skills.push(...result.skills)
      for (const w of result.warnings) {
        this.diagnostics.push(`[warn] ${w}`)
      }
    }
    return skills
  }

  loadHookConfigs(): { hooks: BridgedHook[]; warnings: string[] } {
    const all: BridgedHook[] = []
    const warnings: string[] = []
    for (const cp of this.contentPacks) {
      for (const asset of cp.assets.hooks) {
        const result = parseEccHooks(asset.path)
        all.push(...result.hooks)
        warnings.push(...result.warnings)
      }
    }
    return { hooks: all, warnings }
  }

  loadMcpConfigs(): Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }> {
    const configs: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }> = []
    for (const cp of this.contentPacks) {
      for (const asset of cp.assets.mcp) {
        try {
          const raw = readFileSync(asset.path, "utf8")
          const parsed = JSON.parse(raw)
          const servers = parsed.mcpServers ?? {}
          for (const [name, cfg] of Object.entries(servers)) {
            const server = cfg as Record<string, unknown>
            const command = server.command as string | undefined
            if (!command) {
              this.diagnostics.push(`[warn] MCP server "${name}" in ${asset.path} missing command, skipping`)
              continue
            }
            if (!command.startsWith("node ") && !command.startsWith("bun ") && !command.includes("/") && !command.startsWith(".")) {
              this.diagnostics.push(`[warn] MCP server "${name}" command "${command}" is not stdio-safe, skipping`)
              continue
            }
            // Skip known unsafe patterns
            const args = (server.args as string[]) ?? []
            const env = (server.env as Record<string, string>) ?? {}
            const fullCmd = [command, ...args].join(" ")
            if (fullCmd.includes("http://") || fullCmd.includes("https://") || fullCmd.startsWith("npx ") || fullCmd.startsWith("uvx ")) {
              this.diagnostics.push(`[info] MCP server "${name}" uses HTTP/npx/uvx transport (${fullCmd.slice(0, 60)}), skipping`)
              continue
            }
            // Check for placeholder env vars (e.g. YOUR_API_KEY_HERE)
            const hasPlaceholder = Object.values(env).some(v =>
              typeof v === "string" && (v.includes("YOUR_") || v.includes("your-") || v.includes("<") && v.includes(">"))
            )
            if (hasPlaceholder) {
              this.diagnostics.push(`[info] MCP server "${name}" has placeholder env vars, skipping`)
              continue
            }
            configs.push({ name: `${cp.name}:${name}`, command, args, env })
          }
        } catch (e) {
          this.diagnostics.push(`[warn] Failed to load MCP config ${asset.path}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
    return configs
  }

  getStatus(): PluginRuntimeStatus {
    const assetCounts = { skills: 0, agents: 0, rules: 0, commands: 0, mcp: 0, hooks: 0 }
    for (const cp of this.contentPacks) {
      assetCounts.skills += cp.assets.skills.length
      assetCounts.agents += cp.assets.agents.length
      assetCounts.rules += cp.assets.rules.length
      assetCounts.commands += cp.assets.commands.length
      assetCounts.mcp += cp.assets.mcp.length
      assetCounts.hooks += cp.assets.hooks.length
    }

    return {
      initialized: this.initialized,
      loadedPlugins: this.loadedPlugins.map((p) => p.mod.id),
      contentPacks: this.contentPacks.map((cp) => cp.name),
      tools: this.pluginTools.map((t) => t.name),
      hooks: this.hookRegistry.getRegisteredIds(),
      assets: assetCounts,
      errors: this.errors,
      diagnostics: this.diagnostics,
    }
  }

  dispose(): void {
    if (this.options.hookManager) {
      this.hookRegistry.dispose(this.options.hookManager)
    }
    this.loadedPlugins = []
    this.pluginTools = []
    this.contentPacks = []
    this.errors = []
    this.diagnostics = []
    this.initialized = false
  }
}

export function createPluginRuntime(options?: PluginRuntimeOptions): PluginRuntime {
  return new PluginRuntime(options)
}
