import { describe, it, expect } from "vitest"
import { safeStringify, hasBinaryEncoding } from "../src/safe-stringify.js"

describe("safeStringify", () => {
  it("should serialize a plain object", () => {
    const r = safeStringify({ a: 1, b: "hello" })
    expect(r).toBe('{"a":1,"b":"hello"}')
  })

  it("should truncate at maxLen with notice", () => {
    const r = safeStringify({ data: "x".repeat(500) }, 50)
    expect(r).toContain("[truncated")
    expect(r.length).toBeLessThan(150)
  })

  it("should not truncate when within limit", () => {
    const r = safeStringify({ a: 1 }, 10)
    expect(r).toBe('{"a":1}')
  })

  it("should fallback to String for non-JSON objects", () => {
    const circular: any = { a: 1 }
    circular.self = circular
    const r = safeStringify(circular)
    expect(r).toContain("[object Object]")
  })

  it("should handle null", () => {
    expect(safeStringify(null)).toBe("null")
  })

  it("should handle undefined", () => {
    expect(safeStringify(undefined)).toBe("undefined")
  })
})

describe("hasBinaryEncoding", () => {
  it("should detect high proportion of replacement characters", () => {
    const s = "\uFFFD".repeat(10) + "abc"
    expect(hasBinaryEncoding(s)).toBe(true)
  })

  it("should return false for normal text", () => {
    expect(hasBinaryEncoding("hello world")).toBe(false)
  })

  it("should return false for empty string", () => {
    expect(hasBinaryEncoding("")).toBe(false)
  })

  it("should return false for low proportion of replacement chars", () => {
    const s = "\uFFFD" + "hello world this is a long text"
    expect(hasBinaryEncoding(s)).toBe(false)
  })

  it("should handle mixed content correctly", () => {
    const s = "text\uFFFDmore text\uFFFDand more\uFFFDstuff"
    // 3 / 38 ≈ 0.079 > 0.05 → true
    expect(hasBinaryEncoding(s)).toBe(true)
  })

  it("should not throw on string with null bytes (\\x00)", () => {
    const s = "abc\x00def\x00ghi"
    const r = safeStringify(s)
    expect(r).toBeTruthy()
    expect(typeof r).toBe("string")
  })

  it("should detect string with high replacement char ratio as binary", () => {
    // Simulate output with lots of \\x00 bytes decoded as U+FFFD
    const s = "\uFFFD".repeat(20) + "normal"
    expect(hasBinaryEncoding(s)).toBe(true)
  })

  it("should not throw when JSON.stringify fails on circular with binary", () => {
    const obj: any = { data: "some\x00data" }
    obj.self = obj
    const r = safeStringify(obj)
    expect(r).toBeTruthy()
  })

  it("should handle BigInt without throwing", () => {
    const r = safeStringify({ big: BigInt(9007199254740991) })
    expect(r).toBeTruthy()
  })

  it("should handle Symbol without throwing", () => {
    const r = safeStringify({ sym: Symbol("test") })
    expect(r).toBeTruthy()
  })
})
