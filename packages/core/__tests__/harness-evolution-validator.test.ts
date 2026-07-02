import { describe, test, expect, beforeAll } from "bun:test";
import { PatchValidator } from "../src/harness-evolution/self-harness/patch-validator";
import { SurfaceStore } from "../src/harness-evolution/surfaces/surface-store";
import type { HarnessPatchPacket } from "../src/harness-evolution/self-harness/patch-schema";
import { generatePatchId } from "../src/harness-evolution/self-harness/patch-proposer";

const TEST_BASE = "/tmp/covalo-test-validator-" + Math.random().toString(36).slice(2, 8);

function makePatch(overrides: Partial<HarnessPatchPacket> = {}): HarnessPatchPacket {
  const base: HarnessPatchPacket = {
    schemaVersion: "covalo.harness-patch.v1",
    patchId: generatePatchId("weak:test", "worker-system-prompt"),
    surface: "worker-system-prompt",
    changeType: "append_rule",
    target: "worker-system-prompt",
    beforeHash: "", // Will be filled by test
    patch: "## worker_skips_reading_project_instructions\n\nAdd instruction to read AGENTS.md",
    rationale: "Mined from test",
    expectedImpact: "Better context awareness",
    risk: "low",
    weaknessIds: ["weak:test"],
    ...overrides,
    // PacketBase fields
    runId: "test",
    mode: "loop",
    role: "system",
    createdAt: new Date().toISOString(),
  } as unknown as HarnessPatchPacket;
  return base;
}

describe("PatchValidator", () => {
  let store: SurfaceStore;
  let validator: PatchValidator;

  beforeAll(() => {
    store = new SurfaceStore(TEST_BASE);
    validator = new PatchValidator(store);
  });

  test("validatePatchIntegrity passes for valid patch", async () => {
    const hash = await store.getHash("worker-system-prompt");
    const patch = makePatch({ beforeHash: hash });
    const result = await validator.validatePatchIntegrity(patch);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("validatePatchIntegrity fails on beforeHash mismatch", async () => {
    const patch = makePatch({ beforeHash: "wrong_hash_1234" });
    const result = await validator.validatePatchIntegrity(patch);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("beforeHash mismatch"))).toBe(true);
  });

  test("validatePatchIntegrity warns on safety surfaces", async () => {
    const hash = await store.getHash("runtime-guard-policy");
    const patch = makePatch({
      surface: "runtime-guard-policy",
      beforeHash: hash,
      patchId: generatePatchId("weak:safety", "runtime-guard-policy"),
    });
    const result = await validator.validatePatchIntegrity(patch);
    expect(result.valid).toBe(true); // hash matches
    expect(result.warnings.some(w => w.includes("safety surface"))).toBe(true);
  });

  test("runValidation accepts improvement", async () => {
    const hash = await store.getHash("supervisor-system-prompt");
    const patch = makePatch({
      surface: "supervisor-system-prompt",
      beforeHash: hash,
      patchId: generatePatchId("weak:val1", "supervisor-system-prompt"),
    });

    const result = await validator.runValidation({
      patch,
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

    expect(result.accepted).toBe(true);
    expect(result.heldIn.delta).toBe(3);
    expect(result.heldOut.delta).toBe(1);
  });

  test("runValidation rejects regression", async () => {
    const hash = await store.getHash("supervisor-system-prompt");
    const patch = makePatch({
      surface: "supervisor-system-prompt",
      beforeHash: hash,
      patchId: generatePatchId("weak:val2", "supervisor-system-prompt"),
    });

    const result = await validator.runValidation({
      patch,
      beforeHeldIn: { pass: 5, total: 10 },
      afterHeldIn: { pass: 3, total: 10 },
      beforeHeldOut: { pass: 3, total: 5 },
      afterHeldOut: { pass: 4, total: 5 },
      regressions: ["case-001"],
      beforeInfraFailures: 0,
      afterInfraFailures: 1,
      beforePolicyViolations: 0,
      afterPolicyViolations: 0,
    });

    expect(result.accepted).toBe(false);
  });

  test("runValidation rejects on beforeHash mismatch", async () => {
    const patch = makePatch({
      beforeHash: "bad_hash",
      patchId: generatePatchId("weak:val3", "worker-system-prompt"),
    });

    const result = await validator.runValidation({
      patch,
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

    expect(result.accepted).toBe(false);
    expect(result.heldIn.total).toBe(0); // Integrity check failed
  });

  test("canAutoPromote blocks safety surfaces", () => {
    const mockValidation = {
      patchId: "test",
      heldIn: { beforePass: 5, afterPass: 8, total: 10, delta: 3 },
      heldOut: { beforePass: 3, afterPass: 4, total: 5, delta: 1 },
      accepted: true,
      regressions: [],
      infraFailuresDoNotIncrease: true,
      policyViolationsDoNotIncrease: true,
    };

    expect(validator.canAutoPromote("supervisor-system-prompt", mockValidation)).toBe(true);
    expect(validator.canAutoPromote("runtime-guard-policy", mockValidation)).toBe(false);
    expect(validator.canAutoPromote("tool-use-policy", mockValidation)).toBe(false);
  });
});
