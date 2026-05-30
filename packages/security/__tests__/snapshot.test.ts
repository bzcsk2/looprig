import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { FileSnapshot } from "../src/snapshot.js"
import { writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("FileSnapshot", () => {
  let workDir: string
  let patchesDir: string
  let snap: FileSnapshot

  beforeEach(async () => {
    workDir = join(tmpdir(), `deepicode-snap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    patchesDir = join(workDir, ".deepicode_patches")
    await mkdir(workDir, { recursive: true })
    snap = new FileSnapshot(patchesDir)
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it("should snapshot a file and revert it", async () => {
    const filePath = join(workDir, "test.txt")
    await writeFile(filePath, "original content", "utf-8")

    const id = await snap.snapshot(filePath)
    expect(id).toBeTruthy()

    await writeFile(filePath, "modified content", "utf-8")

    const reverted = await snap.revert(filePath)
    expect(reverted).toBe(true)

    const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"))
    expect(content).toBe("original content")
  })

  it("should return false when reverting non-snapped file", async () => {
    const filePath = join(workDir, "never-snapped.txt")
    const reverted = await snap.revert(filePath)
    expect(reverted).toBe(false)
  })

  it("should list snapshots for a file", async () => {
    const filePath = join(workDir, "list-test.txt")
    await writeFile(filePath, "content", "utf-8")
    await snap.snapshot(filePath)
    const list = await snap.list(filePath)
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list[0]).toMatch(/\.snap$/)
  })

  it("should return empty list for unknown file", async () => {
    const list = await snap.list("/nonexistent/file.txt")
    expect(list).toEqual([])
  })

  it("should retain multiple snapshots for the same file", async () => {
    const filePath = join(workDir, "multi-snap.txt")
    await writeFile(filePath, "v1", "utf-8")
    await snap.snapshot(filePath)
    await writeFile(filePath, "v2", "utf-8")
    await snap.snapshot(filePath)
    await writeFile(filePath, "v3", "utf-8")

    // revert should restore the latest snapshot (v2)
    const reverted = await snap.revert(filePath)
    expect(reverted).toBe(true)
    const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"))
    expect(content).toBe("v2")
  })

  it("should auto-create patches directory when taking snapshot", async () => {
    const customPatches = join(workDir, "custom_patches")
    const snap2 = new (await import("../src/snapshot.js")).FileSnapshot(customPatches)
    const filePath = join(workDir, "auto-dir.txt")
    await writeFile(filePath, "data", "utf-8")

    const id = await snap2.snapshot(filePath)
    expect(id).toBeTruthy()
    // directory should have been auto-created
    const { existsSync } = await import("node:fs")
    expect(existsSync(customPatches)).toBe(true)
  })

  it("should list multiple snapshots in order", async () => {
    const filePath = join(workDir, "list-multi.txt")
    await writeFile(filePath, "v1", "utf-8")
    await snap.snapshot(filePath)
    await new Promise(r => setTimeout(r, 5))
    await writeFile(filePath, "v2", "utf-8")
    await snap.snapshot(filePath)

    const list = await snap.list(filePath)
    expect(list.length).toBe(2)
    expect(list[0]).toMatch(/\.snap$/)
    expect(list[1]).toMatch(/\.snap$/)
  })
})
