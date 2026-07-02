import { describe, test, expect } from "bun:test"
import { resolveContentPack } from "../src/content-pack/resolver.js"
import { resolve } from "node:path"

const ECC_DIR = resolve(process.cwd(), "..", "ECC")

describe("Real ECC Content Pack Resolution", () => {
  test("developer profile has modules > 0", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "developer",
      target: "covalo",
      targetMode: "compatible",
      hooks: { enabled: false },
      mcp: { enabled: false },
    })
    expect(result.modules.length).toBeGreaterThan(0)
    expect(result.diagnostics.filter(d => d.type === "error").length).toBe(0)
  })

  test("minimal profile has fewer modules than developer", () => {
    const minimal = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "minimal",
      target: "covalo",
      targetMode: "compatible",
      hooks: { enabled: false },
      mcp: { enabled: false },
    })

    const developer = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "developer",
      target: "covalo",
      targetMode: "compatible",
      hooks: { enabled: false },
      mcp: { enabled: false },
    })

    expect(minimal.modules.length).toBeGreaterThan(0)
    expect(developer.modules.length).toBeGreaterThan(minimal.modules.length)
  })

  test("full profile has >= modules than developer", () => {
    const developer = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "developer",
      target: "covalo",
      targetMode: "compatible",
      hooks: { enabled: false },
      mcp: { enabled: false },
    })

    const full = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "full",
      target: "covalo",
      targetMode: "compatible",
      hooks: { enabled: false },
      mcp: { enabled: false },
    })

    expect(full.modules.length).toBeGreaterThanOrEqual(developer.modules.length)
  })

  test("minimal profile loads only assets from its modules", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "minimal",
      target: "covalo",
      targetMode: "compatible",
      hooks: { enabled: false },
      mcp: { enabled: false },
    })

    // Minimal should have 5 modules (rules-core, agents-core, commands-core, platform-configs, workflow-quality)
    expect(result.modules.length).toBe(5)
    // Skills should come only from selected module paths, not full directory discovery
    expect(result.assets.skills.length).toBeGreaterThan(0)
    // Commands disabled by default
    expect(result.assets.commands.length).toBe(0)
  })

  test("three profiles produce different asset sets", () => {
    const minimal = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "minimal",
      target: "covalo",
      targetMode: "compatible",
      hooks: { enabled: false },
      mcp: { enabled: false },
    })

    const developer = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "developer",
      target: "covalo",
      targetMode: "compatible",
      hooks: { enabled: false },
      mcp: { enabled: false },
    })

    const full = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "full",
      target: "covalo",
      targetMode: "compatible",
      hooks: { enabled: false },
      mcp: { enabled: false },
    })

    // All three should be different
    const minModules = [...minimal.modules].sort().join(",")
    const devModules = [...developer.modules].sort().join(",")
    const fullModules = [...full.modules].sort().join(",")

    expect(minModules).not.toBe(devModules)
    expect(devModules).not.toBe(fullModules)
  })

  test("unknown profile returns diagnostics", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "nonexistent-profile",
      target: "covalo",
      targetMode: "compatible",
    })

    const hasWarn = result.diagnostics.some(d =>
      d.type === "warn" && d.message.includes("nonexistent-profile")
    )
    expect(hasWarn).toBe(true)
  })

  test("hooks disabled by default", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "developer",
      target: "covalo",
      targetMode: "compatible",
    })

    // hooks.enabled defaults to false, so no hooks should be enabled
    expect(result.options.hooks?.enabled).toBe(false)
  })

  test("MCP disabled by default", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "developer",
      target: "covalo",
      targetMode: "compatible",
    })

    expect(result.options.mcp?.enabled).toBe(false)
  })
})
