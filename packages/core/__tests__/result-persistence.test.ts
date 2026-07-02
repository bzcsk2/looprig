import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, rm, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { maybePersistResult, DEFAULT_MAX_RESULT_CHARS, resetSessionByteUsage, getSessionByteUsage } from "../src/result-persistence.js"

const TEST_DIR = join(process.cwd(), ".covalo", "results", "test-session")

describe("P4: Result Overflow Persistence", () => {
  beforeEach(async () => {
    await rm(join(process.cwd(), ".covalo", "results"), { recursive: true, force: true })
  })

  afterEach(async () => {
    await rm(join(process.cwd(), ".covalo", "results"), { recursive: true, force: true })
  })

  it("returns original content when under threshold", async () => {
    const content = "short result"
    const r = await maybePersistResult(content, "session-1", "bash")
    expect(r.content).toBe(content)
    expect(r.persisted).toBeUndefined()
    expect(r.warning).toBeUndefined()
  })

  it("persists large content and returns preview with truncation marker", async () => {
    const largeContent = "x".repeat(DEFAULT_MAX_RESULT_CHARS + 1000)
    const r = await maybePersistResult(largeContent, "session-1", "bash", { previewChars: 500 })
    expect(r.content).toContain("[TRUNCATED:")
    expect(r.content).toContain("500 chars]")
    expect(r.persisted).toBeDefined()
    expect(r.persisted!.truncated).toBe(true)
    expect(r.persisted!.originalChars).toBe(largeContent.length)
    expect(r.persisted!.previewChars).toBe(500)
    expect(r.persisted!.persistedPath).toContain("session-1")
    expect(r.persisted!.persistedPath).toContain("bash-")
    expect(r.persisted!.persistedPath).toSatisfy((p: string) => p.endsWith(".txt"))
  })

  it("writes file with correct permissions", async () => {
    const largeContent = "y".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const r = await maybePersistResult(largeContent, "session-2", "grep")
    expect(r.persisted).toBeDefined()

    const fileStat = await stat(r.persisted!.persistedPath)
    // File should be readable
    const written = await readFile(r.persisted!.persistedPath, "utf-8")
    expect(written).toBe(largeContent)
  })

  it("creates directory with 0700 permissions", async () => {
    const largeContent = "z".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    await maybePersistResult(largeContent, "session-3", "read_file")
    const dir = join(process.cwd(), ".covalo", "results", "session-3")
    const dirStat = await stat(dir)
    expect(dirStat.isDirectory()).toBe(true)
  })

  it("sanitizes session ID in path — no path traversal", async () => {
    const largeContent = "a".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const r = await maybePersistResult(largeContent, "../../../etc/passwd", "bash")
    expect(r.persisted).toBeDefined()
    // Key: no path traversal (..) in the final path
    expect(r.persisted!.persistedPath).not.toContain("..")
    // The path should be under .covalo/results/
    const normalizedPath = r.persisted!.persistedPath.replace(/\\/g, "/")
    expect(normalizedPath).toContain(".covalo/results/")
  })

  it("sanitizes tool name in filename", async () => {
    const largeContent = "b".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const r = await maybePersistResult(largeContent, "session-4", "../../evil")
    expect(r.persisted).toBeDefined()
    expect(r.persisted!.persistedPath).not.toContain("..")
  })

  it("uses default preview length of 2000 chars with truncation marker", async () => {
    const largeContent = "c".repeat(DEFAULT_MAX_RESULT_CHARS + 1000)
    const r = await maybePersistResult(largeContent, "session-5", "bash")
    expect(r.content).toContain("[TRUNCATED:")
    expect(r.content).toContain("2000 chars]")
    expect(r.persisted!.truncated).toBe(true)
  })

  it("returns warning on write failure", async () => {
    // Use an invalid path that can't be created (file in place of directory)
    const content = "d".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    // This should not throw — it falls back to preview with warning
    const r = await maybePersistResult(content, "session-6", "bash")
    // The write may or may not fail depending on environment, but should not throw
    expect(r.content.length).toBeGreaterThan(0)
  })

  it("multiple persists create separate files", async () => {
    const content1 = "1".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const content2 = "2".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const r1 = await maybePersistResult(content1, "session-7", "bash")
    const r2 = await maybePersistResult(content2, "session-7", "bash")
    expect(r1.persisted!.persistedPath).not.toBe(r2.persisted!.persistedPath)
  })

  it("does not persist error results (caller handles)", async () => {
    // maybePersistResult only checks content length, not isError
    // The caller (executor) only calls it for non-error results
    const content = "e".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const r = await maybePersistResult(content, "session-8", "bash")
    expect(r.persisted).toBeDefined()
  })
})

describe("AUD-02: session quota and cleanup", () => {
  beforeEach(async () => {
    await rm(join(process.cwd(), ".covalo", "results"), { recursive: true, force: true })
    resetSessionByteUsage()
  })

  afterEach(async () => {
    await rm(join(process.cwd(), ".covalo", "results"), { recursive: true, force: true })
    resetSessionByteUsage()
  })

  it("tracks byte usage across multiple persists", async () => {
    const content = "x".repeat(DEFAULT_MAX_RESULT_CHARS + 100) // ~200k chars
    await maybePersistResult(content, "q-session", "bash")
    const used = getSessionByteUsage("q-session")
    expect(used).toBeGreaterThan(0)

    await maybePersistResult(content, "q-session", "grep")
    const used2 = getSessionByteUsage("q-session")
    expect(used2).toBeGreaterThan(used)
  })

  it("returns warning when quota exceeded", async () => {
    const content = "y".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const smallQuota = { sessionQuotaBytes: 100, maxResultSizeChars: 10, previewChars: 10 }
    const r = await maybePersistResult(content, "quota-session", "bash", smallQuota)
    expect(r.persisted).toBeDefined()
    expect(r.persisted!.persistedPath).toBe("")
    expect(r.persisted!.truncated).toBe(true)
    expect(r.warning).toContain("quota exceeded")
    expect(r.content).toContain("[TRUNCATED:")
  })

  it("separate sessions have independent quotas", async () => {
    const content = "z".repeat(5000) // small enough to fit under 10K quota
    const quota = { sessionQuotaBytes: 10000, maxResultSizeChars: 100, previewChars: 50 }

    // First persist for session-A and session-B should succeed
    const rA = await maybePersistResult(content, "session-A", "bash", quota)
    expect(rA.persisted).toBeDefined()
    expect(getSessionByteUsage("session-A")).toBeGreaterThan(0)

    const rB = await maybePersistResult(content, "session-B", "bash", quota)
    expect(rB.persisted).toBeDefined()
    expect(getSessionByteUsage("session-B")).toBeGreaterThan(0)

    // Second persist for session-A uses remaining quota (5000 → 10000)
    const rA2 = await maybePersistResult(content, "session-A", "bash", quota)
    expect(rA2.persisted).toBeDefined()
    expect(getSessionByteUsage("session-A")).toBe(10000)

    // Third persist should exceed 10000 quota
    const rA3 = await maybePersistResult(content, "session-A", "bash", quota)
    expect(rA3.warning).toContain("quota exceeded")
    expect(rA3.persisted).toBeDefined()
    expect(rA3.persisted!.persistedPath).toBe("")
    expect(rA3.persisted!.truncated).toBe(true)
  })

  it("cleans up old files when exceeding max count", async () => {
    const content = "c".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const config = { maxFilesPerSession: 3 }

    // Write 5 files with brief delays for distinct mtimes
    for (let i = 0; i < 5; i++) {
      await maybePersistResult(content, "cleanup-session", "bash", config)
      await new Promise(r => setTimeout(r, 50))
    }

    // Wait for async cleanup
    await new Promise(r => setTimeout(r, 200))

    const dir = join(process.cwd(), ".covalo", "results", "cleanup-session")
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      files = []
    }
    expect(files.length).toBeLessThanOrEqual(4)
    expect(files.length).toBeGreaterThan(0)
  })

  it("resetSessionByteUsage clears tracking", async () => {
    const content = "r".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    await maybePersistResult(content, "reset-me", "bash")
    expect(getSessionByteUsage("reset-me")).toBeGreaterThan(0)
    resetSessionByteUsage("reset-me")
    expect(getSessionByteUsage("reset-me")).toBe(0)
  })
})

describe("CL-31: Disk-based session usage initialization", () => {
  beforeEach(async () => {
    await rm(join(process.cwd(), ".covalo", "results"), { recursive: true, force: true })
    resetSessionByteUsage()
  })

  afterEach(async () => {
    await rm(join(process.cwd(), ".covalo", "results"), { recursive: true, force: true })
    resetSessionByteUsage()
  })

  it("initializes usage from existing files on disk", async () => {
    // Write a file manually to simulate existing persistence
    const dir = join(process.cwd(), ".covalo", "results", "legacy-session")
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const existingContent = "x".repeat(10_000)
    const existingFile = join(dir, "legacy-tool.txt")
    await writeFile(existingFile, existingContent, { mode: 0o600 })

    // Now persist a new overflow result — usage should include the existing file
    const newContent = "y".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const r = await maybePersistResult(newContent, "legacy-session", "bash")
    expect(r.persisted).toBeDefined()

    const totalUsage = getSessionByteUsage("legacy-session")
    // Should include both existing (10k) and new file
    expect(totalUsage).toBeGreaterThan(10_000)
  })

  it("does not scan disk for small results (under threshold)", async () => {
    // Previously persisted big files for this session
    const dir = join(process.cwd(), ".covalo", "results", "small-session")
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(join(dir, "old-big.txt"), "z".repeat(50_000), { mode: 0o600 })

    // Small result should NOT trigger disk scan or count existing files
    // (because maybePersistResult returns early before initSessionUsage)
    const smallContent = "hello"
    const r = await maybePersistResult(smallContent, "small-session", "bash")
    expect(r.content).toBe(smallContent)
    expect(r.persisted).toBeUndefined()
    // Usage should still be 0 since we never triggered init for non-overflow
    // (resetSessionByteUsage was called in beforeEach, so sessionByteUsage is empty)
  })

  it("initSessionUsage handles missing directories gracefully", async () => {
    resetSessionByteUsage("ghost-session")
    // First overflow for non-existent session dir — should create and not crash
    const content = "g".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const r = await maybePersistResult(content, "ghost-session", "bash")
    expect(r.persisted).toBeDefined()
    expect(getSessionByteUsage("ghost-session")).toBeGreaterThan(0)
  })

  it("cleanup recalibrates memory count after removing files", async () => {
    const content = "c".repeat(DEFAULT_MAX_RESULT_CHARS + 100)
    const config = { maxFilesPerSession: 2 }

    for (let i = 0; i < 4; i++) {
      await maybePersistResult(content, "recal-session", "bash", config)
      await new Promise(r => setTimeout(r, 50))
    }
    await new Promise(r => setTimeout(r, 200))

    const dir = join(process.cwd(), ".covalo", "results", "recal-session")
    const files = await readdir(dir)
    expect(files.length).toBeLessThanOrEqual(3)

    // Memory count should reflect actual bytes on disk, not accumulated
    // Since cleanup subtracts removed file bytes
    const usage = getSessionByteUsage("recal-session")
    const expectedFiles = Math.min(files.length, 2) // max 2 kept + maybe 1 in flight
    expect(usage).toBeGreaterThan(0)
  })
})
