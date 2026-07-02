import type { IncidentPacket } from "../packets/incident-packet";
import type { ReviewPacket } from "../packets/review-packet";
import { mineFromIncidents, mineFromReview, storeWeaknesses, type Weakness } from "../experience/weakness-miner";
import { ExperienceStore } from "../experience/experience-store";
import { buildValidationResult, validateSurfaceAutoPromotion } from "./promotion-gate";
import { LineageStore, type HarnessLineageEntry, type LineageDecision } from "./lineage-store";
import type { HarnessSurface, HarnessPatchPacket } from "./patch-schema";
import type { HarnessValidationResult } from "./promotion-gate";
import { PatchProposer } from "./patch-proposer";
import { PatchValidator } from "./patch-validator";
import { SurfaceStore } from "../surfaces/surface-store";

export interface SelfHarnessInput {
  incidents: IncidentPacket[];
  reviews: ReviewPacket[];
  baseDir: string;
  /** Optional held-in/held-out validation results for full pipeline evaluation */
  validationResults?: {
    heldIn: { pass: number; total: number };
    heldOut: { pass: number; total: number };
    regressions?: string[];
    infraFailures?: number;
    policyViolations?: number;
  };
}

export interface SelfHarnessResult {
  minedWeaknesses: Weakness[];
  proposedPatches: HarnessPatchPacket[];
  validatedPatches: Array<{ patch: HarnessPatchPacket; validation: HarnessValidationResult }>;
  acceptedPatches: number;
  rejectedPatches: number;
  lineage: HarnessLineageEntry[];
}

/** Options for the propose step. */
export interface ProposeOptions {
  baseDir: string;
  weaknesses: Weakness[];
  skipDuplicates?: boolean;
}

/** Options for the validate step. */
export interface ValidateOptions {
  baseDir: string;
  patches: HarnessPatchPacket[];
  heldIn: { pass: number; total: number };
  heldOut: { pass: number; total: number };
  regressions?: string[];
  infraFailures?: number;
  policyViolations?: number;
}

/** Options for the promote step. */
export interface PromoteOptions {
  baseDir: string;
  patch: HarnessPatchPacket;
  validation: HarnessValidationResult;
  forceHuman?: boolean;
}

/**
 * Run the full self-harness pipeline: mine → propose → validate → promote.
 *
 * - Validate runs PatchValidator integrity check by default.
 * - If validationResults are provided, also runs held-in/held-out validation.
 * - Promote only fires when validation passes and the surface allows auto-promotion.
 */
export async function runSelfHarness(input: SelfHarnessInput): Promise<SelfHarnessResult> {
  const expStore = new ExperienceStore(input.baseDir);
  await expStore.init();

  const lineageStore = new LineageStore(input.baseDir);
  await lineageStore.init();

  const surfaceStore = new SurfaceStore(input.baseDir);

  // Step 1: Mine
  const weaknesses = [
    ...mineFromIncidents(input.incidents),
    ...mineFromReview(input.reviews),
  ];

  // Store weaknesses as experiences
  if (weaknesses.length > 0) {
    await storeWeaknesses(expStore, weaknesses);
  }

  // Step 2: Propose
  const proposer = new PatchProposer(surfaceStore);
  const patches = await proposer.proposeFromWeaknesses(weaknesses);

  // Step 3: Validate
  const validator = new PatchValidator(surfaceStore);
  const validatedPatches: Array<{ patch: HarnessPatchPacket; validation: HarnessValidationResult }> = [];

  for (const patch of patches) {
    const integrity = await validator.validatePatchIntegrity(patch);
    if (!integrity.valid) {
      validatedPatches.push({
        patch,
        validation: {
          patchId: patch.patchId,
          heldIn: { beforePass: 0, afterPass: 0, total: 0, delta: 0 },
          heldOut: { beforePass: 0, afterPass: 0, total: 0, delta: 0 },
          accepted: false,
          regressions: [],
          infraFailuresDoNotIncrease: true,
          policyViolationsDoNotIncrease: true,
        },
      });
      continue;
    }

    if (input.validationResults) {
      const v = input.validationResults;
      const validation = await validator.runValidation({
        patch,
        beforeHeldIn: v.heldIn,
        afterHeldIn: v.heldIn,
        beforeHeldOut: v.heldOut,
        afterHeldOut: v.heldOut,
        regressions: v.regressions ?? [],
        beforeInfraFailures: v.infraFailures ?? 0,
        afterInfraFailures: v.infraFailures ?? 0,
        beforePolicyViolations: v.policyViolations ?? 0,
        afterPolicyViolations: v.policyViolations ?? 0,
      });
      validatedPatches.push({ patch, validation });
    } else {
      validatedPatches.push({
        patch,
        validation: {
          patchId: patch.patchId,
          heldIn: { beforePass: 0, afterPass: 0, total: 0, delta: 0 },
          heldOut: { beforePass: 0, afterPass: 0, total: 0, delta: 0 },
          accepted: false,
          regressions: [],
          infraFailuresDoNotIncrease: true,
          policyViolationsDoNotIncrease: true,
        },
      });
    }
  }

  // Step 4: Promote (only for validated/approved safety-ok patches)
  let acceptedPatches = 0;
  let rejectedPatches = 0;
  const lineage: HarnessLineageEntry[] = [];

  for (const { patch, validation } of validatedPatches) {
    if (validation.accepted && canAutoPromote(patch.surface, validation)) {
      const result = await promotePatch({
        baseDir: input.baseDir,
        patch,
        validation,
        forceHuman: false,
      });
      if (result.promoted) acceptedPatches++;
      else rejectedPatches++;
      lineage.push(result.entry);
    } else {
      const entry = await recordLineageForPatch({
        baseDir: input.baseDir,
        patchId: patch.patchId,
        surface: patch.surface,
        decision: validation.accepted ? "blocked" : "rejected",
        weaknessIds: patch.weaknessIds,
        beforeHash: patch.beforeHash,
        validation,
        promotedBy: "self-harness",
      });
      rejectedPatches++;
      lineage.push(entry);
    }
  }

  return {
    minedWeaknesses: weaknesses,
    proposedPatches: patches,
    validatedPatches,
    acceptedPatches,
    rejectedPatches,
    lineage,
  };
}

/**
 * Propose patches from weaknesses.
 */
export async function proposePatches(options: ProposeOptions): Promise<HarnessPatchPacket[]> {
  const surfaceStore = new SurfaceStore(options.baseDir);
  const proposer = new PatchProposer(surfaceStore);
  return proposer.proposeFromWeaknesses(options.weaknesses);
}

/**
 * Validate a set of patches against held-in/held-out data.
 */
export async function validatePatches(options: ValidateOptions): Promise<Array<{ patch: HarnessPatchPacket; validation: HarnessValidationResult }>> {
  const surfaceStore = new SurfaceStore(options.baseDir);
  const validator = new PatchValidator(surfaceStore);
  const results: Array<{ patch: HarnessPatchPacket; validation: HarnessValidationResult }> = [];

  for (const patch of options.patches) {
    const validation = await validator.runValidation({
      patch,
      beforeHeldIn: options.heldIn,
      afterHeldIn: options.heldIn,
      beforeHeldOut: options.heldOut,
      afterHeldOut: options.heldOut,
      regressions: options.regressions ?? [],
      beforeInfraFailures: options.infraFailures ?? 0,
      afterInfraFailures: options.infraFailures ?? 0,
      beforePolicyViolations: options.policyViolations ?? 0,
      afterPolicyViolations: options.policyViolations ?? 0,
    });
    results.push({ patch, validation });
  }

  return results;
}

/**
 * Promote a patch if validation passes.
 * Writes lineage record and optionally applies the patch to the surface store.
 */
export async function promotePatch(options: PromoteOptions): Promise<{
  promoted: boolean;
  entry: HarnessLineageEntry;
}> {
  const lineageStore = new LineageStore(options.baseDir);
  await lineageStore.init();

  const surfaceStore = new SurfaceStore(options.baseDir);

  const canAutoPromoteResult = canAutoPromote(options.patch.surface, options.validation);

  let decision: LineageDecision;
  let promoted = false;

  if (options.validation.accepted && (canAutoPromoteResult || options.forceHuman)) {
    decision = "accepted";
    promoted = true;

    // Apply the patch: write the new surface content
    await surfaceStore.writeOverride(options.patch.surface, options.patch.patch);
  } else if (!options.validation.accepted) {
    decision = "rejected";
  } else {
    decision = "blocked";
  }

  const entry = await recordLineageForPatch({
    baseDir: options.baseDir,
    patchId: options.patch.patchId,
    surface: options.patch.surface,
    decision,
    weaknessIds: options.patch.weaknessIds,
    beforeHash: options.patch.beforeHash,
    afterHash: promoted ? await surfaceStore.getHash(options.patch.surface) : undefined,
    validation: options.validation,
    promotedBy: options.forceHuman ? "human" : "self-harness",
  });

  return { promoted, entry };
}

export async function recordLineageForPatch(params: {
  baseDir: string;
  patchId: string;
  surface: HarnessSurface;
  decision: LineageDecision;
  weaknessIds: string[];
  beforeHash: string;
  afterHash?: string;
  validation: HarnessValidationResult;
  promotedBy: "self-harness" | "human";
}): Promise<HarnessLineageEntry> {
  const store = new LineageStore(params.baseDir);
  await store.init();

  const entry: HarnessLineageEntry = {
    schemaVersion: "covalo.harness-lineage.v1",
    patchId: params.patchId,
    surface: params.surface,
    decision: params.decision,
    weaknessIds: params.weaknessIds,
    beforeHash: params.beforeHash,
    afterHash: params.afterHash,
    validation: params.validation,
    promotedBy: params.promotedBy,
    acceptedAt: params.decision === "accepted" ? new Date().toISOString() : undefined,
  };

  await store.append(entry);
  return entry;
}

export function canAutoPromote(surface: HarnessSurface, validation: HarnessValidationResult): boolean {
  if (!validateSurfaceAutoPromotion(surface)) return false;
  return validation.accepted;
}
