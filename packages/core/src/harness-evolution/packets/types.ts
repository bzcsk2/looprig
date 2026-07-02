export const HARNESS_PACKET_SCHEMA_VERSION = "covalo.packet-base.v1";

export type HarnessMode = "alone" | "subagent" | "loop" | "eval";
export type HarnessRole = "worker" | "supervisor" | "system";

export interface PacketBase {
  schemaVersion: string;
  packetId: string;
  runId: string;
  submitId?: string;
  evalRunId?: string;
  caseId?: string;
  mode: HarnessMode;
  role: HarnessRole;
  createdAt: string;
  sourceRef?: string;
  sourceSha256?: string;
}

export type HarnessPacket =
  | import("./task-digest").TaskDigestPacket
  | import("./runtime-guard").RuntimeGuardPacket
  | import("./action-certificate").ActionCertificatePacket
  | import("./review-packet").ReviewPacket
  | import("./incident-packet").IncidentPacket
  | import("./recovery-packet").RecoveryPacket
  | import("../self-harness/patch-schema").HarnessPatchPacket;

export interface EvidenceRef {
  file: string;
  line?: number;
  excerpt?: string;
}

export type ReviewVerdict = "ACCEPTED" | "NEEDS_FIX" | "UNKNOWN";

export type RepairLoopState =
  | "planned"
  | "worker_running"
  | "gate_running"
  | "reviewing"
  | "repairing"
  | "confirming"
  | "accepted"
  | "failed"
  | "escalated"
  | "cancelled";

export const LOOP_STATE_LABELS: Record<RepairLoopState, string> = {
  planned: "Task digest created",
  worker_running: "Worker running",
  gate_running: "Deterministic gates running",
  reviewing: "Supervisor reviewing",
  repairing: "Repair round {n} if needed",
  confirming: "Confirming",
  accepted: "Accepted",
  failed: "Failed",
  escalated: "Escalated",
  cancelled: "Cancelled",
};
