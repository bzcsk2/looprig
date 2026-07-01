/**
 * Prompt locale integration tests.
 *
 * Covers: setPromptLocale/getPromptLocale, buildSystemPrompt bilingual,
 * agentConfigFor bilingual, buildVerificationGatePrompt bilingual.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { setPromptLocale, getPromptLocale, normalizePromptLocale, isChinesePromptLocale, DEFAULT_LOCALE } from "../src/prompt-locale";
import { buildSystemPrompt } from "../src/system-prompt";
import { agentConfigFor, getAgent, getAgentSystemPrompt } from "../src/agent";
import type { AgentDefinition } from "../src/agent";
import { buildVerificationGatePrompt } from "../src/governance/verification-gate";
import { buildWorkerEvalPrompt, buildSupervisorEvalPrompt } from "../src/scoring/eval-prompts";
import type { AgentBenchmarkCase } from "../src/scoring/types";

// --- Core locale module ---

describe("prompt-locale core", () => {
  beforeEach(() => {
    setPromptLocale("zh-CN");
  });

  test("DEFAULT_LOCALE export is zh-CN per spec", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
  });

  test("setPromptLocale/getPromptLocale round-trip", () => {
    setPromptLocale("en");
    expect(getPromptLocale()).toBe("en");
    setPromptLocale("zh-CN");
    expect(getPromptLocale()).toBe("zh-CN");
  });

  test("normalizePromptLocale handles variants", () => {
    expect(normalizePromptLocale("en")).toBe("en");
    expect(normalizePromptLocale("english")).toBe("en");
    expect(normalizePromptLocale("zh-CN")).toBe("zh-CN");
    expect(normalizePromptLocale("中文")).toBe("zh-CN");
    expect(normalizePromptLocale("chinese")).toBe("zh-CN");
    expect(normalizePromptLocale("fr")).toBe("zh-CN"); // unknown -> default zh-CN
  });

  test("isChinesePromptLocale", () => {
    setPromptLocale("zh-CN");
    expect(isChinesePromptLocale()).toBe(true);
    setPromptLocale("en");
    expect(isChinesePromptLocale()).toBe(false);
  });
});

// --- buildSystemPrompt bilingual ---

describe("buildSystemPrompt locale", () => {
  beforeEach(() => {
    setPromptLocale("zh-CN");
  });

  test("zh-CN contains '你是 LoopRig'", () => {
    const prompt = buildSystemPrompt(".", { locale: "zh-CN" });
    expect(prompt).toContain("你是 LoopRig");
    expect(prompt).not.toContain("deepreef");
  });

  test("en contains 'You are LoopRig'", () => {
    const prompt = buildSystemPrompt(".", { locale: "en" });
    expect(prompt).toContain("You are LoopRig");
    expect(prompt).not.toContain("deepreef");
  });

  test("zh-CN includes environment info", () => {
    const prompt = buildSystemPrompt("/test", { locale: "zh-CN", osPlatform: "linux", shellBackend: "bash" });
    expect(prompt).toContain("工作目录");
    expect(prompt).toContain("/test");
    expect(prompt).toContain("linux");
  });

  test("en includes environment info", () => {
    const prompt = buildSystemPrompt("/test", { locale: "en", osPlatform: "darwin", shellBackend: "zsh" });
    expect(prompt).toContain("Working directory");
    expect(prompt).toContain("/test");
    expect(prompt).toContain("darwin");
  });

  test("defaults to getPromptLocale() when locale not passed", () => {
    setPromptLocale("en");
    const prompt = buildSystemPrompt(".");
    expect(prompt).toContain("You are LoopRig");
    expect(prompt).not.toContain("你是");
  });
});

// --- agentConfigFor bilingual ---

describe("agentConfigFor locale", () => {
  beforeEach(() => {
    setPromptLocale("zh-CN");
  });

  test("zh-CN worker prompt is Chinese", () => {
    setPromptLocale("zh-CN");
    const cfg = agentConfigFor("worker");
    expect(cfg.systemPrompt).toContain("Worker Agent");
    expect(cfg.systemPrompt).toContain("双 Agent");
  });

  test("en worker prompt is English", () => {
    setPromptLocale("en");
    const cfg = agentConfigFor("worker");
    expect(cfg.systemPrompt).toContain("Worker agent");
    expect(cfg.systemPrompt).toContain("dual-agent");
  });

  test("zh-CN supervisor prompt is Chinese", () => {
    setPromptLocale("zh-CN");
    const cfg = agentConfigFor("supervisor");
    expect(cfg.systemPrompt).toMatch(/Supervisor|分析目标/);
  });

  test("custom agent keeps original systemPrompt", () => {
    const customDef: AgentDefinition = {
      name: "custom",
      label: "Custom",
      systemPrompt: "Custom agent prompt",
    };
    const prompt = getAgentSystemPrompt(customDef, "en");
    expect(prompt).toBe("Custom agent prompt");
  });

  test("custom agent with systemPromptByLocale", () => {
    const customDef: AgentDefinition = {
      name: "bilingual",
      label: "Bilingual",
      systemPrompt: "English fallback",
      systemPromptByLocale: {
        "zh-CN": "中文专属",
      },
    };
    expect(getAgentSystemPrompt(customDef, "en")).toBe("English fallback");
    expect(getAgentSystemPrompt(customDef, "zh-CN")).toBe("中文专属");
  });
});

// --- buildVerificationGatePrompt bilingual ---

describe("buildVerificationGatePrompt locale", () => {
  function makeLedger(changedFiles: string[], lastVerification?: { exitCode: number; summary: string }) {
    return {
      goal: "test",
      changedFiles,
      plan: [],
      verificationPending: true,
      lastVerification: lastVerification ?? null,
      blockers: [],
    } as any;
  }

  beforeEach(() => {
    setPromptLocale("zh-CN");
  });

  test("zh-CN is Chinese", () => {
    const ledger = makeLedger(["src/main.ts"]);
    const prompt = buildVerificationGatePrompt(ledger, "zh-CN");
    expect(prompt).toContain("验证");
    expect(prompt).not.toContain("Verification required");
  });

  test("en is English", () => {
    const ledger = makeLedger(["src/main.ts"]);
    const prompt = buildVerificationGatePrompt(ledger, "en");
    expect(prompt).toContain("Verification required");
    expect(prompt).not.toContain("验证");
  });
});

// --- Eval prompts bilingual ---

describe("eval prompts locale", () => {
  const fakeCase: AgentBenchmarkCase = {
    id: "test-001",
    title: "Test Case",
    taskType: "bugfix",
    difficulty: "easy",
    prompt: "Fix the bug",
    verification: ["Run tests"],
    repository: "test-repo",
  };

  beforeEach(() => {
    setPromptLocale("zh-CN");
  });

  test("buildWorkerEvalPrompt zh-CN includes Chinese wrapper", () => {
    const prompt = buildWorkerEvalPrompt(fakeCase, { objective: "" }, "zh-CN");
    expect(prompt).toContain("编码 Worker");
    expect(prompt).toContain("Fix the bug"); // task prompt kept in original
    expect(prompt).not.toContain("Repository");
    expect(prompt).not.toContain("Constraints");
    expect(prompt).not.toContain("Token budget");
  });

  test("buildWorkerEvalPrompt en is English wrapper", () => {
    const prompt = buildWorkerEvalPrompt(fakeCase, { objective: "" }, "en");
    expect(prompt).toContain("coding Worker");
    expect(prompt).not.toContain("编码 Worker");
  });

  test("buildSupervisorEvalPrompt zh-CN includes Chinese wrapper", () => {
    const prompt = buildSupervisorEvalPrompt(fakeCase, "Worker completed", { objective: "" }, "zh-CN");
    expect(prompt).toContain("评估一个编码 Worker");
    expect(prompt).not.toContain("Original Objective");
    expect(prompt).not.toContain("Repository");
  });

  test("buildSupervisorEvalPrompt en is English wrapper", () => {
    const prompt = buildSupervisorEvalPrompt(fakeCase, "Worker completed", { objective: "" }, "en");
    expect(prompt).toContain("evaluating a coding Worker");
    expect(prompt).not.toContain("编码 Worker");
  });

  test("JSON schema keys are not translated", () => {
    const prompt = buildSupervisorEvalPrompt(fakeCase, "", { objective: "" }, "zh-CN");
    expect(prompt).toContain("dimensions");
    expect(prompt).toContain("taskCompletion");
    expect(prompt).toContain("verification");
    expect(prompt).toContain("toolUse");
  });
});
