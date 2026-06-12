/**
 * Read-Before-Write 守卫
 *
 * DRF-20: 从 SmallCode read_tracker.js 适配
 * Source: smallcode/src/tools/read_tracker.js (MIT)
 */

import { existsSync } from "node:fs"
import { isAbsolute, normalize, relative, resolve } from "node:path"

/** 写入守卫检查结果 */
export interface WriteGuardResult {
  ok: boolean
  reason?: string
  warning?: boolean
  blocked?: boolean
  withWarning?: string
}

/** 写入类工具名 */
const WRITE_TOOLS = new Set(["write_file", "edit", "NotebookEdit"])

/** 读取类工具名 */
const READ_TOOLS = new Set(["read_file"])

/**
 * 跟踪会话内已读/已写路径，防止小模型未读就覆盖文件
 */
export class ReadTracker {
  private readPaths = new Set<string>()
  private writtenPaths = new Set<string>()
  private warnedPaths = new Set<string>()
  private disabled: boolean
  private strict: boolean

  constructor(options?: { disabled?: boolean; strict?: boolean }) {
    this.disabled = options?.disabled ?? process.env.DEEPREEF_WRITE_GUARD === "false"
    this.strict = options?.strict ?? process.env.DEEPREEF_WRITE_GUARD_STRICT === "true"
  }

  /** 规范化路径用于跟踪 */
  private canon(filePath: string, cwd: string): string | null {
    if (!filePath) return null
    try {
      const abs = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
      return normalize(abs)
    } catch {
      return null
    }
  }

  /** 标记路径已读 */
  recordRead(filePath: string, cwd: string): void {
    if (this.disabled) return
    const c = this.canon(filePath, cwd)
    if (!c) return
    this.readPaths.add(c)
    this.warnedPaths.delete(c)
  }

  /** 标记路径已写 */
  recordWrite(filePath: string, cwd: string): void {
    if (this.disabled) return
    const c = this.canon(filePath, cwd)
    if (!c) return
    this.writtenPaths.add(c)
    this.readPaths.add(c)
  }

  /**
   * 检查写入是否应被守卫
   */
  checkWrite(filePath: string, cwd: string): WriteGuardResult {
    if (this.disabled) return { ok: true }
    const c = this.canon(filePath, cwd)
    if (!c) return { ok: true }

    let fileExists = false
    try { fileExists = existsSync(c) } catch { /* ignore */ }
    if (!fileExists) return { ok: true }

    if (this.readPaths.has(c) || this.writtenPaths.has(c)) return { ok: true }

    const rel = relative(cwd, c) || c
    if (this.strict) {
      return {
        ok: false,
        blocked: true,
        reason: `Refused: write to existing file '${rel}' without prior read_file. Read the file first.`,
      }
    }

    if (this.warnedPaths.has(c)) {
      this.recordWrite(filePath, cwd)
      return { ok: true, withWarning: "overwriting unread file (second attempt)" }
    }

    this.warnedPaths.add(c)
    return {
      ok: false,
      warning: true,
      reason: `Refused: write would overwrite existing '${rel}' you haven't read. Call read_file first, or retry — second attempt is allowed.`,
    }
  }

  /** 重置跟踪状态 */
  reset(): void {
    this.readPaths.clear()
    this.writtenPaths.clear()
    this.warnedPaths.clear()
  }
}

/**
 * 从工具参数提取文件路径
 */
export function extractFilePath(toolName: string, args: Record<string, unknown>): string | null {
  if (WRITE_TOOLS.has(toolName) || READ_TOOLS.has(toolName)) {
    const p = args.path ?? args.filePath ?? args.file
    return typeof p === "string" ? p : null
  }
  return null
}

/**
 * 判断工具是否为写入类
 */
export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName)
}

/**
 * 判断工具是否为读取类
 */
export function isReadTool(toolName: string): boolean {
  return READ_TOOLS.has(toolName)
}
