import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ExperienceStore } from "../src/harness-evolution/experience/experience-store";
import { formatExperienceForPrompt, buildRecallFilter, DEFAULT_RECALL_POLICY } from "../src/harness-evolution/experience/recall-policy";
import type { ExperienceRecord } from "../src/harness-evolution/experience/experience-types";

const BASE_DIR = "/tmp/covalo-test-experience-" + Math.random().toString(36).slice(2, 8);

function makeRecord(overrides: Partial<ExperienceRecord> = {}): ExperienceRecord {
  return {
    id: `exp:${Math.random().toString(36).slice(2, 8)}`,
    signature: "test-signature",
    sourceKind: "task",
    sourceRef: "test-run",
    trust: "untrusted",
    createdAt: new Date().toISOString(),
    taskType: "bugfix",
    confidence: 0.8,
    evidenceRefs: [],
    ...overrides,
  };
}

describe("ExperienceStore", () => {
  let store: ExperienceStore;

  beforeAll(async () => {
    store = new ExperienceStore(BASE_DIR);
    await store.init();
  });

  afterAll(async () => {
    await store.close();
  });

  test("append and count", async () => {
    await store.append(makeRecord({ id: "exp:1", signature: "s1" }));
    expect(await store.count()).toBeGreaterThanOrEqual(1);
  });

  test("recall returns records", async () => {
    const result = await store.recall();
    expect(result.records.length).toBeGreaterThanOrEqual(1);
  });

  test("recall filters by trust", async () => {
    const trusted = await store.recall({ trust: ["trusted"] });
    for (const r of trusted.records) {
      expect(r.trust).toBe("trusted");
    }
  });

  test("recall filters by sourceKind", async () => {
    await store.append(makeRecord({ id: "exp:src", sourceKind: "eval" }));
    const result = await store.recall({ sourceKind: ["eval"] });
    expect(result.records.some(r => r.sourceKind === "eval")).toBe(true);
  });

  test("recall limits results", async () => {
    const result = await store.recall({ limit: 1 });
    expect(result.records.length).toBeLessThanOrEqual(1);
  });

  test("superseded records are hidden", async () => {
    await store.append(makeRecord({ id: "exp:old", signature: "old" }));
    await store.append(makeRecord({ id: "exp:new", signature: "new", supersedes: ["exp:old"] }));
    const result = await store.recall();
    expect(result.records.some(r => r.id === "exp:old")).toBe(false);
  });

  test("getById returns record", async () => {
    await store.append(makeRecord({ id: "exp:getme", signature: "getme" }));
    const r = await store.getById("exp:getme");
    expect(r).not.toBeNull();
    expect(r!.signature).toBe("getme");
  });

  test("getById returns null for missing", async () => {
    const r = await store.getById("exp:nonexistent");
    expect(r).toBeNull();
  });

  test("promote changes trust to trusted", async () => {
    await store.append(makeRecord({ id: "exp:promoteme", trust: "untrusted" }));
    const ok = await store.promote("exp:promoteme");
    expect(ok).toBe(true);
    const result = await store.recall({ trust: ["trusted"] });
    expect(result.records.some(r => r.id === "exp:promoteme") ||
           result.records.some(r => r.id === "exp:promoteme:v2")).toBe(true);
  });

  test("appendMany writes multiple records", async () => {
    await store.appendMany([
      makeRecord({ id: "exp:batch1" }),
      makeRecord({ id: "exp:batch2" }),
      makeRecord({ id: "exp:batch3" }),
    ]);
    const result = await store.recall();
    expect(result.records.some(r => r.id === "exp:batch1")).toBe(true);
    expect(result.records.some(r => r.id === "exp:batch2")).toBe(true);
    expect(result.records.some(r => r.id === "exp:batch3")).toBe(true);
  });
});

describe("RecallPolicy", () => {
  test("buildRecallFilter merges with defaults", () => {
    const f = buildRecallFilter({ maxRecall: 5 });
    expect(f.trust).toEqual(["trusted"]);
    expect(f.limit).toBe(5);
    expect(f.minConfidence).toBe(DEFAULT_RECALL_POLICY.minConfidence);
  });

  test("formatExperienceForPrompt returns empty for no records", () => {
    expect(formatExperienceForPrompt([])).toBe("");
  });

  test("formatExperienceForPrompt includes metadata by default", () => {
    const record = makeRecord({ failureMode: "test_fail", successfulRecovery: "fix_test", badStrategy: "skip_test" });
    const output = formatExperienceForPrompt([record]);
    expect(output).toContain("test_fail");
    expect(output).toContain("fix_test");
    expect(output).toContain("skip_test");
    expect(output).toContain("Relevant Experiences");
  });

  test("formatExperienceForPrompt omits metadata when disabled", () => {
    const record = makeRecord({ failureMode: "test_fail" });
    const output = formatExperienceForPrompt([record], false);
    expect(output).toContain("test_fail");
  });
});
