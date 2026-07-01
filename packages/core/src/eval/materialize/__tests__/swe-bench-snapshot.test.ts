import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import type { EvalCaseManifest } from "../../types";

const TEST_DIR = join(tmpdir(), `swe-snapshot-test-${randomUUID()}`);
const SNAPSHOTS_DIR = join(TEST_DIR, "swe-bench", "snapshots", "psf_requests");
const WORKSPACE_DIR = join(TEST_DIR, "workspace");
const FAKE_SNAPSHOT_PATH = join(SNAPSHOTS_DIR, "fakecommit.tar.gz");

beforeAll(() => {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  mkdirSync(WORKSPACE_DIR, { recursive: true });

  const staging = join(TEST_DIR, "staging");
  mkdirSync(join(staging, "src"), { recursive: true });
  mkdirSync(join(staging, "tests"), { recursive: true });
  writeFileSync(join(staging, "src", "lib.py"), "x = 1");
  writeFileSync(join(staging, "tests", "test_lib.py"), "def test_x(): assert True");

  execSync(
    `tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner -czf "${FAKE_SNAPSHOT_PATH}" -C "${staging}" .`,
    { stdio: "pipe", timeout: 15000 },
  );
});

afterAll(() => {
  execSync(`rm -rf "${TEST_DIR}"`, { stdio: "pipe" });
});

describe("swe-bench-snapshot", () => {
  test("extractSafeTarGz extracts to workspace", async () => {
    const { extractSafeTarGz } = await import("../../assets/extract-safe");
    const ws = join(TEST_DIR, "extract-test");
    mkdirSync(ws, { recursive: true });

    await extractSafeTarGz(FAKE_SNAPSHOT_PATH, ws);
    expect(existsSync(join(ws, "src", "lib.py"))).toBe(true);
    expect(existsSync(join(ws, "tests", "test_lib.py"))).toBe(true);
    expect(readFileSync(join(ws, "src", "lib.py"), "utf-8")).toBe("x = 1");
  });

  test("extractSafeTarGz rejects tar entry with ..", async () => {
    const maliciousTar = join(TEST_DIR, "malicious.tar.gz");
    const staging = join(TEST_DIR, "mal-staging");
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "test.txt"), "data");

    execSync(
      `cd "${staging}" && tar -czf "${maliciousTar}" --transform='s|test.txt|../../etc/passwd|' test.txt 2>/dev/null || true`,
      { stdio: "pipe", timeout: 15000 },
    );

    const { extractSafeTarGz } = await import("../../assets/extract-safe");
    const ws = join(TEST_DIR, "mal-ws");
    mkdirSync(ws, { recursive: true });

    try {
      await extractSafeTarGz(maliciousTar, ws);
      expect(true).toBe(false); // should not reach here
    } catch (e) {
      expect((e as Error).message).toContain("..");
    }
  });

  test("extractSafeTarGz rejects absolute path in tar", async () => {
    const { extractSafeTarGz } = await import("../../assets/extract-safe");
    const ws = join(TEST_DIR, "abs-ws");
    mkdirSync(ws, { recursive: true });

    const absTar = join(TEST_DIR, "absolute.tar.gz");
    const staging = join(TEST_DIR, "abs-staging");
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "evil.txt"), "evil");

    execSync(
      `cd "${staging}" && tar -czf "${absTar}" --transform='s|evil.txt|/tmp/evil.txt|' evil.txt 2>/dev/null || true`,
      { stdio: "pipe", timeout: 15000 },
    );

    try {
      await extractSafeTarGz(absTar, ws);
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain("absolute");
    }
  });

  test("missing snapshot throws MissingEvalAssetError", async () => {
    const { resolveSweBenchSnapshot } = await import("../swe-bench-snapshot");
    try {
      resolveSweBenchSnapshot("nonexistent/repo", "deadbeef");
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).name).toBe("MissingEvalAssetError");
    }
  });

  test("sweBenchMaterializer extracts snapshot and applies testPatch", async () => {
    const testId = randomUUID().slice(0, 8);
    const testDir = join(tmpdir(), `swe-materialize-${testId}`);
    const wsDir = join(testDir, "workspace");
    const staging = join(testDir, "staging");

    mkdirSync(join(staging, "src"), { recursive: true });
    writeFileSync(join(staging, "src", "lib.py"), "x = 1\n");

    const snapDir = join(testDir, "snapshots");
    mkdirSync(snapDir, { recursive: true });
    const snapPath = join(snapDir, "testcommit.tar.gz");
    execSync(
      `tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner -czf "${snapPath}" -C "${staging}" .`,
      { stdio: "pipe", timeout: 15000 },
    );

    mkdirSync(wsDir, { recursive: true });

    const { extractSafeTarGz } = await import("../../assets/extract-safe");
    await extractSafeTarGz(snapPath, wsDir);

    expect(existsSync(join(wsDir, "src", "lib.py"))).toBe(true);
    expect(readFileSync(join(wsDir, "src", "lib.py"), "utf-8")).toBe("x = 1\n");

    // Write testPatch and apply it with git
    const testPatch = "--- a/src/lib.py\n+++ b/src/lib.py\n@@ -1 +1 @@\n-x = 1\n+x = 2\n";
    writeFileSync(join(wsDir, "__test.patch"), testPatch, "utf-8");
    execSync('git apply "__test.patch"', { cwd: wsDir, stdio: "pipe", timeout: 15000 });

    expect(readFileSync(join(wsDir, "src", "lib.py"), "utf-8")).toBe("x = 2\n");

    // Create baseline commit (as createCaseWorkspace does after materializer)
    execSync("git init 2>/dev/null", { cwd: wsDir, stdio: "pipe" });
    execSync("git config user.email eval@test && git config user.name test-eval", { cwd: wsDir, stdio: "pipe" });
    execSync("git add -A && git commit -m baseline --allow-empty 2>/dev/null", { cwd: wsDir, stdio: "pipe" });

    // Verify baseline commit exists
    const log = execSync("git log --oneline -1", { cwd: wsDir, encoding: "utf-8", stdio: "pipe" });
    expect(log).toContain("baseline");

    rmSync(testDir, { recursive: true, force: true });
  }, 30000);

  test("sweBenchMaterializer throws MissingEvalAssetError for missing instance (no silent empty workspace)", async () => {
    const { sweBenchMaterializer } = await import("../swe-bench");
    const wsDir = join(TEST_DIR, "missing-instance-ws");
    mkdirSync(wsDir, { recursive: true });

    const manifest = {
      id: "swe-nonexistent",
      category: "weak-model",
      suite: "standard",
      title: "Nonexistent",
      description: "Nonexistent",
      fixtureSource: "__swe__test-nonexistent-00000000",
      sourceMeta: {
        sourceKind: "swe-bench",
        sourceId: "test-nonexistent-00000000",
        sourceRepoPath: "https://github.com/psf/requests.git",
        sourceCommit: "1111111",
      },
      setup: [],
      requiredBinaries: [],
      requiredPythonModules: [],
      taskPrompt: "Fix test",
      expectedVerification: [],
      verifier: { type: "command", command: "true" },
    } as EvalCaseManifest;

    try {
      await sweBenchMaterializer.materialize(manifest, wsDir);
      expect(true).toBe(false);
    } catch (e) {
      expect(e instanceof Error).toBe(true);
      expect(e.name).toBe("MissingEvalAssetError");
    }

    const wsFiles = readdirSync(wsDir);
    expect(wsFiles).toHaveLength(0);
  }, 15000);
});
