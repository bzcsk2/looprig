import { describe, it, expect } from "bun:test";
import { sum, average, chunk, unique, flatten } from "./utils";

describe("sum", () => {
  it("should sum numbers", () => {
    expect(sum([1, 2, 3])).toBe(6);
  });

  it("should handle empty array", () => {
    expect(sum([])).toBe(0);
  });
});

describe("average", () => {
  it("should compute average", () => {
    expect(average([1, 2, 3, 4])).toBe(2.5);
  });

  it("should handle empty array", () => {
    expect(average([])).toBe(0);
  });
});

describe("chunk", () => {
  it("should split array into chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("should handle exact division", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("should handle size larger than array", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  it("should handle empty array", () => {
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("unique", () => {
  it("should remove duplicates", () => {
    expect(unique([1, 2, 2, 3, 1, 4])).toEqual([1, 2, 3, 4]);
  });
});

describe("flatten", () => {
  it("should flatten nested arrays", () => {
    expect(flatten([[1, 2], [3], [4, 5, 6]])).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
