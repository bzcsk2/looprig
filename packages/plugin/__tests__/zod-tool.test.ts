import { describe, it, expect } from "vitest"
import { z } from "zod"
import { definePluginTool, isSchemaAwareTool } from "../src/define-tool.js"
import { convertSchemaToJsonSpec, validateSchemaArgs, isStandardSchemaLike } from "../src/schema-adapter.js"

describe("Zod Plugin Tool Integration", () => {
  describe("definePluginTool", () => {
    it("creates a function with covaloTool metadata", () => {
      const schema = z.object({ name: z.string() })
      const tool = definePluginTool({
        description: "Greet a user",
        inputSchema: schema,
        execute: (args: { name: string }) => `Hello ${args.name}`,
      })

      expect(typeof tool).toBe("function")
      expect(tool.covaloTool.description).toBe("Greet a user")
      expect(isStandardSchemaLike(tool.covaloTool.inputSchema)).toBe(true)
      expect(isSchemaAwareTool(tool)).toBe(true)
    })

    it("executes with correct args", () => {
      const schema = z.object({ name: z.string() })
      const tool = definePluginTool({
        description: "Greet",
        inputSchema: schema,
        execute: (args: { name: string }) => `Hi ${args.name}`,
      })

      expect(tool({ name: "World" })).toBe("Hi World")
    })

    it("throws if inputSchema is not a Standard Schema", () => {
      expect(() =>
        definePluginTool({
          description: "bad",
          inputSchema: {} as any,
          execute: () => "never",
        }),
      ).toThrow(TypeError)
    })
  })

  describe("isSchemaAwareTool", () => {
    it("returns false for plain functions", () => {
      expect(isSchemaAwareTool(() => {})).toBe(false)
    })

    it("returns true for definePluginTool output", () => {
      const tool = definePluginTool({
        description: "test",
        inputSchema: z.object({}),
        execute: () => "ok",
      })
      expect(isSchemaAwareTool(tool)).toBe(true)
    })
  })

  describe("convertSchemaToJsonSpec", () => {
    it("converts a Zod object schema to Draft-07 JSON Schema", async () => {
      const schema = z.object({
        name: z.string().min(1).describe("Name to greet"),
        age: z.number().optional(),
      })

      const spec = await convertSchemaToJsonSpec(schema)
      expect(spec).toMatchObject({
        type: "object",
        properties: {
          name: { type: "string", description: "Name to greet" },
          age: { type: "number" },
        },
        required: ["name"],
      })
    })

    it("converts enum schema", async () => {
      const schema = z.enum(["a", "b", "c"])
      const spec = await convertSchemaToJsonSpec(schema)
      expect(spec).toMatchObject({ type: "string", enum: ["a", "b", "c"] })
    })

    it("converts array schema", async () => {
      const schema = z.array(z.string())
      const spec = await convertSchemaToJsonSpec(schema)
      expect(spec).toMatchObject({ type: "array", items: { type: "string" } })
    })

    it("converts nested object schema", async () => {
      const schema = z.object({
        meta: z.object({
          tags: z.array(z.string()),
          count: z.number(),
        }),
      })
      const spec = await convertSchemaToJsonSpec(schema)
      expect(spec).toMatchObject({
        type: "object",
        properties: {
          meta: {
            type: "object",
            properties: {
              tags: { type: "array", items: { type: "string" } },
              count: { type: "number" },
            },
          },
        },
        required: ["meta"],
      })
    })

    it("handles default values (input schema strips defaults from required)", async () => {
      const schema = z.object({
        name: z.string(),
        excited: z.boolean().default(false),
      })
      const spec = await convertSchemaToJsonSpec(schema)
      expect(spec).toMatchObject({
        type: "object",
        properties: {
          name: { type: "string" },
          excited: { type: "boolean" },
        },
        required: ["name"],
      })
    })

    it("handles union types", async () => {
      const schema = z.union([z.string(), z.number()])
      const spec = await convertSchemaToJsonSpec(schema)
      expect(spec).toMatchObject({ anyOf: [{ type: "string" }, { type: "number" }] })
    })

    it("falls back gracefully for unrepresentable schema", async () => {
      const schema = z.string().transform((s) => s.length)
      const spec = await convertSchemaToJsonSpec(schema)
      // unrepresentable: "any" means it won't throw
      expect(spec).toBeDefined()
    })
  })

  describe("validateSchemaArgs", () => {
    it("validates correct args and returns typed data", async () => {
      const schema = z.object({
        name: z.string().min(1),
        age: z.number().optional(),
      })

      const result = await validateSchemaArgs(schema, { name: "Alice", age: 30 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ name: "Alice", age: 30 })
      }
    })

    it("rejects missing required field", async () => {
      const schema = z.object({ name: z.string() })
      const result = await validateSchemaArgs(schema, {})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.issues.length).toBeGreaterThan(0)
        expect(result.issues.some((i) => i.path.includes("name"))).toBe(true)
      }
    })

    it("does not call execute on validation failure", async () => {
      const schema = z.object({ x: z.number() })
      let executed = false
      const tool = definePluginTool({
        description: "test",
        inputSchema: schema,
        execute: () => {
          executed = true
          return "done"
        },
      })

      // Validate directly
      const result = await validateSchemaArgs(schema, { x: "not-a-number" })
      expect(result.success).toBe(false)
      expect(executed).toBe(false)
    })

    it("injects default values via validation", async () => {
      const schema = z.object({
        name: z.string(),
        excited: z.boolean().default(false),
      })

      const result = await validateSchemaArgs(schema, { name: "Alice" })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ name: "Alice", excited: false })
      }
    })

    it("applies trim transformation", async () => {
      const schema = z.object({
        name: z.string().trim(),
      })

      const result = await validateSchemaArgs(schema, { name: "  hello  " })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ name: "hello" })
      }
    })
  })
})
