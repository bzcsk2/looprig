import { createHash } from "node:crypto";
import type { Weakness } from "../experience/weakness-miner";
import type { SurfaceStore } from "../surfaces/surface-store";
import type { HarnessPatchPacket, HarnessSurface, PatchChangeType } from "./patch-schema";

const SAFETY_SURFACES: HarnessSurface[] = [
  "runtime-guard-policy",
  "tool-use-policy",
  "eval-gate-policy",
  "memory-recall-policy",
];

/**
 * Determines patch risk based on the affected surface.
 * Safety surfaces are always high risk unless tightening policy.
 * Other surfaces default to low/medium based on change type.
 */
export function determinePatchRisk(surface: HarnessSurface, changeType: PatchChangeType): "low" | "medium" | "high" {
  if (SAFETY_SURFACES.includes(surface)) {
    if (changeType === "tighten_policy") return "medium";
    return "high";
  }
  switch (changeType) {
    case "tighten_policy": return "medium";
    case "replace_section": return "medium";
    case "append_rule": return "low";
    case "add_example": return "low";
  }
}

/**
 * Generate a deterministic patch ID from a weakness and surface.
 */
export function generatePatchId(weaknessId: string, surface: HarnessSurface): string {
  const raw = `patch:${weaknessId}:${surface}`;
  return `p:${createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
}

/**
 * Map a weakness to the appropriate change type.
 * Most weaknesses map to "append_rule" by default.
 */
function inferChangeType(weakness: Weakness): PatchChangeType {
  if (weakness.signature.includes("too_permissive") ||
      weakness.signature.includes("missing_lockfile") ||
      weakness.signature.includes("contract_incomplete")) {
    return "tighten_policy";
  }
  if (weakness.signature.includes("without_evidence") ||
      weakness.signature.includes("failed_verifier")) {
    return "replace_section";
  }
  return "append_rule";
}

/**
 * Generate a proposed patch direction from the weakness direction.
 */
function generatePatchContent(weakness: Weakness): string {
  return `## ${weakness.signature}\n\n${weakness.proposedDirection}\n\n### Evidence\n${weakness.examples.slice(0, 3).map(e => `- ${e.file ? e.file + ": " : ""}${e.excerpt ?? e.line ? "line " + e.line : ""}`).join("\n")}\n`;
}

export class PatchProposer {
  private surfaceStore: SurfaceStore;

  constructor(surfaceStore: SurfaceStore) {
    this.surfaceStore = surfaceStore;
  }

  /** Propose a single patch from a weakness. */
  async proposeFromWeakness(weakness: Weakness): Promise<HarnessPatchPacket> {
    const surface = weakness.affectedSurface;
    const changeType = inferChangeType(weakness);
    const beforeHash = await this.surfaceStore.getHash(surface);

    const patch: HarnessPatchPacket = {
      schemaVersion: "covalo.harness-patch.v1",
      packetId: generatePatchId(weakness.id, surface),
      patchId: generatePatchId(weakness.id, surface),
      surface,
      changeType,
      target: surface,
      beforeHash,
      patch: generatePatchContent(weakness),
      rationale: `Mined from weakness "${weakness.signature}" with ${weakness.evidenceCount} occurrences (confidence: ${weakness.confidence.toFixed(2)})`,
      expectedImpact: weakness.proposedDirection,
      risk: determinePatchRisk(surface, changeType),
      weaknessIds: [weakness.id],
    } as unknown as HarnessPatchPacket;

    // Add required PacketBase fields
    (patch as any).runId = `propose:${weakness.id}`;
    (patch as any).mode = "loop";
    (patch as any).role = "system";
    (patch as any).createdAt = new Date().toISOString();

    return patch;
  }

  /** Propose multiple patches from multiple weaknesses. */
  async proposeFromWeaknesses(weaknesses: Weakness[]): Promise<HarnessPatchPacket[]> {
    // Deduplicate by surface to avoid multiple patches for the same surface
    const seenSurfaces = new Set<HarnessSurface>();
    const patches: HarnessPatchPacket[] = [];

    for (const w of weaknesses) {
      if (!seenSurfaces.has(w.affectedSurface)) {
        seenSurfaces.add(w.affectedSurface);
        patches.push(await this.proposeFromWeakness(w));
      }
    }

    return patches;
  }
}
