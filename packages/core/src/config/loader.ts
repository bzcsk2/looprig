import { readFileSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"
import { homedir } from "node:os"
import { parse } from "smol-toml"
import { CovaloConfigSchema, parseConfig } from "./schema.js"
import { DEFAULT_CONFIG } from "./defaults.js"
import type { CovaloConfig, ConfigSource, ConfigWarning, ConfigLoadOptions } from "./schema.js"

const DEFAULT_USER_CONFIG_PATH = join(homedir(), ".covalo", "config.toml")
const DEFAULT_PROJECT_CONFIG_DIR = ".covalo"
const DEFAULT_PROJECT_CONFIG_FILE = "config.toml"

export interface ConfigLoadResult {
  config: CovaloConfig
  sources: ConfigSource[]
  warnings: ConfigWarning[]
}

export async function loadConfig(options: ConfigLoadOptions): Promise<ConfigLoadResult> {
  const {
    cwd,
    userConfigPath = DEFAULT_USER_CONFIG_PATH,
    projectConfigPath = join(cwd, DEFAULT_PROJECT_CONFIG_DIR, DEFAULT_PROJECT_CONFIG_FILE),
    cliOverrides,
  } = options

  const sources: ConfigSource[] = []
  const warnings: ConfigWarning[] = []

  // 1. 从默认值开始
  let config = { ...DEFAULT_CONFIG }
  sources.push({ kind: "default", loaded: true })

  // 2. 加载用户级配置
  if (existsSync(userConfigPath)) {
    try {
      const userConfig = loadTomlFile(userConfigPath)
      config = mergeConfigs(config, userConfig)
      sources.push({ kind: "user", path: userConfigPath, loaded: true })
    } catch (error) {
      warnings.push({
        path: userConfigPath,
        message: `加载用户配置失败: ${error instanceof Error ? error.message : String(error)}`,
      })
      sources.push({ kind: "user", path: userConfigPath, loaded: false })
    }
  } else {
    sources.push({ kind: "user", path: userConfigPath, loaded: false })
  }

  // 3. 加载项目级配置
  if (existsSync(projectConfigPath)) {
    try {
      const projectConfig = loadTomlFile(projectConfigPath)
      config = mergeConfigs(config, projectConfig)
      sources.push({ kind: "project", path: projectConfigPath, loaded: true })
    } catch (error) {
      warnings.push({
        path: projectConfigPath,
        message: `加载项目配置失败: ${error instanceof Error ? error.message : String(error)}`,
      })
      sources.push({ kind: "project", path: projectConfigPath, loaded: false })
    }
  } else {
    sources.push({ kind: "project", path: projectConfigPath, loaded: false })
  }

  // 4. 应用 CLI 覆盖
  if (cliOverrides) {
    config = mergeConfigs(config, cliOverrides)
    sources.push({ kind: "cli", loaded: true })
  }

  // 5. 应用环境变量替换
  config = applyEnvironmentVariables(config)

  // 6. 使用 zod schema 进行验证和默认值填充
  try {
    const validatedConfig = parseConfig(config)
    return { config: validatedConfig, sources, warnings }
  } catch (error) {
    throw new Error(`配置验证失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function loadTomlFile(filePath: string): Partial<CovaloConfig> {
  const content = readFileSync(filePath, "utf-8")
  try {
    const parsed = parse(content)
    return parsed as Partial<CovaloConfig>
  } catch (error) {
    throw new Error(`TOML 解析失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function mergeConfigs(base: CovaloConfig, override: Partial<CovaloConfig>): CovaloConfig {
  const result = { ...base }

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue

    if (value === null) {
      // null 表示显式清空，使用默认值
      ;(result as Record<string, unknown>)[key] = (DEFAULT_CONFIG as Record<string, unknown>)[key]
      continue
    }

    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      // 对象递归合并
      const baseValue = (result as Record<string, unknown>)[key]
      if (typeof baseValue === 'object' && !Array.isArray(baseValue) && baseValue !== null) {
        ;(result as Record<string, unknown>)[key] = mergeConfigs(
          baseValue as CovaloConfig,
          value as Partial<CovaloConfig>
        )
      } else {
        ;(result as Record<string, unknown>)[key] = value
      }
    } else {
      // 数组和其他类型直接替换
      ;(result as Record<string, unknown>)[key] = value
    }
  }

  return result
}

function applyEnvironmentVariables(config: CovaloConfig): CovaloConfig {
  const result = { ...config }

  // 处理 provider 的 apiKeyEnv
  for (const [providerName, providerConfig] of Object.entries(result.providers)) {
    if (providerConfig.apiKeyEnv && !providerConfig.apiKey) {
      const envValue = process.env[providerConfig.apiKeyEnv]
      if (envValue) {
        result.providers[providerName] = {
          ...providerConfig,
          apiKey: envValue,
        }
      }
    }
  }

  return result
}

export function getConfigPath(type: "user" | "project", cwd?: string): string {
  if (type === "user") {
    return DEFAULT_USER_CONFIG_PATH
  }
  return join(cwd || process.cwd(), DEFAULT_PROJECT_CONFIG_DIR, DEFAULT_PROJECT_CONFIG_FILE)
}

export function getConfigDir(type: "user" | "project", cwd?: string): string {
  if (type === "user") {
    return join(homedir(), ".covalo")
  }
  return join(cwd || process.cwd(), DEFAULT_PROJECT_CONFIG_DIR)
}