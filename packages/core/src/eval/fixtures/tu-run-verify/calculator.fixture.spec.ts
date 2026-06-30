import { describe, it, expect } from "bun:test";
import { add, subtract, multiply, divide, power, factorial } from "./calculator";

describe("add", () => {
  it("should add numbers", () => {
    expect(add(2, 3)).toBe(5);
    expect(add(-1, 1)).toBe(0);
  });
});

describe("subtract", () => {
  it("should subtract numbers", () => {
    expect(subtract(5, 3)).toBe(2);
  });
});

describe("multiply", () => {
  it("should multiply numbers", () => {
    expect(multiply(3, 4)).toBe(12);
  });
});

describe("divide", () => {
  it("should divide numbers", () => {
    expect(divide(10, 2)).toBe(5);
  });

  it("should handle division by zero", () => {
    expect(() => divide(1, 0)).toThrow();
  });
});

describe("power", () => {
  it("should compute power", () => {
    expect(power(2, 3)).toBe(8);
    expect(power(5, 0)).toBe(1);
  });
});

describe("factorial", () => {
  it("should compute factorial", () => {
    expect(factorial(5)).toBe(120);
    expect(factorial(0)).toBe(1);
  });
});
