export type SchemaValidator<T = unknown> = {
  validate: (value: unknown) => { readonly value: T } | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<string | number> }> } | Promise<{ readonly value: T } | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<string | number> }> }>
}

export type JsonParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { type: "file_not_found" | "malformed_json" | "schema_error"; path?: string; cause: string; issues?: Array<{ path: string; message: string }> } }

export async function parseJsonConfig<T>(
  raw: string | undefined,
  schema: SchemaValidator<T>,
  path?: string,
): Promise<JsonParseResult<T>> {
  if (raw === undefined) {
    return { success: false, error: { type: "file_not_found", path, cause: "File does not exist or is unreadable" } }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return {
      success: false,
      error: {
        type: "malformed_json",
        path,
        cause: e instanceof Error ? e.message : String(e),
      },
    }
  }

  const result = await schema.validate(parsed)
  if ("issues" in result) {
    return {
      success: false,
      error: {
        type: "schema_error",
        path,
        cause: result.issues.map((i) => i.message).join("; "),
        issues: result.issues.map((i) => ({
          path: i.path ? i.path.join(".") : "",
          message: i.message,
        })),
      },
    }
  }

  return { success: true, data: result.value }
}
