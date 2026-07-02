import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { MemoryStore } from "../src/runtime/memory-store.js"
import { StateKV } from "../src/state/kv.js"
import { VectorIndex } from "../src/state/vector-index.js"
import { InMemoryKV } from "../src/mcp/in-memory-kv.js"
import { parseJsonlText } from "../src/replay/jsonl-parser.js"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "covalo-mem-test-"))
}

describe("F1: MemoryStore path traversal protection", () => {
  let dir: string

  beforeEach(() => { dir = tempDir() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it("rejects key with ../", async () => {
    const store = new MemoryStore(dir)
    await expect(store.get("scope", "../../etc/passwd")).rejects.toThrow("Invalid key")
  })

  it("rejects key with forward slash", async () => {
    const store = new MemoryStore(dir)
    await expect(store.set("scope", "a/b", "val")).rejects.toThrow("Invalid key")
  })

  it("rejects key with backslash", async () => {
    const store = new MemoryStore(dir)
    await expect(store.set("scope", "a\\b", "val")).rejects.toThrow("Invalid key")
  })

  it("rejects scope with path traversal", async () => {
    const store = new MemoryStore(dir)
    await expect(store.get("../evil", "key")).rejects.toThrow("Invalid scope")
  })

  it("accepts normal keys", async () => {
    const store = new MemoryStore(dir)
    await store.set("scope", "normal-key", "value")
    const v = await store.get<string>("scope", "normal-key")
    expect(v).toBe("value")
  })

  it("delete rejects path traversal keys", async () => {
    const store = new MemoryStore(dir)
    await expect(store.delete("scope", "../../etc/hostname")).rejects.toThrow("Invalid key")
  })

  it("list rejects path traversal scope", async () => {
    const store = new MemoryStore(dir)
    await expect(store.list("../evil")).rejects.toThrow("Invalid scope")
  })
})

describe("F2: VectorIndex base64 byte length validation", () => {
  it("accepts valid embedding", () => {
    const idx = new VectorIndex()
    const dims = [0.1, 0.2, 0.3, 0.4]
    idx.add("obs1", "sess1", new Float32Array(dims))
    const serialized = idx.serialize()
    const restored = VectorIndex.deserialize(serialized)
    expect(restored.size).toBe(1)
  })

  it("rejects base64 with invalid byte length via deserialize (caught by try/catch)", () => {
    const badData = JSON.stringify([
      ["obs1", { embedding: "AAAA", sessionId: "sess1" }],
    ])
    const idx = VectorIndex.deserialize(badData)
    // AAAA decodes to 3 bytes, not divisible by 4 → caught and skipped
    expect(idx.size).toBe(0)
  })

  it("skips corrupt vector without crashing other entries", () => {
    // 12 bytes / 4 = 3 floats (valid) for obs1; 3 bytes (invalid) for obs2
    const data = JSON.stringify([
      ["obs1", { embedding: "AAAAAAAAAAA=", sessionId: "s1" }],
      ["obs2", { embedding: "AAAA", sessionId: "s2" }],
    ])
    const idx = VectorIndex.deserialize(data)
    expect(idx.size).toBe(1)
  })
})

describe("F3: StateKV rejects unknown operation types", () => {
  let dir: string
  let store: MemoryStore
  let kv: StateKV

  beforeEach(() => {
    dir = tempDir()
    store = new MemoryStore(dir)
    kv = new StateKV(store)
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it("accepts set operation", async () => {
    await kv.update("scope", "key", [{ type: "set", path: "a", value: 1 }])
    const v = await kv.get<{ a: number }>("scope", "key")
    expect(v?.a).toBe(1)
  })

  it("accepts delete operation", async () => {
    await kv.update("scope", "key", [{ type: "set", path: "a", value: 1 }])
    await kv.update("scope", "key", [{ type: "delete", path: "a" }])
    const v = await kv.get<{ a: number }>("scope", "key")
    expect(v?.a).toBeUndefined()
  })

  it("accepts append operation", async () => {
    await kv.update("scope", "key", [{ type: "set", path: "items", value: [] }])
    await kv.update("scope", "key", [{ type: "append", path: "items", value: 1 }])
    const v = await kv.get<{ items: number[] }>("scope", "key")
    expect(v?.items).toEqual([1])
  })

  it("rejects unknown operation type", async () => {
    await expect(
      kv.update("scope", "key", [{ type: "unknown_op", path: "a", value: 1 }]),
    ).rejects.toThrow('Unknown KV operation type: "unknown_op"')
  })
})

describe("F4: InMemoryKV auto-persist and atomic write", () => {
  let dir: string
  let persistPath: string

  beforeEach(() => {
    dir = tempDir()
    persistPath = join(dir, "kv-data.json")
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it("auto-persists after set", () => {
    const kv = new InMemoryKV(persistPath)
    kv.set("scope", "key1", "value1")
    const raw = readFileSync(persistPath, "utf-8")
    const data = JSON.parse(raw)
    expect(data.scope.key1).toBe("value1")
  })

  it("loads persisted data on construction", async () => {
    const kv1 = new InMemoryKV(persistPath)
    kv1.set("scope", "key", "stored")
    const kv2 = new InMemoryKV(persistPath)
    const v = await kv2.get("scope", "key")
    expect(v).toBe("stored")
  })

  it("auto-persists after delete", () => {
    const kv = new InMemoryKV(persistPath)
    kv.set("scope", "key", "val")
    kv.delete("scope", "key")
    const raw = readFileSync(persistPath, "utf-8")
    const data = JSON.parse(raw)
    expect(data.scope.key).toBeUndefined()
  })

  it("does not persist when persistPath is not set", () => {
    const kv = new InMemoryKV()
    kv.set("scope", "key", "val")
    expect(kv.getLastPersistError()).toBeNull()
  })

  it("reports persist errors via getLastPersistError", () => {
    // Create a directory at the persist path so renameSync fails
    const badPath = join(dir, "persist-dir")
    mkdirSync(badPath)
    const kv = new InMemoryKV(badPath)
    kv.set("scope", "key", "val")
    const err = kv.getLastPersistError()
    expect(err).not.toBeNull()
  })

  it("atomic write does not leave tmp file", () => {
    const kv = new InMemoryKV(persistPath)
    kv.set("scope", "key", "val")
    const files = readFileSync(persistPath, "utf-8")
    expect(files).toBeTruthy()
    // No .covalo_tmp_ files should remain
    const dirFiles = readdirSync(dir)
    expect(dirFiles.filter((f: string) => f.includes("covalo_tmp")).length).toBe(0)
  })
})

describe("F5: deriveProject handles POSIX and Windows paths", () => {
  it("handles POSIX path", () => {
    const result = parseJsonlText(
      JSON.stringify({ type: "user", sessionId: "s1", cwd: "/home/user/project", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
    )
    expect(result.project).toBe("project")
  })

  it("handles Windows path with backslashes", () => {
    const result = parseJsonlText(
      JSON.stringify({ type: "user", sessionId: "s1", cwd: "C:\\work\\repo", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
    )
    expect(result.project).toBe("repo")
  })

  it("returns unknown for empty path", () => {
    const result = parseJsonlText(
      JSON.stringify({ type: "user", sessionId: "s1", cwd: "", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
    )
    expect(result.project).toBe("unknown")
  })
})
