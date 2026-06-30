/**
 * Verification Gate — 代码改动后必须验证才能结束任务。
 *
 * DRF-40: 从 iceCoder harness-verification-gate.ts + task-state.ts 裁剪适配（MIT）
 * Source: iceCoder/src/harness/harness-verification-gate.ts, task-state.ts
 */

import type { TaskLedger } from "../task-ledger.js"
import { buildVerificationDigest, buildVerificationSuccessSummary } from "./verification-digest.js"
import { getPromptLocale } from "../prompt-locale.js"
import type { PromptLocale } from "../prompt-locale.js"

/** Verification Gate 运行时计数器状态 */
export interface VerificationGateState {
  /** 连续被 gate 拦截后继续的轮次 */
  continuationCount: number
}

/** Gate 评估结果 */
export interface VerificationGateDecision {
  /** 是否应拦截 model_done */
  blocking: boolean
  /** 注入模型的纠正提示 */
  prompt: string
  /** 是否已达最大续跑次数（应请求用户） */
  requiresUser: boolean
}

/** 默认最大 gate 续跑次数 */
export const DEFAULT_MAX_GATE_CONTINUATIONS = 3

/**
 * 纯查询：是否应拦截 final/done（无副作用）。
 */
export function isVerificationBlockingFinal(
  ledger: TaskLedger,
  requireVerification: boolean,
): boolean {
  if (!requireVerification) return false
  if (ledger.changedFiles.length === 0) return false
  return ledger.verificationPending
}

/**
 * 构造 Verification Gate 拦截提示。
 */
export function buildVerificationGatePrompt(ledger: TaskLedger, locale?: PromptLocale): string {
  const isZh = (locale ?? getPromptLocale()) === "zh-CN"
  const fileList = ledger.changedFiles.slice(0, 8)
  const more = ledger.changedFiles.length > 8
    ? isZh ? `\n- … 以及其他 ${ledger.changedFiles.length - 8} 个文件`
          : `\n- … and ${ledger.changedFiles.length - 8} more`
    : ""

  const lastFail = ledger.lastVerification && ledger.lastVerification.exitCode !== 0
    ? isZh
      ? `\n\n上次验证失败（退出码 ${ledger.lastVerification.exitCode}）：${ledger.lastVerification.summary}`
      : `\n\nLast verification failed (exit ${ledger.lastVerification.exitCode}): ${ledger.lastVerification.summary}`
    : ""

  if (isZh) {
    return `[系统] 完成此任务前需要验证。

你修改了 ${ledger.changedFiles.length} 个文件，但验证仍未通过。
修改的文件：
${fileList.map(f => `- ${f}`).join("\n")}${more}${lastFail}

运行合适的验证命令（如 bun test、bun run typecheck、bun run build）。
在验证通过之前，不要声明任务完成；或者明确请求用户豁免验证。`
  }
  return `[System] Verification required before completing this task.

You changed ${ledger.changedFiles.length} file(s) but verification is still pending.
Changed files:
${fileList.map(f => `- ${f}`).join("\n")}${more}${lastFail}

Run an appropriate verification command (e.g. npm test, bun test, npm run typecheck, npm run build).
Do not claim the task is complete until verification passes, or explicitly ask the user to waive verification.`
}

/**
 * 评估 Verification Gate 决策。
 */
export function evaluateVerificationGate(
  ledger: TaskLedger,
  requireVerification: boolean,
  state: VerificationGateState,
  maxContinuations = DEFAULT_MAX_GATE_CONTINUATIONS,
  locale?: PromptLocale,
): VerificationGateDecision {
  const blocking = isVerificationBlockingFinal(ledger, requireVerification)
  if (!blocking) {
    return { blocking: false, prompt: "", requiresUser: false }
  }

  const requiresUser = state.continuationCount >= maxContinuations
  const isZh = (locale ?? getPromptLocale()) === "zh-CN"
  const gateLimitMsg = isZh
    ? "\n\n[门禁限额已达] 询问用户是否继续修复、重新验证或豁免验证。"
    : "\n\n[Gate limit reached] Ask the user whether to continue fixing, re-run verification, or waive verification."
  const prompt = requiresUser
    ? `${buildVerificationGatePrompt(ledger)}${gateLimitMsg}`
    : buildVerificationGatePrompt(ledger)

  return { blocking: true, prompt, requiresUser }
}

/**
 * Gate 计数器：blocking 解除，或 pending 净减少时归零。
 */
export function shouldResetVerificationGateCounter(
  pendingBefore: boolean,
  pendingAfter: boolean,
  blockingAfter: boolean,
): boolean {
  if (!blockingAfter) return true
  if (pendingBefore && !pendingAfter) return true
  return false
}

/** 工具轮结束后按验收净进展更新 Gate 计数 */
export function maybeResetVerificationGateCounter(
  state: VerificationGateState,
  pendingBefore: boolean,
  pendingAfter: boolean,
  blockingAfter: boolean,
): void {
  if (shouldResetVerificationGateCounter(pendingBefore, pendingAfter, blockingAfter)) {
    state.continuationCount = 0
  }
}

/**
 * 处理 bash 验收命令结果：更新 digest 并返回是否通过。
 */
export function processVerificationCommandResult(
  command: string,
  output: string,
  exitCode: number,
): { passed: boolean; summary: string; digest?: string } {
  const passed = exitCode === 0
  if (passed) {
    const summary = buildVerificationSuccessSummary(command, output) ?? "ok"
    return { passed: true, summary }
  }

  const digest = buildVerificationDigest(command, output)
  return {
    passed: false,
    summary: digest?.split("\n")[0] ?? "verification failed",
    digest: digest ?? undefined,
  }
}
