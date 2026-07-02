import { describe, test, expect } from "bun:test"
import { resolveContentPack } from "../src/content-pack/resolver.js"
import { resolve } from "node:path"

const ECC_DIR = resolve(process.cwd(), "..", "ECC")

describe("Content Pack Resolver", () => {
  test("resolver returns id and name", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "developer",
      target: "covalo",
      targetMode: "compatible",
    })
    expect(result.id).toBeTruthy()
    expect(result.name).toBeTruthy()
    expect(result.rootDir).toBe(ECC_DIR)
  })

  test("resolver returns options", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "developer",
      target: "covalo",
      targetMode: "compatible",
      rules: { enabled: true, mode: "system" },
    })
    expect(result.options).toBeDefined()
    expect(result.options.rules?.mode).toBe("system")
  })

  test("profile selection works with default developer", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      target: "covalo",
      targetMode: "compatible",
    })
    // Even without explicit profile, should default to "developer"
    expect(result.modules.length).toBeGreaterThan(0)
  })

  test("targetMode strict filters non-targeted modules", () => {
    const compatible = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "full",
      target: "covalo",
      targetMode: "compatible",
    })

    const strict = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "full",
      target: "nonexistent-target",
      targetMode: "strict",
    })

    // strict mode should have fewer modules since many lack the fake target
    expect(strict.modules.length).toBeLessThanOrEqual(compatible.modules.length)
  })

  test("include component adds its modules", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "minimal",
      target: "covalo",
      targetMode: "compatible",
      include: ["baseline:rules"],
    })
    expect(result.modules).toContain("rules-core")
  })

  test("exclude component removes its modules", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "developer",
      target: "covalo",
      targetMode: "compatible",
      exclude: ["baseline:rules"],
    })
    expect(result.modules).not.toContain("rules-core")
  })

  test("unknown profile warns", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      profile: "unknown-profile-xyz",
      target: "covalo",
    })
    const warns = result.diagnostics.filter(d => d.type === "warn")
    expect(warns.length).toBeGreaterThan(0)
  })

  test("unknown module warns", () => {
    const result = resolveContentPack(ECC_DIR, {
      type: "content-pack",
      modules: ["non-existent-module-12345"],
      target: "covalo",
    })
    const warns = result.diagnostics.filter(d => d.message.includes("not found"))
    expect(warns.length).toBeGreaterThan(0)
  })
})
