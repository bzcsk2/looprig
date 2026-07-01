import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getEvalAssetPath, getEvalAssetsRoot, assertSafeAssetRelativePath } from "./resolve-assets-root";
import { CorruptEvalAssetError, MissingEvalAssetError } from "../types";

export interface SweBenchSnapshotEntry {
  repo: string;
  baseCommit: string;
  path: string;
  format: "tar.gz";
  sha256: string;
  sizeBytes?: number;
}

export interface AssetsLockJson {
  version: number;
  createdAt: string;
  sweBench: {
    dataset: string;
    datasetVersion: string;
    snapshots: Record<string, SweBenchSnapshotEntry>;
  };
  terminalBench: {
    dataset: string;
    datasetVersion: string;
    tasksRoot: string;
    assets: Record<string, unknown>;
  };
}

let _cached: AssetsLockJson | null = null;

export function loadAssetsLock(): AssetsLockJson {
  if (_cached) return _cached;

  const root = getEvalAssetsRoot();
  const lockPath = join(root, "assets.lock.json");

  if (!existsSync(lockPath)) {
    throw new MissingEvalAssetError(`assets.lock.json not found at ${lockPath}`);
  }

  const raw = readFileSync(lockPath, "utf-8");
  const parsed = JSON.parse(raw) as AssetsLockJson;

  if (!parsed.version || !parsed.sweBench || !parsed.terminalBench) {
    throw new Error(`Invalid assets.lock.json format at ${lockPath}`);
  }

  _cached = parsed;
  return parsed;
}

export function verifyAssetSha256(relativePath: string, expectedSha256: string): void {
  assertSafeAssetRelativePath(relativePath);

  const fullPath = getEvalAssetPath(relativePath);
  const hash = createHash("sha256");
  const content = readFileSync(fullPath);
  hash.update(content);
  const actual = hash.digest("hex");

  if (actual !== expectedSha256.toLowerCase()) {
    throw new CorruptEvalAssetError(
      `SHA256 mismatch for ${relativePath}: expected ${expectedSha256}, actual ${actual}`,
    );
  }
}

export function getSweBenchSnapshot(
  repo: string,
  baseCommit: string,
): SweBenchSnapshotEntry | null {
  const lock = loadAssetsLock();
  const key = `${repo}#${baseCommit}`;
  return lock.sweBench.snapshots[key] ?? null;
}

export function getSweBenchSnapshotPath(
  repo: string,
  baseCommit: string,
): string | null {
  const entry = getSweBenchSnapshot(repo, baseCommit);
  if (!entry) return null;
  return getEvalAssetPath(entry.path);
}
