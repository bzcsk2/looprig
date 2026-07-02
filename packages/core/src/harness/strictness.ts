/**
 * ADV-HAR-01: Harness 三档严格度解析器
 *
 * 优先级：session > project > model-profile > default
 * 默认值：未知本地模型 → strict，其他未知 → normal
 */

import { resolve } from "node:path"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { z } from "zod"
import type {
  HarnessStrictness,
  StrictnessSource,
  EffectiveHarnessPolicy,
  ProjectHarnessConfig,
  ModelProfile,
} from "../model-profile/types.js"

const PROJECT_CONFIG_DIR = ".covalo"
const PROJECT_CONFIG_FILE = "harness.json"

// ADV-HAR-P0: Zod schema for harness config validation
const HarnessStrictnessSchema = z.enum(["strict", "normal", "loose"])

const ProjectHarnessConfigSchema = z.object({
  strictness: HarnessStrictnessSchema.optional(),
  modelOverrides: z.record(z.string(), HarnessStrictnessSchema).optional(),
}).strict()

/**
 * 读取项目级 harness 配置（.covalo/harness.json）
 * ADV-HAR-P0: 使用 Zod 校验，非法配置安全回退到 null
 */
export function readProjectHarnessConfig(cwd?: string): ProjectHarnessConfig | null {
  const dir = resolve(cwd ?? process.cwd(), PROJECT_CONFIG_DIR)
  const filePath = resolve(dir, PROJECT_CONFIG_FILE)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") {
      // ADV-HAR-P0: 使用 Zod 校验
      const result = ProjectHarnessConfigSchema.safeParse(parsed)
      if (result.success) {
        return result.data as ProjectHarnessConfig
      }
      // 校验失败，记录错误并返回 null
      console.warn(`[harness] Invalid config in ${filePath}:`, result.error.format())
      return null
    }
    return null
  } catch {
    return null
  }
}

/**
 * 写入项目级 harness 配置
 */
export function writeProjectHarnessConfig(
  config: ProjectHarnessConfig,
  cwd?: string,
): void {
  const dir = resolve(cwd ?? process.cwd(), PROJECT_CONFIG_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const filePath = resolve(dir, PROJECT_CONFIG_FILE)
  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8")
}

/**
 * 根据模型信息推断默认严格度
 * - 未知本地模型 → strict
 * - 其他未知 → normal
 */
export function inferDefaultStrictness(modelProfile: ModelProfile | null): HarnessStrictness {
  if (!modelProfile) return "normal"
  if (modelProfile.id === "unknown-local") return "strict"
  return "normal"
}

export interface ResolveStrictnessOptions {
  /** 当前会话显式选择（最高优先级） */
  sessionStrictness?: HarnessStrictness | null
  /** 项目配置 */
  projectConfig?: ProjectHarnessConfig | null
  /** 当前模型名（用于 modelOverrides 匹配） */
  modelName?: string
  /** 模型画像（用于推断默认值） */
  modelProfile?: ModelProfile | null
}

export interface ResolvedStrictness {
  strictness: HarnessStrictness
  source: StrictnessSource
}

/**
 * 按优先级解析当前有效严格度
 *
 * 优先级链：
 * 1. 会话显式选择（session）
 * 2. 项目配置中模型覆盖（project + modelOverrides）
 * 3. 项目全局配置（project）
 * 4. 模型画像推荐（model-profile）— 暂不实现，用默认值
 * 5. 默认值（default）
 */
export function resolveHarnessStrictness(
  options: ResolveStrictnessOptions,
): ResolvedStrictness {
  const {
    sessionStrictness,
    projectConfig,
    modelName,
    modelProfile,
  } = options

  // 1. 会话显式选择（最高优先级）
  if (sessionStrictness != null) {
    return { strictness: sessionStrictness, source: "session" }
  }

  // 2. 项目配置中模型覆盖
  if (projectConfig?.modelOverrides && modelName) {
    const normalizedModel = modelName.toLowerCase()
    for (const [pattern, strictness] of Object.entries(projectConfig.modelOverrides)) {
      if (normalizedModel.includes(pattern.toLowerCase())) {
        return { strictness, source: "project" }
      }
    }
  }

  // 3. 项目全局配置
  if (projectConfig?.strictness) {
    return { strictness: projectConfig.strictness, source: "project" }
  }

  // 4. 模型画像推荐（预留接口，暂用默认推断）
  // 未来可在此处读取 modelProfile 的推荐 strictness

  // 5. 默认值
  return {
    strictness: inferDefaultStrictness(modelProfile ?? null),
    source: "default",
  }
}
