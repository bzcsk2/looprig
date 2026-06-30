import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { initDefaultProviders, diagnoseEnvironment } from "@deepreef/core"
import { resolveEvalEnvironment } from "@deepreef/core/sandbox/types.js"
import {
  ensureTool,
  isToolInstalled,
  getInstalledVersion,
  getToolchainInfo,
  getToolManifest,
  cleanToolchain,
  getBenchmarkToolchainStatus,
} from "@deepreef/core/eval/profile/index.js"

interface ToolCheck {
  name: string
  found: boolean
  version?: string
  path?: string
  source?: "managed" | "host" | "fallback" | "missing"
  expected?: string
}

async function checkTool(name: string, expected?: string): Promise<ToolCheck> {
  try {
    const out = execSync(`command -v ${name} 2>/dev/null`, { encoding: "utf-8", stdio: "pipe" }).toString().trim()
    if (!out) return { name, found: false, source: "missing" }
    let version = ""
    try {
      const v = execSync(`${name} --version 2>/dev/null`, { encoding: "utf-8", stdio: "pipe" }).toString().trim()
      version = v.split("\n")[0] ?? ""
    } catch {}
    return { name, found: true, version: version || "ok", path: out, source: "host", expected }
  } catch {
    return { name, found: false, source: "missing", expected }
  }
}

function checkBwrap(): ToolCheck {
  const paths = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", join(homedir(), ".looprig", "bin", "bwrap")]
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const v = execSync(`${p} --version 2>/dev/null`, { encoding: "utf-8", stdio: "pipe" }).toString().trim()
        return { name: "bwrap", found: true, version: v || "ok", path: p, source: "managed" }
      } catch {
        return { name: "bwrap", found: true, path: p, source: "managed" }
      }
    }
  }
  try {
    const out = execSync("command -v bwrap 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).toString().trim()
    if (out) {
      const v = execSync("bwrap --version 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).toString().trim()
      return { name: "bwrap", found: true, version: v || "ok", path: out, source: "host" }
    }
  } catch {}
  return { name: "bwrap", found: false, source: "missing", expected: "system or bundled" }
}


export async function evalDoctor(args: string[]): Promise<void> {
  const jsonOutput = args.includes("--json")
  initDefaultProviders()

  const toolchainInfo = getToolchainInfo()
  const benchmarkToolchainStatus = getBenchmarkToolchainStatus()

  const benchmarkDiag = await diagnoseEnvironment("sandbox.benchmark" as any)
  const localDiag = await diagnoseEnvironment("sandbox.local" as any)

  const benchmarkTools: ToolCheck[] = await Promise.all([
    checkBwrap(),
    checkTool("node", "22.17.0"),
    checkTool("bun", "1.3.1"),
    checkTool("python3"),
    checkTool("git", "2.45.x"),
    checkTool("rg", "14.1.1"),
    checkTool("jq", "1.7.1"),
  ])

  const localTools: ToolCheck[] = await Promise.all([
    checkTool("node"),
    checkTool("bun"),
    checkTool("python3"),
    checkTool("git"),
    checkTool("rg"),
    checkTool("jq"),
  ])

  // Merge managed toolchain info into the checks
  const managedToolNames = new Set(["node", "bun", "rg", "jq"])
  for (const t of benchmarkTools) {
    if (managedToolNames.has(t.name)) {
      const tc = toolchainInfo[t.name]
      if (tc?.installed) {
        t.found = true
        t.source = "managed"
        t.version = tc.version ?? t.version
        t.path = tc.path ?? t.path
      } else {
        // Reset host-found managed tools so officialScore requires managed install
        t.found = false
        t.source = "missing"
      }
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({
      environments: {
        "sandbox.benchmark": {
          provider: benchmarkDiag,
          tools: benchmarkTools,
          toolchain: toolchainInfo,
          networkIsolation: benchmarkDiag.providerId === "bwrap",
          officialScore: benchmarkDiag.official && benchmarkToolchainStatus.ready,
          benchmarkToolchainStatus,
        },
        "sandbox.local": {
          provider: localDiag,
          tools: localTools,
          networkIsolation: localDiag.providerId === "bwrap",
          officialScore: false,
        },
      },
    }, null, 2))
    return
  }

  console.log("LoopRig Eval Doctor\n")

  console.log("sandbox.benchmark:")
  console.log(`  provider:        ${benchmarkDiag.available ? benchmarkDiag.providerId : "unavailable"} ${benchmarkDiag.official ? "(official)" : "(diagnostic)"}`)
  for (const t of benchmarkTools) {
    const status = t.found ? (t.source === "managed" ? "installed" : "found") : "missing"
    const version = t.version ? ` ${t.version}` : ""
    const expected = t.expected ? ` (expected: ${t.expected})` : ""
    console.log(`  ${t.name.padEnd(20)} ${status}${version}${expected}`)
  }
  const canBenchmark = benchmarkDiag.official && benchmarkToolchainStatus.ready
  if (canBenchmark) {
    console.log(`  ${"agent network off".padEnd(20)} supported (bwrap)`)
  }
  console.log()

  console.log("sandbox.local:")
  console.log(`  provider:        ${localDiag.available ? localDiag.providerId : "unavailable"}`)
  for (const t of localTools) {
    const status = t.found ? `host ${t.version || ""}` : "missing" + (t.name === "rg" || t.name === "jq" ? " (optional)" : "")
    console.log(`  ${t.name.padEnd(20)} ${status}`)
  }
  console.log()

  if (!benchmarkDiag.available && !localDiag.available) {
    console.log("⚠ No sandbox provider available. Eval will not run.")
  } else {
    console.log(benchmarkDiag.official ? "✓ Official benchmark scoring available" : "⚠ Diagnostic mode only")
  }
}

export async function evalPrepare(args: string[]): Promise<void> {
  const target = args[0]
  if (!target || (target !== "sandbox.benchmark" && target !== "sandbox.local")) {
    console.error("Usage: looprig eval prepare <sandbox.benchmark|sandbox.local>")
    process.exit(1)
  }

  const envId = resolveEvalEnvironment(target)
  initDefaultProviders()

  const diag = await diagnoseEnvironment(envId)
  if (!diag.available) {
    console.error(`Environment ${envId} is not available: ${diag.reason ?? "no provider"}`)
    process.exit(1)
  }

  console.log(`Preparing ${envId}...\n`)

  if (envId === "sandbox.benchmark") {
    const missingManaged = getToolManifest.filter((t) => !isToolInstalled(t.name))

    if (missingManaged.length === 0) {
      console.log("✓ Managed toolchain already installed at ~/.looprig/toolchains/benchmark-node/")
      return
    }

    console.log(`Downloading ${missingManaged.length} missing tools...\n`)
    for (const entry of missingManaged) {
      console.log(`  [${entry.name}] ensuring ${entry.name}@${entry.pinnedVersion}...`)
      try {
        await ensureTool(entry.name)
        const version = getInstalledVersion(entry.name)
        console.log(`  ✓ ${entry.name}@${version ?? entry.pinnedVersion} installed`)
      } catch (e) {
        console.error(`  ✗ Failed: ${e instanceof Error ? e.message : e}`)
      }
    }

    const stillMissing = getToolManifest.filter((t) => !isToolInstalled(t.name))
    if (stillMissing.length === 0) {
      console.log("\n✓ Benchmark toolchain ready at ~/.looprig/toolchains/benchmark-node/")
    } else {
      console.log(`\n⚠ ${stillMissing.length} tool(s) still missing: ${stillMissing.map((t) => t.name).join(", ")}`)
    }
  }

  if (envId === "sandbox.local") {
    const tools = await Promise.all([
      checkTool("node"),
      checkTool("bun"),
      checkTool("python3"),
      checkTool("git"),
    ])
    const missing = tools.filter(t => !t.found)
    if (missing.length > 0) {
      console.log("Missing required tools for sandbox.local:")
      for (const t of missing) {
        console.log(`  - ${t.name}`)
      }
      console.log()
      console.log("Install missing tools via your package manager and try again.")
    } else {
      console.log("✓ All required local tools are available on PATH.")
    }
    console.log()
    console.log("Environment ready for diagnostic eval runs.")
  }
}

export async function evalCleanToolchains(args: string[]): Promise<void> {
  const force = args.includes("--force")
  if (!force) {
    console.log("This will remove all managed toolchains at ~/.looprig/toolchains/")
    console.log("Run with --force to confirm.")
    return
  }
  cleanToolchain()
  console.log("✓ Managed toolchain removed")
}

export async function evalCommand(subcommand: string, args: string[]): Promise<void> {
  switch (subcommand) {
    case "doctor":
      await evalDoctor(args)
      break
    case "prepare":
      await evalPrepare(args)
      break
    case "clean-toolchains":
      await evalCleanToolchains(args)
      break
    default:
      console.log(`Usage:
  looprig eval doctor [--json]           Check eval environment health
  looprig eval prepare <env>             Prepare an eval environment
  looprig eval clean-toolchains [--force] Remove managed toolchains
`)
  }
}
