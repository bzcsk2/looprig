import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { stringify } from "smol-toml"
import { loadConfig, getConfigPath, getConfigDir } from "./loader.js"
import { DEFAULT_CONFIG, CONFIG_TEMPLATES } from "./defaults.js"
import { migrateConfig, needsMigration, getLatestVersion } from "./migrations.js"
import { ConfigError } from "./errors.js"
import type {
  DeepReefConfig,
  ConfigSource,
  ConfigWarning,
  ConfigLoadOptions,
  WorkflowConfig,
  GoalConfig,
  AgentConfig,
  ToolsConfig,
  ToolRoleModePolicy,
} from "./schema.js"

export type ConfigChangeListener = (config: DeepReefConfig) => void

export class ConfigManager {
  private config: DeepReefConfig = DEFAULT_CONFIG
  private sources: ConfigSource[] = []
  private warnings: ConfigWarning[] = []
  private listeners: Set<ConfigChangeListener> = new Set()
  private userConfigPath: string
  private projectConfigPath: string
  private cwd: string

  constructor(options: { cwd: string; userConfigPath?: string }) {
    this.cwd = options.cwd
    this.userConfigPath = options.userConfigPath || getConfigPath("user")
    this.projectConfigPath = getConfigPath("project", options.cwd)
  }

  async load(cliOverrides?: Partial<DeepReefConfig>): Promise<void> {
    const options: ConfigLoadOptions = {
      cwd: this.cwd,
      userConfigPath: this.userConfigPath,
      projectConfigPath: this.projectConfigPath,
      cliOverrides,
    }

    const result = await loadConfig(options)
    
    // 处理配置迁移
    if (needsMigration(result.config.version)) {
      const migrated = migrateConfig(result.config) as DeepReefConfig
      result.config = migrated
      result.warnings.push({
        path: "version",
        message: `配置已从版本 ${result.config.version} 迁移到版本 ${getLatestVersion()}`,
      })
    }

    this.config = result.config
    this.sources = result.sources
    this.warnings = result.warnings
  }

  get(): DeepReefConfig {
    return this.config
  }

  getWorkflowConfig(): WorkflowConfig {
    return this.config.workflow
  }

  getGoalConfig(): GoalConfig {
    return this.config.goal
  }

  getAgentConfig(role: "supervisor" | "worker"): AgentConfig {
    return this.config.agents[role]
  }

  getToolsConfig(): ToolsConfig {
    return this.config.tools
  }

  getToolPolicy(role: "supervisor" | "worker", mode: "loop" | "subagent"): ToolRoleModePolicy {
    const roleConfig = this.config.tools[role]
    return roleConfig[mode]
  }

  update(partial: Partial<DeepReefConfig>, source: "tui" | "cli"): void {
    this.config = this.mergeConfigs(this.config, partial)
    this.notifyListeners()
  }

  private mergeConfigs(base: DeepReefConfig, override: Partial<DeepReefConfig>): DeepReefConfig {
    const result = { ...base }

    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue

      if (value === null) {
        ;(result as Record<string, unknown>)[key] = (DEFAULT_CONFIG as Record<string, unknown>)[key]
        continue
      }

      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        const baseValue = (result as Record<string, unknown>)[key]
        if (typeof baseValue === 'object' && !Array.isArray(baseValue) && baseValue !== null) {
          ;(result as Record<string, unknown>)[key] = this.mergeConfigs(
            baseValue as DeepReefConfig,
            value as Partial<DeepReefConfig>
          )
        } else {
          ;(result as Record<string, unknown>)[key] = value
        }
      } else {
        ;(result as Record<string, unknown>)[key] = value
      }
    }

    return result
  }

  async saveUserConfig(): Promise<void> {
    await this.saveConfig(this.userConfigPath, this.config)
  }

  async saveProjectConfig(): Promise<void> {
    await this.saveConfig(this.projectConfigPath, this.config)
  }

  private async saveConfig(filePath: string, config: DeepReefConfig): Promise<void> {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const content = stringify(config)
    writeFileSync(filePath, content, "utf-8")
  }

  async reload(): Promise<void> {
    await this.load()
    this.notifyListeners()
  }

  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.config)
      } catch (error) {
        console.error("配置变更监听器错误:", error)
      }
    }
  }

  getSources(): ConfigSource[] {
    return this.sources
  }

  getWarnings(): ConfigWarning[] {
    return this.warnings
  }

  getUserConfigPath(): string {
    return this.userConfigPath
  }

  getProjectConfigPath(): string {
    return this.projectConfigPath
  }

  static async create(options: { cwd: string; userConfigPath?: string }): Promise<ConfigManager> {
    const manager = new ConfigManager(options)
    await manager.load()
    return manager
  }

  static createSync(options: { cwd: string; userConfigPath?: string }): ConfigManager {
    return new ConfigManager(options)
  }
}

// 全局配置管理器实例
let globalConfigManager: ConfigManager | null = null

export function getGlobalConfigManager(): ConfigManager | null {
  return globalConfigManager
}

export function setGlobalConfigManager(manager: ConfigManager): void {
  globalConfigManager = manager
}

export async function initGlobalConfigManager(options: { cwd: string }): Promise<ConfigManager> {
  const manager = await ConfigManager.create(options)
  setGlobalConfigManager(manager)
  return manager
}