import type { z } from "zod"

/**
 * Minimal Standard Schema V1 shape used as the plugin runtime contract.
 * This avoids hardcoding ZodType in public interfaces so non-Zod
 * libraries implementing Standard Schema can also work.
 */
export interface StandardSchemaLike<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
    ) => { readonly value: Output } | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<string | number> }> } | Promise<{ readonly value: Output } | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<string | number> }> }>
    readonly jsonSchema?: {
      readonly input: (options?: { readonly target?: string }) => Record<string, unknown>
    }
  }
}

export type SchemaAwareToolMeta = {
  description: string
  inputSchema: StandardSchemaLike
}

function isStandardSchemaLike(value: unknown): value is StandardSchemaLike {
  if (!value || typeof value !== "object") return false
  const std = (value as Record<string, unknown>)["~standard"]
  if (!std || typeof std !== "object") return false
  const s = std as Record<string, unknown>
  return typeof s.validate === "function"
}

function hasStandardJSONSchema(schema: StandardSchemaLike): boolean {
  return typeof schema["~standard"].jsonSchema?.input === "function"
}

let zodModule: { z: typeof import("zod")["z"] } | null | undefined

async function getZodModule(): Promise<{ z: typeof import("zod")["z"] } | null> {
  if (zodModule !== undefined) return zodModule
  try {
    const mod = await import("zod")
    zodModule = { z: mod.z }
  } catch {
    zodModule = null
  }
  return zodModule
}

export async function convertSchemaToJsonSpec(
  inputSchema: StandardSchemaLike,
): Promise<Record<string, unknown>> {
  if (hasStandardJSONSchema(inputSchema)) {
    try {
      const result = inputSchema["~standard"].jsonSchema!.input({ target: "draft-07" })
      return result as Record<string, unknown>
    } catch {
      // Fall through to z.toJSONSchema
    }
  }

  const zod = await getZodModule()
  if (zod) {
    try {
      const result = zod.z.toJSONSchema(inputSchema as unknown as Parameters<typeof zod.z.toJSONSchema>[0], {
        io: "input",
        target: "draft-07",
        unrepresentable: "any",
      })
      return result as Record<string, unknown>
    } catch {
      // Fall through
    }
  }

  return { type: "object", properties: {} }
}

export async function validateSchemaArgs(
  inputSchema: StandardSchemaLike,
  args: unknown,
): Promise<{ success: true; data: unknown } | { success: false; issues: Array<{ path: string; message: string }> }> {
  const result = await inputSchema["~standard"].validate(args)
  if ("issues" in result) {
    return {
      success: false,
      issues: result.issues.map((issue) => ({
        path: Array.isArray(issue.path) ? issue.path.join(".") : "",
        message: issue.message,
      })),
    }
  }
  return { success: true, data: result.value }
}

export { isStandardSchemaLike }
