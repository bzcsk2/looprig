import type { ThreadGoal } from "./types.js"
import { getPromptLocale } from "../prompt-locale.js"
import type { PromptLocale } from "../prompt-locale.js"

export function buildContinuationPrompt(goal: ThreadGoal, iteration: number, locale?: PromptLocale): string {
  const isZh = (locale ?? getPromptLocale()) === "zh-CN"
  if (isZh) {
    return `继续朝当前目标工作。

## 当前目标
- 目标：${goal.objective}
- 状态：${goal.status}
- 已用 Token：${goal.tokensUsed}${goal.tokenBudget ? ` / 预算：${goal.tokenBudget}` : ""}
- 已用时间：${goal.timeUsedSeconds}s
- 当前迭代：${iteration}

## 规则
1. 目标跨轮次持续。不要缩小或改变目标。
2. 基于当前证据和工作区状态工作。
3. 在标记目标完成前，逐条审计需求。
4. 如果连续 3 轮遇到同一阻塞且无法推进，将目标标记为 blocked。
5. 不要开始新的无关工作。专注于目标。`
  }
  return `Continue working toward the current goal.

## Current Goal
- Objective: ${goal.objective}
- Status: ${goal.status}
- Tokens Used: ${goal.tokensUsed}${goal.tokenBudget ? ` / Budget: ${goal.tokenBudget}` : ""}
- Time Used: ${goal.timeUsedSeconds}s
- Current Iteration: ${iteration}

## Rules
1. The goal persists across turns. Do not narrow or change the objective.
2. Base your work on current evidence and worktree state.
3. Before marking the goal as complete, perform a requirement-by-requirement audit.
4. If you encounter the same blocker for 3 consecutive turns and cannot make progress, mark the goal as blocked.
5. Do not start new unrelated work. Stay focused on the goal.`
}

export function buildBudgetLimitPrompt(goal: ThreadGoal, locale?: PromptLocale): string {
  const isZh = (locale ?? getPromptLocale()) === "zh-CN"
  if (isZh) {
    return `## Token 预算已超限

当前目标已达到 Token 预算（${goal.tokenBudget} tokens，已用 ${goal.tokensUsed}）。

请立即收尾：
- 完成正在进行的工作。
- 不要开始新的实质性工作。
- 总结已完成的工作。
- 如果目标可完成则标记为完成，否则标记为 blocked。`
  }
  return `## Budget Limit Reached

The current goal has reached its token budget (${goal.tokenBudget} tokens, used ${goal.tokensUsed}).

You must wrap up immediately:
- Finish any in-progress work.
- Do NOT start new substantial work.
- Summarize what was accomplished.
- Mark the goal as complete if achievable, or blocked if not.`
}

export function buildUsageLimitPrompt(locale?: PromptLocale): string {
  const isZh = (locale ?? getPromptLocale()) === "zh-CN"
  if (isZh) {
    return `## 使用次数已达上限

最大自动续跑次数已用完，此轮后将停止工作流。
- 收尾当前工作。
- 总结已完成的工作和遗留内容。`
  }
  return `## Usage Limit Reached

Maximum auto-continuations reached. The workflow will stop after this turn.
- Wrap up current work.
- Summarize what was accomplished and what remains.`
}
