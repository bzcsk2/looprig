import { describe, test, expect, beforeAll } from "bun:test";
import { OutcomeStore } from "../src/harness-evolution/outcomes/outcome-store";
import { aggregateByModel, formatModelReport } from "../src/harness-evolution/outcomes/model-outcome";
import type { ModelOutcomeRecord } from "../src/harness-evolution/outcomes/model-outcome";

const BASE = "/tmp/covalo-test-outcomes-" + Math.random().toString(36).slice(2, 8);

function makeRecord(overrides: Partial<ModelOutcomeRecord> = {}): ModelOutcomeRecord {
  return {
    taskSignature: "test-task",
    modelTarget: "gpt-4",
    role: "worker",
    outcome: "pass",
    toolFailureCount: 0,
    repairRounds: 0,
    durationMs: 1000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("OutcomeStore", () => {
  let store: OutcomeStore;

  beforeAll(async () => {
    store = new OutcomeStore(BASE);
    await store.init();
  });

  test("append and count", async () => {
    await store.append(makeRecord({ taskSignature: "t1" }));
    expect(await store.count()).toBeGreaterThanOrEqual(1);
  });

  test("getAll returns records", async () => {
    const all = await store.getAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  test("getByModel filters correctly", async () => {
    await store.append(makeRecord({ taskSignature: "t2", modelTarget: "gpt-4" }));
    await store.append(makeRecord({ taskSignature: "t3", modelTarget: "claude-3" }));
    const gpt4 = await store.getByModel("gpt-4");
    for (const r of gpt4) {
      expect(r.modelTarget).toBe("gpt-4");
    }
  });

  test("getReport produces aggregates", async () => {
    const report = await store.getReport();
    expect(report.length).toBeGreaterThanOrEqual(1);
    for (const agg of report) {
      expect(agg.totalRuns).toBeGreaterThanOrEqual(1);
      expect(agg.passRate).toBeGreaterThanOrEqual(0);
      expect(agg.passRate).toBeLessThanOrEqual(1);
    }
  });
});

describe("ModelOutcomeAggregate", () => {
  test("aggregateByModel groups by model:role", () => {
    const records: ModelOutcomeRecord[] = [
      makeRecord({ modelTarget: "gpt-4", role: "worker", outcome: "pass" }),
      makeRecord({ modelTarget: "gpt-4", role: "worker", outcome: "pass" }),
      makeRecord({ modelTarget: "gpt-4", role: "worker", outcome: "fail" }),
      makeRecord({ modelTarget: "claude-3", role: "worker", outcome: "pass" }),
      makeRecord({ modelTarget: "claude-3", role: "supervisor", outcome: "pass" }),
    ];
    const aggs = aggregateByModel(records);
    expect(aggs.length).toBe(3);
    const gpt4 = aggs.find(a => a.modelTarget === "gpt-4");
    expect(gpt4).toBeDefined();
    expect(gpt4!.totalRuns).toBe(3);
    expect(gpt4!.passCount).toBe(2);
    expect(gpt4!.failCount).toBe(1);
    expect(gpt4!.passRate).toBeCloseTo(2 / 3, 4);
  });

  test("aggregateByModel computes averages", () => {
    const records: ModelOutcomeRecord[] = [
      makeRecord({ modelTarget: "gpt-4", role: "worker", durationMs: 1000, toolFailureCount: 1, repairRounds: 0 }),
      makeRecord({ modelTarget: "gpt-4", role: "worker", durationMs: 3000, toolFailureCount: 3, repairRounds: 2 }),
    ];
    const aggs = aggregateByModel(records);
    const gpt4 = aggs.find(a => a.modelTarget === "gpt-4");
    expect(gpt4!.avgDurationMs).toBe(2000);
    expect(gpt4!.avgToolFailures).toBe(2);
    expect(gpt4!.avgRepairRounds).toBe(1);
  });

  test("aggregateByModel includes cost when present", () => {
    const records: ModelOutcomeRecord[] = [
      makeRecord({ modelTarget: "gpt-4", role: "worker", cost: 0.01, durationMs: 100 }),
      makeRecord({ modelTarget: "gpt-4", role: "worker", cost: 0.03, durationMs: 200 }),
    ];
    const aggs = aggregateByModel(records);
    const gpt4 = aggs.find(a => a.modelTarget === "gpt-4");
    expect(gpt4!.avgCost).toBeCloseTo(0.02, 4);
  });

  test("aggregateByModel returns empty for empty input", () => {
    expect(aggregateByModel([])).toHaveLength(0);
  });
});

describe("formatModelReport", () => {
  test("formats aggregates into readable report", () => {
    const aggs = [{
      modelTarget: "gpt-4",
      role: "worker" as const,
      totalRuns: 10,
      passCount: 8,
      failCount: 2,
      infraErrorCount: 0,
      cancelledCount: 0,
      passRate: 0.8,
      avgDurationMs: 1500,
      avgToolFailures: 0.5,
      avgRepairRounds: 0.3,
      avgCost: 0.015,
    }];
    const report = formatModelReport(aggs);
    expect(report).toContain("gpt-4");
    expect(report).toContain("80.0%");
    expect(report).toContain("8/10");
    expect(report).toContain("$0.015");
  });

  test("returns placeholder for empty data", () => {
    expect(formatModelReport([])).toContain("No model outcome data");
  });
});
