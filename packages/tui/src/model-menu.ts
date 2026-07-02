import { FREE_MODEL_TARGETS, PROVIDERS } from "@covalo/core"
import type { ApiKeySource } from "@covalo/core"
import { loadRoleConfig } from "@covalo/core"

export interface ModelSelection {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
}

export type ModelMenuRow =
  | { kind: "header"; id: string; label: string }
  | { kind: "model"; id: string; group: string; label: string; target: ModelSelection }
  | { kind: "provider"; id: string; provider: string; label: string; configured: boolean; expanded: boolean; keySource?: ApiKeySource }
  | { kind: "custom"; id: string; label: string; provider: "openai-compatible" }

/** 一级菜单分组顺序 */
export const GROUP_ORDER: { id: string; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "local", label: "Local" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "qwen", label: "Qwen" },
  { id: "kimi", label: "Kimi" },
  { id: "zai", label: "ZAI" },
  { id: "stepfun", label: "Stepfun" },
  { id: "nvidia", label: "NVIDIA" },
  { id: "openai", label: "OpenAI" },
  { id: "mimo", label: "Mimo" },
]

/** Local 快捷模型映射 */
const LOCAL_MODELS: { label: string; model: string }[] = [
  { label: "qwen3.6-35B-A3B-mtp", model: "qwen3.6-35B-A3B-mtp" },
  { label: "gemma-4-26B-A4B-it", model: "gemma-4-26B-A4B-it" },
]

export function resolveLocalBaseUrl(): string {
  const envUrl = process.env.OPENAI_COMPATIBLE_BASE_URL
  if (envUrl) return envUrl
  const lastOac = loadRoleConfig("worker") ?? loadRoleConfig("supervisor")
  if (lastOac?.provider === "openai-compatible" && lastOac.baseUrl) return lastOac.baseUrl
  return "http://localhost:8000/v1"
}

/** 付费 provider 列表（用于检测是否需要 Key） */
const PAID_PROVIDERS = new Set(["deepseek", "qwen", "kimi", "zai", "stepfun", "nvidia", "openai", "mimo"])

/**
 * 生成一级菜单的扁平行列表。
 * @param configuredKeys - listConfiguredApiKeys() 的结果
 * @param expandedProviders - 当前展开的 provider ID 集合
 * @param currentProvider - 当前选中 provider
 * @param currentModel - 当前选中 model
 */
export function buildMenuRows(
  configuredKeys: Record<string, ApiKeySource>,
  expandedProviders: Set<string>,
  currentProvider: string,
  currentModel: string,
): ModelMenuRow[] {
  const rows: ModelMenuRow[] = []

  for (const group of GROUP_ORDER) {
    if (group.id === "free") {
      rows.push({ kind: "header", id: "hdr-free", label: group.label })
      for (const ft of FREE_MODEL_TARGETS) {
        const isCurrent = ft.provider === currentProvider && ft.model === currentModel
        rows.push({
          kind: "model",
          id: `free-${ft.label}`,
          group: "free",
          label: ft.label,
          target: {
            provider: ft.provider,
            model: ft.model,
            apiKey: "",
            baseUrl: PROVIDERS[ft.provider]?.baseUrl ?? "",
          },
        })
      }
    } else if (group.id === "local") {
      rows.push({ kind: "header", id: "hdr-local", label: group.label })
      const localBaseUrl = resolveLocalBaseUrl()
      for (const lm of LOCAL_MODELS) {
        const isCurrent = currentProvider === "openai-compatible" && currentModel === lm.model
        rows.push({
          kind: "model",
          id: `local-${lm.model}`,
          group: "local",
          label: lm.label,
          target: {
            provider: "openai-compatible",
            model: lm.model,
            apiKey: "",
            baseUrl: localBaseUrl,
          },
        })
      }
      rows.push({
        kind: "custom",
        id: "local-openai-compatible",
        label: "OpenAI-Compatible",
        provider: "openai-compatible",
      })
    } else {
      // Paid provider group
      const pid = group.id
      const info = PROVIDERS[pid]
      if (!info) continue

      rows.push({ kind: "header", id: `hdr-${pid}`, label: group.label })

      const keySource = configuredKeys[pid]
      const configured = !!keySource && keySource !== "none"

      if (!configured) {
        rows.push({
          kind: "provider",
          id: `provider-${pid}`,
          provider: pid,
          label: info.model,
          configured: false,
          expanded: false,
        })
      } else {
        rows.push({
          kind: "provider",
          id: `provider-${pid}`,
          provider: pid,
          label: info.model,
          configured: true,
          expanded: expandedProviders.has(pid),
          keySource,
        })
        if (expandedProviders.has(pid)) {
          for (const m of info.models) {
            rows.push({
              kind: "model",
              id: `model-${pid}-${m.model}`,
              group: pid,
              label: m.label,
              target: {
                provider: pid,
                model: m.model,
                apiKey: "",
                baseUrl: info.baseUrl,
              },
            })
          }
        }
      }
    }
  }

  return rows
}

/** 获取上一个/下一个可选行的索引（跳过 header） */
export function getPrevSelectableIndex(rows: ModelMenuRow[], currentIdx: number): number {
  for (let i = currentIdx - 1; i >= 0; i--) {
    if (rows[i]!.kind !== "header") return i
  }
  return currentIdx
}

export function getNextSelectableIndex(rows: ModelMenuRow[], currentIdx: number): number {
  for (let i = currentIdx + 1; i < rows.length; i++) {
    if (rows[i]!.kind !== "header") return i
  }
  return currentIdx
}

/** 裁剪可视窗口使选中项始终可见 */
export function clampWindow(selIdx: number, total: number, windowSize: number): number {
  if (total <= windowSize) return 0
  const half = Math.floor(windowSize / 2)
  let start = selIdx - half
  if (start < 0) start = 0
  if (start + windowSize > total) start = total - windowSize
  return start
}
