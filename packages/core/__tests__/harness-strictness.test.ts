/**
 * ADV-HAR-01 测试：Harness 三档严格度解析器
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import {
  resolveHarnessStrictness,
  readProjectHarnessConfig,
  writeProjectHarnessConfig,
  inferDefaultStrictness,
} from "../src/harness/strictness.js"
import {
  resolveEffectiveHarnessPolicy,
  getBasePolicy,
} from "../src/harness/policy.js"
import type { ProjectHarnessConfig, ModelProfile } from "../src/model-profile/types.js"

const TEST_DIR = resolve(import.meta.dir, "../../.test-harness-temp")

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe("resolveHarnessStrictness", () => {
  it("returns session strictness when provided (highest priority)", () => {
    const result = resolveHarnessStrictness({
      sessionStrictness: "loose",
      projectConfig: { strictness: "strict" },
      modelName: "qwen3",
    })
    expect(result).toEqual({ strictness: "loose", source: "session" })
  })

  it("returns project model override when no session", () => {
    const result = resolveHarnessStrictness({
      projectConfig: {
        strictness: "normal",
        modelOverrides: { qwen: "strict" },
      },
      modelName: "qwen3-8b",
    })
    expect(result).toEqual({ strictness: "strict", source: "project" })
  })

  it("returns project global strictness when no session or model override", () => {
    const result = resolveHarnessStrictness({
      projectConfig: { strictness: "loose" },
    })
    expect(result).toEqual({ strictness: "loose", source: "project" })
  })

  it("returns default strictness for unknown local model", () => {
    const localProfile: ModelProfile = {
      id: "unknown-local",
      match: [],
      sizeClass: "small",
      contextWindow: 32768,
      maxOutputTokens: 4096,
      toolFormat: "native",
      toolCallReliability: "low",
      jsonReliability: "low",
      strengths: [],
      weaknesses: ["unknown_capabilities"],
      defaultHarness: "local-small-strict",
    }
    const result = resolveHarnessStrictness({
      modelProfile: localProfile,
    })
    expect(result).toEqual({ strictness: "strict", source: "default" })
  })

  it("returns normal for unknown remote model", () => {
    const result = resolveHarnessStrictness({})
    expect(result).toEqual({ strictness: "normal", source: "default" })
  })

  it("model override is case-insensitive", () => {
    const result = resolveHarnessStrictness({
      projectConfig: {
        modelOverrides: { QWEN: "loose" },
      },
      modelName: "qwen3-8b",
    })
    expect(result).toEqual({ strictness: "loose", source: "project" })
  })
})

describe("inferDefaultStrictness", () => {
  it("returns strict for unknown-local profile", () => {
    const profile: ModelProfile = {
      id: "unknown-local",
      match: [],
      sizeClass: "small",
      contextWindow: 32768,
      maxOutputTokens: 4096,
      toolFormat: "native",
      toolCallReliability: "low",
      jsonReliability: "low",
      strengths: [],
      weaknesses: [],
      defaultHarness: "local-small-strict",
    }
    expect(inferDefaultStrictness(profile)).toBe("strict")
  })

  it("returns normal for known profiles", () => {
    const profile: ModelProfile = {
      id: "qwen3-8b",
      match: ["qwen3"],
      sizeClass: "small",
      contextWindow: 32768,
      maxOutputTokens: 8192,
      toolFormat: "hermes",
      toolCallReliability: "medium",
      jsonReliability: "high",
      strengths: [],
      weaknesses: [],
      defaultHarness: "local-small-strict",
    }
    expect(inferDefaultStrictness(profile)).toBe("normal")
  })

  it("returns normal for null", () => {
    expect(inferDefaultStrictness(null)).toBe("normal")
  })
})

describe("readProjectHarnessConfig / writeProjectHarnessConfig", () => {
  it("returns null when no config file exists", () => {
    expect(readProjectHarnessConfig(TEST_DIR)).toBeNull()
  })

  it("writes and reads back project config", () => {
    const config: ProjectHarnessConfig = {
      strictness: "strict",
      modelOverrides: { qwen: "loose" },
    }
    writeProjectHarnessConfig(config, TEST_DIR)
    const loaded = readProjectHarnessConfig(TEST_DIR)
    expect(loaded).toEqual(config)
  })

  it("returns null for corrupt JSON", () => {
    const covaloDir = resolve(TEST_DIR, ".covalo")
    mkdirSync(covaloDir, { recursive: true })
    writeFileSync(resolve(covaloDir, "harness.json"), "not-json", "utf-8")
    expect(readProjectHarnessConfig(TEST_DIR)).toBeNull()
  })
})

describe("resolveEffectiveHarnessPolicy", () => {
  it("returns strict policy with correct defaults", () => {
    const policy = resolveEffectiveHarnessPolicy("strict")
    expect(policy.strictness).toBe("strict")
    expect(policy.source).toBe("default")
    expect(policy.executionMode).toBe("forced")
    expect(policy.readBeforeWrite).toBe("block")
    expect(policy.verification).toBe("block")
    expect(policy.earlyStop).toBe("aggressive")
    expect(policy.toolRouting).toBe("two-stage")
    expect(policy.shellPolicy).toBe("dual-track-conservative")
    expect(policy.supervisorPolicy).toBe("on-failure")
  })

  it("returns normal policy with correct defaults", () => {
    const policy = resolveEffectiveHarnessPolicy("normal")
    expect(policy.strictness).toBe("normal")
    expect(policy.executionMode).toBe("adaptive")
    expect(policy.readBeforeWrite).toBe("warn")
    expect(policy.verification).toBe("require-or-waive")
    expect(policy.earlyStop).toBe("standard")
    expect(policy.toolRouting).toBe("auto")
    expect(policy.shellPolicy).toBe("dual-track")
    expect(policy.supervisorPolicy).toBe("critical-only")
  })

  it("returns loose policy with correct defaults", () => {
    const policy = resolveEffectiveHarnessPolicy("loose")
    expect(policy.strictness).toBe("loose")
    expect(policy.executionMode).toBe("free")
    expect(policy.readBeforeWrite).toBe("off")
    expect(policy.textToolSalvage).toBe("off")
    expect(policy.branchBudget).toBe("observe")
    expect(policy.verification).toBe("warn")
    expect(policy.earlyStop).toBe("critical-only")
    expect(policy.toolRouting).toBe("direct")
    expect(policy.supervisorPolicy).toBe("off")
  })

  it("sets source correctly", () => {
    const policy = resolveEffectiveHarnessPolicy("normal", "session")
    expect(policy.source).toBe("session")
  })

  it("returns immutable policy (spread creates new object)", () => {
    const p1 = resolveEffectiveHarnessPolicy("strict")
    const p2 = resolveEffectiveHarnessPolicy("strict")
    expect(p1).not.toBe(p2)
    expect(p1).toEqual(p2)
  })
})

describe("getBasePolicy", () => {
  it("returns a copy of the base policy", () => {
    const p1 = getBasePolicy("strict")
    const p2 = getBasePolicy("strict")
    expect(p1).not.toBe(p2)
    expect(p1).toEqual(p2)
  })

  it("mutating returned policy does not affect subsequent calls", () => {
    const p = getBasePolicy("normal")
    p.maxTurns = 999
    const p2 = getBasePolicy("normal")
    expect(p2.maxTurns).toBe(50)
  })
})
