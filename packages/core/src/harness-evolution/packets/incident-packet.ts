import type { PacketBase, EvidenceRef } from "./types";

export const INCIDENT_PACKET_SCHEMA_VERSION = "covalo.incident-packet.v1";

export const INCIDENT_KINDS = [
  "review_needs_fix",
  "verification_failure",
  "build_failure",
  "integration_conflict",
  "runtime_failure",
  "tooling_error",
  "missing_output",
  "context_provenance",
  "planning_error",
  "policy_violation",
  "sandbox_failure",
  "unknown",
] as const;

export type IncidentKind = typeof INCIDENT_KINDS[number];

export type IncidentSeverity = "critical" | "major" | "minor" | "unknown";

export const HARNESS_LAYERS = [
  "environment",
  "tools",
  "context",
  "lifecycle",
  "observability",
  "verification",
  "governance",
  "sandbox",
  "unknown",
] as const;

export type HarnessLayer = typeof HARNESS_LAYERS[number];

export interface IncidentRecord {
  id: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  failureClass: string;
  harnessLayer: HarnessLayer;
  summary: string;
  evidence: EvidenceRef[];
  recommendedChecks: string[];
}

export interface IncidentPacketIssue {
  kind: "no_incident_detected" | "incident_without_evidence";
  detail: string;
}

export interface IncidentPacket extends PacketBase {
  schemaVersion: typeof INCIDENT_PACKET_SCHEMA_VERSION;
  incidents: IncidentRecord[];
  issues: IncidentPacketIssue[];
}

export function createIncidentPacket(params: {
  packetId: string;
  runId: string;
  incidents: IncidentRecord[];
  mode: IncidentPacket["mode"];
  role: IncidentPacket["role"];
  evalRunId?: string;
  caseId?: string;
}): IncidentPacket {
  const issues: IncidentPacketIssue[] = [];
  if (params.incidents.length === 0) {
    issues.push({
      kind: "no_incident_detected",
      detail: "input did not match any known incident pattern",
    });
  }
  for (const inc of params.incidents) {
    if (inc.evidence.length === 0) {
      issues.push({
        kind: "incident_without_evidence",
        detail: `${inc.id} has no evidence`,
      });
    }
  }
  return {
    schemaVersion: INCIDENT_PACKET_SCHEMA_VERSION,
    packetId: params.packetId,
    runId: params.runId,
    evalRunId: params.evalRunId,
    caseId: params.caseId,
    mode: params.mode,
    role: params.role,
    createdAt: new Date().toISOString(),
    incidents: params.incidents,
    issues,
  };
}

export function classifyFailureClass(failureClass: string): {
  kind: IncidentKind;
  severity: IncidentSeverity;
  harnessLayer: HarnessLayer;
} {
  switch (failureClass) {
    case "preflight_failure":
    case "sandbox_failure":
      return { kind: "sandbox_failure", severity: "critical", harnessLayer: "sandbox" };
    case "setup_failure":
      return { kind: "runtime_failure", severity: "major", harnessLayer: "environment" };
    case "registry_failure":
      return { kind: "context_provenance", severity: "critical", harnessLayer: "context" };
    case "worker_empty_output":
      return { kind: "missing_output", severity: "major", harnessLayer: "observability" };
    case "worker_failure":
      return { kind: "verification_failure", severity: "major", harnessLayer: "verification" };
    case "verifier_contract_failure":
      return { kind: "tooling_error", severity: "major", harnessLayer: "verification" };
    case "policy_gate_failure":
      return { kind: "policy_violation", severity: "major", harnessLayer: "governance" };
    case "system_error":
      return { kind: "runtime_failure", severity: "critical", harnessLayer: "environment" };
    default:
      return { kind: "unknown", severity: "unknown", harnessLayer: "unknown" };
  }
}
