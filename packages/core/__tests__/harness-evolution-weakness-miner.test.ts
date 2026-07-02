import { describe, test, expect } from "bun:test";
import { mineFromIncidents, mineFromReview, formatWeaknesses } from "../src/harness-evolution/experience/weakness-miner";
import type { IncidentPacket } from "../src/harness-evolution/packets/incident-packet";
import type { ReviewPacket } from "../src/harness-evolution/packets/review-packet";

function makeIncidentPacket(overrides: Partial<IncidentPacket> = {}): IncidentPacket {
  return {
    schemaVersion: "covalo.incident-packet.v1",
    packetId: "test:inc:1",
    runId: "test",
    mode: "eval",
    role: "system",
    createdAt: new Date().toISOString(),
    incidents: [],
    issues: [],
    ...overrides,
  } as IncidentPacket;
}

function makeReviewPacket(verdict: "ACCEPTED" | "NEEDS_FIX" | "UNKNOWN" = "ACCEPTED", emptyEvidence = false): ReviewPacket {
  return {
    schemaVersion: "covalo.review-packet.v1",
    packetId: "test:rv:1",
    runId: "test",
    mode: "eval",
    role: "supervisor",
    createdAt: new Date().toISOString(),
    verdict,
    findings: emptyEvidence
      ? [{ id: "F1", severity: "major", category: "correctness", summary: "No evidence", evidence: [], recommendedChecks: [] }]
      : [{ id: "F1", severity: "major", category: "correctness", summary: "Has evidence", evidence: [{ file: "src/main.ts", line: 10 }], recommendedChecks: [] }],
    requiredChecks: [],
    evidenceRefs: [],
    confidence: 0.9,
    issues: [],
  } as ReviewPacket;
}

describe("WeaknessMiner", () => {
  test("mineFromIncidents produces weaknesses from known incident kinds", () => {
    const packet = makeIncidentPacket({
      incidents: [{
        id: "I1", kind: "missing_output", severity: "major",
        failureClass: "worker_empty_output", harnessLayer: "observability",
        summary: "empty", evidence: [{ file: "out.md", excerpt: "" }],
        recommendedChecks: [],
      }],
    });
    const weaknesses = mineFromIncidents([packet]);
    expect(weaknesses.length).toBeGreaterThanOrEqual(1);
    expect(weaknesses[0].signature).toBe("worker_claims_done_without_verification");
  });

  test("mineFromIncidents returns multiple distinct weaknesses", () => {
    const packet = makeIncidentPacket({
      incidents: [
        { id: "I1", kind: "missing_output", severity: "major", failureClass: "worker_empty_output", harnessLayer: "observability", summary: "empty", evidence: [], recommendedChecks: [] },
        { id: "I2", kind: "policy_violation", severity: "major", failureClass: "policy_gate_failure", harnessLayer: "governance", summary: "policy", evidence: [], recommendedChecks: [] },
      ],
    });
    const weaknesses = mineFromIncidents([packet]);
    const sigs = new Set(weaknesses.map(w => w.signature));
    expect(sigs.has("worker_claims_done_without_verification")).toBe(true);
    expect(sigs.has("supervisor_accepts_failed_verifier")).toBe(true);
  });

  test("mineFromReview detects findings without evidence", () => {
    const reviews = [makeReviewPacket("NEEDS_FIX", true), makeReviewPacket("NEEDS_FIX", true)];
    const weaknesses = mineFromReview(reviews);
    expect(weaknesses.length).toBeGreaterThanOrEqual(1);
    expect(weaknesses[0].signature).toBe("supervisor_review_without_evidence");
  });

  test("mineFromReview returns empty when all findings have evidence", () => {
    const reviews = [makeReviewPacket("ACCEPTED", false)];
    const weaknesses = mineFromReview(reviews);
    expect(weaknesses).toHaveLength(0);
  });

  test("formatWeaknesses produces readable output", () => {
    const weaknesses = [
      { id: "weak:t1", signature: "worker_skips_reading_project_instructions", affectedSurface: "worker-system-prompt" as const, evidenceCount: 3, examples: [], proposedDirection: "Add instruction", confidence: 0.6 },
    ];
    const output = formatWeaknesses(weaknesses);
    expect(output).toContain("worker_skips_reading_project_instructions");
    expect(output).toContain("worker-system-prompt");
  });

  test("formatWeaknesses returns empty for no weaknesses", () => {
    expect(formatWeaknesses([])).toBe("");
  });
});
