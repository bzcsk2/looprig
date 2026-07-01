import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  getSweBenchSnapshot,
  getSweBenchSnapshotPath,
  verifyAssetSha256,
} from "../assets/assets-lock";
import { extractSafeTarGz } from "../assets/extract-safe";
import {
  MissingEvalAssetError,
  CorruptEvalAssetError,
  EvalAssetExtractionError,
} from "../types";

export interface SweBenchSnapshotRef {
  repo: string;
  baseCommit: string;
  path: string;
  format: "tar.gz";
  sha256: string;
  sizeBytes?: number;
}

export function resolveSweBenchSnapshot(
  repo: string,
  baseCommit: string,
): SweBenchSnapshotRef {
  const entry = getSweBenchSnapshot(repo, baseCommit);
  if (!entry) {
    throw new MissingEvalAssetError(
      `Missing SWE-bench snapshot for ${repo}#${baseCommit}`,
    );
  }
  return entry;
}

export async function materializeSweBenchSnapshot(
  ref: SweBenchSnapshotRef,
  workspaceDir: string,
): Promise<void> {
  const fullPath = getSweBenchSnapshotPath(ref.repo, ref.baseCommit);
  if (!fullPath) {
    throw new MissingEvalAssetError(
      `Snapshot file not found for ${ref.repo}#${ref.baseCommit} (path: ${ref.path})`,
    );
  }

  if (!existsSync(fullPath)) {
    throw new MissingEvalAssetError(
      `Snapshot file does not exist at ${fullPath} for ${ref.repo}#${ref.baseCommit}`,
    );
  }

  if (ref.sha256) {
    try {
      verifyAssetSha256(ref.path, ref.sha256);
    } catch (e) {
      if (e instanceof CorruptEvalAssetError) throw e;
      throw new CorruptEvalAssetError(
        `SHA256 verification failed for ${ref.repo}#${ref.baseCommit}: ${e}`,
      );
    }
  }

  await extractSafeTarGz(fullPath, workspaceDir);
}

export async function getLockInstanceData(
  repo: string,
  baseCommit: string,
  lockPath: string,
): Promise<{ patch: string; testPatch: string } | null> {
  const lock = JSON.parse(
    await import("node:fs").then((fs) => fs.readFileSync(lockPath, "utf-8")),
  ) as {
    instances: Array<{
      instanceId: string;
      repo: string;
      baseCommit: string;
      patch: string;
      testPatch: string;
    }>;
  };

  const inst = lock.instances.find(
    (i) => i.repo === repo && i.baseCommit === baseCommit,
  );
  if (!inst) return null;
  return { patch: inst.patch, testPatch: inst.testPatch };
}
