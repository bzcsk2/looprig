import { readFile } from "node:fs/promises"
import { resolve, dirname } from "node:path"

export interface LspLanguageConfig {
  command: string
  args?: string[]
  rootPatterns?: string[]
  fileExtensions?: string[]
  initializationOptions?: Record<string, unknown>
  settings?: Record<string, unknown>
}

export interface LspConfig {
  version?: number
  idleTimeoutMs?: number
  requestTimeoutMs?: number
  languages?: Record<string, LspLanguageConfig>
}

export interface LspConfigResult {
  config: LspConfig
  configPath: string | null
}

const DEFAULT_REQUEST_TIMEOUT_MS = 8000
const DEFAULT_IDLE_TIMEOUT_MS = 300000

export async function readLspConfig(cwd: string, configPath?: string): Promise<LspConfigResult> {
  const envConfigPath = process.env.DEEPICODE_LSP_CONFIG
  const paths = [
    configPath,
    envConfigPath,
    resolve(cwd, ".deepicode", "lsp.json"),
  ].filter((p): p is string => typeof p === "string")

  for (const path of paths) {
    try {
      const content = await readFile(path, "utf8")
      const parsed = JSON.parse(content) as LspConfig
      return { config: normalizeConfig(parsed), configPath: path }
    } catch {
      continue
    }
  }

  return { config: {}, configPath: null }
}

export function normalizeConfig(raw: LspConfig): LspConfig {
  return {
    version: raw.version ?? 1,
    idleTimeoutMs: clampNumber(raw.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 60000, 600000),
    requestTimeoutMs: clampNumber(raw.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 1000, 30000),
    languages: raw.languages ?? {},
  }
}

export function getLanguageConfig(config: LspConfig, language: string): LspLanguageConfig | undefined {
  return config.languages?.[language]
}

export function getRequestTimeout(config: LspConfig): number {
  return config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
}

export function getIdleTimeout(config: LspConfig): number {
  return config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
}

function clampNumber(value: unknown, defaultValue: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultValue
  return Math.max(min, Math.min(max, Math.floor(value)))
}

export const INSTALL_HINTS: Record<string, string> = {
  typescript: "npm i -g typescript-language-server typescript",
  typescriptreact: "npm i -g typescript-language-server typescript",
  javascript: "npm i -g typescript-language-server typescript",
  javascriptreact: "npm i -g typescript-language-server typescript",
  python: "pip install pyright",
  go: "go install golang.org/x/tools/gopls@latest",
  rust: "rustup component add rust-analyzer",
  json: "npm i -g vscode-langservers-extracted",
  css: "npm i -g vscode-langservers-extracted",
  html: "npm i -g vscode-langservers-extracted",
}

export function getInstallHint(language: string): string | undefined {
  return INSTALL_HINTS[language]
}
