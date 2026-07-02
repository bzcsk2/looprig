import { describe, test, expect, beforeAll } from "bun:test";
import { PatchProposer, determinePatchRisk, generatePatchId } from "../src/harness-evolution/self-harness/patch-proposer";
import { SurfaceStore } from "../src/harness-evolution/surfaces/surface-store";
import type { Weakness } from "../src/harness-evolution/experience/weakness-miner";

const TEST_BASE = "/tmp/covalo-test-proposer-" + Math.random().toString(36).slice(2, 8);

function makeWeakness(overrides: Partial<Weakness> = {}): Weakness {
  return {
    id: "weak:test_sig",
    signature: "worker_skips_reading_project_instructions",
    affectedSurface: "worker-system-prompt",
    evidenceCount: 5,
    examples: [{ file: "src/main.ts", line: 10 }],
    proposedDirection: "Add instruction to read AGENTS.md",
    confidence: 0.8,
    ...overrides,
  };
}

describe("PatchProposer", () => {
  let store: SurfaceStore;
  let proposer: PatchProposer;

  beforeAll(() => {
    store = new SurfaceStore(TEST_BASE);
    proposer = new PatchProposer(store);
  });

  test("proposeFromWeakness generates a valid patch packet", async () => {
    const weakness = makeWeakness();
    const patch = await proposer.proposeFromWeakness(weakness);

    expect(patch.schemaVersion).toBe("covalo.harness-patch.v1");
    expect(patch.surface).toBe("worker-system-prompt");
    expect(patch.weaknessIds).toEqual(["weak:test_sig"]);
    expect(patch.patchId).toMatch(/^p:/);
    expect(patch.beforeHash).toHaveLength(16);
    expect(patch.rationale).toContain("worker_skips_reading_project_instructions");
  });

  test("proposeFromWeakness generates unique patch IDs", async () => {
    const w1 = makeWeakness({ id: "weak:test_1" });
    const w2 = makeWeakness({ id: "weak:test_2", affectedSurface: "review-rubric" });

    const p1 = await proposer.proposeFromWeakness(w1);
    const p2 = await proposer.proposeFromWeakness(w2);

    expect(p1.patchId).not.toBe(p2.patchId);
  });

  test("proposeFromWeaknesses deduplicates by surface", async () => {
    const weaknesses = [
      makeWeakness({ id: "weak:1", signature: "worker_skips_reading_project_instructions", affectedSurface: "worker-system-prompt" }),
      makeWeakness({ id: "weak:2", signature: "worker_uses_wrong_package_manager", affectedSurface: "worker-system-prompt" }),
      makeWeakness({ id: "weak:3", signature: "supervisor_accepts_failed_verifier", affectedSurface: "supervisor-system-prompt" }),
    ];

    const patches = await proposer.proposeFromWeaknesses(weaknesses);
    const surfaces = patches.map(p => p.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length); // No duplicates
    expect(surfaces).toContain("worker-system-prompt");
    expect(surfaces).toContain("supervisor-system-prompt");
  });

  test("patch contains valid changeType for each weakness", async () => {
    const w1 = makeWeakness({ signature: "worker_skips_reading_project_instructions" });
    const w2 = makeWeakness({
      id: "weak:tighten",
      signature: "runtime_guard_too_permissive",
      affectedSurface: "runtime-guard-policy",
    });
    const w3 = makeWeakness({
      id: "weak:replace",
      signature: "supervisor_review_without_evidence",
      affectedSurface: "review-rubric",
    });

    const p1 = await proposer.proposeFromWeakness(w1);
    const p2 = await proposer.proposeFromWeakness(w2);
    const p3 = await proposer.proposeFromWeakness(w3);

    expect(p1.changeType).toBe("append_rule");
    expect(p2.changeType).toBe("tighten_policy");
    expect(p3.changeType).toBe("replace_section");
  });
});

describe("determinePatchRisk", () => {
  test("non-safety surfaces default to low risk for append_rule", () => {
    expect(determinePatchRisk("supervisor-system-prompt", "append_rule")).toBe("low");
  });

  test("non-safety surfaces medium risk for replace_section", () => {
    expect(determinePatchRisk("supervisor-system-prompt", "replace_section")).toBe("medium");
  });

  test("safety surfaces are high risk for replace_section", () => {
    expect(determinePatchRisk("runtime-guard-policy", "replace_section")).toBe("high");
  });

  test("safety surfaces medium risk for tighten_policy", () => {
    expect(determinePatchRisk("runtime-guard-policy", "tighten_policy")).toBe("medium");
  });

  test("add_example is always low risk", () => {
    expect(determinePatchRisk("runtime-guard-policy", "add_example")).toBe("high");
  });
});

describe("generatePatchId", () => {
  test("generates deterministic ID", () => {
    const id1 = generatePatchId("weak:test", "supervisor-system-prompt");
    const id2 = generatePatchId("weak:test", "supervisor-system-prompt");
    expect(id1).toBe(id2);
  });

  test("generates different IDs for different inputs", () => {
    const id1 = generatePatchId("weak:test", "supervisor-system-prompt");
    const id2 = generatePatchId("weak:test", "worker-system-prompt");
    expect(id1).not.toBe(id2);
  });
});
