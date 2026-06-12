/**
 * 阻止 salvage 截断后的写入类工具执行，避免不完整 payload 覆盖文件。
 */

import { isSalvagedTruncatedArguments, buildSalvageTruncatedError } from "./salvage.js"

/** 截断 salvage 后禁止执行的写入类工具 */
export const SALVAGED_TRUNCATED_WRITE_TOOLS = new Set([
  "write_file",
  "edit",
  "NotebookEdit",
])

/**
 * 判断是否应拒绝执行：写入工具 + 参数来自截断 salvage。
 */
export function shouldBlockSalvagedTruncatedWrite(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  return SALVAGED_TRUNCATED_WRITE_TOOLS.has(toolName) && isSalvagedTruncatedArguments(args)
}

/**
 * 构建拒绝执行时的错误消息。
 */
export function buildSalvagedTruncatedWriteBlockMessage(
  toolName: string,
  args: Record<string, unknown>,
): string {
  return buildSalvageTruncatedError(toolName, args)
}
