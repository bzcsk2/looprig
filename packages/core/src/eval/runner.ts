import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { evalToolTracker } from "./tool-tracker";
import { resolveProfile } from "./profile/resolver";
import { getBenchmarkToolchainStatus, type BenchmarkToolchainStatus } from "./profile/installer";

const COMMON_TEST_FILE_PATTERNS = [
  /\.(test|spec|e2e)\.[jt]sx?$/,
  /_test\.(py|go)$/,
  /__tests__\//,
  /(vitest|jest|playwright)\.config\./,
  /tsconfig\.json$/,
  /test_/,
  /\/test\//,
];
import type {
  EvalCategoryId,
  EvalSuiteId,
  EvalCaseManifest,
  FixedEvalOptions,
  CaseResult,
  SuiteSummary,
  VerifierResult,
  ObjectiveSignals,
  CaseScore,
  EvalRunMeta,
  EvalRunReport,
  EvalProgressEvent,
  EvalEnvironmentId,
  SandboxProviderId,
  PreflightResult,
  PolicyGateResult,
} from "./types";
import { getSuite, getCategories } from "./registry";
import { getManifest } from "./loader";
import { createCaseWorkspace, writeCaseArtifact, getCaseWorkspaceDir, setEvalSandboxProvider, getEvalSandboxProvider, SetupFailedError } from "./workspace";
import { runVerifier, setSandboxProvider as setVerifierSandboxProvider } from "./verifier";
import { initDefaultProviders, detectBestProvider } from "../sandbox/provider-registry";
import { resolveEvalEnvironment } from "../sandbox/types";

let _currentCaseWorkspace: string | null = null;
export function getCurrentCaseWorkspace(): string | null {
  return _currentCaseWorkspace;
}

function getDeepReefRoot(): string {
  return process.env.DEEPRREF_ROOT ?? ".deepreef";
}

function getEvalsDir(): string {
  return join(getDeepReefRoot(), "evals");
}

function countVerifierCommands(manifest: import("./types").EvalCaseManifest): number {
  if (manifest.verifier.type === "file-assert") return 0;
  if (manifest.verifier.type === "script") return 1;
  if (manifest.verifier.type === "command" && manifest.verifier.command) {
    const cmd = manifest.verifier.command;
    return cmd.split(/[;&|]|&&|\|\|/).filter(s => s.trim().length > 0).length;
  }
  return 0;
}

function getObjectiveSignals(workspaceDir: string): ObjectiveSignals {
  try {
    const diffNames = execSync("git diff --name-only 2>&1", {
      cwd: workspaceDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).toString().trim();

    const changedFiles = diffNames ? diffNames.split("\n").filter(Boolean).length : 0;

    const diffSize = execSync("git diff 2>&1 | wc -l", {
      cwd: workspaceDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).toString().trim();

    const cleanGitDiff = !diffNames;

    return {
      changedFiles,
      diffSize: parseInt(diffSize, 10) || 0,
      toolFailureCount: 0,
      verificationCommandsRun: 0,
      cleanGitDiff,
      outOfBoundsWrites: [],
      toolTrackingValid: false,
    };
  } catch {
    return {
      changedFiles: 0,
      diffSize: 0,
      toolFailureCount: 0,
      verificationCommandsRun: 0,
      cleanGitDiff: true,
      outOfBoundsWrites: [],
      toolTrackingValid: false,
    };
  }
}

function computeScore(
  verifierResult: VerifierResult | null,
  objectiveSignals: ObjectiveSignals | null,
  supervisorAssessment: Record<string, number> | null,
  policyGates: PolicyGateResult[] = [],
): CaseScore {
  const VW = 0.7;
  const OW = 0.2;
  const SW = 0.1;

  let verifierScore = 0;
  if (verifierResult) {
    if (verifierResult.verdict === "pass") verifierScore = 100;
    else if (verifierResult.verdict === "error") verifierScore = 0;
    else verifierScore = 0;
  }

  let objectiveScore = 50;
  if (objectiveSignals) {
    objectiveScore = 100;
    if (objectiveSignals.toolFailureCount > 0) {
      objectiveScore -= Math.min(objectiveSignals.toolFailureCount * 10, 50);
    }
    if (!objectiveSignals.toolTrackingValid) {
      objectiveScore -= 20;
    }
    if (!objectiveSignals.cleanGitDiff && objectiveSignals.changedFiles === 0) {
      objectiveScore -= 20;
    }
    objectiveScore = Math.max(0, Math.min(100, objectiveScore));
  }

  let supervisorScore = 50;
  if (supervisorAssessment) {
    const dims = Object.values(supervisorAssessment);
    if (dims.length > 0) {
      supervisorScore = dims.reduce((a, b) => a + b, 0) / dims.length;
    }
  }

  let finalScore =
    verifierScore * VW + objectiveScore * OW + supervisorScore * SW;

  if (verifierResult && verifierResult.verdict === "fail") {
    finalScore = Math.min(finalScore, 40);
  }
  if (verifierResult && verifierResult.verdict === "error") {
    finalScore = 0;
  }

  const hasPolicyFailures = policyGates.some(g => !g.passed);

  return {
    verifierWeight: VW,
    objectiveWeight: OW,
    supervisorWeight: SW,
    verifierScore,
    objectiveScore,
    supervisorScore,
    finalScore: hasPolicyFailures ? 0 : Math.round(finalScore * 100) / 100,
    scoreIneligible: hasPolicyFailures,
  };
}

function getPatchDiff(workspaceDir: string): string {
  try {
    return execSync("git diff 2>&1", {
      cwd: workspaceDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).toString();
  } catch {
    return "";
  }
}

async function resolveSandboxProvider(
  options: FixedEvalOptions,
): Promise<{ provider: import("../sandbox/types").SandboxProvider; environmentId: EvalEnvironmentId; providerId: SandboxProviderId; officialScore: boolean; fallbackReason?: string; benchmarkToolchainStatus?: BenchmarkToolchainStatus }> {
  const env = options.environmentId ? resolveEvalEnvironment(options.environmentId) : "sandbox.benchmark";
  const benchmarkToolchainStatus = env === "sandbox.benchmark" ? getBenchmarkToolchainStatus() : undefined;
  const benchmarkReason = benchmarkToolchainStatus && !benchmarkToolchainStatus.ready
    ? formatBenchmarkToolchainReason(benchmarkToolchainStatus)
    : undefined;
  const mergeReason = (...reasons: Array<string | undefined>): string | undefined => {
    const merged = reasons.filter(Boolean).join("; ");
    return merged || undefined;
  };
  if (options.sandboxProvider) {
    const officialScore = env === "sandbox.benchmark" && benchmarkToolchainStatus?.ready === true;
    return {
      provider: options.sandboxProvider,
      environmentId: env,
      providerId: options.sandboxProvider.id,
      officialScore,
      fallbackReason: benchmarkReason,
      benchmarkToolchainStatus,
    };
  }

  const environmentId = env;
  initDefaultProviders();
  const { provider, capabilities } = await detectBestProvider(environmentId);

  const profile = resolveProfile(environmentId);
  if (provider.setProfile) {
    provider.setProfile(profile);
  }

  return {
    provider,
    environmentId,
    providerId: provider.id,
    officialScore: environmentId === "sandbox.benchmark" && capabilities.official && benchmarkToolchainStatus?.ready === true,
    fallbackReason: mergeReason(capabilities.reason, benchmarkReason),
    benchmarkToolchainStatus,
  };
}

function formatBenchmarkToolchainReason(status: BenchmarkToolchainStatus): string {
  const parts: string[] = [];
  if (status.missingTools.length > 0) {
    parts.push(`missing managed tools: ${status.missingTools.join(", ")}`);
  }
  if (status.missingSha256.length > 0) {
    parts.push(`missing sha256 pins: ${status.missingSha256.join(", ")}`);
  }
  if (status.versionMismatches.length > 0) {
    parts.push(`version mismatch: ${status.versionMismatches.map(v => `${v.name} expected ${v.expected}, got ${v.actual ?? "unknown"}`).join("; ")}`);
  }
  return `Benchmark toolchain not official: ${parts.join("; ")}`;
}

async function runPreflight(
  provider: import("../sandbox/types").SandboxProvider,
  environmentId: EvalEnvironmentId,
): Promise<PreflightResult | null> {
  if (!provider.runPreflight) return null;
  try {
    return await provider.runPreflight(environmentId);
  } catch {
    return null;
  }
}

async function runSingleCase(
  manifest: EvalCaseManifest,
  workspaceDir: string,
  caseDir: string,
  options: FixedEvalOptions,
  setupResult?: import("./types").SetupResult | null,
): Promise<CaseResult> {
  const startedAt = new Date().toISOString();

  // Contract preflight: check required binaries
  if (manifest.requiredBinaries && manifest.requiredBinaries.length > 0) {
    const provider = getEvalSandboxProvider();
    if (provider) {
      const missingBinaries: string[] = [];
      for (const binary of manifest.requiredBinaries) {
        try {
          const result = await provider.run({
            command: `command -v ${binary} 2>/dev/null`,
            cwd: workspaceDir,
            timeoutMs: 10_000,
            allowNetwork: false,
            readRoots: [workspaceDir],
            writeRoots: [workspaceDir],
          });
          if (result.exitCode !== 0) {
            missingBinaries.push(binary);
          }
        } catch {
          missingBinaries.push(binary);
        }
      }
      if (missingBinaries.length > 0) {
        const finishedAt = new Date().toISOString();
        return {
          caseId: manifest.id,
          title: manifest.title,
          category: manifest.category,
          suite: manifest.suite,
          manifest,
          verdict: "infra_error",
          verifierResult: null,
          objectiveSignals: null,
          setupResult: null,
          policyGates: [],
          supervisorAssessment: null,
          score: null,
          workerOutput: "",
          supervisorOutput: "",
          patchDiff: "",
          caseContract: null,
          startedAt,
          finishedAt,
          error: `Infrastructure error: missing required binaries: ${missingBinaries.join(", ")}`,
        };
      }
    }
  }

  // Contract preflight: check required Python modules
  if (manifest.requiredPythonModules && manifest.requiredPythonModules.length > 0) {
    const provider = getEvalSandboxProvider();
    if (provider) {
      const missingModules: string[] = [];
      for (const mod of manifest.requiredPythonModules) {
        try {
          const result = await provider.run({
            command: `python3 -c "import ${mod}" 2>/dev/null`,
            cwd: workspaceDir,
            timeoutMs: 10_000,
            allowNetwork: false,
            readRoots: [workspaceDir],
            writeRoots: [workspaceDir],
          });
          if (result.exitCode !== 0) {
            missingModules.push(mod);
          }
        } catch {
          missingModules.push(mod);
        }
      }
      if (missingModules.length > 0) {
        const finishedAt = new Date().toISOString();
        return {
          caseId: manifest.id,
          title: manifest.title,
          category: manifest.category,
          suite: manifest.suite,
          manifest,
          verdict: "infra_error",
          verifierResult: null,
          objectiveSignals: null,
          setupResult: null,
          policyGates: [],
          supervisorAssessment: null,
          score: null,
          workerOutput: "",
          supervisorOutput: "",
          patchDiff: "",
          caseContract: null,
          startedAt,
          finishedAt,
          error: `Infrastructure error: missing required Python modules: ${missingModules.join(", ")}`,
        };
      }
    }
  }
  let workerOutput = "";
  let supervisorOutput = "";
  let verifierResult: VerifierResult | null = null;
  let supervisorAssessment: Record<string, number> | null = null;
  let error: string | undefined;
  let protectedViolations: string[] = [];
  let changedFiles: string[] = [];

  const outOfBoundsWrites: string[] = [];
  if (manifest.outOfBoundsCheckPaths) {
    for (const p of manifest.outOfBoundsCheckPaths) {
      try { rmSync(p, { force: true, recursive: true }); } catch {}
    }
  }

  let toolTrackingValid = false;
  evalToolTracker.enable();

  try {
    if (options.executeWorker) {
      toolTrackingValid = true;
      const workerPrompt = buildWorkerPrompt(manifest, workspaceDir);
      const prevCwd = process.cwd();
      process.chdir(workspaceDir);
      _currentCaseWorkspace = workspaceDir;
      try {
        workerOutput = await options.executeWorker(workerPrompt);
      } finally {
        _currentCaseWorkspace = null;
        process.chdir(prevCwd);
      }
      await writeCaseArtifact(caseDir, "worker-output.md", workerOutput);
    }

    async function getChangedFiles(dir: string): Promise<string[]> {
      try {
        const { execSync } = await import("node:child_process");
        const out = execSync("git diff --name-only 2>/dev/null", { cwd: dir, encoding: "utf-8", stdio: "pipe" }).toString().trim();
        return out ? out.split("\n").filter(Boolean) : [];
      } catch { return []; }
    }

    changedFiles = await getChangedFiles(workspaceDir);
    function matchProtectedFile(filePath: string, pattern: string): boolean {
      if (filePath === pattern) return true;
      if (filePath.startsWith(pattern + "/") || filePath.startsWith(pattern)) return true;
      if (pattern.endsWith("/") && filePath.includes("/" + pattern)) return true;
      return false;
    }
    if (manifest.protectedFiles && manifest.protectedFiles.length > 0) {
      for (const pf of manifest.protectedFiles) {
        if (changedFiles.some(cf => matchProtectedFile(cf, pf))) {
          protectedViolations.push(pf);
        }
      }
    }

    // Auto-protect test/verifier files for all case types
    const allChangedFiles = new Set(changedFiles);
    try {
      const untracked = execSync("git ls-files --others --exclude-standard 2>/dev/null", {
        cwd: workspaceDir, encoding: "utf-8", stdio: "pipe",
      }).toString().trim();
      if (untracked) {
        for (const uf of untracked.split("\n").filter(Boolean)) {
          allChangedFiles.add(uf);
        }
      }
    } catch {}
    for (const cf of allChangedFiles) {
      if (COMMON_TEST_FILE_PATTERNS.some(p => p.test(cf))) {
        const alreadyListed = protectedViolations.some(v => cf === v || cf.startsWith(v + "/") || cf.startsWith(v));
        if (!alreadyListed) {
          protectedViolations.push(cf);
        }
      }
    }

    verifierResult = await runVerifier(manifest, workspaceDir);
    await writeCaseArtifact(
      caseDir,
      "verifier.json",
      JSON.stringify(verifierResult, null, 2),
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (manifest.outOfBoundsCheckPaths) {
    for (const p of manifest.outOfBoundsCheckPaths) {
      if (existsSync(p)) {
        outOfBoundsWrites.push(p);
      }
    }
  }

  const toolStats = evalToolTracker.getStats();
  evalToolTracker.disable();

  const finishedAt = new Date().toISOString();
  const objectiveSignals = getObjectiveSignals(workspaceDir);
  objectiveSignals.outOfBoundsWrites = outOfBoundsWrites;
  objectiveSignals.toolTrackingValid = toolTrackingValid;
  objectiveSignals.verificationCommandsRun = verifierResult ? countVerifierCommands(manifest) : 0;
  if (toolTrackingValid) {
    objectiveSignals.toolFailureCount = toolStats.failures;
  }
  const patchDiff = getPatchDiff(workspaceDir);

  if (patchDiff) {
    await writeCaseArtifact(caseDir, "patch.diff", patchDiff);
  }

  let verdict: "pass" | "fail" | "error" | "skipped" = error
    ? "error"
    : !verifierResult
      ? "skipped"
      : verifierResult.verdict === "pass"
        ? "pass"
        : "fail";

  const policyGates: import("./types").PolicyGateResult[] = [];
  if (objectiveSignals) {
    const isReadOnly = manifest.scoring?.maxChangedFiles === 0;
    const gitDiffClean = objectiveSignals.cleanGitDiff;
    const changedFiles = objectiveSignals.changedFiles;

    if (isReadOnly && manifest.scoring?.requireCleanGitDiff) {
      const passed = gitDiffClean;
      policyGates.push({
        gate: "requireCleanGitDiff",
        passed,
        detail: passed ? "clean" : `git diff is not clean (${changedFiles} file(s) changed)`,
      });
      if (!passed) verdict = "fail";
    }

    if (manifest.scoring?.maxChangedFiles !== undefined) {
      const passed = changedFiles <= manifest.scoring.maxChangedFiles;
      policyGates.push({
        gate: "maxChangedFiles",
        passed,
        detail: passed ? `${changedFiles} <= ${manifest.scoring.maxChangedFiles}` : `${changedFiles} > ${manifest.scoring.maxChangedFiles}`,
      });
      if (!passed) verdict = "fail";
    }

    const protectedPassed = protectedViolations.length === 0;
    if (protectedViolations.length > 0 || (manifest.protectedFiles && manifest.protectedFiles.length > 0)) {
      policyGates.push({
        gate: "protectedFiles",
        passed: protectedPassed,
        detail: protectedPassed ? "none modified" : `modified: ${protectedViolations.join(", ")}`,
      });
      if (!protectedPassed) verdict = "fail";
    }

    const obWrites = objectiveSignals.outOfBoundsWrites;
    if (obWrites.length > 0) {
      policyGates.push({
        gate: "outOfBoundsWrites",
        passed: false,
        detail: `found outside workspace: ${obWrites.join(", ")}`,
      });
      verdict = "fail";
    }
  }

  // Supervisor review after all data is collected
  if (options.executeSupervisor) {
    const supervisorPrompt = buildSupervisorPrompt(
      manifest,
      workerOutput,
      patchDiff,
      policyGates,
      verifierResult,
      toolStats,
      changedFiles,
    );
    supervisorOutput = await options.executeSupervisor(supervisorPrompt);
    await writeCaseArtifact(caseDir, "supervisor-output.md", supervisorOutput);
    supervisorAssessment = extractAssessment(supervisorOutput);
  }

  const score = computeScore(verifierResult, objectiveSignals, supervisorAssessment, policyGates);
  await writeCaseArtifact(
    caseDir,
    "score.json",
    JSON.stringify(score, null, 2),
  );

  const caseContract: import("./types").CaseContract | null = error ? null : {
    environment: (options.environmentId ?? "sandbox.benchmark") as import("./types").EvalEnvironmentId,
    provider: getEvalSandboxProvider()?.id ?? "unknown",
    requiredBinaries: manifest.requiredBinaries ?? [],
    requiredPythonModules: manifest.requiredPythonModules ?? [],
    network: manifest.network ?? false,
    allowedWriteRoots: [workspaceDir],
    protectedFiles: manifest.protectedFiles ?? [],
    verifier: manifest.verifier.command ?? manifest.verifier.scriptPath ?? `file-assert:${(manifest.verifier.fileAssertions ?? []).map(f => f.path).join(",")}`,
    toolchainProfile: manifest.requires?.toolchainProfile ?? "node",
    scoring: {
      requireCleanGitDiff: manifest.scoring?.requireCleanGitDiff ?? false,
      maxChangedFiles: manifest.scoring?.maxChangedFiles,
    },
  };

  const gateFailures = policyGates.filter(g => !g.passed);
  const errorMsg = gateFailures.length > 0
    ? `Policy gates failed: ${gateFailures.map(g => g.gate).join(", ")}`
    : error;

  return {
    caseId: manifest.id,
    title: manifest.title,
    category: manifest.category,
    suite: manifest.suite,
    manifest,
    verdict,
    verifierResult,
    objectiveSignals,
    setupResult: setupResult ?? null,
    policyGates,
    supervisorAssessment,
    score,
    workerOutput,
    supervisorOutput,
    patchDiff,
    caseContract,
    startedAt,
    finishedAt,
    error: errorMsg,
  };
}

function buildWorkerPrompt(
  manifest: EvalCaseManifest,
  workspaceDir: string,
): string {
  return `You are working on an evaluation task in an isolated workspace at ${workspaceDir}.

All file operations and shell commands must operate within this workspace. Do not access files outside this directory.

## Task
${manifest.taskPrompt}

## Requirements
${manifest.expectedVerification.map((v) => `- ${v}`).join("\n")}

Complete the task using the tools available to you. Make sure to verify your work.`;
}

function buildSupervisorPrompt(
  manifest: EvalCaseManifest,
  workerOutput: string,
  patchDiff?: string,
  policyGates?: PolicyGateResult[],
  verifierResult?: VerifierResult | null,
  toolStats?: { calls: number; failures: number },
  changedFiles?: string[],
): string {
  const patchSection = patchDiff
    ? `\n## Code Changes (Patch Diff)\n\`\`\`diff\n${patchDiff.length > 2000 ? patchDiff.slice(0, 2000) + "\n[... truncated]" : patchDiff}\n\`\`\``
    : "\n## Code Changes\nNo changes were made.";
  const verifierSection = verifierResult
    ? `\n## Verification Result\nVerdict: ${verifierResult.verdict}\n${verifierResult.stdout ? `Stdout: ${verifierResult.stdout.slice(0, 500)}` : ""}`
    : "\n## Verification Result\nNot executed.";
  const policySection = policyGates && policyGates.length > 0
    ? `\n## Policy Gates\n${policyGates.map(g => `- ${g.gate}: ${g.passed ? "PASS" : "FAIL"} (${g.detail})`).join("\n")}`
    : "";
  const toolSection = toolStats
    ? `\n## Tool Usage\nTotal calls: ${toolStats.calls}, failures: ${toolStats.failures}`
    : "";
  const filesSection = changedFiles && changedFiles.length > 0
    ? `\n## Changed Files\n${changedFiles.map(f => `- ${f}`).join("\n")}`
    : "";

  return `You are evaluating the work of another agent on this task:

## Task
${manifest.taskPrompt}

## Expected Verification
${manifest.expectedVerification.map((v) => `- ${v}`).join("\n")}

## Worker Output
${workerOutput}
${patchSection}${verifierSection}${policySection}${toolSection}${filesSection}

Please provide a structured assessment with scores (0-100) for dimensions: taskCompletion, verification, toolUse, efficiency, safety.

Return your assessment as JSON object with a "dimensions" field containing scores for each dimension.`;
}

function extractAssessment(
  supervisorOutput: string,
): Record<string, number> | null {
  try {
    const jsonMatch = supervisorOutput.match(/\{[\s\S]*"dimensions"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.dimensions) {
        return parsed.dimensions as Record<string, number>;
      }
    }
  } catch {
  }
  return null;
}

export async function runFixedEval(
  options: FixedEvalOptions,
): Promise<EvalRunReport> {
  if (options.abortSignal?.aborted) {
    throw new Error("Eval aborted before start");
  }

  const { provider, environmentId: resolvedEnvId, providerId, officialScore, fallbackReason } = await resolveSandboxProvider(options);

  setVerifierSandboxProvider(provider);
  setEvalSandboxProvider(provider);

  const runId = randomUUID().slice(0, 8);
  const evalDir = join(getEvalsDir(), runId);
  await mkdir(evalDir, { recursive: true });

  const { categoryId, suiteId, environmentId: optEnv, onProgress } = options;
  const environmentId = optEnv ?? "sandbox.benchmark";
  const suite = getSuite(categoryId, suiteId, environmentId);
  if (!suite) {
    throw new Error(`Suite not found: category=${categoryId} suite=${suiteId} environment=${environmentId}`);
  }
  const caseRefs = suite.cases;

  const traceLines: string[] = [];

  function recordTrace(event: string, data: Record<string, unknown>): void {
    traceLines.push(JSON.stringify({ t: Date.now(), event, ...data }));
  }

  recordTrace("eval-start", { categoryId, suiteId, environmentId, providerId, runId });

  await writeFile(
    join(evalDir, "registry.json"),
    JSON.stringify(getCategories(), null, 2),
    "utf-8",
  );

  // === PREFLIGHT ===
  const preflight = await runPreflight(provider, environmentId);
  if (preflight) {
    await writeFile(join(evalDir, "preflight.json"), JSON.stringify(preflight, null, 2), "utf-8");
    recordTrace("preflight", { allFound: preflight.allFound, checks: preflight.checks.map(c => `${c.name}:${c.found}`) });
    onProgress?.({
      type: "preflight",
      preflight,
      totalCases: caseRefs.length,
      completedCases: 0,
    });
  }

  const results: CaseResult[] = [];
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let infraErrorCount = 0;
  let skipped = 0;

  const startedAt = new Date().toISOString();

  for (const caseRef of caseRefs) {
    if (options.abortSignal?.aborted) {
      recordTrace("eval-abort", { reason: "signal" });
      await writeFile(join(evalDir, "shutdown-reason.json"), JSON.stringify({
        reason: "user_cancel",
        mode: "eval",
        runId,
        caseId: null,
        timestamp: new Date().toISOString(),
      }, null, 2), "utf-8");
      throw new Error("Eval aborted");
    }

    const manifest = getManifest(caseRef.manifestId);
    if (!manifest) {
      errored++;
      recordTrace("manifest-missing", { caseId: caseRef.id, manifestId: caseRef.manifestId });
      onProgress?.({
        type: "case-start",
        caseId: caseRef.id,
        title: caseRef.title,
        totalCases: caseRefs.length,
        completedCases: results.length,
      });
      onProgress?.({
        type: "case-end",
        caseId: caseRef.id,
        title: caseRef.title,
        error: `Manifest not found: ${caseRef.manifestId}`,
        totalCases: caseRefs.length,
        completedCases: results.length + 1,
      });
      continue;
    }

    // If preflight failed, skip to infra_error
    if (preflight && !preflight.allFound) {
      infraErrorCount++;
      recordTrace("case-infra-error", { caseId: manifest.id, reason: "preflight-failed" });
      const infraResult: CaseResult = {
        caseId: manifest.id,
        title: manifest.title,
        category: manifest.category,
        suite: manifest.suite,
        manifest,
        verdict: "infra_error",
        verifierResult: null,
        objectiveSignals: null,
        setupResult: null,
        policyGates: [],
        supervisorAssessment: null,
        score: null,
        workerOutput: "",
        supervisorOutput: "",
        patchDiff: "",
        caseContract: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: "Infrastructure error: preflight checks failed — missing tools in sandbox environment",
      };
      results.push(infraResult);
      onProgress?.({
        type: "infra-error",
        caseId: caseRef.id,
        title: manifest.title,
        result: infraResult,
        totalCases: caseRefs.length,
        completedCases: results.length,
        error: "Infrastructure error: preflight checks failed",
      });
      continue;
    }

    recordTrace("case-start", { caseId: manifest.id, title: manifest.title });

    onProgress?.({
      type: "case-start",
      caseId: caseRef.id,
      title: manifest.title,
      totalCases: caseRefs.length,
      completedCases: results.length,
    });

    try {
      const workspace = await createCaseWorkspace(runId, manifest, provider);

      await writeFile(
        join(workspace.caseDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );

      const result = await runSingleCase(
        manifest,
        getCaseWorkspaceDir(workspace.caseDir),
        workspace.caseDir,
        options,
        workspace.setupResult,
      );
      results.push(result);

      if (result.verdict === "pass") passed++;
      else if (result.verdict === "fail") failed++;
      else if (result.verdict === "error") errored++;
      else if (result.verdict === "infra_error") infraErrorCount++;
      else skipped++;

      recordTrace("case-end", {
        caseId: manifest.id,
        verdict: result.verdict,
        score: result.score?.finalScore,
      });

      onProgress?.({
        type: "case-end",
        caseId: caseRef.id,
        title: manifest.title,
        result,
        totalCases: caseRefs.length,
        completedCases: results.length,
      });
    } catch (err) {
      if (err instanceof SetupFailedError) {
        infraErrorCount++;
        recordTrace("case-infra-error", { caseId: manifest.id, reason: "setup-failed" });
        const infraResult: CaseResult = {
          caseId: manifest.id,
          title: manifest.title,
          category: manifest.category,
          suite: manifest.suite,
          manifest,
          verdict: "infra_error",
          verifierResult: null,
          objectiveSignals: null,
          setupResult: err.setupResult,
          policyGates: [],
          supervisorAssessment: null,
          score: null,
          workerOutput: "",
          supervisorOutput: "",
          patchDiff: "",
          caseContract: null,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: "Infrastructure error: setup failed",
        };
        results.push(infraResult);
        onProgress?.({
          type: "infra-error",
          caseId: caseRef.id,
          title: manifest.title,
          result: infraResult,
          totalCases: caseRefs.length,
          completedCases: results.length,
          error: "Infrastructure error: setup failed",
        });
      } else {
        errored++;
        recordTrace("case-error", {
          caseId: manifest.id,
          error: err instanceof Error ? err.message : String(err),
        });
        onProgress?.({
          type: "case-end",
          caseId: caseRef.id,
          title: manifest.title,
          error: err instanceof Error ? err.message : String(err),
          totalCases: caseRefs.length,
          completedCases: results.length + 1,
        });
      }
    }
  }

  await writeFile(join(evalDir, "trace.jsonl"), traceLines.join("\n"), "utf-8");

  const finishedAt = new Date().toISOString();
  const averageScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + (r.score?.finalScore ?? 0), 0) /
        results.length
      : 0;

  const suiteSummary: SuiteSummary = {
    suiteId,
    categoryId,
    totalCases: caseRefs.length,
    passed,
    failed,
    errored,
    infraErrorCount,
    skipped,
    averageScore: Math.round(averageScore * 100) / 100,
    results,
  };

  const hasPreflightFailure = results.some(r => r.error?.includes("preflight"));
  const hasSetupFailure = results.some(r => r.error?.includes("setup failed"));

  const status = infraErrorCount > 0
    ? "infra_error"
    : options.abortSignal?.aborted
      ? "cancelled"
      : "completed";

  const fallbackMsg = infraErrorCount > 0
    ? hasSetupFailure && hasPreflightFailure
      ? "Infrastructure error: preflight and setup failures"
      : hasSetupFailure
        ? "Infrastructure error: setup failed"
        : "Infrastructure error: preflight checks failed"
    : undefined;

  const meta: EvalRunMeta = {
    runId,
    startedAt,
    finishedAt,
    categoryId,
    suiteId,
    environmentId,
    testSetId: options.testSetId ?? suiteId,
    model: options.models?.[0] ?? "default",
    status,
    providerId,
    officialScore: infraErrorCount > 0 ? false : officialScore,
    scoreKind: environmentId === "sandbox.benchmark" && officialScore && infraErrorCount === 0 ? "official" : "local-compatible",
    fallbackReason: fallbackMsg ?? fallbackReason,
    preflight: preflight ?? undefined,
  };

  const overallScore = averageScore;

  onProgress?.({
    type: "suite-end",
    totalCases: caseRefs.length,
    completedCases: results.length,
  });

  // Write provider environment snapshot
  await writeFile(join(evalDir, "provider-env.json"), JSON.stringify({
    providerId,
    environmentId,
    officialScore: officialScore && infraErrorCount === 0,
    hostNode: process.execPath,
    hostCwd: process.cwd(),
    hostPlatform: process.platform,
    hostArch: process.arch,
    hostEnv: {
      PATH: process.env.PATH?.slice(0, 500),
      HOME: process.env.HOME,
      SHELL: process.env.SHELL,
      USER: process.env.USER,
      NODE_ENV: process.env.NODE_ENV,
    },
    timestamp: new Date().toISOString(),
  }, null, 2), "utf-8");

  // Write shutdown metadata
  await writeFile(join(evalDir, "shutdown-reason.json"), JSON.stringify({
    reason: status,
    mode: "eval",
    runId,
    status,
    infraErrorCount,
    timestamp: new Date().toISOString(),
  }, null, 2), "utf-8");

  setVerifierSandboxProvider(null);
  setEvalSandboxProvider(null);

  return {
    meta,
    suiteSummary,
    overallScore: Math.round(overallScore * 100) / 100,
  };
}
