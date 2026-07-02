import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigManager } from "../src/config/manager.js"
import { loadConfig } from "../src/config/loader.js"
import { DEFAULT_CONFIG } from "../src/config/defaults.js"

describe("ConfigManager", () => {
  let testDir: string

  beforeAll(() => {
    testDir = join(tmpdir(), `covalo-config-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  it("should create ConfigManager with default config", async () => {
    const manager = await ConfigManager.create({ cwd: testDir })
    const config = manager.get()
    
    expect(config.version).toBe(1)
    expect(config.workflow.maxRounds).toBe(6)
    expect(config.goal.autoContinue).toBe(true)
  })

  it("should load user config from file", async () => {
    // 创建临时用户目录
    const tempHome = join(testDir, "home")
    const userConfigDir = join(tempHome, ".covalo")
    mkdirSync(userConfigDir, { recursive: true })
    
    const configContent = `
version = 1

[workflow]
max_rounds = 10

[goal]
auto_continue = false
`
    writeFileSync(join(userConfigDir, "config.toml"), configContent, "utf-8")
    
    // 使用自定义userConfigPath测试
    const manager = await ConfigManager.create({ 
      cwd: testDir,
      userConfigPath: join(userConfigDir, "config.toml")
    })
    const config = manager.get()
    
    expect(config.workflow.maxRounds).toBe(10)
    expect(config.goal.autoContinue).toBe(false)
  })

  it("should merge project config over user config", async () => {
    const userConfigDir = join(testDir, ".covalo")
    mkdirSync(userConfigDir, { recursive: true })
    
    const userConfig = `
version = 1

[workflow]
max_rounds = 10
`
    writeFileSync(join(userConfigDir, "config.toml"), userConfig, "utf-8")
    
    const projectConfigDir = join(testDir, ".covalo")
    mkdirSync(projectConfigDir, { recursive: true })
    
    const projectConfig = `
version = 1

[workflow]
max_rounds = 20
`
    writeFileSync(join(projectConfigDir, "config.toml"), projectConfig, "utf-8")
    
    const manager = await ConfigManager.create({ cwd: testDir })
    const config = manager.get()
    
    // 项目配置应该覆盖用户配置
    expect(config.workflow.maxRounds).toBe(20)
  })

  it("should apply CLI overrides", async () => {
    const manager = await ConfigManager.create({ cwd: testDir })
    
    manager.update({
      workflow: {
        ...manager.get().workflow,
        maxRounds: 15,
      },
    }, "cli")
    
    const config = manager.get()
    expect(config.workflow.maxRounds).toBe(15)
  })

  it("should notify listeners on config change", async () => {
    const manager = await ConfigManager.create({ cwd: testDir })
    
    let notified = false
    manager.onChange(() => {
      notified = true
    })
    
    manager.update({
      workflow: {
        ...manager.get().workflow,
        maxRounds: 25,
      },
    }, "tui")
    
    expect(notified).toBe(true)
  })

  it("should get tool policy for role and mode", async () => {
    const manager = await ConfigManager.create({ cwd: testDir })
    
    const supervisorLoopPolicy = manager.getToolPolicy("supervisor", "loop")
    expect(supervisorLoopPolicy.deny).toContain("bash")
    
    const workerLoopPolicy = manager.getToolPolicy("worker", "loop")
    expect(workerLoopPolicy.deny).toContain("update_goal")
  })
})

describe("loadConfig", () => {
  let testDir: string

  beforeAll(() => {
    testDir = join(tmpdir(), `covalo-load-config-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  it("should load config with defaults", async () => {
    const result = await loadConfig({ cwd: testDir })
    
    expect(result.config.version).toBe(1)
    expect(result.sources.some(s => s.kind === "default")).toBe(true)
  })

  it("should throw error for invalid config", async () => {
    const configDir = join(testDir, ".covalo")
    mkdirSync(configDir, { recursive: true })
    
    const invalidConfig = `
version = "not a number"
`
    writeFileSync(join(configDir, "config.toml"), invalidConfig, "utf-8")
    
    await expect(loadConfig({ cwd: testDir })).rejects.toThrow("配置验证失败")
  })
})