/**
 * SupervisorAdvice 结构化校验 — Zod schema 与安全边界检查。
 *
 * DRF-50：借鉴 SmallCode reviewer 置信度阈值思路；输出仅允许建议文本（MIT）。
 */

import { z } from "zod"

import { SUPERVISOR_ADVICE_VERSION } from "./types.js"
import type { FailureClass, SupervisorAdvice } from "./types.js"

/** nextActions 最大条目数 */
export const MAX_NEXT_ACTIONS = 5

/** 单条 action/constraint/verification 最大长度 */
export const MAX_ADVICE_ITEM_LENGTH = 400

/** diagnosis 最大长度 */
export const MAX_DIAGNOSIS_LENGTH = 800

/** 禁止 bypass 权限/安全边界的关键词 */
const UNSAFE_ADVICE_PATTERNS = [
  /\bbypass\b/i,
  /\bignore\s+(permission|security|deny)\b/i,
  /\bdisable\s+(permission|security|rls)\b/i,
  /\brun\s+as\s+root\b/i,
  /绕过.*权限/,
  /忽略.*安全/,
  /关闭.*权限/,
]

/** 禁止直接 patch/shell 对象的关键词 */
const EXECUTABLE_OBJECT_PATTERNS = [
  /"tool_calls"\s*:/,
  /"patch"\s*:/,
  /"command"\s*:\s*"(rm|curl|wget|sudo)/i,
]

const failureClassSchema = z.enum([
  "tool_format",
  "wrong_strategy",
  "missing_context",
  "verification_failure",
  "goal_drift",
  "provider_failure",
  "unknown",
])

/** SupervisorAdvice Zod schema */
export const supervisorAdviceSchema = z.object({
  version: z.literal(SUPERVISOR_ADVICE_VERSION),
  diagnosis: z.string().min(1).max(MAX_DIAGNOSIS_LENGTH),
  failureClass: failureClassSchema,
  nextActions: z.array(z.string().min(1).max(MAX_ADVICE_ITEM_LENGTH)).min(1).max(MAX_NEXT_ACTIONS),
  constraints: z.array(z.string().max(MAX_ADVICE_ITEM_LENGTH)).default([]),
  verification: z.array(z.string().max(MAX_ADVICE_ITEM_LENGTH)).default([]),
  confidence: z.number().min(0).max(1),
  shouldContinue: z.boolean(),
  requiresUser: z.boolean().optional(),
})

export type ParsedSupervisorAdvice = z.infer<typeof supervisorAdviceSchema>

/** schema 校验结果 */
export interface SupervisorAdviceValidation {
  success: boolean
  advice?: SupervisorAdvice
  errors?: string[]
}

/**
 * 检查 advice 文本是否包含不安全或可直接执行的 payload。
 */
export function findUnsafeAdviceContent(text: string): string[] {
  const issues: string[] = []
  for (const pattern of UNSAFE_ADVICE_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`包含不安全建议模式: ${pattern.source}`)
    }
  }
  for (const pattern of EXECUTABLE_OBJECT_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`包含疑似可执行对象: ${pattern.source}`)
    }
  }
  return issues
}

/**
 * 从原始 JSON 字符串或对象解析并校验 SupervisorAdvice。
 * @param raw LLM 返回的 JSON 字符串或已解析对象
 */
export function parseSupervisorAdvice(raw: unknown): SupervisorAdviceValidation {
  let value: unknown = raw

  if (typeof raw === "string") {
    const trimmed = raw.trim()
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonText = fenced?.[1]?.trim() ?? trimmed
    try {
      value = JSON.parse(jsonText)
    } catch (err) {
      return {
        success: false,
        errors: [`JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`],
      }
    }
  }

  const parsed = supervisorAdviceSchema.safeParse(value)
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
    }
  }

  const advice = parsed.data as SupervisorAdvice
  const fieldTexts = [
    advice.diagnosis,
    ...advice.nextActions,
    ...advice.constraints,
    ...advice.verification,
  ]
  const unsafe = fieldTexts.flatMap(findUnsafeAdviceContent)
  if (unsafe.length > 0) {
    return { success: false, errors: unsafe }
  }

  return { success: true, advice }
}

/**
 * 校验已构造的 SupervisorAdvice 对象（运行时二次检查）。
 */
export function validateSupervisorAdvice(advice: SupervisorAdvice): SupervisorAdviceValidation {
  return parseSupervisorAdvice(advice)
}

/**
 * 将 failureClass 字符串规范化为合法枚举值。
 */
export function coerceFailureClass(value: string | undefined): FailureClass {
  const result = failureClassSchema.safeParse(value)
  return result.success ? result.data : "unknown"
}
