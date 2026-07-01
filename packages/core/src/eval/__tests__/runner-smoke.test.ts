import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const TEST_DIR = join(tmpdir(), `runner-smoke-test-${randomUUID()}`);

// Register weak-model fixture before importing runner
import { registerBuiltinManifests, clearManifests } from "../loader";
import { WEAK_MODEL_MANIFESTS } from "../fixtures/index";
import type { SandboxProvider } from "../../sandbox/types";

class FakeSandboxProvider implements SandboxProvider {
  id = "fake-smoke";
  name = "FakeSmoke";
  capabilities = { sandbox: false, official: false };
  metadata = { version: "0.0.0" };

  async run(cmd: { command: string; cwd?: string; timeoutMs?: number; allowNetwork?: boolean; readRoots?: string[]; writeRoots?: string[] }) {
    const { execSync } = await import("node:child_process");
    try {
      const out = execSync(cmd.command, {
        cwd: cmd.cwd || process.cwd(),
        encoding: "utf-8",
        timeout: cmd.timeoutMs || 10000,
        stdio: "pipe",
      });
      return { exitCode: 0, stdout: out.toString(), stderr: "", timedOut: false };
    } catch (e: any) {
      return { exitCode: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "", timedOut: false };
    }
  }

  async runCommand(cmd: { command: string; cwd?: string; timeout?: number; env?: Record<string, string> }) {
    const { execSync } = await import("node:child_process");
    try {
      const out = execSync(cmd.command, {
        cwd: cmd.cwd || process.cwd(),
        encoding: "utf-8",
        timeout: cmd.timeout || 10000,
        stdio: "pipe",
      });
      return { exitCode: 0, stdout: out.toString(), stderr: "" };
    } catch (e: any) {
      return { exitCode: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
    }
  }

  async isAllowed() { return { allowed: true }; }
}

describe("runner-smoke", () => {
  beforeAll(() => {
    clearManifests();
    registerBuiltinManifests(WEAK_MODEL_MANIFESTS);
    process.env.DEEPRREF_ROOT = TEST_DIR;
  });

  afterAll(() => {
    delete process.env.DEEPRREF_ROOT;
    import("node:fs").then((fs) => fs.rmSync(TEST_DIR, { recursive: true, force: true }));
  });

  test("weak-model/smoke runs with fake worker and produces a report", async () => {
    const { runFixedEval } = await import("../runner");

    const provider = new FakeSandboxProvider();

    const report = await runFixedEval({
      categoryId: "weak-model",
      suiteId: "smoke",
      environmentId: "sandbox.local",
      sandboxProvider: provider,
      executeWorker: async (prompt: string) => {
        return "I ran the test and it passed.";
      },
      executeSupervisor: async (prompt: string) => {
        return JSON.stringify({
          dimensions: {
            taskCompletion: 100,
            verification: 100,
            toolUse: 100,
            efficiency: 100,
            safety: 100,
          },
        });
      },
    });

    // Verify the report structure
    expect(report).toBeDefined();
    expect(report.meta).toBeDefined();
    expect(report.meta.categoryId).toBe("weak-model");
    expect(report.meta.suiteId).toBe("smoke");
    expect(report.suiteSummary).toBeDefined();
    expect(report.suiteSummary.totalCases).toBeGreaterThanOrEqual(1);

    // Verify at least one case was processed
    const firstResult = report.suiteSummary.results[0];
    expect(firstResult).toBeDefined();
    expect(firstResult.caseId).toBe("wm-hello");
    // Verdict should be pass or fail (not error/infra_error) since the fixture exists
    expect(["pass", "fail", "skipped"]).toContain(firstResult.verdict);

    // Verify no external benchmark files were accessed (no SWE-bench, no torch)
    const traceFile = join(TEST_DIR, "evals", report.meta.runId, "trace.jsonl");
    const registryFile = join(TEST_DIR, "evals", report.meta.runId, "registry.json");
    expect(existsSync(traceFile)).toBe(true);
    expect(existsSync(registryFile)).toBe(true);

    // Workspace should exist and have the fixture files
    const ws = join(TEST_DIR, "evals", report.meta.runId, "cases", "wm-hello", "workspace");
    expect(existsSync(ws)).toBe(true);
    expect(existsSync(join(ws, "test_hello.py"))).toBe(true);
  }, 30000);
});
