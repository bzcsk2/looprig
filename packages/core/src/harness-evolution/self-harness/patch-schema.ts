import type { PacketBase } from "../packets/types";

export const HARNESS_PATCH_SCHEMA_VERSION = "covalo.harness-patch.v1";

export type HarnessSurface =
  | "supervisor-system-prompt"
  | "worker-system-prompt"
  | "task-digest-template"
  | "review-rubric"
  | "incident-taxonomy"
  | "recovery-playbook"
  | "context-selection-policy"
  | "tool-use-policy"
  | "eval-gate-policy"
  | "memory-recall-policy"
  | "runtime-guard-policy";

export type PatchChangeType =
  | "append_rule"
  | "replace_section"
  | "tighten_policy"
  | "add_example";

export interface HarnessPatchPacket extends PacketBase {
  schemaVersion: typeof HARNESS_PATCH_SCHEMA_VERSION;
  patchId: string;
  surface: HarnessSurface;
  changeType: PatchChangeType;
  target: string;
  beforeHash: string;
  patch: string;
  rationale: string;
  expectedImpact: string;
  risk: "low" | "medium" | "high";
  weaknessIds: string[];
}
