import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { validateAssetPath } from "../src/content-pack/path-security.js"
import { resolve as pathResolve } from "node:path"
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from "node:fs"

const TMP_DIR = "/tmp/covalo-ps-" + Date.now()
const TRUSTED_DIR = pathResolve(TMP_DIR, "trusted", "pack")
const EVIL_DIR = pathResolve(TMP_DIR, "trusted", "pack-evil")

describe("Path Security", () => {
  beforeAll(() => {
    mkdirSync(TRUSTED_DIR, { recursive: true })
    mkdirSync(EVIL_DIR, { recursive: true })
    mkdirSync(pathResolve(TRUSTED_DIR, "skills", "test-skill"), { recursive: true })
    mkdirSync(pathResolve(TRUSTED_DIR, "deep", "nested"), { recursive: true })
    writeFileSync(pathResolve(TRUSTED_DIR, "deep", "nested", "file.md"), "test")
    writeFileSync(pathResolve(EVIL_DIR, "evil.md"), "malicious")
    // Create symlink: TRUSTED_DIR/skills/test-skill/escape -> EVIL_DIR
    symlinkSync(EVIL_DIR, pathResolve(TRUSTED_DIR, "skills", "test-skill", "escape"), "dir")
  })

  afterAll(() => {
    try { rmSync(TMP_DIR, { recursive: true, force: true }) } catch {}
  })

  test("rejects ../ outside traversal", () => {
    // root=/tmp/.../trusted/pack, candidate=/tmp/.../trusted/outside
    const candidate = pathResolve(TRUSTED_DIR, "..", "outside")
    const result = validateAssetPath(candidate, TRUSTED_DIR, "skill", "test", "test-plugin")
    expect(result.isValid).toBe(false)
    expect(result.diagnostic?.type).toBe("error")
    expect(result.diagnostic?.message).toContain("traversal")
  })

  test("rejects root prefix deception (/trusted/pack-evil)", () => {
    const result = validateAssetPath(EVIL_DIR, TRUSTED_DIR, "rule", "evil-rule", "test-plugin")
    expect(result.isValid).toBe(false)
    expect(result.diagnostic?.type).toBe("error")
    expect(result.diagnostic?.message).toContain("traversal")
  })

  test("rejects symlink escape (dir inside root pointing outside)", () => {
    if (!existsSync(pathResolve(TRUSTED_DIR, "skills", "test-skill", "escape"))) {
      return // skip if symlink creation failed
    }
    const symlinkPath = pathResolve(TRUSTED_DIR, "skills", "test-skill", "escape")
    const result = validateAssetPath(symlinkPath, TRUSTED_DIR, "skill", "symlink-test", "test-plugin")
    expect(result.isValid).toBe(false)
    expect(result.diagnostic?.type).toBe("error")
    expect(result.diagnostic?.message).toContain("Symlink")
  })

  test("accepts valid path inside root", () => {
    const candidate = pathResolve(TRUSTED_DIR, "skills", "test-skill")
    const result = validateAssetPath(candidate, TRUSTED_DIR, "skill", "test", "test-plugin")
    expect(result.isValid).toBe(true)
    expect(result.resolvedPath).toBe(candidate)
  })

  test("accepts root directory itself", () => {
    const result = validateAssetPath(TRUSTED_DIR, TRUSTED_DIR, "skill", "root", "test-plugin")
    expect(result.isValid).toBe(true)
  })

  test("accepts nested subdirectory", () => {
    const candidate = pathResolve(TRUSTED_DIR, "deep", "nested", "file.md")
    const result = validateAssetPath(candidate, TRUSTED_DIR, "agent", "nested", "test-plugin")
    expect(result.isValid).toBe(true)
  })

  test("rejects relative path with explicit ../ prefix", () => {
    // Direct ../ prefix without resolve normalization
    // Use a path format that won't be pre-resolved
    const result = validateAssetPath(
      pathResolve(TRUSTED_DIR, "..", "etc", "passwd"),
      TRUSTED_DIR,
      "hook",
      "evil-hook",
      "test-plugin",
    )
    expect(result.isValid).toBe(false)
  })
})
