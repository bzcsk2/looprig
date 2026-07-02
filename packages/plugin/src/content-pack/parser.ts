import { readFileSync, existsSync, statSync } from "node:fs"
import { resolve } from "node:path"
import type { ContentPackManifest } from "./types.js"

export interface ParseResult {
  manifest?: ContentPackManifest
  error?: string
}

/**
 * Parse a manifest JSON file into a structured ContentPackManifest.
 * Does NOT auto-discover default directories (skills/, agents/, etc.).
 * Directory discovery is handled by the resolver based on whether ECC
 * install manifests exist.
 */
export function parseManifest(manifestPath: string, rootDir: string): ParseResult {
  try {
    const raw = readFileSync(manifestPath, "utf8")
    const data = JSON.parse(raw)

    if (typeof data !== "object" || data === null) {
      return { error: "Manifest is not an object" }
    }

    const id = data.id ?? data.name ?? rootDir.split("/").pop() ?? "unknown"
    const name = data.name ?? id

    // Parse manifest-declared assets only (no directory discovery)
    const skillDirs: string[] = []
    const agentFiles: string[] = []
    const ruleFiles: string[] = []
    const commandFiles: string[] = []

    if (Array.isArray(data.skills)) {
      for (const s of data.skills) {
        if (typeof s === "string") {
          const p = resolve(rootDir, s)
          if (existsSync(p) && statSync(p).isDirectory()) {
            skillDirs.push(p)
          }
        }
      }
    }
    if (Array.isArray(data.agents)) {
      for (const a of data.agents) {
        if (typeof a === "string") {
          agentFiles.push(resolve(rootDir, a))
        }
      }
    }
    if (Array.isArray(data.rules)) {
      for (const r of data.rules) {
        if (typeof r === "string") {
          ruleFiles.push(resolve(rootDir, r))
        }
      }
    }
    if (Array.isArray(data.commands)) {
      for (const c of data.commands) {
        if (typeof c === "string") {
          commandFiles.push(resolve(rootDir, c))
        }
      }
    }

    // Hook files
    const hookFiles: string[] = []
    if (Array.isArray(data.hooks)) {
      for (const h of data.hooks) {
        if (typeof h === "string") {
          hookFiles.push(resolve(rootDir, h))
        }
      }
    }

    // MCP servers from manifest or .mcp.json
    // Support three forms: string path, string path array, inline object
    const mcpServers: string[] = []
    if (data.mcpServers) {
      if (typeof data.mcpServers === "string") {
        mcpServers.push(resolve(rootDir, data.mcpServers))
      } else if (Array.isArray(data.mcpServers)) {
        for (const s of data.mcpServers) {
          if (typeof s === "string") {
            mcpServers.push(resolve(rootDir, s))
          }
        }
      } else if (typeof data.mcpServers === "object") {
        // Inline MCP server config — store as manifest reference
        mcpServers.push("__inline__:" + manifestPath)
      }
    }
    // .mcp.json is a standard location
    const mcpJsonPath = resolve(rootDir, ".mcp.json")
    if (existsSync(mcpJsonPath)) {
      mcpServers.push(mcpJsonPath)
    }

    const sourceKind = manifestPath.includes("covalo") ? "covalo"
      : manifestPath.includes("codex") ? "codex"
      : "claude"

    return {
      manifest: {
        id,
        name,
        rootDir,
        sourceManifestPath: manifestPath,
        sourceKind,
        skillDirs,
        agentFiles,
        ruleFiles,
        commandFiles,
        hookFiles: hookFiles.length > 0 ? hookFiles : undefined,
        mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
        profiles: data.profiles ?? data.installProfiles,
        modules: data.modules ?? data.installModules,
        components: data.components ?? data.installComponents,
        metadata: data,
      },
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
