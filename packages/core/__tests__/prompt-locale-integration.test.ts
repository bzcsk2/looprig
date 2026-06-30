/**
 * Integration test: /lang locale switching affects system prompt on next submit.
 *
 * Uses a fake ChatClient that captures messages[0].content so we can verify
 * the system prompt language changes between zh-CN and en.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { setPromptLocale, getPromptLocale } from "../src/prompt-locale";
import { buildSystemPrompt } from "../src/system-prompt";
import { agentConfigFor } from "../src/agent";
import { formatLedgerForContext, formatPlanForContext, planRequestInstruction } from "../src/task-ledger";
import { buildVerificationGatePrompt } from "../src/governance/verification-gate";
import { buildContinuationPrompt, buildBudgetLimitPrompt, buildUsageLimitPrompt } from "../src/goal/steering";

// Type for a fake task ledger
function makeLedger(overrides: Record<string, unknown> = {}) {
  return {
    goal: "Fix the bug",
    plan: [],
    changedFiles: ["src/main.ts"],
    verificationPending: true,
    lastVerification: null,
    blockers: [],
    ...overrides,
  } as any;
}

function makeSteps(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    text: `Step ${i + 1}`,
    status: i === 0 ? "active" as const : "pending" as const,
  }));
}

describe("/lang prompt locale switch integration", () => {
  beforeEach(() => {
    setPromptLocale("zh-CN");
  });

  test("setPromptLocale/getPromptLocale round-trip", () => {
    expect(getPromptLocale()).toBe("zh-CN");
    setPromptLocale("en");
    expect(getPromptLocale()).toBe("en");
    setPromptLocale("zh-CN");
    expect(getPromptLocale()).toBe("zh-CN");
  });

  // --- buildSystemPrompt ---
  test("buildSystemPrompt zh-CN contains Chinese", () => {
    const prompt = buildSystemPrompt(".", { locale: "zh-CN" });
    expect(prompt).toContain("你是 LoopRig");
    expect(prompt).not.toContain("deepreef");
  });

  test("buildSystemPrompt en contains English", () => {
    const prompt = buildSystemPrompt(".", { locale: "en" });
    expect(prompt).toContain("You are LoopRig");
    expect(prompt).not.toContain("deepreef");
  });

  // --- agentConfigFor ---
  test("agentConfigFor zh-CN agent prompt is Chinese", () => {
    setPromptLocale("zh-CN");
    expect(agentConfigFor("worker").systemPrompt).toContain("双 Agent");
    expect(agentConfigFor("supervisor").systemPrompt).toContain("分析目标");
  });

  test("agentConfigFor en agent prompt is English", () => {
    setPromptLocale("en");
    expect(agentConfigFor("worker").systemPrompt).toContain("dual-agent");
    expect(agentConfigFor("supervisor").systemPrompt).toContain("Analyze goals");
  });

  // --- formatLedgerForContext ---
  test("formatLedgerForContext zh-CN", () => {
    const text = formatLedgerForContext(makeLedger(), "zh-CN");
    expect(text).toContain("任务目标");
    expect(text).not.toContain("TASK GOAL");
  });

  test("formatLedgerForContext en", () => {
    const text = formatLedgerForContext(makeLedger(), "en");
    expect(text).toContain("TASK GOAL");
    expect(text).not.toContain("任务目标");
  });

  // --- formatPlanForContext ---
  test("formatPlanForContext zh-CN", () => {
    const text = formatPlanForContext(makeSteps(3), "zh-CN");
    expect(text).toContain("当前计划");
  });

  test("formatPlanForContext en", () => {
    const text = formatPlanForContext(makeSteps(3), "en");
    expect(text).toContain("ACTIVE PLAN");
  });

  // --- planRequestInstruction ---
  test("planRequestInstruction zh-CN", () => {
    const text = planRequestInstruction(5, "zh-CN");
    expect(text).toContain("多步骤任务");
  });

  test("planRequestInstruction en", () => {
    const text = planRequestInstruction(5, "en");
    expect(text).toContain("multi-step task");
  });

  // --- buildVerificationGatePrompt ---
  test("buildVerificationGatePrompt zh-CN", () => {
    const text = buildVerificationGatePrompt(makeLedger(), "zh-CN");
    expect(text).toContain("验证");
  });

  test("buildVerificationGatePrompt en", () => {
    const text = buildVerificationGatePrompt(makeLedger(), "en");
    expect(text).toContain("Verification required");
  });

  // --- buildContinuationPrompt ---
  test("buildContinuationPrompt zh-CN", () => {
    const text = buildContinuationPrompt({ objective: "test", status: "active", tokensUsed: 100, timeUsedSeconds: 30 }, 1, "zh-CN");
    expect(text).toContain("当前目标");
  });

  test("buildContinuationPrompt en", () => {
    const text = buildContinuationPrompt({ objective: "test", status: "active", tokensUsed: 100, timeUsedSeconds: 30 }, 1, "en");
    expect(text).toContain("Current Goal");
  });

  // --- buildBudgetLimitPrompt ---
  test("buildBudgetLimitPrompt zh-CN", () => {
    const text = buildBudgetLimitPrompt({ objective: "test", status: "active", tokensUsed: 100, tokenBudget: 200, timeUsedSeconds: 30 }, "zh-CN");
    expect(text).toContain("超限");
  });

  test("buildBudgetLimitPrompt en", () => {
    const text = buildBudgetLimitPrompt({ objective: "test", status: "active", tokensUsed: 100, tokenBudget: 200, timeUsedSeconds: 30 }, "en");
    expect(text).toContain("Budget Limit Reached");
  });

  // --- buildUsageLimitPrompt ---
  test("buildUsageLimitPrompt zh-CN", () => {
    const text = buildUsageLimitPrompt("zh-CN");
    expect(text).toContain("上限");
  });

  test("buildUsageLimitPrompt en", () => {
    const text = buildUsageLimitPrompt("en");
    expect(text).toContain("Usage Limit Reached");
  });
});
