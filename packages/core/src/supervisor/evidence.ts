/**
 * EvidenceBundle 构建 — 从 TaskLedger、BranchBudget、EarlyStop 与工具结果组装有界证据。
 *
 * DRF-50：借鉴 SmallCode escalation 的精简上下文与 iceCoder checkpoint 摘要思路（MIT）。
 */

import { createHash } from "node:crypto"

import type {
  BuildEvidenceBundleInput,
  EvidenceBundle,
  EvidenceFailureEntry,
  EvidenceToolEntry,
  FailureClass,
} from "./types.js"

/** 近期失败条目上限 */
export const MAX_EVIDENCE_FAILURES = 10

/** 近期工具条目上限 */
export const MAX_EVIDENCE_TOOLS = 20

/** 验证输出 tail 字符上限 */
export const MAX_VERIFICATION_TAIL = 500

/** 单条 summary 字符上限 */
export const MAX_EVIDENCE_SUMMARY = 200

/** 已尝试策略条目上限 */
export const MAX_ATTEMPTED_STRATEGIES = 10

/** changedFiles 展示上限 */
export const MAX_CHANGED_FILES = 12

/**
 * 截断文本到指定长度。
 */
export function truncateEvidenceText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen - 3)}...`
}

/**
 * 从 TaskLedger 计划中提取当前 active 步骤文本。
 */
export function extractActiveStep(
  plan: Array<{ text: string; status: string }> | undefined,
): string | undefined {
  if (!plan?.length) return undefined
  const active = plan.find(s => s.status === "active")
  if (active) return active.text.trim()
  const pending = plan.find(s => s.status === "pending")
  return pending?.text.trim()
}

/**
 * 规范化 EvidenceBundle 用于确定性哈希。
 */
export function normalizeEvidenceForHash(bundle: EvidenceBundle): Record<string, unknown> {
  return {
    goal: bundle.goal.trim(),
    activeStep: bundle.activeStep?.trim(),
    failureClass: bundle.failureClass,
    recentFailures: bundle.recentFailures.map(f => ({
      signature: f.signature,
      summary: f.summary,
    })),
    recentTools: bundle.recentTools.map(t => ({
      name: t.name,
      success: t.success,
      summary: t.summary,
    })),
    changedFiles: [...bundle.changedFiles].sort(),
    verification: bundle.verification
      ? {
          command: bundle.verification.command,
          exitCode: bundle.verification.exitCode,
          tail: bundle.verification.tail,
        }
      : undefined,
    attemptedStrategies: [...bundle.attemptedStrategies],
  }
}

/**
 * 计算 EvidenceBundle 的短哈希，用于去重与 checkpoint。
 */
export function hashEvidenceBundle(bundle: EvidenceBundle): string {
  const normalized = normalizeEvidenceForHash(bundle)
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 16)
}

/**
 * 裁剪失败/工具条目列表。
 */
export function trimEvidenceFailures(
  entries: EvidenceFailureEntry[],
  max = MAX_EVIDENCE_FAILURES,
): EvidenceFailureEntry[] {
  return entries.slice(-max).map(e => ({
    signature: e.signature,
    summary: truncateEvidenceText(e.summary, MAX_EVIDENCE_SUMMARY),
  }))
}

/**
 * 裁剪工具条目列表。
 */
export function trimEvidenceTools(
  entries: EvidenceToolEntry[],
  max = MAX_EVIDENCE_TOOLS,
): EvidenceToolEntry[] {
  return entries.slice(-max).map(t => ({
    name: t.name,
    success: t.success,
    summary: truncateEvidenceText(t.summary, MAX_EVIDENCE_SUMMARY),
  }))
}

/**
 * 从 BranchBudget block/recover 与 EarlyStop 原因推导 attemptedStrategies。
 */
export function deriveAttemptedStrategies(
  base: string[] | undefined,
  extras: Array<string | undefined>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of [...(base ?? []), ...extras]) {
    const trimmed = item?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(truncateEvidenceText(trimmed, MAX_EVIDENCE_SUMMARY))
    if (out.length >= MAX_ATTEMPTED_STRATEGIES) break
  }
  return out
}

/**
 * 将 FailureClass 映射为默认诊断前缀（证据包构建时的兜底）。
 */
export function defaultFailureSummary(failureClass: FailureClass): string {
  switch (failureClass) {
    case "tool_format":
      return "工具调用格式或参数解析反复失败"
    case "wrong_strategy":
      return "当前分支策略已耗尽或重复无效操作"
    case "missing_context":
      return "缺少完成任务所需上下文"
    case "verification_failure":
      return "验证命令连续失败"
    case "goal_drift":
      return "任务目标或上下文出现漂移"
    case "provider_failure":
      return "模型提供方返回错误"
    default:
      return "未知失败模式，需要监督指导"
  }
}

/**
 * 从 TaskLedger、工具结果与运行时信号构建有界 EvidenceBundle。
 */
export function buildEvidenceBundle(input: BuildEvidenceBundleInput): EvidenceBundle {
  const {
    ledger,
    failureClass,
    recentFailures = [],
    recentTools = [],
    attemptedStrategies,
    verificationTail,
    stopSignalReason,
  } = input

  const activeStep = extractActiveStep(ledger.plan)
  const failures = trimEvidenceFailures(recentFailures)
  if (failures.length === 0 && ledger.blockers?.length) {
    for (const blocker of ledger.blockers.slice(-3)) {
      failures.push({
        signature: createHash("sha256").update(blocker).digest("hex").slice(0, 12),
        summary: truncateEvidenceText(blocker, MAX_EVIDENCE_SUMMARY),
      })
    }
  }
  if (failures.length === 0) {
    failures.push({
      signature: failureClass,
      summary: defaultFailureSummary(failureClass),
    })
  }

  const changedFiles = ledger.changedFiles.slice(0, MAX_CHANGED_FILES)

  let verification: EvidenceBundle["verification"]
  if (ledger.lastVerification) {
    const tailSource = verificationTail ?? ledger.lastVerification.summary
    verification = {
      command: ledger.lastVerification.command,
      exitCode: ledger.lastVerification.exitCode,
      tail: truncateEvidenceText(tailSource, MAX_VERIFICATION_TAIL),
    }
  }

  const strategies = deriveAttemptedStrategies(attemptedStrategies, [
    stopSignalReason ? `early_stop:${stopSignalReason}` : undefined,
    ledger.lastVerification ? `verify:${ledger.lastVerification.command}` : undefined,
  ])

  return {
    goal: truncateEvidenceText(ledger.goal.trim(), 500),
    activeStep: activeStep ? truncateEvidenceText(activeStep, 300) : undefined,
    failureClass,
    recentFailures: failures,
    recentTools: trimEvidenceTools(recentTools),
    changedFiles,
    verification,
    attemptedStrategies: strategies,
  }
}
