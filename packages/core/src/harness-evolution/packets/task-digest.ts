import type { PacketBase, EvidenceRef } from "./types";

export const TASK_DIGEST_SCHEMA_VERSION = "covalo.task-digest.v1";

export interface ContextFileEntry {
  path: string;
  reason: string;
  sha256?: string;
  truncated?: boolean;
}

export interface OmittedContextEntry {
  reason: "budget" | "irrelevant" | "unsafe" | "missing";
  detail: string;
}

export interface RepoFacts {
  cwd: string;
  packageManager?: string;
  gitBranch?: string;
  gitClean?: boolean;
  relevantConfigFiles: string[];
}

export interface TaskDigestPacket extends PacketBase {
  schemaVersion: typeof TASK_DIGEST_SCHEMA_VERSION;
  goal: string;
  acceptanceCriteria: string[];
  repoFacts: RepoFacts;
  contextFiles: ContextFileEntry[];
  constraints: string[];
  verificationPlan: string[];
  omittedContext: OmittedContextEntry[];
  evidenceRefs?: EvidenceRef[];
}

export function createTaskDigest(params: {
  packetId: string;
  runId: string;
  goal: string;
  acceptanceCriteria: string[];
  repoFacts: RepoFacts;
  contextFiles: ContextFileEntry[];
  constraints: string[];
  verificationPlan: string[];
  omittedContext: OmittedContextEntry[];
  mode: TaskDigestPacket["mode"];
  role: TaskDigestPacket["role"];
  evalRunId?: string;
  caseId?: string;
}): TaskDigestPacket {
  return {
    schemaVersion: TASK_DIGEST_SCHEMA_VERSION,
    packetId: params.packetId,
    runId: params.runId,
    evalRunId: params.evalRunId,
    caseId: params.caseId,
    mode: params.mode,
    role: params.role,
    createdAt: new Date().toISOString(),
    goal: params.goal,
    acceptanceCriteria: params.acceptanceCriteria,
    repoFacts: params.repoFacts,
    contextFiles: params.contextFiles,
    constraints: params.constraints,
    verificationPlan: params.verificationPlan,
    omittedContext: params.omittedContext,
  };
}
