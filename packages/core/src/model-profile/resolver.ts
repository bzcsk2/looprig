/**
 * ModelProfile 与 HarnessProfile 解析器
 *
 * DRF-11: 从 SmallCode matchProfile/getProfile 适配
 * Source: smallcode/src/model/profiles.js (MIT)
 */

import {
  BUILTIN_HARNESS_PROFILES,
  BUILTIN_MODEL_PROFILES,
  DEFAULT_LOCAL_PROFILE,
  DEFAULT_REMOTE_PROFILE,
} from "./profiles.js"
import type { HarnessProfile, ModelProfile, ModelProfileConfig } from "./types.js"

/**
 * 按模型名模糊匹配内置 profile（最长 match 优先）
 */
export function matchModelProfile(modelName: string): ModelProfile | null {
  const normalized = modelName.toLowerCase()
  let best: ModelProfile | null = null
  let bestLen = 0

  for (const profile of BUILTIN_MODEL_PROFILES) {
    for (const pattern of profile.match) {
      if (normalized.includes(pattern.toLowerCase()) && pattern.length > bestLen) {
        best = profile
        bestLen = pattern.length
      }
    }
  }

  return best
}

/**
 * 解析模型 profile，支持项目覆盖
 *
 * @param modelName - 模型名称
 * @param isLocal - 是否为本地端点
 * @param detectedContextWindow - 端点检测到的上下文窗口（0 表示未知）
 * @param overrides - 项目级覆盖
 */
export function resolveModelProfile(
  modelName: string,
  isLocal = false,
  detectedContextWindow = 0,
  overrides?: ModelProfileConfig,
): ModelProfile {
  const matched = matchModelProfile(modelName)
  const base = matched ?? (isLocal ? DEFAULT_LOCAL_PROFILE : DEFAULT_REMOTE_PROFILE)
  const override = matched ? overrides?.modelProfiles?.[matched.id] : undefined
  const merged = override ? { ...base, ...override } : base

  if (detectedContextWindow > 0) {
    return { ...merged, contextWindow: detectedContextWindow }
  }
  return merged
}

/**
 * 解析 Harness profile
 */
export function resolveHarnessProfile(
  harnessId: string,
  overrides?: ModelProfileConfig,
): HarnessProfile {
  const builtin = BUILTIN_HARNESS_PROFILES[harnessId]
  if (!builtin) {
    return BUILTIN_HARNESS_PROFILES["remote-adaptive"]
  }
  const override = overrides?.harnessProfiles?.[harnessId]
  return override ? { ...builtin, ...override } : builtin
}

/**
 * 根据模型名解析默认 harness
 */
export function resolveDefaultHarness(
  modelName: string,
  isLocal = false,
  overrides?: ModelProfileConfig,
): HarnessProfile {
  const modelProfile = resolveModelProfile(modelName, isLocal, 0, overrides)
  return resolveHarnessProfile(modelProfile.defaultHarness, overrides)
}
