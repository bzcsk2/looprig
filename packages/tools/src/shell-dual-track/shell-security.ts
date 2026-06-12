/**
 * Shell 命令安全检查 — 复用 shell-exec 的危险模式与敏感路径规则。
 */

import { resolve } from "node:path"
import { isSensitive } from "../sensitive.js"
import type { ShellBackendId } from "../platform/shell-backend.js"

const POSIX_DENY_PATTERNS = [
  /\brm\s+(?:-[A-Za-z]*r[A-Za-z]*\s+.*\/\*|.*-[A-Za-z]*r[A-Za-z]*\s+\/)/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+-R\s+777\s+\//,
  /\bdd\b/,
  /\bfdisk\b/,
  /\bmkfs\.\w+\b/,
  /\bgit\s+push\b/,
  /\bgit\s+commit\b/,
]

const POWERSHELL_DENY_PATTERNS = [
  /\b(?:Remove-Item|rm)\b[^;\n]*(?:-Recurse\b[^;\n]*)?(?:[A-Za-z]:\\|\/)\s*(?:-\w+\s*)*$/i,
  /\b(?:Remove-Item|rm)\b[^;\n]*-[FRS]\b/i,
  /\bFormat-Volume\b/i,
  /\bClear-Disk\b/i,
  /\bInitialize-Disk\b/i,
  /\bStart-Process\b[^;\n]*-Verb\s+RunAs\b/i,
]

/**
 * 检查命令是否匹配危险模式。
 *
 * @returns 匹配到的模式 source，未匹配则 null
 */
export function matchDeniedShellPattern(command: string, backend: ShellBackendId): string | null {
  const patterns = backend === "bash" ? POSIX_DENY_PATTERNS : POWERSHELL_DENY_PATTERNS
  for (const p of patterns) {
    if (p.test(command.trim())) return p.source
  }
  return null
}

/**
 * 检查命令是否引用敏感文件路径。
 *
 * @returns 敏感路径，未匹配则 null
 */
export function matchSensitivePathInCommand(command: string): string | null {
  const pathRe = /\b([\w./-]*(?:\.\w{1,10}))\b|\b([\w./-]*\/?\.[\w.-]+)\b|\b([\w./-]*(?:id_rsa|id_ed25519|credentials\.json|service-account\.json|token\.json))\b/g
  let pathMatch: RegExpExecArray | null
  while ((pathMatch = pathRe.exec(command)) !== null) {
    const fp = pathMatch[1] || pathMatch[2] || pathMatch[3]
    if (fp && isSensitive(fp)) return fp
  }
  return null
}

export interface ShellSecurityCheckResult {
  ok: boolean
  error?: string
}

/**
 * 综合校验 shell 命令是否允许执行。
 *
 * @param command 原始命令
 * @param backend 当前平台 shell backend
 * @param cwd 工作目录（用于相对路径敏感检查，可选）
 */
export function validateShellCommand(
  command: string,
  backend: ShellBackendId,
  cwd?: string,
): ShellSecurityCheckResult {
  const trimmed = command.trim()
  if (!trimmed) {
    return { ok: false, error: "command is required" }
  }

  const denied = matchDeniedShellPattern(trimmed, backend)
  if (denied) {
    return { ok: false, error: `Command denied: matches dangerous pattern /${denied}/` }
  }

  const sensitive = matchSensitivePathInCommand(trimmed)
  if (sensitive) {
    const resolved = cwd ? resolve(cwd, sensitive) : sensitive
    if (isSensitive(sensitive) || isSensitive(resolved)) {
      return { ok: false, error: `Command references sensitive file: ${sensitive}` }
    }
  }

  return { ok: true }
}

/**
 * 判断命令是否不应静默进入后台（破坏性/危险操作）。
 */
export function isDestructiveShellCommand(command: string, backend: ShellBackendId): boolean {
  return matchDeniedShellPattern(command, backend) !== null
    || /\b(rm|del|Remove-Item|git\s+push)\b/i.test(command.trim())
}
