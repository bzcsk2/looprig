import type { PacketBase } from "./types";
import type { IncidentRecord } from "./incident-packet";

export const RECOVERY_PACKET_SCHEMA_VERSION = "covalo.recovery-packet.v1";

export type RecoveryDisposition = "ready" | "blocked";

export type RecoveryPhase = "containment" | "repair" | "validation" | "learning";

export type RecoveryScope = "worker" | "supervisor" | "harness" | "user";

export interface RecoveryGate {
  disposition: RecoveryDisposition;
  reasons: string[];
}

export interface RecoveryStep {
  id: string;
  phase: RecoveryPhase;
  scope: RecoveryScope;
  action: string;
  rationale: string;
  evidenceIncidentIds: string[];
  checks: string[];
}

export interface RecoveryPacket extends PacketBase {
  schemaVersion: typeof RECOVERY_PACKET_SCHEMA_VERSION;
  gate: RecoveryGate;
  steps: RecoveryStep[];
}

export function createRecoveryPacket(params: {
  packetId: string;
  runId: string;
  incidents: IncidentRecord[];
  mode: RecoveryPacket["mode"];
  role: RecoveryPacket["role"];
  evalRunId?: string;
  caseId?: string;
}): RecoveryPacket {
  const incidentIds = params.incidents.map((i) => i.id);

  const steps: RecoveryStep[] = [];
  const noEvidence = params.incidents.some((i) => i.evidence.length === 0);
  const gate: RecoveryGate = noEvidence || params.incidents.length === 0
    ? {
        disposition: "blocked",
        reasons: noEvidence
          ? ["Some incidents lack evidence, recovery guidance is blocked"]
          : ["No incidents detected, recovery guidance is blocked"],
      }
    : {
        disposition: "ready",
        reasons: ["Recovery steps grounded in incident evidence"],
      };

  if (gate.disposition === "ready") {
    const failureCause = params.incidents[0].kind;
    steps.push(
      {
        id: "R1",
        phase: "containment",
        scope: "supervisor",
        action: `Contain the failure by analyzing the root cause: ${failureCause}`,
        rationale: "Containment prevents repeated failures with the same root cause",
        evidenceIncidentIds: incidentIds,
        checks: ["Verify the failure class before retrying"],
      },
      {
        id: "R2",
        phase: "repair",
        scope: "worker",
        action: "Apply the minimal fix for the identified failure",
        rationale: "Small evidence-grounded patches are easier to validate",
        evidenceIncidentIds: incidentIds,
        checks: ["Re-run affected verification gates after repair"],
      },
      {
        id: "R3",
        phase: "validation",
        scope: "supervisor",
        action: "Re-run deterministic gates and supervisor review",
        rationale: "Diagnosis becomes recovery only when the next attempt can verify the change",
        evidenceIncidentIds: incidentIds,
        checks: ["Re-run independent review after repair"],
      },
      {
        id: "R4",
        phase: "learning",
        scope: "supervisor",
        action: "Distill the reusable lesson only after validation passes",
        rationale: "Failed traces should enter memory as structured experiences, not raw logs",
        evidenceIncidentIds: incidentIds,
        checks: ["Record the lesson with failure class metadata"],
      },
    );
  }

  return {
    schemaVersion: RECOVERY_PACKET_SCHEMA_VERSION,
    packetId: params.packetId,
    runId: params.runId,
    evalRunId: params.evalRunId,
    caseId: params.caseId,
    mode: params.mode,
    role: params.role,
    createdAt: new Date().toISOString(),
    gate,
    steps,
  };
}
