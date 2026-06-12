/**
 * 验收命令输出摘要解析。
 *
 * DRF-40: 从 iceCoder verification-digest.ts 适配（MIT）
 * Source: iceCoder/src/harness/verification-digest.ts
 */

import { isHarnessVerificationCommand } from "./verification-command.js"

const VERIFICATION_TEST_CMD = /\b(npm\s+test|npm\s+run\s+test|vitest|npx\s+vitest)\b/i

/** @deprecated 使用 {@link isHarnessVerificationCommand} */
export function isVerificationCommand(command: string): boolean {
  return isHarnessVerificationCommand(command.trim())
}

/** 是否为 build 类验收命令 */
export function isBuildVerificationCommand(command: string): boolean {
  const c = command.toLowerCase()
  return /\bnpm\s+run\s+build\b/.test(c)
    || /\bnpx\s+tsc\b/.test(c)
    || /\btsc\s+--no-emit\b/.test(c)
    || /\bvite\s+build\b/.test(c)
    || /\bnode\s+.*vite.*build\b/.test(c)
}

/** 是否为 test 类验收命令 */
export function isTestVerificationCommand(command: string): boolean {
  return VERIFICATION_TEST_CMD.test(command.trim())
}

/**
 * 从 vitest / npm test 输出中提取简短失败摘要。
 */
export function parseVitestFailureDigest(output: string): string | null {
  const body = output.trim()
  if (!body) return null

  const lines = body.split(/\r?\n/)
  const failHeaders: string[] = []
  const assertions: string[] = []
  const hints: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (/^FAIL\b/i.test(trimmed) || /^❯\s/.test(trimmed)) {
      failHeaders.push(trimmed.slice(0, 200))
      continue
    }

    if (/AssertionError|Expected|expected.*to/i.test(trimmed)) {
      assertions.push(trimmed.slice(0, 240))
      continue
    }

    if (/\.test\.(ts|tsx|js|jsx)/i.test(trimmed) && /failed|error/i.test(trimmed)) {
      hints.push(trimmed.slice(0, 200))
    }
  }

  if (failHeaders.length === 0 && assertions.length === 0 && hints.length === 0) {
    const compact = body.replace(/\s+/g, " ").slice(0, 600)
    return compact.length > 20 ? compact : null
  }

  const parts: string[] = ["[Verification digest]"]
  if (failHeaders.length > 0) {
    parts.push("Failed suites / cases:")
    parts.push(...failHeaders.slice(0, 4).map(l => `- ${l}`))
  }
  if (assertions.length > 0) {
    parts.push("Assertions:")
    parts.push(...assertions.slice(0, 4).map(l => `- ${l}`))
  }
  if (hints.length > 0) {
    parts.push("Related:")
    parts.push(...hints.slice(0, 2).map(l => `- ${l}`))
  }

  return parts.join("\n")
}

/** 从 tsc / vite / rollup 输出中提取 build 失败摘要 */
export function parseBuildFailureDigest(output: string): string | null {
  const body = output.trim()
  if (!body) return null

  const lines = body.split(/\r?\n/)
  const errors: string[] = []
  const hints: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (/error TS\d+:/i.test(trimmed)
      || /^ERROR\b/i.test(trimmed)
      || /\[vite\].*error/i.test(trimmed)
      || /RollupError|Failed to compile|Build failed/i.test(trimmed)
      || /Cannot find module/i.test(trimmed)) {
      errors.push(trimmed.slice(0, 260))
      continue
    }

    if (/\.(ts|tsx|js|jsx)\(\d+,\d+\)/i.test(trimmed)) {
      hints.push(trimmed.slice(0, 220))
    }
  }

  if (errors.length === 0 && hints.length === 0) {
    const compact = body.replace(/\s+/g, " ").slice(0, 600)
    return compact.length > 20 ? `[Build digest]\n${compact}` : null
  }

  const parts: string[] = ["[Build digest]"]
  if (errors.length > 0) {
    parts.push("Errors:")
    parts.push(...errors.slice(0, 6).map(l => `- ${l}`))
  }
  if (hints.length > 0) {
    parts.push("Locations:")
    parts.push(...hints.slice(0, 4).map(l => `- ${l}`))
  }
  return parts.join("\n")
}

/**
 * 构造验收失败 digest（含下一步提示）。
 */
export function buildVerificationDigest(command: string, output: string): string | null {
  if (!isHarnessVerificationCommand(command)) return null

  const digest = isBuildVerificationCommand(command)
    ? parseBuildFailureDigest(output)
    : parseVitestFailureDigest(output)
  if (!digest) return null

  const shortCmd = command.length > 160 ? `${command.slice(0, 157)}...` : command
  const nextStep = isBuildVerificationCommand(command)
    ? "Next: read_file the reported source files; run npx tsc --noEmit if needed; fix TypeScript before rerunning build."
    : "Next: read_file the failing test and implementation; do not rewrite the same file without new evidence."

  return [
    digest,
    "",
    `Command: ${shortCmd}`,
    nextStep,
  ].join("\n")
}

/** 从 vitest 输出提取成功摘要 */
export function parseVitestSuccessSummary(output: string): string | null {
  const body = output.trim()
  if (!body) return null
  if (/\b(\d+\s+failed|FAIL\b|AssertionError)/i.test(body)) return null

  const filesMatch = body.match(/Test Files\s+(\d+)\s+passed\s*\((\d+)\)/i)
  const testsMatch = body.match(/Tests\s+(\d+)\s+passed\s*\((\d+)\)/i)
  if (!testsMatch) return null

  const tests = testsMatch[1]
  if (filesMatch) {
    return `${filesMatch[1]} files / ${tests} tests passed`
  }
  return `${tests} tests passed`
}

/** 从 Playwright / e2e 输出提取成功摘要 */
export function parsePlaywrightSuccessSummary(output: string): string | null {
  const body = output.trim()
  if (!body) return null
  if (/\b(failed|timed out|Test timeout)\b/i.test(body) && !/\b0 failed\b/i.test(body)) {
    return null
  }
  const match = body.match(/(\d+)\s+passed\s*(?:\(([^)]+)\))?/i)
  if (!match) return null
  const passed = match[1]
  const duration = match[2] ? ` in ${match[2]}` : ""
  return `${passed} e2e tests passed${duration}`
}

/** 从 vite / tsc 构建输出提取成功摘要 */
export function parseBuildSuccessSummary(output: string): string | null {
  const body = output.trim()
  if (!body) return null
  if (/\b(error TS\d+|RollupError|Build failed|ERROR\b)/i.test(body)) return null

  const match = body.match(/built in\s+([0-9.]+\s*[a-z]+)/i)
  if (match) return `build succeeded in ${match[1]}`
  if (/^\s*$/.test(body) || /Compiled successfully/i.test(body)) {
    return "build succeeded"
  }
  return null
}

function isPlaywrightOrE2ECommand(command: string): boolean {
  const c = command.toLowerCase()
  return /\b(playwright|cypress)\b/.test(c)
    || /\bnpm\s+run\s+test:e2e\b/.test(c)
    || /\b(pnpm|yarn)\s+(run\s+)?test:e2e\b/.test(c)
}

/**
 * 构造验收命令成功摘要（一行）。
 */
export function buildVerificationSuccessSummary(command: string, output: string): string | null {
  if (!isHarnessVerificationCommand(command) && !isPlaywrightOrE2ECommand(command)) {
    if (!/\bnpm\s+(ci|install)\b/i.test(command)) return null
  }

  const cmdLower = command.toLowerCase()
  if (isBuildVerificationCommand(command)) {
    return parseBuildSuccessSummary(output) ?? "build succeeded"
  }
  if (isPlaywrightOrE2ECommand(command)) {
    return parsePlaywrightSuccessSummary(output) ?? "e2e passed"
  }
  if (/\b(npm\s+test|npm\s+run\s+test|vitest|jest|mocha)\b/i.test(cmdLower)) {
    return parseVitestSuccessSummary(output) ?? "tests passed"
  }
  return "ok"
}
