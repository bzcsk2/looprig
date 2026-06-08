import { readFileSync } from "node:fs"
import { resolve, dirname, isAbsolute } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

export type PluginSpec = string | [string, PluginOptions] | { spec: string; options?: PluginOptions }

export interface PluginOptions {
  enabled?: boolean
  [key: string]: unknown
}

export interface PluginConfigItem {
  spec: string
  options: PluginOptions
  source: "file" | "npm"
  deprecated: boolean
}

export type PluginConfigError =
  | { type: "file_not_found"; path: string }
  | { type: "malformed_json"; path: string; cause: string }
  | { type: "invalid_spec"; spec: string }
  | { type: "duplicate_spec"; spec: string }
  | { type: "duplicate_id"; id: string }
  | { type: "npm_plugin_not_installed"; spec: string }

export interface PluginConfigResult {
  items: PluginConfigItem[]
  errors: PluginConfigError[]
}

const DEPRECATED_PLUGINS: string[] = []

function isPathSpec(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("file://") || isAbsolute(spec)
}

function resolvePath(spec: string, basePath: string): string {
  if (spec.startsWith("file://")) {
    return fileURLToPath(spec)
  }
  if (isAbsolute(spec)) {
    return spec
  }
  return resolve(dirname(basePath), spec)
}

function normalizeSpec(item: PluginSpec): { spec: string; options: PluginOptions } {
  if (typeof item === "string") {
    return { spec: item, options: {} }
  }
  if (Array.isArray(item)) {
    return { spec: item[0], options: item[1] ?? {} }
  }
  return { spec: item.spec, options: item.options ?? {} }
}

function parseConfigItem(
  raw: PluginSpec,
  configPath: string,
): { item: PluginConfigItem; error?: PluginConfigError } {
  const { spec: rawSpec, options } = normalizeSpec(raw)
  const source = isPathSpec(rawSpec) ? "file" : "npm"
  const deprecated = DEPRECATED_PLUGINS.some((d) => rawSpec.includes(d))

  if (!rawSpec || typeof rawSpec !== "string") {
    return {
      item: { spec: String(rawSpec), options, source, deprecated },
      error: { type: "invalid_spec", spec: String(rawSpec) },
    }
  }

  const spec = source === "file" ? resolvePath(rawSpec, configPath) : rawSpec

  return {
    item: { spec, options, source, deprecated },
  }
}

export function readPluginConfig(configPath: string): PluginConfigResult {
  let content: string
  try {
    content = readFileSync(configPath, "utf8")
  } catch {
    return { items: [], errors: [{ type: "file_not_found", path: configPath }] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    return {
      items: [],
      errors: [{ type: "malformed_json", path: configPath, cause: e instanceof Error ? e.message : String(e) }],
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      items: [],
      errors: [{ type: "malformed_json", path: configPath, cause: "Expected array" }],
    }
  }

  const items: PluginConfigItem[] = []
  const errors: PluginConfigError[] = []
  const seenSpecs = new Set<string>()

  for (const raw of parsed) {
    const { item, error } = parseConfigItem(raw as PluginSpec, configPath)
    if (error) {
      errors.push(error)
      continue
    }

    if (item.options.enabled === false) {
      continue
    }

    if (seenSpecs.has(item.spec)) {
      errors.push({ type: "duplicate_spec", spec: item.spec })
      continue
    }

    seenSpecs.add(item.spec)
    items.push(item)
  }

  return { items, errors }
}

export function pluginSource(spec: string): "file" | "npm" {
  return isPathSpec(spec) ? "file" : "npm"
}
