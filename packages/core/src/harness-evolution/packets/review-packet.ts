import type { PacketBase, EvidenceRef, ReviewVerdict } from "./types";

export const REVIEW_PACKET_SCHEMA_VERSION = "covalo.review-packet.v1";

export const REVIEW_FINDING_CATEGORIES = [
  "correctness",
  "security",
  "tests",
  "performance",
  "maintainability",
  "integration",
  "documentation",
  "policy",
  "traceability",
  "other",
] as const;

export type ReviewFindingCategory = typeof REVIEW_FINDING_CATEGORIES[number];

export const REVIEW_FINDING_SEVERITIES = [
  "critical",
  "major",
  "minor",
  "nit",
  "unknown",
] as const;

export type ReviewFindingSeverity = typeof REVIEW_FINDING_SEVERITIES[number];

export interface ReviewFinding {
  id: string;
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  summary: string;
  evidence: EvidenceRef[];
  requiredFix?: string;
  recommendedChecks: string[];
}

export interface ReviewPacketIssue {
  kind: "missing_verdict" | "finding_without_evidence" | "schema_parse_error";
  detail: string;
}

export interface ReviewPacket extends PacketBase {
  schemaVersion: typeof REVIEW_PACKET_SCHEMA_VERSION;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  requiredChecks: string[];
  evidenceRefs: EvidenceRef[];
  confidence: number;
  issues: ReviewPacketIssue[];
}

export function createReviewPacket(params: {
  packetId: string;
  runId: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  requiredChecks: string[];
  evidenceRefs: EvidenceRef[];
  confidence: number;
  mode: ReviewPacket["mode"];
  role: ReviewPacket["role"];
  evalRunId?: string;
  caseId?: string;
}): ReviewPacket {
  const issues: ReviewPacketIssue[] = [];
  if (params.verdict === "UNKNOWN") {
    issues.push({
      kind: "missing_verdict",
      detail: "review output did not contain ACCEPTED or NEEDS_FIX verdict",
    });
  }
  for (const f of params.findings) {
    if (f.evidence.length === 0) {
      issues.push({
        kind: "finding_without_evidence",
        detail: `${f.id} has no file evidence`,
      });
    }
  }
  return {
    schemaVersion: REVIEW_PACKET_SCHEMA_VERSION,
    packetId: params.packetId,
    runId: params.runId,
    evalRunId: params.evalRunId,
    caseId: params.caseId,
    mode: params.mode,
    role: params.role,
    createdAt: new Date().toISOString(),
    verdict: params.verdict,
    findings: params.findings,
    requiredChecks: params.requiredChecks,
    evidenceRefs: params.evidenceRefs,
    confidence: params.confidence,
    issues,
  };
}
