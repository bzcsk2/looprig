import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { execSync } from "node:child_process"
import { createHash } from "node:crypto"

export interface ToolEntry {
  name: string
  pinnedVersion: string
  downloadUrl: string
  sha256: string
  binaryName: string
  archiveType: "tar.gz" | "zip" | "none"
  archiveBinaryPath: string
}

const TOOLCHAIN_ROOT = join(homedir(), ".covalo", "toolchains")
const PROFILE_DIR = "benchmark-node"

function formatUrl(template: string, version: string): string {
  return template.replace(/\{\{version\}\}/g, version)
}

const TOOL_MANIFEST: ToolEntry[] = [
  {
    name: "node",
    pinnedVersion: "22.17.0",
    downloadUrl: "https://nodejs.org/dist/v{{version}}/node-v{{version}}-linux-x64.tar.gz",
    sha256: "0fa01328a0f3d10800623f7107fbcd654a60ec178fab1ef5b9779e94e0419e1a",
    binaryName: "node",
    archiveType: "tar.gz",
    archiveBinaryPath: "node-v{{version}}-linux-x64/bin/node",
  },
  {
    name: "bun",
    pinnedVersion: "1.3.1",
    downloadUrl: "https://github.com/oven-sh/bun/releases/download/bun-v{{version}}/bun-linux-x64.zip",
    sha256: "400824c82bfcc0854365bcada11cf53d7384ecb1e2c3da0e2c0a2c6a527d5629",
    binaryName: "bun",
    archiveType: "zip",
    archiveBinaryPath: "bun-linux-x64/bun",
  },
  {
    name: "rg",
    pinnedVersion: "14.1.1",
    downloadUrl: "https://github.com/BurntSushi/ripgrep/releases/download/{{version}}/ripgrep-{{version}}-x86_64-unknown-linux-musl.tar.gz",
    sha256: "4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e",
    binaryName: "rg",
    archiveType: "tar.gz",
    archiveBinaryPath: "ripgrep-{{version}}-x86_64-unknown-linux-musl/rg",
  },
  {
    name: "jq",
    pinnedVersion: "1.7.1",
    downloadUrl: "https://github.com/jqlang/jq/releases/download/jq-{{version}}/jq-linux-amd64",
    sha256: "5942c9b0934e510ee61eb3e30273f1b3fe2590df93933a93d7c58b81d19c8ff5",
    binaryName: "jq",
    archiveType: "none",
    archiveBinaryPath: "",
  },
]

function getProfileDir(): string {
  return join(TOOLCHAIN_ROOT, PROFILE_DIR)
}

function toolDir(name: string): string {
  return join(getProfileDir(), name, getPinnedVersion(name))
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const resp = await fetch(url, { headers: { "User-Agent": "covalo-toolchain/1.0" } })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url.slice(0, 80)}`)
  }
  const buffer = Buffer.from(await resp.arrayBuffer())
  await writeFile(dest, buffer)
}

function verifySha256(filePath: string, expected: string): boolean {
  const hash = createHash("sha256")
  const data = readFileSync(filePath)
  hash.update(data)
  return hash.digest("hex") === expected
}

function getPinnedVersion(name: string): string {
  const entry = TOOL_MANIFEST.find((t) => t.name === name)
  return entry?.pinnedVersion ?? "unknown"
}

function getEntry(name: string): ToolEntry | undefined {
  return TOOL_MANIFEST.find((t) => t.name === name)
}

function installedBinaryRelativePath(entry: ToolEntry): string {
  if (entry.archiveType === "tar.gz") {
    const parts = formatUrl(entry.archiveBinaryPath, entry.pinnedVersion).split("/").filter(Boolean)
    return parts.slice(1).join("/") || entry.binaryName
  }
  return entry.binaryName
}

export function getInstalledBinaryPath(name: string): string | null {
  const entry = getEntry(name)
  if (!entry) return null
  return join(toolDir(name), installedBinaryRelativePath(entry))
}

export function getInstalledVersion(name: string): string | null {
  const binary = getInstalledBinaryPath(name)
  if (!binary) return null
  if (!existsSync(binary)) return null
  try {
    return execSync(`${binary} --version 2>/dev/null`, { encoding: "utf-8" }).toString().trim()
  } catch {
    return null
  }
}

export function isToolInstalled(name: string): boolean {
  const binary = getInstalledBinaryPath(name)
  return !!binary && existsSync(binary)
}

export async function ensureTool(name: string): Promise<string> {
  const entry = TOOL_MANIFEST.find((t) => t.name === name)
  if (!entry) throw new Error(`Unknown tool: ${name}`)

  const installed = getInstalledVersion(name)
  if (installed) return toolDir(name)

  const dlDir = join(getProfileDir(), name)
  mkdirSync(dlDir, { recursive: true })

  const url = formatUrl(entry.downloadUrl, entry.pinnedVersion)
  const fileName = url.split("/").pop() ?? `${name}.bin`

  console.error(`[installer] Downloading ${name}@${entry.pinnedVersion}...`)
  const tmpFile = join(dlDir, fileName)
  await downloadFile(url, tmpFile)

  if (entry.sha256) {
    if (!verifySha256(tmpFile, entry.sha256)) {
      execSync(`rm -f "${tmpFile}"`, { stdio: "pipe" })
      throw new Error(`SHA256 mismatch for ${name}: expected ${entry.sha256}`)
    }
    console.error(`[installer] SHA256 verified for ${name}`)
  } else {
    console.error(`[installer] Warning: no SHA256 pinned for ${name}, skipping verification`)
  }

  const versionDir = join(dlDir, entry.pinnedVersion)
  mkdirSync(versionDir, { recursive: true })

  if (entry.archiveType === "none") {
    execSync(`cp "${tmpFile}" "${join(versionDir, name)}" && chmod +x "${join(versionDir, name)}"`, { stdio: "pipe" })
  } else if (entry.archiveType === "tar.gz") {
    const destDir = join(dlDir, "tmp-extract")
    mkdirSync(destDir, { recursive: true })
    execSync(`tar xzf "${tmpFile}" -C "${destDir}"`, { stdio: "pipe" })

    const binaryRel = formatUrl(entry.archiveBinaryPath, entry.pinnedVersion)
    const binarySrc = join(destDir, binaryRel)
    if (!existsSync(binarySrc)) {
      execSync(`rm -rf "${destDir}" "${tmpFile}"`, { stdio: "pipe" })
      throw new Error(`Binary ${binarySrc} not found in archive for ${name}`)
    }

    execSync(`cp -r "${join(destDir, binaryRel.split("/")[0])}/"* "${versionDir}/"`, { stdio: "pipe" })
    execSync(`rm -rf "${destDir}"`, { stdio: "pipe" })
  } else if (entry.archiveType === "zip") {
    const unzipPath = join(dlDir, "tmp-unzip")
    mkdirSync(unzipPath, { recursive: true })
    execSync(`unzip -q "${tmpFile}" -d "${unzipPath}"`, { stdio: "pipe" })

    const binaryRel = formatUrl(entry.archiveBinaryPath, entry.pinnedVersion)
    const binarySrc = join(unzipPath, binaryRel)
    if (!existsSync(binarySrc)) {
      execSync(`rm -rf "${unzipPath}" "${tmpFile}"`, { stdio: "pipe" })
      throw new Error(`Binary ${binarySrc} not found in zip for ${name}`)
    }

    execSync(`cp "${binarySrc}" "${join(versionDir, name)}" && chmod +x "${join(versionDir, name)}"`, { stdio: "pipe" })
    execSync(`rm -rf "${unzipPath}"`, { stdio: "pipe" })
  }

  execSync(`rm -f "${tmpFile}"`, { stdio: "pipe" })
  console.error(`[installer] Installed ${name}@${entry.pinnedVersion} to ${versionDir}`)

  return versionDir
}

export async function ensureToolchain(profile: string = PROFILE_DIR): Promise<string> {
  const profileDir = join(TOOLCHAIN_ROOT, profile)
  mkdirSync(profileDir, { recursive: true })

  for (const entry of TOOL_MANIFEST) {
    try {
      await ensureTool(entry.name)
    } catch (e) {
      console.error(`[installer] Failed to install ${entry.name}: ${e instanceof Error ? e.message : e}`)
    }
  }

  return profileDir
}

export function getToolchainPath(profile: string = PROFILE_DIR): string[] {
  const dirs = new Set<string>()
  for (const entry of TOOL_MANIFEST) {
    const binary = getInstalledBinaryPath(entry.name)
    if (binary && existsSync(binary)) dirs.add(dirname(binary))
  }
  return Array.from(dirs)
}

export function getToolchainInfo(): Record<string, { installed: boolean; path: string | null; version: string | null }> {
  const info: Record<string, { installed: boolean; path: string | null; version: string | null }> = {}
  for (const entry of TOOL_MANIFEST) {
    const binary = getInstalledBinaryPath(entry.name)
    const exists = !!binary && existsSync(binary)
    const version = exists ? getInstalledVersion(entry.name) : null
    info[entry.name] = {
      installed: exists,
      path: exists ? binary : null,
      version,
    }
  }
  return info
}

export interface BenchmarkToolchainStatus {
  ready: boolean
  missingTools: string[]
  missingSha256: string[]
  versionMismatches: Array<{ name: string; expected: string; actual: string | null }>
}

export function getBenchmarkToolchainStatus(): BenchmarkToolchainStatus {
  const missingTools: string[] = []
  const missingSha256: string[] = []
  const versionMismatches: Array<{ name: string; expected: string; actual: string | null }> = []

  for (const entry of TOOL_MANIFEST) {
    if (!entry.sha256.trim()) {
      missingSha256.push(entry.name)
    }
    const binary = getInstalledBinaryPath(entry.name)
    if (!binary || !existsSync(binary)) {
      missingTools.push(entry.name)
      continue
    }
    const version = getInstalledVersion(entry.name)
    if (!version || !version.includes(entry.pinnedVersion)) {
      versionMismatches.push({ name: entry.name, expected: entry.pinnedVersion, actual: version })
    }
  }

  return {
    ready: missingTools.length === 0 && missingSha256.length === 0 && versionMismatches.length === 0,
    missingTools,
    missingSha256,
    versionMismatches,
  }
}

export function cleanToolchain(profile: string = PROFILE_DIR): void {
  const dir = join(TOOLCHAIN_ROOT, profile)
  if (existsSync(dir)) {
    execSync(`rm -rf "${dir}"`, { stdio: "pipe" })
    console.error(`[installer] Removed toolchain at ${dir}`)
  }
}

export { TOOL_MANIFEST, TOOLCHAIN_ROOT, PROFILE_DIR }
