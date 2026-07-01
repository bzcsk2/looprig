import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { EvalCaseManifest } from "../types";
import type { Materializer } from "./shared";

const SWE_PREFIX = "__swe__";

function getLocalReposDir(): string {
  return resolve(
    import.meta.dirname ?? __dirname,
    "..",
    "curated",
    "swebench-repos",
  );
}

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

function getLocalBundlePath(repoName: string): string {
  const bundleName = REPO_BUNDLES[repoName];
  if (!bundleName) throw new Error(`Unknown repo: ${repoName}`);
  return join(getLocalReposDir(), bundleName);
}

function getLockInstanceData(instanceId: string): { patch: string; testPatch: string } | null {
  const lockPath = join(
    import.meta.dirname ?? __dirname,
    "..",
    "curated",
    "swe-bench.lock.json",
  );
  if (!existsSync(lockPath)) return null;
  const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as { instances: Array<{ instanceId: string; patch: string; testPatch: string }> };
  const inst = lock.instances.find((i) => i.instanceId === instanceId);
  if (!inst) return null;
  return { patch: inst.patch, testPatch: inst.testPatch };
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
      console.error(`[swe-materializer] Cannot determine repo for ${manifest.id}`);
      return;
    }

    const baseCommit = sourceMeta?.sourceCommit as string | undefined;
    if (!baseCommit) {
      console.error(`[swe-materializer] No baseCommit in sourceMeta for ${manifest.id}`);
      return;
    }

    const lockData = getLockInstanceData(instanceId);
    if (!lockData) {
      console.error(`[swe-materializer] No lock data for ${instanceId}`);
      return;
    }

    const bundlePath = getLocalBundlePath(repoName);
    if (!existsSync(bundlePath)) {
      console.error(`[swe-materializer] Local bundle not found at ${bundlePath} for ${manifest.id}`);
      return;
    }

    try {
      execSync(`git clone "${bundlePath}" "${workspaceDir}"`, {
        stdio: "pipe",
        timeout: 60000,
      });
    } catch (e) {
      console.error(`[swe-materializer] Failed to clone from bundle for ${manifest.id}: ${e}`);
      return;
    }

    try {
      execSync(`git checkout ${baseCommit}`, {
        cwd: workspaceDir,
        stdio: "pipe",
        timeout: 30000,
      });
    } catch (e) {
      console.error(`[swe-materializer] Failed to checkout ${baseCommit} for ${manifest.id}: ${e}`);
      return;
    }

    const patchFile = join(workspaceDir, "__test.patch");
    writeFileSync(patchFile, lockData.testPatch, "utf-8");
    try {
      execSync(`git apply "__test.patch"`, {
        cwd: workspaceDir,
        stdio: "pipe",
        timeout: 30000,
      });
    } catch (e) {
      console.error(`[swe-materializer] Failed to apply test_patch for ${manifest.id}: ${e}`);
    }
    try {
      execSync(`rm -f "__test.patch"`, { cwd: workspaceDir, stdio: "pipe" });
    } catch {
      // ignore
    }
  },
};
