import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("resolve-assets-root", () => {
  test("assertSafeAssetRelativePath rejects absolute path", async () => {
    const { assertSafeAssetRelativePath } = await import("../resolve-assets-root");
    expect(() => assertSafeAssetRelativePath("/etc/passwd")).toThrow();
  });

  test("assertSafeAssetRelativePath rejects .. traversal", async () => {
    const { assertSafeAssetRelativePath } = await import("../resolve-assets-root");
    expect(() => assertSafeAssetRelativePath("swe-bench/../../evil")).toThrow();
  });

  test("assertSafeAssetRelativePath rejects Windows drive", async () => {
    const { assertSafeAssetRelativePath } = await import("../resolve-assets-root");
    expect(() => assertSafeAssetRelativePath("C:\\windows\\system32")).toThrow();
  });

  test("assertSafeAssetRelativePath rejects empty string", async () => {
    const { assertSafeAssetRelativePath } = await import("../resolve-assets-root");
    expect(() => assertSafeAssetRelativePath("")).toThrow();
  });

  test("assertSafeAssetRelativePath allows valid relative path", async () => {
    const { assertSafeAssetRelativePath } = await import("../resolve-assets-root");
    expect(() => assertSafeAssetRelativePath("swe-bench/lock.json")).not.toThrow();
    expect(() => assertSafeAssetRelativePath("terminal-bench/tasks/hello-world/task.yaml")).not.toThrow();
  });

  test("getEvalAssetsRoot reads from LOOPRIG_EVAL_ASSETS_DIR", async () => {
    const tmpDir = join(tmpdir(), `eval-assets-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    process.env.LOOPRIG_EVAL_ASSETS_DIR = tmpDir;
    try {
      const { getEvalAssetsRoot } = await import("../resolve-assets-root");
      const root = getEvalAssetsRoot();
      expect(root).toBe(tmpDir);
    } finally {
      delete process.env.LOOPRIG_EVAL_ASSETS_DIR;
    }
  });

  test("getEvalAssetPath resolves valid relative path", async () => {
    const tmpDir = join(tmpdir(), `eval-assets-test-${randomUUID()}`);
    mkdirSync(join(tmpDir, "swe-bench"), { recursive: true });
    writeFileSync(join(tmpDir, "swe-bench", "lock.json"), "{}");
    process.env.LOOPRIG_EVAL_ASSETS_DIR = tmpDir;
    try {
      const { getEvalAssetPath } = await import("../resolve-assets-root");
      const p = getEvalAssetPath("swe-bench/lock.json");
      expect(p).toBe(join(tmpDir, "swe-bench", "lock.json"));
    } finally {
      delete process.env.LOOPRIG_EVAL_ASSETS_DIR;
    }
  });

  test("getEvalAssetPath throws on missing file", async () => {
    const tmpDir = join(tmpdir(), `eval-assets-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    process.env.LOOPRIG_EVAL_ASSETS_DIR = tmpDir;
    try {
      const { getEvalAssetPath } = await import("../resolve-assets-root");
      expect(() => getEvalAssetPath("nonexistent/file.txt")).toThrow();
    } finally {
      delete process.env.LOOPRIG_EVAL_ASSETS_DIR;
    }
  });
});
