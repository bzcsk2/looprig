import type { StandardSchemaLike, SchemaAwareToolMeta } from "./schema-adapter.js"
import { isStandardSchemaLike } from "./schema-adapter.js"

export interface SchemaAwarePluginTool<TInput = unknown, TOutput = unknown> {
  (args: TInput): TOutput | Promise<TOutput>
  deepicodeTool: SchemaAwareToolMeta
}

export type DefinePluginToolOptions<TInput, TOutput> = {
  description: string
  inputSchema: StandardSchemaLike
  execute(args: TInput): TOutput | Promise<TOutput>
}

export function definePluginTool<TInput, TOutput>(
  opts: DefinePluginToolOptions<TInput, TOutput>,
): SchemaAwarePluginTool<TInput, TOutput> {
  if (!isStandardSchemaLike(opts.inputSchema)) {
    throw new TypeError("definePluginTool: inputSchema must be a Standard Schema (~standard)")
  }

  const fn = (args: TInput): TOutput | Promise<TOutput> => opts.execute(args) as TOutput | Promise<TOutput>
  ;(fn as SchemaAwarePluginTool<TInput, TOutput>).deepicodeTool = {
    description: opts.description,
    inputSchema: opts.inputSchema,
  }
  return fn as SchemaAwarePluginTool<TInput, TOutput>
}

export function isSchemaAwareTool(value: unknown): value is SchemaAwarePluginTool {
  if (typeof value !== "function") return false
  return "deepicodeTool" in (value as unknown as Record<string, unknown>)
}
