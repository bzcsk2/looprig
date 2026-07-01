import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { EvalCaseManifest } from "../types";
import type { Materializer } from "./shared";
import { getEvalAssetsRoot } from "../assets/resolve-assets-root";
import { resolveSweBenchSnapshot, materializeSweBenchSnapshot } from "./swe-bench-snapshot";
import { MissingEvalAssetError, EvalAssetExtractionError } from "../types";

const SWE_PREFIX = "__swe__";

const REPO_BUNDLES: Record<string, string> = {
  "psf/requests": "psf_requests.bundle",
  "pallets/flask": "pallets_flask.bundle",
  "pytest-dev/pytest": "pytest-dev_pytest.bundle",
};

function getRepoName(sourceMeta: Record<string, unknown>): string | null {
  const url = sourceMeta?.sourceRepoPath as string | undefined;
  if (!url) return null;
  for (const name of Object.keys(REPO_BUNDLES)) {
    if (url.endsWith(name)) return name;
  }
  const m = url.match(/github\.com[/:](.+?)\.git$/);
  return m ? m[1] : null;
}

function getLockInstanceData(instanceId: string): { patch: string; testPatch: string } | null {
  const assetsRoot = (() => {
    try {
      return getEvalAssetsRoot();
    } catch {
      return null;
    }
  })();

  if (assetsRoot) {
    const pkgPath = join(assetsRoot, "swe-bench", "lock.json");
    if (existsSync(pkgPath)) {
      const lock = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        instances: Array<{ instanceId: string; patch: string; testPatch: string }>;
      };
      const inst = lock.instances.find((i) => i.instanceId === instanceId);
      if (inst) return { patch: inst.patch, testPatch: inst.testPatch };
    }
  }

  const devPath = join(
    import.meta.dirname ?? __dirname,
    "..",
    "curated",
    "swe-bench.lock.json",
  );
  if (existsSync(devPath)) {
    const lock = JSON.parse(readFileSync(devPath, "utf-8")) as {
      instances: Array<{ instanceId: string; patch: string; testPatch: string }>;
    };
    const inst = lock.instances.find((i) => i.instanceId === instanceId);
    if (inst) return { patch: inst.patch, testPatch: inst.testPatch };
  }

  return null;
}

export const sweBenchMaterializer: Materializer = {
  canHandle(manifest: EvalCaseManifest): boolean {
    return manifest.fixtureSource.startsWith(SWE_PREFIX);
  },

  async materialize(
    manifest: EvalCaseManifest,
    workspaceDir: string,
  ): Promise<void> {
    const instanceId = manifest.fixtureSource.slice(SWE_PREFIX.length);
    const sourceMeta = manifest.sourceMeta as Record<string, unknown> | undefined;

    const repoName = getRepoName(sourceMeta ?? {});
    if (!repoName) {
      throw new MissingEvalAssetError(`Cannot determine SWE-bench repo for ${manifest.id}`);
    }

    const baseCommit = sourceMeta?.sourceCommit as string | undefined;
    if (!baseCommit) {
      throw new MissingEvalAssetError(`Missing SWE-bench baseCommit for ${manifest.id}`);
    }

    const lockData = getLockInstanceData(instanceId);
    if (!lockData) {
      throw new MissingEvalAssetError(`Missing SWE-bench lock data for ${instanceId}`);
    }

    const snapshot = resolveSweBenchSnapshot(repoName, baseCommit);
    await materializeSweBenchSnapshot(snapshot, workspaceDir);

    const patchFile = join(workspaceDir, "__test.patch");
    writeFileSync(patchFile, lockData.testPatch, "utf-8");
    try {
      execSync(`git apply "__test.patch"`, {
        cwd: workspaceDir,
        stdio: "pipe",
        timeout: 30000,
      });
    } catch (e) {
      throw new EvalAssetExtractionError(
        `Failed to apply test_patch for ${manifest.id}: ${e}`,
      );
    }
    try {
      unlinkSync(patchFile);
    } catch {
      // ignore cleanup failures
    }
  },
};
