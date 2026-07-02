import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const TEST_DIR = join(tmpdir(), `assets-lock-test-${randomUUID()}`);
const ASSETS_DIR = join(TEST_DIR, "resources", "eval-assets");

const FAKE_LOCK = {
  version: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  sweBench: {
    dataset: "SWE-bench_Lite",
    datasetVersion: "20240627",
    snapshots: {
      "psf/requests#deadbeef": {
        repo: "psf/requests",
        baseCommit: "deadbeef",
        path: "swe-bench/snapshots/psf_requests/deadbeef.tar.gz",
        format: "tar.gz",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sizeBytes: 0,
      },
    },
  },
  terminalBench: {
    dataset: "terminal-bench-core",
    datasetVersion: "0.1.0",
    tasksRoot: "terminal-bench/tasks",
    assets: {},
  },
};

beforeAll(() => {
  mkdirSync(join(ASSETS_DIR, "swe-bench", "snapshots", "psf_requests"), { recursive: true });
  writeFileSync(join(ASSETS_DIR, "assets.lock.json"), JSON.stringify(FAKE_LOCK, null, 2));
  writeFileSync(join(ASSETS_DIR, "swe-bench", "snapshots", "psf_requests", "deadbeef.tar.gz"), "");
  process.env.COVALO_EVAL_ASSETS_DIR = ASSETS_DIR;
});

afterAll(() => {
  delete process.env.COVALO_EVAL_ASSETS_DIR;
  import("node:fs").then((fs) => fs.rmSync(TEST_DIR, { recursive: true, force: true }));
});

describe("assets-lock", () => {
  test("verifyAssetSha256 passes for correct sha", async () => {
    const { verifyAssetSha256 } = await import("../assets-lock");
    expect(() => verifyAssetSha256(
      "swe-bench/snapshots/psf_requests/deadbeef.tar.gz",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )).not.toThrow();
  });

  test("verifyAssetSha256 throws CorruptEvalAssetError for wrong sha", async () => {
    const { verifyAssetSha256 } = await import("../assets-lock");
    try {
      verifyAssetSha256(
        "swe-bench/snapshots/psf_requests/deadbeef.tar.gz",
        "0000000000000000000000000000000000000000000000000000000000000000",
      );
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).name).toBe("CorruptEvalAssetError");
    }
  });

  test("verifyAssetSha256 rejects unsafe path", async () => {
    const { verifyAssetSha256 } = await import("../assets-lock");
    expect(() => verifyAssetSha256("../../etc/passwd", "deadbeef")).toThrow();
  });

  test("getSweBenchSnapshot returns entry for valid repo+commit", async () => {
    const { getSweBenchSnapshot } = await import("../assets-lock");
    const entry = getSweBenchSnapshot("psf/requests", "deadbeef");
    expect(entry).not.toBeNull();
    expect(entry!.repo).toBe("psf/requests");
    expect(entry!.format).toBe("tar.gz");
  });

  test("getSweBenchSnapshot returns null for missing entry", async () => {
    const { getSweBenchSnapshot } = await import("../assets-lock");
    const entry = getSweBenchSnapshot("nonexistent/repo", "0000000");
    expect(entry).toBeNull();
  });

  test("getSweBenchSnapshotPath returns full path", async () => {
    const { getSweBenchSnapshotPath } = await import("../assets-lock");
    const p = getSweBenchSnapshotPath("psf/requests", "deadbeef");
    expect(p).not.toBeNull();
    expect(existsSync(p!)).toBe(true);
  });

  test("loadAssetsLock reads from env override", async () => {
    const { loadAssetsLock } = await import("../assets-lock");
    const lock = loadAssetsLock();
    expect(lock.version).toBe(1);
    expect(lock.sweBench.dataset).toBe("SWE-bench_Lite");
    expect(Object.keys(lock.sweBench.snapshots)).toHaveLength(1);
  });
});
