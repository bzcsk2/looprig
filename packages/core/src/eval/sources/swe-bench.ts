import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EvalCaseManifest, EvalCategoryId, EvalSuiteId } from "../types";
import { getEvalAssetsRoot } from "../assets/resolve-assets-root";

export interface SweBenchInstance {
  instanceId: string;
  repo: string;
  baseCommit: string;
  environmentSetupCommit: string;
  category: EvalCategoryId;
  suite: EvalSuiteId;
  version: string;
  failToPass: string[];
  instruction?: string;
  description?: string;
  patch: string;
  testPatch: string;
}

interface SweBenchLock {
  version: string;
  source: {
    kind: string;
    datasetName: string;
    datasetVersion: string;
    datasetPath: string;
    split: string;
  };
  instances: SweBenchInstance[];
}

let _lock: SweBenchLock | null = null;

function loadLock(): SweBenchLock {
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
      return JSON.parse(readFileSync(pkgPath, "utf-8")) as SweBenchLock;
    }
  }

  const devPath = join(
    import.meta.dirname ?? __dirname,
    "..",
    "curated",
    "swe-bench.lock.json",
  );
  if (existsSync(devPath)) {
    return JSON.parse(readFileSync(devPath, "utf-8")) as SweBenchLock;
  }

  throw new Error("Cannot locate swe-bench lock.json");
}

const INSTALL_COMMANDS: Record<string, string[]> = {
  "psf/requests": [],
  "pallets/flask": ["pip install -e . 2>&1 || pip3 install -e . 2>&1"],
  "pytest-dev/pytest": ["pip install -e .[testing] 2>&1 || pip3 install -e .[testing] 2>&1"],
};

const REPO_URLS: Record<string, string> = {
  "psf/requests": "https://github.com/psf/requests.git",
  "pallets/flask": "https://github.com/pallets/flask.git",
  "pytest-dev/pytest": "https://github.com/pytest-dev/pytest.git",
};

function getRepoUrl(repo: string): string {
  return REPO_URLS[repo] ?? `https://github.com/${repo}.git`;
}

export function buildCaseId(instanceId: string): string {
  return `swe-${instanceId}`;
}

export function buildManifest(
  instance: SweBenchInstance,
  lock: SweBenchLock,
): EvalCaseManifest {
  const caseId = buildCaseId(instance.instanceId);
  const title = instance.description ?? instance.instanceId;
  const instruction = instance.instruction ?? `Fix the failing tests: ${instance.failToPass.join(", ")}`;
  const failToPassList = instance.failToPass.map(t => `  - \`${t}\``).join("\n");

  return {
    id: caseId,
    category: instance.category,
    suite: instance.suite,
    title,
    description: title,
    fixtureSource: `__swe__${instance.instanceId}`,
    sourceMeta: {
      sourceKind: "swe-bench",
      sourceId: instance.instanceId,
      sourceDataset: lock.source.datasetName,
      sourceRepoPath: getRepoUrl(instance.repo),
      sourceCommit: instance.baseCommit,
    },
    setup: INSTALL_COMMANDS[instance.repo] ?? [],
    requiredBinaries: ["python3", "pip", "git"],
    requiredPythonModules: ["pytest"],
    taskPrompt: instruction,
    expectedVerification: [`FAIL_TO_PASS tests should pass:\n${failToPassList}`],
    verifier: {
      type: "command",
      command: `python -m pytest ${instance.failToPass.map(t => JSON.stringify(t)).join(" ")} -rA 2>&1 || python3 -m pytest ${instance.failToPass.map(t => JSON.stringify(t)).join(" ")} -rA 2>&1`,
    },
    scoring: {
      requireCleanGitDiff: true,
      maxChangedFiles: 20,
    },
  };
}

export function loadSweBenchManifests(): EvalCaseManifest[] {
  if (!_lock) {
    _lock = loadLock();
  }
  const lock = _lock!;
  return lock.instances.map((inst) => buildManifest(inst, lock));
}
