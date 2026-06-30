import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalRunReport, CaseResult } from "./types";
import type { ScoreKind } from "../sandbox/types";

function getDeepReefRoot(): string {
  return process.env.DEEPRREF_ROOT ?? ".deepreef";
}

function getEvalsDir(): string {
  return join(getDeepReefRoot(), "evals");
}

export async function saveEvalReport(
  report: EvalRunReport,
): Promise<{ reportDir: string; summaryMd: string; summaryJson: string }> {
  const evalDir = join(getEvalsDir(), report.meta.runId);
  await mkdir(evalDir, { recursive: true });

  const summaryJsonPath = join(evalDir, "summary.json");
  const summaryMdPath = join(evalDir, "summary.md");
  const metaPath = join(evalDir, "meta.json");

  const metaJson = JSON.stringify(report.meta, null, 2);
  await writeFile(metaPath, metaJson, "utf-8");

  const totalSetupFailures = report.suiteSummary.results.filter(
    r => r.setupResult && !r.setupResult.allPassed
  ).length;
  const infraCount = report.suiteSummary.results.filter(
    r => r.verdict === "infra_error"
  ).length;
  const taskFailCount = report.suiteSummary.results.filter(
    r => r.verdict === "fail" || r.verdict === "error"
  ).length;

  const scoreKind: ScoreKind = report.meta.environmentId === "sandbox.benchmark" && report.meta.officialScore ? "official" : "local-compatible";
  const summaryJson = JSON.stringify(
    {
      meta: report.meta,
      suiteSummary: {
        suiteId: report.suiteSummary.suiteId,
        categoryId: report.suiteSummary.categoryId,
        totalCases: report.suiteSummary.totalCases,
        passed: report.suiteSummary.passed,
        failed: report.suiteSummary.failed,
        errored: report.suiteSummary.errored,
        infraErrorCount: report.suiteSummary.infraErrorCount,
        skipped: report.suiteSummary.skipped,
        averageScore: report.suiteSummary.averageScore,
      },
      scoreKind,
      breakdown: {
        infrastructureFailures: infraCount,
        taskFailures: taskFailCount,
        setupFailures: totalSetupFailures,
      },
      overallScore: report.overallScore,
    },
    null,
    2,
  );
  await writeFile(summaryJsonPath, summaryJson, "utf-8");

  const sandboxMeta = {
    providerId: report.meta.providerId,
    environmentId: report.meta.environmentId,
    officialScore: report.meta.officialScore,
    fallbackReason: report.meta.fallbackReason,
  };

  const envMetaPath = join(evalDir, "sandbox-meta.json");
  await writeFile(envMetaPath, JSON.stringify(sandboxMeta, null, 2), "utf-8");

  const summaryMd = generateMarkdownReport(report);
  await writeFile(summaryMdPath, summaryMd, "utf-8");

  for (const result of report.suiteSummary.results) {
    const caseDir = join(evalDir, "cases", result.caseId);
    await mkdir(caseDir, { recursive: true });

    if (result.setupResult) {
      await writeFile(
        join(caseDir, "setup.json"),
        JSON.stringify(result.setupResult, null, 2),
        "utf-8",
      );
    }
    if (result.policyGates && result.policyGates.length > 0) {
      await writeFile(
        join(caseDir, "policy-gates.json"),
        JSON.stringify(result.policyGates, null, 2),
        "utf-8",
      );
    }
    if (result.verifierResult) {
      await writeFile(
        join(caseDir, "verifier.json"),
        JSON.stringify(result.verifierResult, null, 2),
        "utf-8",
      );
    }
    if (result.caseContract) {
      await writeFile(
        join(caseDir, "case-contract.json"),
        JSON.stringify(result.caseContract, null, 2),
        "utf-8",
      );
    }
    if (result.score) {
      await writeFile(
        join(caseDir, "score.json"),
        JSON.stringify(result.score, null, 2),
        "utf-8",
      );
    }
    if (result.patchDiff) {
      await writeFile(join(caseDir, "patch.diff"), result.patchDiff, "utf-8");
    }
    if (result.workerOutput) {
      await writeFile(join(caseDir, "worker-output.md"), result.workerOutput, "utf-8");
    }
    if (result.supervisorOutput) {
      await writeFile(
        join(caseDir, "supervisor-output.md"),
        result.supervisorOutput,
        "utf-8",
      );
    }
  }

  return { reportDir: evalDir, summaryMd, summaryJson };
}

function generateMarkdownReport(report: EvalRunReport): string {
  const { meta, suiteSummary, overallScore } = report;
  const lines: string[] = [];

  lines.push(`# LoopRig Eval Report`);
  lines.push(``);
  lines.push(`- **Run ID**: \`${meta.runId}\``);
  lines.push(`- **Category**: ${meta.categoryId}`);
  lines.push(`- **Suite**: ${meta.suiteId}`);
  lines.push(`- **Environment**: ${meta.environmentId}`);
  lines.push(`- **Provider**: ${meta.providerId}`);
  lines.push(`- **Official Score**: ${meta.officialScore}`);
  if (meta.preflight) {
    const missing = meta.preflight.checks.filter(c => !c.found).map(c => c.name);
    if (missing.length > 0) {
      lines.push(`- **Preflight**: Missing tools: ${missing.join(", ")}`);
    } else {
      lines.push(`- **Preflight**: All ${meta.preflight.checks.length} tools found`);
    }
  }
  if (meta.fallbackReason) {
    lines.push(`- **Provider Note**: ${meta.fallbackReason}`);
  }
  const scoreKindLabel = meta.environmentId === "sandbox.benchmark" && meta.officialScore ? "Official Benchmark Score" : "Local Compatibility Score";
  lines.push(`- **Score Kind**: ${scoreKindLabel}`);
  lines.push(`- **Official Score Eligible**: ${meta.officialScore}`);
  lines.push(`- **Model**: ${meta.model}`);
  lines.push(`- **Status**: ${meta.status}`);
  lines.push(`- **Started**: ${meta.startedAt}`);
  lines.push(`- **Finished**: ${meta.finishedAt}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total Cases | ${suiteSummary.totalCases} |`);
  lines.push(`| Passed | ${suiteSummary.passed} |`);
  lines.push(`| Failed | ${suiteSummary.failed} |`);
  lines.push(`| Errored | ${suiteSummary.errored} |`);
  lines.push(`| Infra Error | ${suiteSummary.infraErrorCount} |`);
  lines.push(`| Skipped | ${suiteSummary.skipped} |`);
  lines.push(`| Average Score | ${suiteSummary.averageScore.toFixed(2)} |`);
  lines.push(`| Overall Score | ${overallScore.toFixed(2)} |`);
  lines.push(`| Infrastructure Failures | ${suiteSummary.infraErrorCount} |`);
  const taskFailCount = suiteSummary.results.filter(r => r.verdict === "fail" || r.verdict === "error").length;
  lines.push(`| Task Failures | ${taskFailCount} |`);
  lines.push(``);

  lines.push(`## Case Results`);
  lines.push(``);
  for (const result of suiteSummary.results) {
    lines.push(`### ${result.caseId}: ${result.title}`);
    lines.push(``);
    lines.push(`- **Verdict**: \`${result.verdict}\``);
    const scoreIneligible = result.score?.scoreIneligible ?? false;
    lines.push(`- **Final Score**: ${scoreIneligible ? "ineligible (policy gate failure)" : (result.score?.finalScore.toFixed(2) ?? "N/A")}`);
    if (result.caseContract) {
      lines.push(`- **Contract**: env=${result.caseContract.environment} provider=${result.caseContract.provider} profile=${result.caseContract.toolchainProfile} bin=[${result.caseContract.requiredBinaries.join(",")}] py=[${result.caseContract.requiredPythonModules.join(",")}] net=${result.caseContract.network}`);
    }
    const isInfra = result.verdict === "infra_error";
    const isTaskFail = result.verdict === "fail" || result.verdict === "error";
    lines.push(`- **Type**: ${isInfra ? "infrastructure" : isTaskFail ? "task" : "normal"}`);
    if (result.verdict !== "infra_error") {
      lines.push(`- **Verifier**: ${result.verifierResult?.verdict ?? "N/A"}`);
    }
    if (result.objectiveSignals) {
      const os = result.objectiveSignals;
      lines.push(`- **Diff**: ${os.changedFiles} file(s), ${os.diffSize} lines | toolFail=${os.toolFailureCount} valid=${os.toolTrackingValid} outOfBounds=${os.outOfBoundsWrites.join(",") || "none"}`);
    }
    if (result.manifest?.sourceMeta) {
      lines.push(`- **Source**: \`${result.manifest.sourceMeta.sourceKind}\` (\`${result.manifest.sourceMeta.sourceId}\`)`);
    }
    if (result.setupResult) {
      lines.push(`- **Setup**: ${result.setupResult.allPassed ? "passed" : "failed"} (${result.setupResult.commands.length} command(s))`);
    }
    lines.push(`- **Duration**: ${result.startedAt} → ${result.finishedAt}`);
    if (result.error) {
      lines.push(`- **Error**: ${result.error}`);
    }
    if (result.verifierResult && result.verifierResult.details.length > 0) {
      lines.push(``);
      lines.push(`#### Verifier Details`);
      lines.push(``);
      for (const detail of result.verifierResult.details) {
        lines.push(`- ${detail}`);
      }
    }
    if (result.policyGates && result.policyGates.length > 0) {
      lines.push(``);
      lines.push(`#### Policy Gates`);
      lines.push(``);
      for (const pg of result.policyGates) {
        const status = pg.passed ? "PASS" : "FAIL";
        lines.push(`- [${status}] \`${pg.gate}\`: ${pg.detail}`);
      }
    }
    if (result.setupResult && !result.setupResult.allPassed) {
      lines.push(``);
      lines.push(`#### Setup Details`);
      lines.push(``);
      for (const cmd of result.setupResult.commands) {
        lines.push(`- \`${cmd.command}\`: exit ${cmd.exitCode}${cmd.timedOut ? " (timed out)" : ""}`);
        if (cmd.stderr) lines.push(`  - stderr: ${cmd.stderr.slice(0, 200)}`);
      }
    }
    if (result.score) {
      lines.push(``);
      lines.push(`#### Score Breakdown`);
      lines.push(``);
      lines.push(`| Component | Weight | Score |`);
      lines.push(`| --- | --- | --- |`);
      lines.push(
        `| Verifier | ${result.score.verifierWeight} | ${result.score.verifierScore.toFixed(2)} |`,
      );
      lines.push(
        `| Objective | ${result.score.objectiveWeight} | ${result.score.objectiveScore.toFixed(2)} |`,
      );
      lines.push(
        `| Supervisor | ${result.score.supervisorWeight} | ${result.score.supervisorScore.toFixed(2)} |`,
      );
      const ineligible = result.score.scoreIneligible;
      lines.push(
        `| **Final** | **1.00** | ${ineligible ? "**ineligible**" : `**${result.score.finalScore.toFixed(2)}**`} |`,
      );
    }
    lines.push(``);
  }

  return lines.join("\n");
}
