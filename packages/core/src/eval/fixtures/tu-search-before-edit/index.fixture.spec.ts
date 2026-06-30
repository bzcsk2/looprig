import { describe, it, expect } from "bun:test";
import { deepClone, pipe, memoize } from "./index";

describe("deepClone", () => {
  it("should clone primitives", () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone("hello")).toBe("hello");
    expect(deepClone(true)).toBe(true);
    expect(deepClone(null)).toBe(null);
  });

  it("should clone arrays", () => {
    const arr = [1, 2, [3, 4]];
    const cloned = deepClone(arr);
    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
    expect(cloned[2]).not.toBe(arr[2]);
  });

  it("should clone objects", () => {
    const obj = { a: 1, b: { c: 2 } };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
    expect(cloned.b).not.toBe(obj.b);
  });

  it("should handle Date objects", () => {
    const date = new Date();
    const cloned = deepClone(date);
    expect(cloned).toEqual(date);
  });

  it("should handle nested mixed structures", () => {
    const obj = { a: [1, { b: 2 }], c: new Date() };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned.a).not.toBe(obj.a);
    expect(cloned.a[1]).not.toBe(obj.a[1]);
  });
});
