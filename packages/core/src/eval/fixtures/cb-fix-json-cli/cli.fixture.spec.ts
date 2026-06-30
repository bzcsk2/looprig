import { describe, it, expect } from "bun:test";
import { processInput } from "./cli";

// These tests are wrong - they import from cli.ts which doesn't export processInput
// The bug is two-fold:
// 1. cli.ts doesn't export processInput
// 2. transformValue doesn't handle objects correctly

describe("CLI JSON Parser", () => {
  it("should parse simple values", () => {
    expect(processInput('"hello"')).toBe('"hello"');
    expect(processInput("42")).toBe("42");
    expect(processInput("true")).toBe("yes");
    expect(processInput("false")).toBe("no");
    expect(processInput("null")).toBe("null");
  });

  it("should parse arrays", () => {
    expect(processInput("[1, 2, 3]")).toBe("[1, 2, 3]");
    expect(processInput('["a", "b"]')).toBe('["a", "b"]');
  });

  it("should parse nested objects", () => {
    const result = processInput('{"name": "test", "value": 42}');
    expect(result).toContain("name");
    expect(result).toContain("test");
    expect(result).toContain("value");
    expect(result).toContain("42");
    expect(result).not.toBe("[object Object]");
  });

  it("should reject invalid JSON", () => {
    expect(processInput("not json")).toBe("Error: Invalid JSON");
  });
});
