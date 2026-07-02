import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { 
  SurfaceStore, 
  LineageStore, 
  ExperienceStore,
  mineFromIncidents,
  mineFromReview,
  formatWeaknesses,
} from "@covalo/core";
import type { Weakness } from "@covalo/core";

function printHarnessHelp(): void {
  console.log(`covalo harness - Harness evolution management

Usage:
  covalo harness doctor                Check harness health
  covalo harness mine --from-eval <id>  Mine weaknesses from eval run
  covalo harness propose --weakness <id> Propose patches from weakness
  covalo harness validate --patch <id>  Validate a patch
  covalo harness promote --patch <id>   Promote a patch
  covalo harness history                Show harness evolution history
  covalo harness rollback <id>          Rollback a patch
`);
}

function getBaseDir(): string {
  return process.cwd();
}

export async function harnessDoctor(args: string[]): Promise<void> {
  const jsonOutput = args.includes("--json");
  const baseDir = getBaseDir();

  const surfaceStore = new SurfaceStore(baseDir);
  const lineageStore = new LineageStore(baseDir);
  const expStore = new ExperienceStore(baseDir);

  if (jsonOutput) {
    console.log(JSON.stringify({
      surfaces: surfaceStore.list(),
      lineageCount: (await lineageStore.getAll()).length,
      experienceCount: await expStore.count(),
    }, null, 2));
    return;
  }

  console.log("Covalo Harness Doctor\n");

  // Check surfaces
  const surfaces = surfaceStore.list();
  console.log(`Surfaces: ${surfaces.length} defined`);
  const hashes = await surfaceStore.getAllHashes();
  for (const [surface, hash] of Object.entries(hashes)) {
    console.log(`  ${surface.padEnd(35)} ${hash}`);
  }
  console.log();

  // Check lineage
  const lineage = await lineageStore.getAll();
  const acceptedCount = lineage.filter(e => e.decision === "accepted").length;
  const rejectedCount = lineage.filter(e => e.decision === "rejected").length;
  const blockedCount = lineage.filter(e => e.decision === "blocked").length;
  console.log(`Lineage: ${lineage.length} total entries`);
  console.log(`  Accepted: ${acceptedCount}`);
  console.log(`  Rejected: ${rejectedCount}`);
  console.log(`  Blocked: ${blockedCount}`);
  console.log();

  // Check experience store
  const expCount = await expStore.count();
  console.log(`Experience store: ${expCount} records`);
  console.log();

  if (lineage.length === 0) {
    console.log("No harness evolution history yet. Run 'covalo harness mine' to start.");
  } else {
    const lastAccepted = lineage.filter(e => e.decision === "accepted").pop();
    if (lastAccepted) {
      console.log(`Last accepted patch: ${lastAccepted.patchId} (${lastAccepted.surface})`);
    }
  }
}

export async function harnessMine(args: string[]): Promise<void> {
  const fromEvalIdx = args.indexOf("--from-eval");
  const evalRunId = fromEvalIdx >= 0 ? args[fromEvalIdx + 1] : undefined;

  if (!evalRunId) {
    console.error("Usage: covalo harness mine --from-eval <evalRunId>");
    console.error("Mine weaknesses from a specific eval run.");
    process.exit(1);
  }

  const baseDir = getBaseDir();
  const covaloDir = join(baseDir, ".covalo", "evals", evalRunId);

  if (!existsSync(covaloDir)) {
    console.error(`Eval run directory not found: ${covaloDir}`);
    process.exit(1);
  }

  console.log(`Mining weaknesses from eval run: ${evalRunId}`);
  console.log();

  // Collect incident packets and review packets from the eval run
  const { readFileSync, readdirSync } = await import("node:fs");
  const casesDir = join(covaloDir, "cases");
  const incidents: any[] = [];
  const reviews: any[] = [];

  if (existsSync(casesDir)) {
    const caseDirs = readdirSync(casesDir);
    for (const caseId of caseDirs) {
      const packetFile = join(casesDir, caseId, "packets.jsonl");
      if (existsSync(packetFile)) {
        const content = readFileSync(packetFile, "utf-8");
        for (const line of content.trim().split("\n").filter(Boolean)) {
          try {
            const packet = JSON.parse(line);
            if (packet.schemaVersion === "covalo.incident-packet.v1") {
              incidents.push(packet);
            }
            if (packet.schemaVersion === "covalo.review-packet.v1") {
              reviews.push(packet);
            }
          } catch {}
        }
      }
    }
  }

  const weaknesses: Weakness[] = [
    ...mineFromIncidents(incidents),
    ...mineFromReview(reviews),
  ];

  if (weaknesses.length === 0) {
    console.log("No weaknesses mined from the eval run.");
    return;
  }

  console.log(formatWeaknesses(weaknesses));
  console.log(`Total weaknesses found: ${weaknesses.length}`);

  // Store weaknesses as experiences
  const expStore = new ExperienceStore(baseDir);
  await expStore.init();
  for (const w of weaknesses) {
    await expStore.append({
      id: w.id,
      signature: w.signature,
      sourceKind: "eval",
      sourceRef: evalRunId,
      trust: "untrusted",
      createdAt: new Date().toISOString(),
      taskType: "eval",
      failureMode: w.signature,
      successfulRecovery: w.proposedDirection,
      evidenceRefs: w.examples,
      confidence: w.confidence,
    });
  }
  console.log(`Stored ${weaknesses.length} weaknesses as experiences.`);
}

export async function harnessPropose(args: string[]): Promise<void> {
  const weaknessIdx = args.indexOf("--weakness");
  const weaknessId = weaknessIdx >= 0 ? args[weaknessIdx + 1] : undefined;

  if (!weaknessId) {
    console.error("Usage: covalo harness propose --weakness <weaknessId>");
    process.exit(1);
  }

  const baseDir = getBaseDir();
  const surfaceStore = new SurfaceStore(baseDir);
  const { PatchProposer } = await import("@covalo/core");
  const proposer = new PatchProposer(surfaceStore);

  // Create a synthetic weakness for proposing
  const weakness: Weakness = {
    id: weaknessId,
    signature: weaknessId.replace("weak:", ""),
    affectedSurface: "supervisor-system-prompt",
    evidenceCount: 1,
    examples: [],
    proposedDirection: "Improve based on mined weakness",
    confidence: 0.5,
  };

  // Try to find the actual weakness in the experience store
  try {
    const expStore = new ExperienceStore(baseDir);
    const record = await expStore.getById(weaknessId);
    if (record) {
      weakness.signature = record.signature;
      weakness.proposedDirection = record.successfulRecovery ?? weakness.proposedDirection;
      weakness.evidenceCount = record.evidenceRefs.length;
      weakness.confidence = record.confidence;
    }
  } catch {}

  const patches = await proposer.proposeFromWeaknesses([weakness]);

  // Save patches to disk for subsequent validate/promote
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const patchesDir = join(baseDir, ".covalo", "harness", "patches");
  mkdirSync(patchesDir, { recursive: true });

  for (const patch of patches) {
    const patchPath = join(patchesDir, `${patch.patchId}.json`);
    writeFileSync(patchPath, JSON.stringify(patch, null, 2), "utf-8");
    console.log(`Patch saved: ${patchPath}`);
  }

  console.log(JSON.stringify(patches, null, 2));
  console.log(`\nProposed ${patches.length} patch(es).`);
  console.log("Run 'covalo harness validate --patch <patchId>' to validate.");
}

export async function harnessValidate(args: string[]): Promise<void> {
  const patchIdx = args.indexOf("--patch");
  const patchId = patchIdx >= 0 ? args[patchIdx + 1] : undefined;

  if (!patchId) {
    console.error("Usage: covalo harness validate --patch <patchId>");
    process.exit(1);
  }

  const baseDir = getBaseDir();
  const surfaceStore = new SurfaceStore(baseDir);
  const { PatchValidator } = await import("@covalo/core");
  const validator = new PatchValidator(surfaceStore);

  // Load the patch from saved patch file
  const { join } = await import("node:path");
  const { existsSync, readFileSync } = await import("node:fs");
  const patchPath = join(baseDir, ".covalo", "harness", "patches", `${patchId}.json`);

  if (!existsSync(patchPath)) {
    console.error(`Patch file not found: ${patchPath}`);
    console.error("Run 'covalo harness propose --weakness <weaknessId>' first.");
    process.exit(1);
  }

  const patch = JSON.parse(readFileSync(patchPath, "utf-8"));

  console.log(`Validating patch: ${patchId}`);
  console.log(`  Surface: ${patch.surface}`);
  console.log(`  Before hash: ${patch.beforeHash}`);
  console.log();

  // Note: this is a PATCH INTEGRITY CHECK, not a held-in/held-out eval validation.
  // Full self-harness validation requires running fixed eval before and after
  // the patch, then comparing pass rates. This check only verifies the patch
  // references the correct surface state.
  const integrity = await validator.validatePatchIntegrity(patch);

  console.log(`Integrity check: ${integrity.valid ? "PASS" : "FAIL"}`);
  for (const err of integrity.errors) {
    console.log(`  ✗ ${err}`);
  }
  for (const warn of integrity.warnings) {
    console.log(`  ⚠ ${warn}`);
  }
  console.log();

  console.log("⚠ This is a PATCH INTEGRITY CHECK only. Full held-in/held-out validation");
  console.log("  requires running 'covalo eval' before and after applying the patch,");
  console.log("  then comparing pass rate deltas. Use 'covalo harness promote' only");
  console.log("  after real eval validation, or use --force for manual override.");
}

export async function harnessPromote(args: string[]): Promise<void> {
  const patchIdx = args.indexOf("--patch");
  const patchId = patchIdx >= 0 ? args[patchIdx + 1] : undefined;

  if (!patchId) {
    console.error("Usage: covalo harness promote --patch <patchId>");
    process.exit(1);
  }

  const baseDir = getBaseDir();
  const surfaceStore = new SurfaceStore(baseDir);
  const lineageStore = new LineageStore(baseDir);

  const forcePromote = args.includes("--force");
  const { promotePatch, PatchValidator } = await import("@covalo/core");

  // Load the patch from saved patch file
  const { join } = await import("node:path");
  const { existsSync, readFileSync } = await import("node:fs");
  const patchPath = join(baseDir, ".covalo", "harness", "patches", `${patchId}.json`);

  if (!existsSync(patchPath)) {
    console.error(`Patch file not found: ${patchPath}`);
    console.error("Run 'covalo harness propose --weakness <weaknessId>' first.");
    console.error("Or use 'covalo harness promote --force --patch <patchId>' to force promote from lineage.");
    process.exit(1);
  }

  const patch = JSON.parse(readFileSync(patchPath, "utf-8"));

  console.log(`Promoting patch: ${patchId}`);
  console.log(`  Surface: ${patch.surface}`);
  console.log(`  Before hash: ${patch.beforeHash}`);
  console.log();

  // Check surface hasn't changed since proposal
  const hash = await surfaceStore.getHash(patch.surface);
  if (hash !== patch.beforeHash && !forcePromote) {
    console.error(`⚠ Surface "${patch.surface}" has changed since patch was created.`);
    console.error(`  Expected hash: ${patch.beforeHash}`);
    console.error(`  Current hash:  ${hash}`);
    console.error("  Re-propose the patch, or use --force to promote anyway.");
    process.exit(1);
  }

  // Validate the patch first
  const validator = new PatchValidator(surfaceStore);
  const integrity = await validator.validatePatchIntegrity(patch);

  if (!integrity.valid && !forcePromote) {
    console.error("Patch integrity check failed:");
    for (const err of integrity.errors) {
      console.error(`  ✗ ${err}`);
    }
    console.error("Use --force to promote anyway.");
    process.exit(1);
  }

  // Use force-accepted validation unless real eval results are available
  const validation = {
    patchId,
    heldIn: { beforePass: 0, afterPass: 0, total: 0, delta: 0 },
    heldOut: { beforePass: 0, afterPass: 0, total: 0, delta: 0 },
    accepted: forcePromote,
    regressions: [] as string[],
    infraFailuresDoNotIncrease: true,
    policyViolationsDoNotIncrease: true,
  };

  if (!forcePromote) {
    console.log("⚠ No validation results available. Promote requires real held-in/held-out eval results.");
    console.log("  Use --force to promote with synthetic acceptance (bypasses validation gate).");
    process.exit(1);
  }

  // Save a backup of the current surface content before promoting
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const rollbackDir = join(baseDir, ".covalo", "harness", "rollbacks");
  mkdirSync(rollbackDir, { recursive: true });

  const currentSurfaceContent = await surfaceStore.get(patch.surface);
  const backupPath = join(rollbackDir, `${patchId}-before.json`);
  writeFileSync(backupPath, JSON.stringify({
    patchId,
    surface: patch.surface,
    beforeHash: patch.beforeHash,
    content: currentSurfaceContent,
    timestamp: new Date().toISOString(),
  }, null, 2), "utf-8");

  const { promoted, entry: newEntry } = await promotePatch({
    baseDir,
    patch,
    validation,
    forceHuman: true,
  });

  if (promoted) {
    console.log(`✓ Patch ${patchId} promoted successfully.`);
    console.log(`  New surface "${patch.surface}" content has been applied.`);
    console.log("  Changes will apply to future runs.");
    console.log("  Use 'covalo harness rollback <patchId>' to revert if needed.");
  } else {
    console.log(`Patch ${patchId} was not promoted.`);
    console.log(`  Decision: ${newEntry.decision}`);
  }
}

export async function harnessHistory(args: string[]): Promise<void> {
  const jsonOutput = args.includes("--json");
  const baseDir = getBaseDir();
  const lineageStore = new LineageStore(baseDir);
  const lineage = await lineageStore.getAll();

  if (lineage.length === 0) {
    console.log("No harness evolution history found.");
    console.log("Run 'covalo harness mine --from-eval <evalRunId>' to get started.");
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify(lineage, null, 2));
    return;
  }

  console.log("Harness Evolution History\n");
  console.log(`${"Patch ID".padEnd(20)} ${"Surface".padEnd(30)} ${"Decision".padEnd(16)} ${"Promoted By".padEnd(14)} ${"Date"}`);
  console.log("-".repeat(100));

  for (const entry of lineage) {
    const date = entry.acceptedAt
      ? new Date(entry.acceptedAt).toISOString().slice(0, 19).replace("T", " ")
      : "-";
    console.log(
      `${entry.patchId.padEnd(20)} ${entry.surface.padEnd(30)} ${entry.decision.padEnd(16)} ${entry.promotedBy.padEnd(14)} ${date}`,
    );
  }
  console.log();
  console.log(`Total entries: ${lineage.length}`);
}

export async function harnessRollback(args: string[]): Promise<void> {
  const rollbackId = args[0];

  if (!rollbackId) {
    console.error("Usage: covalo harness rollback <rollbackId>");
    process.exit(1);
  }

  const baseDir = getBaseDir();
  const lineageStore = new LineageStore(baseDir);
  const lineage = await lineageStore.getAll();
  const entry = lineage.find(e => e.patchId === rollbackId || e.rollbackId === rollbackId);

  if (!entry) {
    console.error(`Patch not found: ${rollbackId}`);
    process.exit(1);
  }

  if (entry.decision !== "accepted" && entry.decision !== "manual_required") {
    console.error(`Patch "${rollbackId}" was not applied (decision: ${entry.decision}). Nothing to rollback.`);
    process.exit(1);
  }

  if (!entry.beforeHash) {
    console.error(`Patch "${rollbackId}" has no beforeHash. Cannot determine previous state.`);
    process.exit(1);
  }

  const surfaceStore = new SurfaceStore(baseDir);
  const surface = entry.surface;
  const currentHash = await surfaceStore.getHash(surface);

  console.log(`Rolling back patch: ${rollbackId}`);
  console.log(`  Surface: ${surface}`);
  console.log(`  Current hash: ${currentHash}`);
  console.log(`  Target hash: ${entry.beforeHash}`);
  console.log();

  // Restore surface content from backup
  const { join } = await import("node:path");
  const { existsSync, readFileSync } = await import("node:fs");
  const backupPath = join(baseDir, ".covalo", "harness", "rollbacks", `${rollbackId}-before.json`);

  if (!existsSync(backupPath)) {
    console.error(`Backup file not found: ${backupPath}`);
    console.error("Cannot restore surface content without backup.");
    console.error("The rollback lineage entry will still be recorded for tracking purposes.");
  } else {
    const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
    await surfaceStore.writeOverride(surface, backup.content);
    console.log(`✓ Surface "${surface}" content restored from backup.`);
    console.log();
  }

  // Record rollback in lineage
  const { recordLineageForPatch } = await import("@covalo/core");
  await recordLineageForPatch({
    baseDir,
    patchId: `rollback:${rollbackId}`,
    surface,
    decision: "accepted",
    weaknessIds: entry.weaknessIds,
    beforeHash: currentHash,
    afterHash: entry.beforeHash,
    validation: {
      patchId: `rollback:${rollbackId}`,
      heldIn: { beforePass: 0, afterPass: 0, total: 0, delta: 0 },
      heldOut: { beforePass: 0, afterPass: 0, total: 0, delta: 0 },
      accepted: true,
      regressions: [],
      infraFailuresDoNotIncrease: true,
      policyViolationsDoNotIncrease: true,
    },
    promotedBy: "human",
  });

  console.log(`✓ Rollback recorded. The previous hash "${entry.beforeHash}" is tracked for restoration.`);
  console.log("  Note: Surface content restoration requires manual intervention.");
}

export async function harnessCommand(subcommand: string, args: string[]): Promise<void> {
  switch (subcommand) {
    case "doctor":
      await harnessDoctor(args);
      break;
    case "mine":
      await harnessMine(args);
      break;
    case "propose":
      await harnessPropose(args);
      break;
    case "validate":
      await harnessValidate(args);
      break;
    case "promote":
      await harnessPromote(args);
      break;
    case "history":
      await harnessHistory(args);
      break;
    case "rollback":
      await harnessRollback(args);
      break;
    default:
      printHarnessHelp();
  }
}
