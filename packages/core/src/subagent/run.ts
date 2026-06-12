import { randomUUID } from "node:crypto"
import type { AgentTool } from "../interface.js"
import { ReasonixEngine } from "../engine.js"
import type { DeepreefConfig } from "../config.js"
import { agentConfigFor } from "../agent.js"
import { SubagentRegistry } from "./registry.js"
import { checkSubagentPermission } from "./permission.js"
import {
  resolveModelTarget,
  targetToConfig,
  createClientForTarget,
} from "../model-target.js"
import type {
  SubagentDefinition,
  SubagentRun,
  SubagentRunOptions,
  SubagentRunResult,
  SubagentRunUsage,
  SubagentRunStatus,
} from "./types.js"

export class SubagentRunner {
  private config: DeepreefConfig
  private registry: SubagentRegistry

  constructor(config: DeepreefConfig, registry?: SubagentRegistry) {
    this.config = config
    this.registry = registry ?? new SubagentRegistry()
  }

  getRegistry(): SubagentRegistry {
    return this.registry
  }

  resolveDefinition(subagentType?: string): SubagentDefinition {
    const type = subagentType ?? "general-purpose"
    return this.registry.resolve(type)
  }

  async spawnAndRun(
    options: SubagentRunOptions,
    parentTools: Map<string, AgentTool>,
    parentEngine: ReasonixEngine,
    parentLogger?: any,
  ): Promise<SubagentRunResult> {
    if (!options.prompt || !options.description) {
      throw new Error("SubagentRunOptions requires both prompt and description")
    }

    const def = this.resolveDefinition(options.subagentType)
    const runId = `subagent_${randomUUID().slice(0, 8)}`

    // DRF-10: 按 target 解析独立 client，不再共享父级 client
    const targetId = options.target ?? def.target
    const resolvedTarget = targetId
      ? resolveModelTarget(targetId, this.config, this.config.modelTargets)
      : null
    const childConfig = resolvedTarget
      ? targetToConfig(resolvedTarget)
      : this.config
    const childClient = resolvedTarget
      ? createClientForTarget(resolvedTarget, parentLogger?.child?.({ delegate: true, subagentType: def.name }))
      : parentEngine["client"]

    const child = new ReasonixEngine(
      childConfig,
      undefined,
      undefined,
      childClient,
      parentLogger?.child?.({ delegate: true, subagentType: def.name, subagentRunId: runId }),
    )

    try {
      // Register tools filtered by definition
      for (const tool of parentTools.values()) {
        if (tool.name === "AgentTool") continue
        if (def.disallowedTools?.includes(tool.name)) continue
        if (def.tools && def.tools[0] !== "*" && !def.tools.includes(tool.name)) continue

        child.registerTool(tool)

        // Apply permission profile
        const perm = checkSubagentPermission(tool.name, def.permissionMode)
        if (!perm.allowed) {
          child.permissionEngine.addDenyRule({
            toolName: tool.name,
            reason: perm.reason ?? `Denied by subagent permission mode: ${def.permissionMode}`,
          })
        }

        // denyExec mode also denies exec-tier tools
        if (def.permissionMode === "denyExec") {
          if (tool.approval === "exec") {
            child.permissionEngine.addDenyRule({
              toolName: tool.name,
              reason: `Subagent in denyExec mode cannot run exec tool: ${tool.name}`,
            })
          }
        }
      }

      const agentCfg = agentConfigFor("build", {
        systemPrompt: def.systemPrompt,
        toolNames: this.registry.getEffectiveTools(def) ?? undefined,
        model: def.model === "inherit" ? undefined : def.model,
      })

      let output = ""
      const warnings: string[] = []
      let usage: SubagentRunUsage = { promptTokens: 0, completionTokens: 0 }

      let turns = 0
      for await (const event of child.submit(options.prompt, agentCfg)) {
        if (event.role === "assistant_delta") output += event.content ?? ""
        if (event.role === "usage" && event.metadata) {
          usage = {
            promptTokens: (event.metadata.promptTokens as number) ?? 0,
            completionTokens: (event.metadata.completionTokens as number) ?? 0,
          }
        }
        if (event.role === "error") {
          warnings.push(event.content ?? "unknown error")
        }
        if (event.role === "tool_start" || event.role === "tool") {
          turns++
          if (def.maxTurns && turns >= def.maxTurns) {
            child.interrupt()
            break
          }
        }
      }

      return {
        status: "completed",
        id: runId,
        subagent_type: def.name,
        description: options.description,
        result: output.trim(),
        files: options.files ?? [],
        usage,
        warnings,
      }
    } finally {
      await child.shutdown()
    }
  }
}
