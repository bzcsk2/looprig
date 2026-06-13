import type { AgentTool } from "../interface.js"
import type { AgentRoleProfile, AgentRole } from "../agent-profile/types.js"
import type {
  Capability,
  CapabilityCatalogSnapshot,
  CapabilitySource,
  RoleCapabilityViewOptions,
} from "./types.js"

export class CapabilityCatalog {
  private tools: Map<string, Capability> = new Map()
  private plugins: Map<string, Capability> = new Map()
  private mcpServers: Map<string, Capability> = new Map()
  private mcpResources: Map<string, Capability> = new Map()
  private skills: Map<string, Capability> = new Map()

  registerBuiltinTool(tool: AgentTool): void {
    const tier = this.classifyToolTier(tool.name)
    const capability: Capability = {
      kind: "tool",
      name: tool.name,
      description: tool.description,
      source: { type: "builtin", name: tool.name },
      tier,
      tool,
    }
    this.tools.set(tool.name, capability)
  }

  registerBuiltinTools(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.registerBuiltinTool(tool)
    }
  }

  registerPluginTool(tool: AgentTool, pluginName: string): void {
    const tier = this.classifyToolTier(tool.name)
    const capability: Capability = {
      kind: "tool",
      name: tool.name,
      description: tool.description,
      source: { type: "plugin", name: tool.name, pluginName },
      tier,
      tool,
    }
    this.tools.set(tool.name, capability)
  }

  registerMcpTool(tool: AgentTool, serverName: string): void {
    const tier = this.classifyToolTier(tool.name)
    const capability: Capability = {
      kind: "tool",
      name: tool.name,
      description: tool.description,
      source: { type: "mcp", name: tool.name, mcpServerName: serverName },
      tier,
      tool,
    }
    this.tools.set(tool.name, capability)
  }

  registerMcpServer(name: string, description?: string): void {
    const capability: Capability = {
      kind: "mcp-server",
      name,
      description,
      source: { type: "mcp", name },
      tier: "read",
    }
    this.mcpServers.set(name, capability)
  }

  registerMcpResource(name: string, description?: string, serverName?: string): void {
    const capability: Capability = {
      kind: "mcp-resource",
      name,
      description,
      source: { type: "mcp", name, mcpServerName: serverName },
      tier: "read",
    }
    this.mcpResources.set(name, capability)
  }

  registerSkill(name: string, description: string, source?: string): void {
    const capability: Capability = {
      kind: "skill",
      name,
      description,
      source: { type: "skill", name },
      tier: "read",
    }
    this.skills.set(name, capability)
  }

  registerPlugin(name: string, description?: string): void {
    const capability: Capability = {
      kind: "plugin",
      name,
      description,
      source: { type: "plugin", name },
      tier: "read",
    }
    this.plugins.set(name, capability)
  }

  getTool(name: string): Capability | undefined {
    return this.tools.get(name)
  }

  snapshot(): CapabilityCatalogSnapshot {
    return {
      tools: Array.from(this.tools.values()),
      plugins: Array.from(this.plugins.values()),
      mcpServers: Array.from(this.mcpServers.values()),
      mcpResources: Array.from(this.mcpResources.values()),
      skills: Array.from(this.skills.values()),
    }
  }

  createRoleView(options: RoleCapabilityViewOptions): RoleCapabilityView {
    return new RoleCapabilityView(this, options)
  }

  private classifyToolTier(toolName: string): "read" | "write" | "exec" {
    const lowerName = toolName.toLowerCase()
    if (
      lowerName.includes("read") ||
      lowerName.includes("list") ||
      lowerName.includes("grep") ||
      lowerName.includes("glob") ||
      lowerName.includes("search") ||
      lowerName.includes("query")
    ) {
      return "read"
    }
    if (
      lowerName.includes("bash") ||
      lowerName.includes("shell") ||
      lowerName.includes("exec") ||
      lowerName.includes("run")
    ) {
      return "exec"
    }
    return "write"
  }
}

export class RoleCapabilityView {
  private catalog: CapabilityCatalog
  private options: RoleCapabilityViewOptions
  private _filteredTools: Capability[] | null = null

  constructor(catalog: CapabilityCatalog, options: RoleCapabilityViewOptions) {
    this.catalog = catalog
    this.options = options
  }

  get role(): AgentRole {
    return this.options.role
  }

  get profile(): AgentRoleProfile {
    return this.options.profile
  }

  get tools(): Capability[] {
    if (!this._filteredTools) {
      this._filteredTools = this.computeFilteredTools()
    }
    return this._filteredTools
  }

  getTool(name: string): Capability | undefined {
    return this.tools.find((t) => t.name === name)
  }

  getToolNames(): string[] {
    return this.tools.map((t) => t.name)
  }

  hasTool(name: string): boolean {
    return this.tools.some((t) => t.name === name)
  }

  private computeFilteredTools(): Capability[] {
    const snapshot = this.catalog.snapshot()
    let tools = snapshot.tools

    tools = this.applyAllowDenyFilter(tools)

    // 强制 Supervisor 只读：移除所有 write 和 exec 级别的工具
    if (this.options.role === "supervisor") {
      tools = tools.filter((cap) => cap.tier === "read")
    }

    return tools
  }

  private applyAllowDenyFilter(tools: Capability[]): Capability[] {
    const { allow, deny } = this.options.profile.tools

    if (allow && allow.length > 0) {
      const allowSet = new Set(allow.map((a) => a.toLowerCase()))
      tools = tools.filter((cap) => allowSet.has(cap.name.toLowerCase()))
    }

    if (deny && deny.length > 0) {
      const denySet = new Set(deny.map((d) => d.toLowerCase()))
      tools = tools.filter((cap) => !denySet.has(cap.name.toLowerCase()))
    }

    return tools
  }
}
