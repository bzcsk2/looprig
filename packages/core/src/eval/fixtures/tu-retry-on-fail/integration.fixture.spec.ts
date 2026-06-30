import { describe, it, expect } from "bun:test";
import { serializeToJSON, countRows } from "./serializer";

const csvData = `name,age,city
Alice,30,New York
Bob,25,Los Angeles
Charlie,35,Chicago`;

const csvDataWithQuotes = `name,age,city
"John, Doe",28,Boston
"Jane, Smith",32,Seattle`;

describe("CSV Integration", () => {
  it("should parse and serialize CSV to JSON", () => {
    const json = serializeToJSON(csvData);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ name: "Alice", age: "30", city: "New York" });
    expect(parsed[1]).toEqual({ name: "Bob", age: "25", city: "Los Angeles" });
  });

  it("should count rows correctly", () => {
    expect(countRows(csvData)).toBe(3);
  });

  it("should handle quoted values in CSV", () => {
    // This test will fail initially because parseCSV doesn't handle quoted values
    const json = serializeToJSON(csvDataWithQuotes);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("John, Doe");
    expect(parsed[1].name).toBe("Jane, Smith");
  });

  it("should handle empty CSV", () => {
    expect(countRows("")).toBe(0);
    expect(serializeToJSON("header1,header2")).toBe("[]");
  });
});
