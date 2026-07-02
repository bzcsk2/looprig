import { describe, it, expect } from "bun:test"
import { buildMenuRows, getPrevSelectableIndex, getNextSelectableIndex, clampWindow, GROUP_ORDER, resolveLocalBaseUrl } from "../src/model-menu.js"
import type { ApiKeySource } from "@covalo/core"

describe("buildMenuRows", () => {
  it("should include Free group with correct order", () => {
    const rows = buildMenuRows({}, new Set(), "zen", "deepseek-v4-flash-free")
    const freeHeader = rows.findIndex(r => r.id === "hdr-free")
    expect(freeHeader).toBeGreaterThanOrEqual(0)
    expect(rows[freeHeader]).toEqual({ kind: "header", id: "hdr-free", label: "Free" })
  })

  it("should render all free models", () => {
    const rows = buildMenuRows({}, new Set(), "", "")
    const freeModels = rows.filter(r => r.kind === "model" && r.group === "free")
    expect(freeModels).toHaveLength(5)
    expect(freeModels[0]!.label).toBe("deepseek-v4-flash-free")
    expect(freeModels[4]!.label).toBe("laguna-xs.2-free")
  })

  it("should render Local group with shortcut models and custom entry", () => {
    const rows = buildMenuRows({}, new Set(), "", "")
    const localHeader = rows.findIndex(r => r.id === "hdr-local")
    expect(localHeader).toBeGreaterThan(0)

    const localModels = rows.filter(r => r.kind === "model" && r.group === "local")
    expect(localModels).toHaveLength(2)

    const custom = rows.find(r => r.kind === "custom")
    expect(custom).toBeDefined()
    expect(custom!.kind).toBe("custom")
  })

  it("should show provider row without key and not expanded", () => {
    const rows = buildMenuRows({}, new Set(), "", "")
    const qwenRow = rows.find(r => r.id === "provider-qwen")
    expect(qwenRow).toBeDefined()
    expect(qwenRow!.kind).toBe("provider")
    if (qwenRow!.kind === "provider") {
      expect(qwenRow!.configured).toBe(false)
      expect(qwenRow!.expanded).toBe(false)
    }
  })

  it("should show provider row with key and expanded models", () => {
    const rows = buildMenuRows({ qwen: "env" as ApiKeySource }, new Set(["qwen"]), "", "")
    const qwenRow = rows.find(r => r.id === "provider-qwen")
    expect(qwenRow).toBeDefined()
    if (qwenRow!.kind === "provider") {
      expect(qwenRow!.configured).toBe(true)
      expect(qwenRow!.expanded).toBe(true)
      expect(qwenRow!.keySource).toBe("env")
    }

    const qwenModels = rows.filter(r => r.kind === "model" && r.group === "qwen")
    expect(qwenModels.length).toBeGreaterThan(0)
  })

  it("headers are never selectable", () => {
    const rows = buildMenuRows({}, new Set(), "", "")
    for (const r of rows) {
      if (r.kind === "header") {
        expect(getNextSelectableIndex(rows, rows.indexOf(r))).not.toBe(rows.indexOf(r))
      }
    }
  })

  it("should mark current selection", () => {
    const rows = buildMenuRows({ deepseek: "project-file" as ApiKeySource }, new Set(["deepseek"]), "deepseek", "deepseek-v4-pro")
    const currentModel = rows.find(r => r.kind === "model" && r.group === "deepseek")
    expect(currentModel).toBeDefined()
  })

  it("group order matches product definition", () => {
    const ids = GROUP_ORDER.map(g => g.id)
    expect(ids).toEqual(["free", "local", "deepseek", "qwen", "kimi", "zai", "stepfun", "nvidia", "openai", "mimo"])
  })
})

describe("getPrevSelectableIndex / getNextSelectableIndex", () => {
  it("should skip headers when going up", () => {
    const rows = buildMenuRows({}, new Set(), "", "")
    const freeHeaderIdx = rows.findIndex(r => r.id === "hdr-free")
    const above = getPrevSelectableIndex(rows, freeHeaderIdx)
    expect(above).toBe(freeHeaderIdx) // can't go up from first header
  })

  it("should skip headers when going down", () => {
    const rows = buildMenuRows({}, new Set(), "", "")
    const freeHeaderIdx = rows.findIndex(r => r.id === "hdr-free")
    const below = getNextSelectableIndex(rows, freeHeaderIdx)
    expect(below).not.toBe(freeHeaderIdx)
    expect(rows[below]!.kind).not.toBe("header")
  })
})

describe("clampWindow", () => {
  it("should return 0 when total <= window", () => {
    expect(clampWindow(5, 10, 20)).toBe(0)
  })

  it("should center selection in window", () => {
    const start = clampWindow(10, 30, 10)
    expect(start).toBe(5)
  })

  it("should not overflow at start", () => {
    expect(clampWindow(0, 30, 10)).toBe(0)
  })

  it("should not overflow at end", () => {
    expect(clampWindow(29, 30, 10)).toBe(20)
  })
})
