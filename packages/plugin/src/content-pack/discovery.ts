import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve, join, dirname } from "node:path"
import type { ContentPackManifest, ManifestSourceKind } from "./types.js"

const MANIFEST_NAMES = [
  ".covalo-plugin.json",
  "covalo-plugin.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
]

export function findManifest(specPath: string): { manifestPath?: string; sourceKind?: ManifestSourceKind } {
  for (const name of MANIFEST_NAMES) {
    const fullPath = resolve(specPath, name)
    if (existsSync(fullPath)) {
      const kind = name.includes("covalo") ? "covalo" : name.includes("codex") ? "codex" : "claude"
      return { manifestPath: fullPath, sourceKind: kind }
    }
  }
  return {}
}

export function isDirectory(specPath: string): boolean {
  try {
    return statSync(specPath).isDirectory()
  } catch {
    return false
  }
}

export function lookUpNpmPackage(name: string): string | null {
  try {
    const resolved = require.resolve(join(name, "package.json"))
    return dirname(resolved)
  } catch {
    return null
  }
}
