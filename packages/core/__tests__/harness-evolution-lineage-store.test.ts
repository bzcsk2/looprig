import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { LineageStore } from "../src/harness-evolution/self-harness/lineage-store";
import type { HarnessLineageEntry } from "../src/harness-evolution/self-harness/lineage-store";
import { buildValidationResult } from "../src/harness-evolution/self-harness/promotion-gate";

const BASE = "/tmp/covalo-test-lineage-" + Math.random().toString(36).slice(2, 8);

function makeLineage(overrides: Partial<HarnessLineageEntry> = {}): HarnessLineageEntry {
  const val = buildValidationResult({
    patchId: overrides.patchId ?? "p1",
    beforeHeldIn: { pass: 5, total: 10 },
    afterHeldIn: { pass: 8, total: 10 },
    beforeHeldOut: { pass: 3, total: 5 },
    afterHeldOut: { pass: 4, total: 5 },
    regressions: [],
    beforeInfraFailures: 0,
    afterInfraFailures: 0,
    beforePolicyViolations: 0,
    afterPolicyViolations: 0,
  });
  return {
    schemaVersion: "covalo.harness-lineage.v1",
    patchId: "p1",
    surface: "supervisor-system-prompt",
    decision: "accepted",
    weaknessIds: ["w1"],
    beforeHash: "abc123",
    afterHash: "def456",
    validation: val,
    promotedBy: "self-harness",
    acceptedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("LineageStore", () => {
  let store: LineageStore;

  beforeAll(async () => {
    store = new LineageStore(BASE);
    await store.init();
  });

  afterAll(async () => {
    // cleanup
  });

  test("append and getAll", async () => {
    await store.append(makeLineage({ patchId: "lineage:1" }));
    const all = await store.getAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.some(e => e.patchId === "lineage:1")).toBe(true);
  });

  test("getBySurface filters correctly", async () => {
    await store.append(makeLineage({ patchId: "lineage:2", surface: "worker-system-prompt" }));
    await store.append(makeLineage({ patchId: "lineage:3", surface: "worker-system-prompt", decision: "rejected" }));
    const results = await store.getBySurface("worker-system-prompt");
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      expect(r.surface).toBe("worker-system-prompt");
    }
  });

  test("getAccepted returns only accepted", async () => {
    await store.append(makeLineage({ patchId: "lineage:4", decision: "accepted" }));
    await store.append(makeLineage({ patchId: "lineage:5", decision: "rejected" }));
    const accepted = await store.getAccepted();
    for (const a of accepted) {
      expect(a.decision).toBe("accepted");
    }
  });

  test("getLatestForSurface returns most recent", async () => {
    await store.append(makeLineage({
      patchId: "lineage:6",
      surface: "review-rubric",
      acceptedAt: new Date("2024-01-01").toISOString(),
    }));
    await store.append(makeLineage({
      patchId: "lineage:7",
      surface: "review-rubric",
      acceptedAt: new Date("2025-01-01").toISOString(),
    }));
    const latest = await store.getLatestForSurface("review-rubric");
    expect(latest).not.toBeNull();
    expect(latest!.patchId).toBe("lineage:7");
  });
});
