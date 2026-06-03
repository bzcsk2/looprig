import { safeStringify } from "../safe-stringify.js"

const MAX_ITEMS = 50
const MAX_PREVIEW_LENGTH = 240
const MAX_DIAGNOSTICS = 100

export interface NormalizedLocation {
  kind: "location"
  file: string
  range: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
  preview?: string
}

export interface NormalizedHover {
  kind: "hover"
  contents: string
}

export interface NormalizedDiagnostic {
  kind: "diagnostic"
  severity: "error" | "warning" | "info" | "hint"
  file: string
  line: number
  column: number
  message: string
  source?: string
  code?: string | number
}

export interface NormalizedCompletion {
  label: string
  detail?: string
  documentation?: string
  insertText?: string
  completionKind?: number
}

export interface NormalizedSymbol {
  kind: "symbol"
  name: string
  kindLabel: string
  file: string
  line: number
  column: number
  containerName?: string
}

export interface NormalizedSignature {
  kind: "signatureHelp"
  activeSignature: number
  activeParameter: number
  signatures: Array<{
    label: string
    documentation?: string
    parameters?: Array<{
      label: string | [number, number]
      documentation?: string
    }>
  }>
}

export interface NormalizedRenameEdit {
  kind: "workspaceEdit"
  changes?: Record<string, unknown>
  documentChanges?: unknown[]
}

export type NormalizedItem =
  | NormalizedLocation
  | NormalizedHover
  | NormalizedDiagnostic
  | NormalizedCompletion
  | NormalizedSymbol
  | NormalizedSignature
  | NormalizedRenameEdit

export function normalizeLocation(raw: unknown): NormalizedLocation | null {
  if (!raw || typeof raw !== "object") return null
  const loc = raw as Record<string, unknown>

  if (loc.range && typeof loc.range === "object") {
    const range = loc.range as Record<string, unknown>
    return {
      kind: "location",
      file: typeof loc.uri === "string" ? uriToPath(loc.uri) : "",
      range: normalizeRange(range),
      preview: truncatePreview(loc.preview),
    }
  }

  if (loc.uri && typeof loc.uri === "string") {
    return {
      kind: "location",
      file: uriToPath(loc.uri),
      range: normalizeRange(loc.range),
    }
  }

  return null
}

export function normalizeLocationArray(raw: unknown): NormalizedLocation[] {
  if (!Array.isArray(raw)) return []
  const items: NormalizedLocation[] = []
  for (const item of raw.slice(0, MAX_ITEMS)) {
    const loc = normalizeLocation(item)
    if (loc) items.push(loc)
  }
  return items
}

export function normalizeHover(raw: unknown): NormalizedHover | null {
  if (!raw || typeof raw !== "object") return null
  const hover = raw as Record<string, unknown>
  const contents = hover.contents
  if (typeof contents === "string") {
    return { kind: "hover", contents: truncatePreview(contents) ?? "" }
  }
  if (contents && typeof contents === "object") {
    const c = contents as Record<string, unknown>
    if (typeof c.value === "string") return { kind: "hover", contents: truncatePreview(c.value) ?? "" }
    if (typeof c.kind === "string" && typeof c.value === "string") {
      return { kind: "hover", contents: truncatePreview(c.value) ?? "" }
    }
  }
  return null
}

export function normalizeDiagnostics(raw: unknown): NormalizedDiagnostic[] {
  if (!Array.isArray(raw)) return []
  const severityMap: Record<number, NormalizedDiagnostic["severity"]> = {
    1: "error",
    2: "warning",
    3: "info",
    4: "hint",
  }
  const items: NormalizedDiagnostic[] = []
  for (const item of raw.slice(0, MAX_DIAGNOSTICS)) {
    if (!item || typeof item !== "object") continue
    const d = item as Record<string, unknown>
    const range = d.range as Record<string, unknown> | undefined
    const start = range?.start as Record<string, unknown> | undefined
    items.push({
      kind: "diagnostic",
      severity: severityMap[(d.severity as number) ?? 1] ?? "error",
      file: typeof d.uri === "string" ? uriToPath(d.uri) : "",
      line: ((start?.line as number) ?? 0) + 1,
      column: ((start?.character as number) ?? 0) + 1,
      message: String(d.message ?? ""),
      source: typeof d.source === "string" ? d.source : undefined,
      code: d.code as string | number | undefined,
    })
  }
  return items
}

export function normalizeCompletion(raw: unknown): NormalizedCompletion[] {
  if (!raw || typeof raw !== "object") return []
  const completion = raw as Record<string, unknown>
  const items = (completion.items ?? raw) as unknown[]
  if (!Array.isArray(items)) return []
  const result: NormalizedCompletion[] = []
  for (const item of items.slice(0, MAX_ITEMS)) {
    if (!item || typeof item !== "object") continue
    const c = item as Record<string, unknown>
    result.push({
      label: String(c.label ?? ""),
      detail: typeof c.detail === "string" ? c.detail : undefined,
      documentation: normalizeDocumentation(c.documentation),
      insertText: typeof c.insertText === "string" ? c.insertText : undefined,
      completionKind: typeof c.kind === "number" ? c.kind : undefined,
    })
  }
  return result
}

export function normalizeDocumentSymbols(raw: unknown): NormalizedSymbol[] {
  if (!Array.isArray(raw)) return []
  const symbolKinds: Record<number, string> = {
    1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class",
    6: "method", 7: "property", 8: "field", 9: "constructor", 10: "enum",
    11: "interface", 12: "function", 13: "variable", 14: "constant", 15: "string",
    16: "number", 17: "boolean", 18: "array", 19: "object", 20: "key",
    21: "null", 22: "enummember", 23: "struct", 24: "event", 25: "operator",
    26: "typeparameter",
  }
  const items: NormalizedSymbol[] = []
  for (const item of raw.slice(0, MAX_ITEMS)) {
    if (!item || typeof item !== "object") continue
    const s = item as Record<string, unknown>
    const loc = s.location as Record<string, unknown> | undefined
    const range = loc?.range as Record<string, unknown> | undefined
    const start = range?.start as Record<string, unknown> | undefined
    items.push({
      kind: "symbol",
      name: String(s.name ?? ""),
      kindLabel: symbolKinds[s.kind as number] ?? "unknown",
      file: loc && typeof loc.uri === "string" ? uriToPath(loc.uri) : "",
      line: (start?.line as number) ?? 0,
      column: (start?.character as number) ?? 0,
      containerName: typeof s.containerName === "string" ? s.containerName : undefined,
    })
  }
  return items
}

export function normalizeWorkspaceSymbols(raw: unknown): NormalizedSymbol[] {
  if (!raw || typeof raw !== "object") return []
  const symbol = raw as Record<string, unknown>
  const symbols = (symbol.symbols ?? raw) as unknown[]
  if (!Array.isArray(symbols)) return []
  const symbolKinds: Record<number, string> = {
    1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class",
    6: "method", 7: "property", 8: "field", 9: "constructor", 10: "enum",
    11: "interface", 12: "function", 13: "variable", 14: "constant", 15: "string",
    16: "number", 17: "boolean", 18: "array", 19: "object", 20: "key",
    21: "null", 22: "enummember", 23: "struct", 24: "event", 25: "operator",
    26: "typeparameter",
  }
  const items: NormalizedSymbol[] = []
  for (const item of symbols.slice(0, MAX_ITEMS)) {
    if (!item || typeof item !== "object") continue
    const s = item as Record<string, unknown>
    const loc = s.location as Record<string, unknown> | undefined
    const range = loc?.range as Record<string, unknown> | undefined
    const start = range?.start as Record<string, unknown> | undefined
    items.push({
      kind: "symbol",
      name: String(s.name ?? ""),
      kindLabel: symbolKinds[s.kind as number] ?? "unknown",
      file: loc && typeof loc.uri === "string" ? uriToPath(loc.uri) : "",
      line: (start?.line as number) ?? 0,
      column: (start?.character as number) ?? 0,
      containerName: typeof s.containerName === "string" ? s.containerName : undefined,
    })
  }
  return items
}

export function normalizeRenameEdit(raw: unknown): NormalizedRenameEdit | null {
  if (!raw || typeof raw !== "object") return null
  const edit = raw as Record<string, unknown>
  if (edit.changes && typeof edit.changes === "object") {
    return { kind: "workspaceEdit", changes: edit.changes as Record<string, unknown> }
  }
  if (edit.documentChanges && Array.isArray(edit.documentChanges)) {
    return { kind: "workspaceEdit", documentChanges: edit.documentChanges }
  }
  return null
}

export function normalizeSignatureHelp(raw: unknown): NormalizedSignature | null {
  if (!raw || typeof raw !== "object") return null
  const sig = raw as Record<string, unknown>
  if (!Array.isArray(sig.signatures)) return null
  const signatures: NormalizedSignature["signatures"] = []
  for (const s of sig.signatures.slice(0, 5)) {
    if (!s || typeof s !== "object") continue
    const sigItem = s as Record<string, unknown>
    const params: Array<{ label: string | [number, number]; documentation?: string }> = []
    if (Array.isArray(sigItem.parameters)) {
      for (const p of sigItem.parameters.slice(0, 10)) {
        if (!p || typeof p !== "object") continue
        const param = p as Record<string, unknown>
        params.push({
          label: param.label as string | [number, number],
          documentation: typeof param.documentation === "string" ? param.documentation : undefined,
        })
      }
    }
    signatures.push({
      label: String(sigItem.label ?? ""),
      documentation: typeof sigItem.documentation === "string" ? sigItem.documentation : undefined,
      parameters: params,
    })
  }
  return {
    kind: "signatureHelp",
    activeSignature: (sig.activeSignature as number) ?? 0,
    activeParameter: (sig.activeParameter as number) ?? 0,
    signatures,
  }
}

function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    return decodeURIComponent(uri.slice(7))
  }
  return uri
}

function normalizeRange(range: unknown): { start: { line: number; column: number }; end: { line: number; column: number } } {
  if (!range || typeof range !== "object") {
    return { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
  }
  const r = range as Record<string, unknown>
  const start = r.start as Record<string, unknown> | undefined
  const end = r.end as Record<string, unknown> | undefined
  return {
    start: { line: (start?.line as number) ?? 0, column: (start?.character as number) ?? 0 },
    end: { line: (end?.line as number) ?? 0, column: (end?.character as number) ?? 0 },
  }
}

function truncatePreview(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined
  if (text.length <= MAX_PREVIEW_LENGTH) return text
  return text.slice(0, MAX_PREVIEW_LENGTH) + "…"
}

function normalizeDocumentation(doc: unknown): string | undefined {
  if (typeof doc === "string") return truncatePreview(doc)
  if (doc && typeof doc === "object") {
    const d = doc as Record<string, unknown>
    if (typeof d.value === "string") return truncatePreview(d.value)
  }
  return undefined
}

export function formatNormalizedItems(items: NormalizedItem[]): string {
  if (items.length === 0) return "No results"
  return safeStringify(items)
}
