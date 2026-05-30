import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { PROVIDERS, getApiKeyEnvVar, buildPiModel, loadConfig, saveLastConfig } from "../src/config.js"
import type { DeepicodeConfig } from "../src/config.js"
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("PROVIDERS", () => {
  it("should have zen provider with defaultKey", () => {
    const zen = PROVIDERS.zen
    expect(zen).toBeDefined()
    expect(zen.defaultKey).toBe("public")
    expect(zen.requiresKey).toBe(false)
    expect(zen.label).toBe("Zen (Free)")
  })

  it("should have deepseek provider without defaultKey", () => {
    const ds = PROVIDERS.deepseek
    expect(ds).toBeDefined()
    expect(ds.requiresKey).toBe(true)
    expect(ds.defaultKey).toBeUndefined()
  })

  it("should have mimo provider", () => {
    const mimo = PROVIDERS.mimo
    expect(mimo).toBeDefined()
    expect(mimo.models).toHaveLength(2)
  })
})

describe("getApiKeyEnvVar", () => {
  it("should return ZEN_API_KEY for zen", () => {
    expect(getApiKeyEnvVar("zen")).toBe("ZEN_API_KEY")
  })

  it("should return DEEPSEEK_API_KEY for deepseek", () => {
    expect(getApiKeyEnvVar("deepseek")).toBe("DEEPSEEK_API_KEY")
  })
})

describe("buildPiModel", () => {
  it("should build correct model object", () => {
    const config: DeepicodeConfig = {
      apiKey: "test",
      baseUrl: "https://api.test.com",
      model: "test-model",
      maxTokens: 1024,
      temperature: 0.5,
      provider: "custom",
    }
    const model = buildPiModel(config)
    expect(model.id).toBe("test-model")
    expect(model.baseUrl).toBe("https://api.test.com")
    expect(model.maxTokens).toBe(1024)
    expect(model.api).toBe("openai-completions")
  })
})

describe("loadConfig - 环境变量", () => {
  const OLD_ENV = { ...process.env }
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "deepicode-config-"))
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
  })

  afterEach(() => {
    process.env = { ...OLD_ENV }
    vi.restoreAllMocks()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should use DEEPICODE_PROVIDER env var to override provider", () => {
    process.env.DEEPICODE_PROVIDER = "mimo"
    const cfg = loadConfig()
    expect(cfg.provider).toBe("mimo")
    expect(cfg.baseUrl).toContain("mimo")
  })

  it("should use ZEN_API_KEY env var when provider is zen", () => {
    process.env.DEEPICODE_PROVIDER = "zen"
    process.env.ZEN_API_KEY = "zen-key-from-env"
    const cfg = loadConfig()
    expect(cfg.provider).toBe("zen")
    expect(cfg.apiKey).toBe("zen-key-from-env")
  })

  it("should use DEEPSEEK_API_KEY env var for deepseek", () => {
    process.env.DEEPICODE_PROVIDER = "deepseek"
    process.env.DEEPSEEK_API_KEY = "ds-key-from-env"
    const cfg = loadConfig()
    expect(cfg.provider).toBe("deepseek")
    expect(cfg.apiKey).toBe("ds-key-from-env")
  })

  it("should fall back to defaultKey for zen when no env var set", () => {
    process.env.DEEPICODE_PROVIDER = "zen"
    delete process.env.ZEN_API_KEY
    const cfg = loadConfig()
    expect(cfg.apiKey).toBe("public")
  })

  it("should default to deepseek provider when no env and no last-config", () => {
    delete process.env.DEEPICODE_PROVIDER
    const cfg = loadConfig()
    expect(cfg.provider).toBe("deepseek")
  })
})

describe("saveLastConfig / loadConfig 持久化", () => {
  const OLD_ENV = { ...process.env }
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "deepicode-config-"))
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
    delete process.env.DEEPICODE_PROVIDER
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.ZEN_API_KEY
  })

  afterEach(() => {
    process.env = { ...OLD_ENV }
    vi.restoreAllMocks()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should persist provider/model/baseUrl and restore them via loadConfig", () => {
    saveLastConfig({ provider: "mimo", model: "mimo-v2.5", baseUrl: "https://api.mimo.ai/v1" })

    const configPath = join(tmpDir, ".deepicode", "last-config.json")
    expect(existsSync(configPath)).toBe(true)
    const saved = JSON.parse(readFileSync(configPath, "utf8"))
    expect(saved.provider).toBe("mimo")
    expect(saved.model).toBe("mimo-v2.5")

    const cfg = loadConfig()
    expect(cfg.provider).toBe("mimo")
    expect(cfg.model).toBe("mimo-v2.5")
    expect(cfg.baseUrl).toBe("https://api.mimo.ai/v1")
  })

  it("should return defaults when last-config file does not exist", () => {
    const cfg = loadConfig()
    expect(cfg.provider).toBe("deepseek")
    expect(cfg.baseUrl).toBe("https://api.deepseek.com")
  })

  it("should not crash when last-config file is corrupted JSON", () => {
    const dir = join(tmpDir, ".deepicode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "last-config.json"), "{invalid json!!!}", "utf8")

    const cfg = loadConfig()
    expect(cfg.provider).toBe("deepseek")
  })

  it("should not crash when last-config file is empty", () => {
    const dir = join(tmpDir, ".deepicode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "last-config.json"), "", "utf8")

    const cfg = loadConfig()
    expect(cfg.provider).toBe("deepseek")
  })
})
