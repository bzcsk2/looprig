import { describe, it, expect } from "bun:test"
import { resolveProfile, buildToolchainFingerprint, listProfiles } from "../src/eval/profile/resolver"
import { isToolInstalled, getToolchainInfo, TOOL_MANIFEST } from "../src/eval/profile/installer"

describe("profile resolver", () => {
  it("resolves sandbox.benchmark as official", () => {
    const p = resolveProfile("sandbox.benchmark")
    expect(p.officialScore).toBe(true)
    expect(p.id).toBe("sandbox.benchmark")
    expect(p.toolchainProfile).toBe("node")
  })

  it("resolves sandbox.local as diagnostic", () => {
    const p = resolveProfile("sandbox.local")
    expect(p.officialScore).toBe(false)
    expect(p.id).toBe("sandbox.local")
    expect(p.toolchainProfile).toBe("node")
  })

  it("resolves diagnostic environment", () => {
    const p = resolveProfile("diagnostic")
    expect(p.officialScore).toBe(false)
    expect(p.id).toBe("sandbox.local")
  })

  it("lists both built-in profiles", () => {
    const profiles = listProfiles()
    expect(profiles).toHaveLength(2)
    const ids = profiles.map((p) => p.id).sort()
    expect(ids).toEqual(["sandbox.benchmark", "sandbox.local"])
  })

  it("accepts custom toolchainProfile", () => {
    const p = resolveProfile("sandbox.benchmark", "python")
    expect(p.toolchainProfile).toBe("python")
  })
})

describe("toolchain fingerprint", () => {
  it("builds fingerprint for known tools", () => {
    const fp = buildToolchainFingerprint("sandbox.benchmark", ["node", "bun"])
    expect(fp.profile).toBe("sandbox.benchmark")
    expect(fp.tools.length).toBe(2)
    expect(fp.tools[0].name).toBe("node")
    expect(fp.tools[1].name).toBe("bun")
    expect(["host", "managed", "fallback"]).toContain(fp.tools[0].source)
  })

  it("builds fingerprint for sandbox.local", () => {
    const fp = buildToolchainFingerprint("sandbox.local", ["git"])
    expect(fp.profile).toBe("sandbox.local")
    expect(fp.tools[0].name).toBe("git")
  })

  it("marks missing tools as fallback", () => {
    const fp = buildToolchainFingerprint("sandbox.benchmark", ["nonexistent-tool-xyz"])
    expect(fp.tools[0].source).toBe("fallback")
    expect(fp.tools[0].version).toBe("unknown")
  })
})

describe("toolchain installer info", () => {
  it("reports tool manifest entries", () => {
    const manifest = TOOL_MANIFEST
    expect(manifest.length).toBeGreaterThan(0)
    expect(manifest.map((t) => t.name)).toEqual(
      expect.arrayContaining(["node", "bun", "rg", "jq"]),
    )
  })

  it("pins sha256 for all managed benchmark tools", () => {
    for (const entry of TOOL_MANIFEST) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it("returns toolchain info without throwing", () => {
    const info = getToolchainInfo()
    expect(typeof info).toBe("object")
    for (const name of ["node", "bun", "rg", "jq"]) {
      expect(info[name]).toBeDefined()
      expect(typeof info[name]?.installed).toBe("boolean")
    }
  })

  it("isToolInstalled returns boolean", () => {
    const result = isToolInstalled("nonexistent-tool-abc")
    expect(result).toBe(false)
  })
})

describe("native fixtures in sandbox.local", () => {
  it("sandbox.local smoke suite exists in registry", async () => {
    const { getSuite } = await import("../src/eval/registry")
    const suite = getSuite("coding-basics", "smoke", "sandbox.local")
    expect(suite).toBeDefined()
    expect(suite!.environmentId).toBe("sandbox.local")
    expect(suite!.cases.length).toBeGreaterThan(0)
  })

  it("sandbox.benchmark smoke suite also exists", async () => {
    const { getSuite } = await import("../src/eval/registry")
    const suite = getSuite("coding-basics", "smoke", "sandbox.benchmark")
    expect(suite).toBeDefined()
    expect(suite!.environmentId).toBe("sandbox.benchmark")
    expect(suite!.cases.length).toBeGreaterThan(0)
  })
})
