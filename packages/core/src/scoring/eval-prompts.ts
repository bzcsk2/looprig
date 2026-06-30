/**
 * Eval prompt builders for Worker and Supervisor evaluation.
 */

import type { AgentBenchmarkCase } from "./types.js"
import { getPromptLocale } from "../prompt-locale.js"
import type { PromptLocale } from "../prompt-locale.js"

export interface EvalPromptOptions {
  objective: string
  maxRounds?: number
  tokenBudget?: number
}

/**
 * Build a prompt for Worker evaluation that instructs the worker to complete a benchmark case
 * and return a structured JSON report.
 */
export function buildWorkerEvalPrompt(
  benchmarkCase: AgentBenchmarkCase,
  options: EvalPromptOptions = { objective: "" },
  locale?: PromptLocale,
): string {
  const objective = options.objective || benchmarkCase.prompt
  const maxRounds = options.maxRounds ?? 10
  const tokenBudget = options.tokenBudget ?? 0
  const isZh = (locale ?? getPromptLocale()) === "zh-CN"

  const parts: string[] = isZh
    ? [
        `你正在作为编码 Worker 接受评估。`,
        ``,
        `## 用例`,
        `ID: ${benchmarkCase.id}`,
        `标题: ${benchmarkCase.title}`,
        `类型: ${benchmarkCase.taskType}`,
        `难度: ${benchmarkCase.difficulty}`,
        ``,
        `## 任务`,
        ``,
        objective,
        ``,
      ]
    : [
        `You are being evaluated as a coding Worker.`,
        ``,
        `## Case`,
        `ID: ${benchmarkCase.id}`,
        `Title: ${benchmarkCase.title}`,
        `Type: ${benchmarkCase.taskType}`,
        `Difficulty: ${benchmarkCase.difficulty}`,
        ``,
        `## Task`,
        ``,
        objective,
        ``,
      ]

  if (benchmarkCase.repository) {
    parts.push(`### Repository`)
    parts.push(``)
    parts.push(benchmarkCase.repository)
    parts.push(``)
  }

  if (tokenBudget > 0) {
    parts.push(`### Constraints`)
    parts.push(``)
    parts.push(`Token budget: ${tokenBudget}`)
    parts.push(``)
  }

  if (benchmarkCase.verification && benchmarkCase.verification.length > 0) {
    parts.push(`### ${isZh ? "验证要求" : "Verification Required"}`)
    for (const v of benchmarkCase.verification) {
      parts.push(`- ${v}`)
    }
    parts.push(``)
  }

  parts.push(`### ${isZh ? "说明" : "Instructions"}`)
  parts.push(``)
  parts.push(isZh
    ? "完成上述目标。使用可用工具读写和编辑文件。"
    : "Complete the objective above. Use the available tools to read, write, and edit files.")
  if (maxRounds > 0) {
    parts.push(isZh ? `最大轮次: ${maxRounds}` : `Maximum rounds: ${maxRounds}`)
  }
  parts.push(``)
  parts.push(isZh ? "完成后，在代码块中返回结构化的 JSON 报告：" : "When done, return a structured JSON report in a code block:")
  parts.push(`\`\`\`json`)
  parts.push(`{`)
  parts.push(`  "summary": "brief summary of what was accomplished",`)
  parts.push(`  "completedSteps": ["step1", "step2"],`)
  parts.push(`  "changedFiles": ["path/to/file1", "path/to/file2"],`)
  parts.push(`  "verification": {`)
  parts.push(`    "passed": true,`)
  parts.push(`    "commands": ["command1", "command2"],`)
  parts.push(`    "summary": "verification result summary"`)
  parts.push(`  },`)
  parts.push(`  "blockers": []`)
  parts.push(`}`)
  parts.push(`\`\`\``)

  return parts.join("\n")
}

/**
 * Build a prompt for Supervisor evaluation that instructs the supervisor to assess
 * a worker's completion and return a structured SupervisorRunAssessment.
 */
export function buildSupervisorEvalPrompt(
  benchmarkCase: AgentBenchmarkCase,
  workerReport: string,
  options: EvalPromptOptions = { objective: "" },
  locale?: PromptLocale,
): string {
  const objective = options.objective || benchmarkCase.prompt
  const isZh = (locale ?? getPromptLocale()) === "zh-CN"

  const parts: string[] = [
    isZh ? `## Supervisor 评估` : `## Supervisor Assessment`,
    ``,
    isZh
      ? "你正在评估一个编码 Worker。不要执行工具或重复工作。"
      : "You are evaluating a coding Worker. Do NOT execute tools or repeat the work.",
    isZh
      ? "阅读任务、Worker 报告并提供结构化评估。"
      : "Read the task, the Worker report, and provide a structured assessment.",
    ``,
    `### Original Objective`,
    objective,
    ``,
  ]

  if (benchmarkCase.repository) {
    parts.push(`### ${isZh ? "仓库" : "Repository"}`)
    parts.push(``)
    parts.push(benchmarkCase.repository)
    parts.push(``)
  }

  parts.push(`### ${isZh ? "Worker 报告" : "Worker Report"}`)
  parts.push(workerReport || (isZh ? "（未提供报告）" : "(no report provided)"))
  parts.push(``)

  if (benchmarkCase.verification && benchmarkCase.verification.length > 0) {
    parts.push(`### ${isZh ? "验证标准" : "Verification Criteria"}`)
    for (const criterion of benchmarkCase.verification) {
      parts.push(`- ${criterion}`)
    }
    parts.push(``)
  }

  parts.push(`### ${isZh ? "评估说明" : "Assessment Instructions"}`)
  parts.push(``)
  if (isZh) {
    parts.push(`评估 Worker 是否成功完成了目标。`)
    parts.push(`考虑以下方面：`)
    parts.push(`- Worker 是否完成了所有必需步骤？`)
    parts.push(`- 验证标准是否全部满足？验证结果是否可信？`)
    parts.push(`- 实现是否符合目标要求？`)
    parts.push(`- 是否存在关键问题、遗漏或阻塞项？`)
  } else {
    parts.push(`Evaluate whether the Worker successfully completed the objective.`)
    parts.push(`Consider:`)
    parts.push(`- Did the Worker complete all required steps?`)
    parts.push(`- Were all verification criteria met? Are the verification results credible?`)
    parts.push(`- Does the implementation match the objective requirements?`)
    parts.push(`- Are there any critical issues, gaps, or blockers?`)
  }
  parts.push(``)
  parts.push(isZh ? "在代码块中返回结构化的 JSON 评估：" : "Return a structured JSON assessment in a code block:")
  parts.push(`\`\`\`json`)
  parts.push(`{`)
  parts.push(`  "summary": "overall assessment of the Worker's performance",`)
  parts.push(`  "completed": true,`)
  parts.push(`  "verificationPassed": true,`)
  parts.push(`  "dimensions": {`)
  parts.push(`    "taskCompletion": 80,`)
  parts.push(`    "verification": 75,`)
  parts.push(`    "toolUse": 70,`)
  parts.push(`    "efficiency": 70,`)
  parts.push(`    "autonomy": 80,`)
  parts.push(`    "instructionFollowing": 80,`)
  parts.push(`    "recovery": 70,`)
  parts.push(`    "communication": 75,`)
  parts.push(`    "safety": 90`)
  parts.push(`  },`)
  parts.push(`  "promptStrategies": []`)
  parts.push(`}`)
  parts.push(`\`\`\``)
  parts.push(``)
  parts.push(isZh ? "各维度得分 0-100，越高越好。" : "Each dimension is scored 0-100. Higher is better.")

  return parts.join("\n")
}
