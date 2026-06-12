/**
 * 工作区路径作用域工具（BranchBudget 与 checkpoint 共用）。
 */

import { existsSync } from "node:fs"
import path from "node:path"

/** 判断绝对路径是否位于工作区根目录之下。 */
export function isUnderRoot(absPath: string, root: string): boolean {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(absPath)
  const rel = path.relative(resolvedRoot, resolvedTarget)
  if (rel === "") return true
  return !rel.startsWith("..") && !path.isAbsolute(rel)
}

/** 将相对或绝对路径解析为绝对路径。 */
export function resolveAgainstWorkspace(rawPath: string, workspaceRoot: string): string {
  return path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(workspaceRoot, rawPath)
}

/** 目标路径在工作区内是否已存在于磁盘。 */
export function workspaceFileExists(workspaceRoot: string, rawPath: string | undefined): boolean {
  if (!rawPath?.trim() || !workspaceRoot.trim()) return false
  return existsSync(resolveAgainstWorkspace(rawPath.trim(), workspaceRoot))
}
