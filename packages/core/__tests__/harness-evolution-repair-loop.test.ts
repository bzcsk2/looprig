import { describe, test, expect } from "bun:test";
import { BoundedRepairLoop, buildRepairInstruction } from "../src/harness-evolution/repair-loop";
import { createReviewPacket } from "../src/harness-evolution/packets/review-packet";
import { createIncidentPacket, classifyFailureClass } from "../src/harness-evolution/packets/incident-packet";
import { createRecoveryPacket } from "../src/harness-evolution/packets/recovery-packet";

const RUN_ID = "test-repair-loop";

describe("BoundedRepairLoop", () => {
  test("starts with planned state", () => {
    const loop = new BoundedRepairLoop({ baseDir: "/tmp/covalo-test", runId: RUN_ID, mode: "eval", maxRounds: 3, role: "system" });
    const round = loop.startRound(1);
    expect(round.state).toBe("planned");
    expect(round.roundNumber).toBe(1);
  });

  test("accepts when review passes and no incidents", () => {
    const loop = new BoundedRepairLoop({ baseDir: "/tmp/covalo-test", runId: RUN_ID, mode: "eval", maxRounds: 3, role: "system" });
    loop.startRound(1);
    loop.completeWorker("some output");
    loop.setReview(createReviewPacket({
      packetId: `${RUN_ID}:review:r1`,
      runId: RUN_ID,
      mode: "eval",
      role: "supervisor",
      verdict: "ACCEPTED",
      findings: [],
      requiredChecks: [],
      evidenceRefs: [],
      confidence: 1,
    }));
    const plan = loop.getPlan();
    expect(plan.accept).toBe(true);
    expect(plan.escalate).toBe(false);
    expect(plan.recoveryPacket).toBeNull();
  });

  test("repairs when review fails with incidents", () => {
    const loop = new BoundedRepairLoop({ baseDir: "/tmp/covalo-test", runId: RUN_ID, mode: "eval", maxRounds: 3, role: "system" });
    loop.startRound(1);
    loop.completeWorker("bad output");
    loop.setReview(createReviewPacket({
      packetId: `${RUN_ID}:review:r1`,
      runId: RUN_ID,
      mode: "eval",
      role: "supervisor",
      verdict: "NEEDS_FIX",
      findings: [{ id: "F1", severity: "major", category: "correctness", summary: "Bad output", evidence: [], recommendedChecks: [] }],
      requiredChecks: [],
      evidenceRefs: [],
      confidence: 0.3,
    }));
    const fc = classifyFailureClass("worker_failure");
    loop.setIncident(createIncidentPacket({
      packetId: `${RUN_ID}:incident:r1`,
      runId: RUN_ID,
      mode: "eval",
      role: "system",
      incidents: [{
        id: "I1:worker_failure",
        kind: fc.kind,
        severity: fc.severity,
        failureClass: "worker_failure",
        harnessLayer: fc.harnessLayer,
        summary: "Worker failed",
        evidence: [{ file: "worker-output.md", excerpt: "bad output" }],
        recommendedChecks: [],
      }],
    }));
    const plan = loop.getPlan();
    expect(plan.accept).toBe(false);
    expect(plan.escalate).toBe(false);
    expect(plan.recoveryPacket).not.toBeNull();
    expect(plan.recoveryPacket!.gate.disposition).toBe("ready");
  });

  test("blocks recovery when incidents lack evidence", () => {
    const loop = new BoundedRepairLoop({ baseDir: "/tmp/covalo-test", runId: RUN_ID, mode: "eval", maxRounds: 3, role: "system" });
    loop.startRound(1);
    loop.completeWorker("bad output");
    loop.setReview(createReviewPacket({
      packetId: `${RUN_ID}:review:r1`,
      runId: RUN_ID,
      mode: "eval",
      role: "supervisor",
      verdict: "NEEDS_FIX",
      findings: [{ id: "F1", severity: "major", category: "correctness", summary: "Bad output", evidence: [], recommendedChecks: [] }],
      requiredChecks: [],
      evidenceRefs: [],
      confidence: 0.3,
    }));
    const fc = classifyFailureClass("worker_failure");
    loop.setIncident(createIncidentPacket({
      packetId: `${RUN_ID}:incident:r1`,
      runId: RUN_ID,
      mode: "eval",
      role: "system",
      incidents: [{
        id: "I1:worker_failure",
        kind: fc.kind,
        severity: fc.severity,
        failureClass: "worker_failure",
        harnessLayer: fc.harnessLayer,
        summary: "Worker failed",
        evidence: [],
        recommendedChecks: [],
      }],
    }));
    const plan = loop.getPlan();
    expect(plan.escalate).toBe(true);
    expect(plan.recoveryPacket).not.toBeNull();
    expect(plan.recoveryPacket!.gate.disposition).toBe("blocked");
  });

  test("escalates when max rounds exceeded", () => {
    const loop = new BoundedRepairLoop({ baseDir: "/tmp/covalo-test", runId: RUN_ID, mode: "eval", maxRounds: 1, role: "system" });
    loop.startRound(1);
    loop.completeWorker("bad output");
    loop.setReview(createReviewPacket({
      packetId: `${RUN_ID}:review:r1`,
      runId: RUN_ID,
      mode: "eval",
      role: "supervisor",
      verdict: "NEEDS_FIX",
      findings: [],
      requiredChecks: [],
      evidenceRefs: [],
      confidence: 0.3,
    }));
    const fc = classifyFailureClass("worker_failure");
    loop.setIncident(createIncidentPacket({
      packetId: `${RUN_ID}:incident:r1`,
      runId: RUN_ID,
      mode: "eval",
      role: "system",
      incidents: [{
        id: "I1:worker_failure",
        kind: fc.kind,
        severity: fc.severity,
        failureClass: "worker_failure",
        harnessLayer: fc.harnessLayer,
        summary: "Worker failed",
        evidence: [{ file: "worker-output.md", excerpt: "bad" }],
        recommendedChecks: [],
      }],
    }));
    const plan = loop.getPlan();
    expect(plan.escalate).toBe(true);
    expect(plan.remainingRounds).toBe(0);
  });

  test("closes round with accepted state", async () => {
    const loop = new BoundedRepairLoop({ baseDir: "/tmp/covalo-test", runId: RUN_ID, mode: "eval", maxRounds: 3, role: "system" });
    loop.startRound(1);
    await loop.close(true);
    expect(loop.currentRound?.state).toBe("accepted");
    expect(loop.currentRound?.accepted).toBe(true);
  });

  test("keep-best returns best round by gate failures", () => {
    const loop = new BoundedRepairLoop({ baseDir: "/tmp/covalo-test", runId: RUN_ID, mode: "eval", maxRounds: 3, role: "system" });
    loop.startRound(1);
    loop.setGateResults([{ gateId: "v1", passed: false, durationMs: 0, failureClass: "verifier_failure" }]);
    loop.startRound(2);
    loop.setGateResults([{ gateId: "v1", passed: true, durationMs: 0 }]);
    const best = loop.getBestRound();
    expect(best?.roundNumber).toBe(2);
  });

  test("escalation reports best round number", () => {
    const loop = new BoundedRepairLoop({ baseDir: "/tmp/covalo-test", runId: RUN_ID, mode: "eval", maxRounds: 1, role: "system", keepBest: true });
    loop.startRound(1);
    loop.setGateResults([{ gateId: "v1", passed: true, durationMs: 0 }]);
    loop.completeWorker("good output");
    loop.setReview(createReviewPacket({
      packetId: `${RUN_ID}:review:r1`,
      runId: RUN_ID,
      mode: "eval",
      role: "supervisor",
      verdict: "NEEDS_FIX",
      findings: [],
      requiredChecks: [],
      evidenceRefs: [],
      confidence: 0.3,
    }));
    const fc = classifyFailureClass("worker_failure");
    loop.setIncident(createIncidentPacket({
      packetId: `${RUN_ID}:incident:r1`,
      runId: RUN_ID,
      mode: "eval",
      role: "system",
      incidents: [{
        id: "I1:worker_failure",
        kind: fc.kind,
        severity: fc.severity,
        failureClass: "worker_failure",
        harnessLayer: fc.harnessLayer,
        summary: "Worker failed",
        evidence: [{ file: "out", excerpt: "bad" }],
        recommendedChecks: [],
      }],
    }));
    const plan = loop.getPlan();
    expect(plan.escalate).toBe(true);
    expect(plan.bestRoundNumber).toBe(1);
  });
});

describe("buildRepairInstruction", () => {
  test("builds repair instruction from recovery packet", () => {
    const rp = createRecoveryPacket({
      packetId: "test:recovery:r1",
      runId: "test",
      mode: "eval",
      role: "system",
      incidents: [{
        id: "I1", kind: "verification_failure", severity: "major",
        failureClass: "worker_failure", harnessLayer: "verification",
        summary: "test", evidence: [{ file: "x", excerpt: "y" }], recommendedChecks: [],
      }],
    });
    const instr = buildRepairInstruction(rp, 1);
    expect(instr).toContain("Repair Round 1");
    expect(instr).toContain("[containment]");
    expect(instr).toContain("[repair]");
  });
});
