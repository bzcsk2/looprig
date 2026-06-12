import { describe, it, expect } from "vitest"
import { checkSubagentPermission, getToolTier } from "../src/subagent/permission.js"

describe("getToolTier", () => {
  it("should classify read tools", () => {
    expect(getToolTier("read_file")).toBe("read")
    expect(getToolTier("grep")).toBe("read")
    expect(getToolTier("list_dir")).toBe("read")
    expect(getToolTier("glob")).toBe("read")
  })

  it("should classify write tools", () => {
    expect(getToolTier("write_file")).toBe("write")
    expect(getToolTier("edit")).toBe("write")
    expect(getToolTier("NotebookEdit")).toBe("write")
  })

  it("should classify exec tools", () => {
    expect(getToolTier("bash")).toBe("exec")
    expect(getToolTier("exec")).toBe("exec")
  })
})

describe("checkSubagentPermission", () => {
  describe("readonly mode", () => {
    it("should allow read tools", () => {
      const result = checkSubagentPermission("read_file", "readonly")
      expect(result.allowed).toBe(true)
    })

    it("should deny write tools", () => {
      const result = checkSubagentPermission("write_file", "readonly")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("readonly")
    })

    it("should deny exec tools", () => {
      const result = checkSubagentPermission("bash", "readonly")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("readonly")
    })
  })

  describe("denyExec mode", () => {
    it("should allow read tools", () => {
      expect(checkSubagentPermission("read_file", "denyExec").allowed).toBe(true)
    })

    it("should allow write tools", () => {
      expect(checkSubagentPermission("write_file", "denyExec").allowed).toBe(true)
    })

    it("should deny exec tools", () => {
      const result = checkSubagentPermission("bash", "denyExec")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("denyExec")
    })

    it("should deny exec tool even if it's a read-like name but classified as exec", () => {
      const result = checkSubagentPermission("exec", "denyExec")
      expect(result.allowed).toBe(false)
    })
  })

  describe("acceptEdits mode", () => {
    it("should allow read tools", () => {
      expect(checkSubagentPermission("read_file", "acceptEdits").allowed).toBe(true)
    })

    it("should allow write tools", () => {
      expect(checkSubagentPermission("write_file", "acceptEdits").allowed).toBe(true)
    })

    it("should require parent approval for exec tools (PERM-10)", () => {
      const result = checkSubagentPermission("bash", "acceptEdits")
      expect(result.allowed).toBe(false)
      expect(result.bubble).toBe(true)
      expect(result.reason).toContain("acceptEdits")
    })
  })

  describe("bubble mode", () => {
    it("should require parent approval for all tools (PERM-10)", () => {
      for (const tool of ["read_file", "write_file", "bash"]) {
        const result = checkSubagentPermission(tool, "bubble")
        expect(result.allowed).toBe(false)
        expect(result.bubble).toBe(true)
      }
    })
  })
})
