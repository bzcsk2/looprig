import { existsSync, readdirSync, statSync } from "node:fs"
import { resolve, basename } from "node:path"
import type {
  ContentPackManifest, ResolvedContentPack, ContentAsset,
  ContentPackDiagnostic, ContentPackPluginOptions, InstallModule,
} from "./types.js"
import { findManifest } from "./discovery.js"
import { parseManifest } from "./parser.js"
import { loadEccManifests } from "./ecc-manifests.js"
import { validateAssetPath } from "./path-security.js"

const DEFAULT_OPTIONS: ContentPackPluginOptions = {
  type: "auto",
  target: "covalo",
  targetMode: "compatible",
  skills: { enabled: true },
  agents: { enabled: true },
  rules: { enabled: true, mode: "system" },
  commands: { enabled: false, mode: "off" },
  hooks: { enabled: false },
  mcp: { enabled: false, allowStdio: true, allowHttp: false, allowNpx: false, allowPlaceholderEnv: false },
}

export function resolveContentPack(
  specPath: string,
  rawOptions: ContentPackPluginOptions,
): ResolvedContentPack {
  const options: ContentPackPluginOptions = { ...DEFAULT_OPTIONS, ...rawOptions }
  const diagnostics: ContentPackDiagnostic[] = []
  const pluginId = specPath.split("/").pop() ?? "unknown"

  // Find manifest
  const { manifestPath, sourceKind } = findManifest(specPath)
  if (!manifestPath) {
    diagnostics.push({ type: "error", pluginId, message: "No manifest file found" })
    return emptyResult(pluginId, specPath, options, diagnostics)
  }

  const result = parseManifest(manifestPath, specPath)
  if (result.error || !result.manifest) {
    diagnostics.push({ type: "error", pluginId, message: `Failed to parse manifest: ${result.error}` })
    return emptyResult(pluginId, specPath, options, diagnostics)
  }

  const manifest = result.manifest

  // Load ECC-specific manifests if available
  const ecc = loadEccManifests(specPath)
  diagnostics.push(...ecc.diagnostics)

  const mergedProfiles = manifest.profiles ?? ecc.profiles
  const mergedModules = manifest.modules ?? ecc.modules
  const mergedComponents = manifest.components ?? ecc.components

  // Determine whether we're in ECC selective-install mode
  const hasEcc = (mergedProfiles !== undefined) || (mergedModules !== undefined)

  // Select modules based on profile + include/exclude
  const selectedModules = selectModules(mergedProfiles, mergedModules, mergedComponents, options, hasEcc, pluginId, diagnostics)

  // Resolve module paths to assets
  const assets = resolveAssets(manifest, selectedModules, mergedModules, options, hasEcc, pluginId, diagnostics)

  return {
    id: manifest.id,
    name: manifest.name,
    rootDir: specPath,
    profile: options.profile,
    modules: [...selectedModules],
    components: [...(options.include ?? [])],
    assets,
    options,
    diagnostics,
  }
}

function selectModules(
  profiles: any,
  modules: any,
  components: any,
  options: ContentPackPluginOptions,
  hasEcc: boolean,
  pluginId: string,
  diagnostics: ContentPackDiagnostic[],
): Set<string> {
  const selected = new Set<string>()

  if (profiles) {
    // Resolve profile name: use explicit option, or default to "developer" for ECC
    const profileName = options.profile ?? (hasEcc ? "developer" : undefined)

    if (profileName) {
      // Support both old array format and new object-map format
      if (typeof profiles.profiles === "object" && !Array.isArray(profiles.profiles)) {
        // Object map format (real ECC)
        const entry = profiles.profiles[profileName]
        if (entry && Array.isArray(entry.modules)) {
          for (const m of entry.modules) selected.add(m)
        } else {
          diagnostics.push({
            type: "warn",
            pluginId,
            message: `Profile "${profileName}" not found in install-profiles.json`,
          })
        }
      } else if (Array.isArray(profiles.profiles)) {
        // Legacy array format (backwards compat)
        const profile = profiles.profiles.find((p: any) => p.id === profileName)
        if (profile) {
          for (const m of profile.modules ?? []) selected.add(m)
        } else {
          diagnostics.push({
            type: "warn",
            pluginId,
            message: `Profile "${profileName}" not found`,
          })
        }
      }
    }
  }

  // Direct module options (always respected)
  for (const m of options.modules ?? []) selected.add(m)

  // Include components
  if (components && options.include) {
    const compList = Array.isArray(components.components) ? components.components : []
    for (const compId of options.include) {
      const comp = compList.find((c: any) => c.id === compId)
      if (comp) {
        for (const m of comp.modules ?? []) selected.add(m)
      } else {
        diagnostics.push({
          type: "warn",
          pluginId,
          message: `Include component "${compId}" not found`,
        })
      }
    }
  }

  // Expand dependencies
  if (modules && Array.isArray(modules.modules)) {
    const moduleList: InstallModule[] = modules.modules
    const deps = new Set<string>()
    for (const mId of selected) {
      expandDeps(mId, moduleList, selected, deps)
    }
    for (const d of deps) selected.add(d)

    // Check for unknown modules
    for (const mId of selected) {
      const mod = moduleList.find((m) => m.id === mId)
      if (!mod) {
        diagnostics.push({
          type: "warn",
          pluginId,
          message: `Module "${mId}" not found in install-modules.json`,
        })
      }
    }
  }

  // Exclude components
  if (components && options.exclude) {
    const compList = Array.isArray(components.components) ? components.components : []
    for (const compId of options.exclude) {
      const comp = compList.find((c: any) => c.id === compId)
      if (comp) {
        for (const m of comp.modules ?? []) selected.delete(m)
        diagnostics.push({
          type: "info",
          pluginId,
          message: `Excluded component "${compId}" (modules: ${comp.modules?.join(", ")})`,
        })
      } else {
        diagnostics.push({
          type: "warn",
          pluginId,
          message: `Exclude component "${compId}" not found`,
        })
      }
    }
  }

  // Filter by target
  const targetMode = options.targetMode ?? "compatible"
  const target = options.target ?? "covalo"
  if (modules && Array.isArray(modules.modules)) {
    for (const mId of [...selected]) {
      const mod = modules.modules.find((m: any) => m.id === mId)
      if (mod && mod.targets && Array.isArray(mod.targets) && mod.targets.length > 0) {
        const isTargeted = mod.targets.includes(target)
        if (targetMode === "strict" && !isTargeted) {
          selected.delete(mId)
          diagnostics.push({
            type: "info",
            pluginId,
            message: `Module "${mId}" skipped: strict mode, not compatible with target "${target}"`,
          })
        } else if (targetMode === "compatible" && !isTargeted) {
          // In compatible mode, include but warn
          diagnostics.push({
            type: "info",
            pluginId,
            message: `Module "${mId}" included in compatible mode (targets: ${mod.targets.join(", ")})`,
          })
        }
      }
    }
  }

  return selected
}

function expandDeps(mId: string, allModules: InstallModule[], alreadySelected: Set<string>, deps: Set<string>): void {
  const mod = allModules.find((m) => m.id === mId)
  if (!mod || !mod.dependencies) return
  for (const dep of mod.dependencies) {
    if (!deps.has(dep) && !alreadySelected.has(dep)) {
      deps.add(dep)
      expandDeps(dep, allModules, alreadySelected, deps)
    }
  }
}

function resolveAssets(
  manifest: ContentPackManifest,
  selectedModules: Set<string>,
  allModules: any,
  options: ContentPackPluginOptions,
  hasEcc: boolean,
  pluginId: string,
  diagnostics: ContentPackDiagnostic[],
): ResolvedContentPack["assets"] {
  const assets: ResolvedContentPack["assets"] = {
    skills: [],
    agents: [],
    rules: [],
    commands: [],
    hooks: [],
    mcp: [],
  }

  const rootDir = manifest.rootDir

  if (hasEcc && selectedModules.size > 0) {
    // === ECC MODE: assets come ONLY from selected module paths ===
    const moduleList: InstallModule[] = (allModules && Array.isArray(allModules.modules))
      ? allModules.modules
      : []

    for (const mod of moduleList) {
      if (!selectedModules.has(mod.id)) continue
      if (!mod.paths || !Array.isArray(mod.paths)) continue

      for (const relativePath of mod.paths) {
        const fullPath = resolve(rootDir, relativePath)

        // Path security check
        const validation = validateAssetPath(fullPath, rootDir, "module path", `${mod.id}/${relativePath}`, pluginId)
        if (!validation.isValid) {
          diagnostics.push(validation.diagnostic!)
          continue
        }

        // Classify by module.kind
        classifyModulePath(mod.kind ?? "unknown", validation.resolvedPath, mod.id, assets, options, rootDir, pluginId, diagnostics)
      }
    }
  } else {
    // === STANDARD MODE: use manifest-declared paths + default directory discovery ===
    const skillDirs = new Set(manifest.skillDirs)
    const agentFiles = new Set(manifest.agentFiles)
    const ruleFiles = new Set(manifest.ruleFiles)
    const commandFiles = new Set(manifest.commandFiles)

    // Discover default directories (standard Claude/Codex behavior)
    discoverDefaultDirs(rootDir, skillDirs, agentFiles, ruleFiles, commandFiles)

    // Skills
    for (const dir of skillDirs) {
      const validation = validateAssetPath(dir, rootDir, "skill", dir, pluginId)
      if (!validation.isValid) {
        diagnostics.push(validation.diagnostic!)
        continue
      }
      if (options.skills?.enabled !== false) {
        assets.skills.push({
          kind: "skill",
          id: dir,
          path: validation.resolvedPath,
          sourcePluginId: pluginId,
          enabledByDefault: true,
        })
      }
    }

    // Agents
    for (const file of agentFiles) {
      const validation = validateAssetPath(file, rootDir, "agent", file, pluginId)
      if (!validation.isValid) {
        diagnostics.push(validation.diagnostic!)
        continue
      }
      if (options.agents?.enabled !== false) {
        const id = basename(file).replace(/\.md$/i, "") ?? "unknown"
        assets.agents.push({
          kind: "agent",
          id,
          path: validation.resolvedPath,
          sourcePluginId: pluginId,
          enabledByDefault: true,
        })
      }
    }

    // Rules
    sortAndAddFileAssets(ruleFiles, "rule", assets.rules, rootDir, options.rules?.enabled !== false, pluginId, diagnostics)

    // Commands
    for (const file of commandFiles) {
      const validation = validateAssetPath(file, rootDir, "command", file, pluginId)
      if (!validation.isValid) {
        diagnostics.push(validation.diagnostic!)
        continue
      }
      if (options.commands?.enabled === true) {
        const id = basename(file).replace(/\.md$/i, "") ?? "unknown"
        assets.commands.push({
          kind: "command",
          id,
          path: validation.resolvedPath,
          sourcePluginId: pluginId,
          enabledByDefault: true,
        })
      }
    }

    // Hooks
    for (const file of manifest.hookFiles ?? []) {
      const validation = validateAssetPath(file, rootDir, "hook", file, pluginId)
      if (!validation.isValid) {
        diagnostics.push(validation.diagnostic!)
        continue
      }
      // Hooks are always added to the asset list (for inspection) but execution is controlled by options.hooks.enabled
      assets.hooks.push({
        kind: "hook",
        id: file,
        path: validation.resolvedPath,
        sourcePluginId: pluginId,
        enabledByDefault: false,
      })
    }

    // MCP
    for (const src of manifest.mcpServers ?? []) {
      const resolvedSrc = src.startsWith("__inline__:") ? src.replace("__inline__:", "") : src
      const validation = validateAssetPath(resolvedSrc, rootDir, "mcp", src, pluginId)
      if (!validation.isValid) {
        diagnostics.push(validation.diagnostic!)
        continue
      }
      assets.mcp.push({
        kind: "mcp",
        id: src,
        path: validation.resolvedPath,
        sourcePluginId: pluginId,
        enabledByDefault: false,
      })
    }
  }

  return assets
}

/**
 * Classify a module path into the appropriate asset category based on module kind.
 */
function classifyModulePath(
  kind: string,
  fullPath: string,
  moduleId: string,
  assets: ResolvedContentPack["assets"],
  options: ContentPackPluginOptions,
  rootDir: string,
  pluginId: string,
  diagnostics: ContentPackDiagnostic[],
): void {
  switch (kind) {
    case "skills":
      if (options.skills?.enabled !== false) {
        if (isDirectorySafe(fullPath)) {
          assets.skills.push({
            kind: "skill",
            id: fullPath,
            path: fullPath,
            sourcePluginId: pluginId,
            moduleId,
            enabledByDefault: true,
          })
        }
      }
      break

    case "agents":
      if (options.agents?.enabled !== false) {
        discoverAgentFiles(fullPath, moduleId, assets, pluginId, diagnostics)
      }
      break

    case "rules":
      if (options.rules?.enabled !== false) {
        discoverRuleFiles(fullPath, moduleId, assets, pluginId, diagnostics)
      }
      break

    case "commands":
      if (options.commands?.enabled === true) {
        discoverCommandFiles(fullPath, moduleId, assets, pluginId, diagnostics)
      }
      break

    case "hooks":
      // Always add hooks for inspection; execution controlled by options.hooks.enabled
      discoverHookFiles(fullPath, moduleId, assets, pluginId, diagnostics)
      break

    case "platform":
      // Platform modules can contain MCP configs, skills, agents
      discoverPlatformAssets(fullPath, moduleId, assets, options, pluginId, diagnostics)
      break

    case "orchestration":
      // Orchestration can contain commands, scripts, skills
      if (options.commands?.enabled === true) {
        discoverCommandFiles(fullPath, moduleId, assets, pluginId, diagnostics)
      }
      break

    case "docs":
      // Documentation only — not loaded as assets
      break

    default:
      diagnostics.push({
        type: "warn",
        pluginId,
        message: `Unknown module kind "${kind}" for module "${moduleId}"`,
      })
      break
  }
}

function discoverDefaultDirs(
  rootDir: string,
  skillDirs: Set<string>,
  agentFiles: Set<string>,
  ruleFiles: Set<string>,
  commandFiles: Set<string>,
): void {
  const defaultSkillsDir = resolve(rootDir, "skills")
  if (existsSync(defaultSkillsDir)) {
    skillDirs.add(defaultSkillsDir)
  }
  const defaultAgentsDir = resolve(rootDir, "agents")
  if (existsSync(defaultAgentsDir)) {
    try {
      for (const f of readdirSync(defaultAgentsDir)) {
        if (f.endsWith(".md")) {
          agentFiles.add(resolve(defaultAgentsDir, f))
        }
      }
    } catch { /* no-op */ }
  }
  const defaultRulesDir = resolve(rootDir, "rules")
  if (existsSync(defaultRulesDir)) {
    try {
      for (const f of readdirSync(defaultRulesDir)) {
        ruleFiles.add(resolve(defaultRulesDir, f))
      }
    } catch { /* no-op */ }
  }
  const defaultCommandsDir = resolve(rootDir, "commands")
  if (existsSync(defaultCommandsDir)) {
    try {
      for (const f of readdirSync(defaultCommandsDir)) {
        if (f.endsWith(".md")) {
          commandFiles.add(resolve(defaultCommandsDir, f))
        }
      }
    } catch { /* no-op */ }
  }
}

function discoverAgentFiles(
  fullPath: string,
  moduleId: string,
  assets: ResolvedContentPack["assets"],
  pluginId: string,
  diagnostics: ContentPackDiagnostic[],
): void {
  if (!existsSync(fullPath)) return
  if (isDirectorySafe(fullPath)) {
    try {
      for (const f of readdirSync(fullPath)) {
        if (f.endsWith(".md")) {
          const filePath = resolve(fullPath, f)
          const validation = validateAssetPath(filePath, fullPath, "agent", f, pluginId)
          if (!validation.isValid) { diagnostics.push(validation.diagnostic!); continue }
          const id = f.replace(/\.md$/i, "")
          assets.agents.push({
            kind: "agent",
            id,
            path: validation.resolvedPath,
            sourcePluginId: pluginId,
            moduleId,
            enabledByDefault: true,
          })
        }
      }
    } catch { /* no-op */ }
  } else if (fullPath.endsWith(".md")) {
    const id = basename(fullPath).replace(/\.md$/i, "")
    assets.agents.push({
      kind: "agent",
      id,
      path: fullPath,
      sourcePluginId: pluginId,
      moduleId,
      enabledByDefault: true,
    })
  }
}

function discoverRuleFiles(
  fullPath: string,
  moduleId: string,
  assets: ResolvedContentPack["assets"],
  pluginId: string,
  diagnostics: ContentPackDiagnostic[],
): void {
  if (!existsSync(fullPath)) return
  if (isDirectorySafe(fullPath)) {
    try {
      for (const f of readdirSync(fullPath)) {
        const filePath = resolve(fullPath, f)
        if (statSyncSafe(filePath)?.isFile()) {
          const validation = validateAssetPath(filePath, fullPath, "rule", f, pluginId)
          if (!validation.isValid) { diagnostics.push(validation.diagnostic!); continue }
          assets.rules.push({
            kind: "rule",
            id: f,
            path: validation.resolvedPath,
            sourcePluginId: pluginId,
            moduleId,
            enabledByDefault: true,
          })
        }
      }
    } catch { /* no-op */ }
  } else {
    assets.rules.push({
      kind: "rule",
      id: basename(fullPath),
      path: fullPath,
      sourcePluginId: pluginId,
      moduleId,
      enabledByDefault: true,
    })
  }
}

function discoverCommandFiles(
  fullPath: string,
  moduleId: string,
  assets: ResolvedContentPack["assets"],
  pluginId: string,
  diagnostics: ContentPackDiagnostic[],
): void {
  if (!existsSync(fullPath)) return
  if (isDirectorySafe(fullPath)) {
    try {
      for (const f of readdirSync(fullPath)) {
        if (f.endsWith(".md")) {
          const filePath = resolve(fullPath, f)
          const validation = validateAssetPath(filePath, fullPath, "command", f, pluginId)
          if (!validation.isValid) { diagnostics.push(validation.diagnostic!); continue }
          const id = f.replace(/\.md$/i, "")
          assets.commands.push({
            kind: "command",
            id,
            path: validation.resolvedPath,
            sourcePluginId: pluginId,
            moduleId,
            enabledByDefault: true,
          })
        }
      }
    } catch { /* no-op */ }
  }
}

function discoverHookFiles(
  fullPath: string,
  moduleId: string,
  assets: ResolvedContentPack["assets"],
  pluginId: string,
  diagnostics: ContentPackDiagnostic[],
): void {
  if (!existsSync(fullPath)) return
  if (isDirectorySafe(fullPath)) {
    // Look for hooks.json in this directory
    const hooksJsonPath = resolve(fullPath, "hooks.json")
    if (existsSync(hooksJsonPath)) {
      const validation = validateAssetPath(hooksJsonPath, fullPath, "hook", "hooks.json", pluginId)
      if (validation.isValid) {
        assets.hooks.push({
          kind: "hook",
          id: `hooks:${moduleId}`,
          path: validation.resolvedPath,
          sourcePluginId: pluginId,
          moduleId,
          enabledByDefault: false,
        })
      } else {
        diagnostics.push(validation.diagnostic!)
      }
    }
    // Also look for individual JSON hook files
    try {
      for (const f of readdirSync(fullPath)) {
        if (f.endsWith(".json")) {
          const filePath = resolve(fullPath, f)
          if (filePath !== hooksJsonPath) {
            const validation = validateAssetPath(filePath, fullPath, "hook", f, pluginId)
            if (validation.isValid) {
              assets.hooks.push({
                kind: "hook",
                id: f.replace(/\.json$/i, ""),
                path: validation.resolvedPath,
                sourcePluginId: pluginId,
                moduleId,
                enabledByDefault: false,
              })
            } else {
              diagnostics.push(validation.diagnostic!)
            }
          }
        }
      }
    } catch { /* no-op */ }
  }
}

function discoverPlatformAssets(
  fullPath: string,
  moduleId: string,
  assets: ResolvedContentPack["assets"],
  options: ContentPackPluginOptions,
  pluginId: string,
  diagnostics: ContentPackDiagnostic[],
): void {
  if (!existsSync(fullPath) || !isDirectorySafe(fullPath)) return

  try {
    for (const f of readdirSync(fullPath)) {
      const filePath = resolve(fullPath, f)
      if (f === ".mcp.json" || f === "mcp.json") {
        const validation = validateAssetPath(filePath, fullPath, "mcp", f, pluginId)
        if (validation.isValid) {
          assets.mcp.push({
            kind: "mcp",
            id: `${moduleId}:${f}`,
            path: validation.resolvedPath,
            sourcePluginId: pluginId,
            moduleId,
            enabledByDefault: false,
          })
        } else {
          diagnostics.push(validation.diagnostic!)
        }
      } else if (f === "plugin.json" || f.endsWith("-plugin.json")) {
        const validation = validateAssetPath(filePath, fullPath, "platform", f, pluginId)
        if (!validation.isValid) { diagnostics.push(validation.diagnostic!); continue }
        // Nested plugin manifest — could have MCP config
        try {
          const raw = require("node:fs").readFileSync(filePath, "utf8")
          const pluginData = JSON.parse(raw)
          if (pluginData.mcpServers) {
            if (typeof pluginData.mcpServers === "string") {
              const mcpResolved = resolve(fullPath, pluginData.mcpServers)
              const mcpValidation = validateAssetPath(mcpResolved, fullPath, "mcp", pluginData.mcpServers, pluginId)
              if (mcpValidation.isValid) {
                assets.mcp.push({
                  kind: "mcp",
                  id: `${moduleId}:mcp`,
                  path: mcpValidation.resolvedPath,
                  sourcePluginId: pluginId,
                  moduleId,
                  enabledByDefault: false,
                })
              } else {
                diagnostics.push(mcpValidation.diagnostic!)
              }
            }
          }
        } catch { /* no-op */ }
      }
    }
  } catch { /* no-op */ }
}

function sortAndAddFileAssets(
  files: Set<string>,
  kind: "rule",
  target: ContentAsset[],
  rootDir: string,
  enabled: boolean,
  pluginId: string,
  diagnostics: ContentPackDiagnostic[],
): void {
  // Sort by path for stable ordering
  const sorted = [...files].sort()
  for (const file of sorted) {
    const validation = validateAssetPath(file, rootDir, kind, file, pluginId)
    if (!validation.isValid) {
      diagnostics.push(validation.diagnostic!)
      continue
    }
    if (enabled) {
      const id = basename(file)
      target.push({
        kind,
        id,
        path: validation.resolvedPath,
        sourcePluginId: pluginId,
        enabledByDefault: true,
      })
    }
  }
}

function isDirectorySafe(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function statSyncSafe(p: string): import("node:fs").Stats | null {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

function emptyResult(
  id: string,
  rootDir: string,
  options: ContentPackPluginOptions,
  diagnostics: ContentPackDiagnostic[],
): ResolvedContentPack {
  return {
    id,
    name: id,
    rootDir,
    modules: [],
    components: [],
    assets: { skills: [], agents: [], rules: [], commands: [], hooks: [], mcp: [] },
    options,
    diagnostics,
  }
}
