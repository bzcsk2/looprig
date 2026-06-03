import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { access, mkdir, readFile, rm, lstat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RuntimeLogger, createRuntimeLoggerFromEnv, parseDebugArgs, registerCleanup, runCleanupFunctions, registerShutdownFlush } from "../src/runtime-logger.js"

describe("RuntimeLogger", () => {
  let tmpDir: string
  let logPath: string
  const originalLevel = process.env.DEEPICODE_LOG_LEVEL
  const originalFile = process.env.DEEPICODE_LOG_FILE

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `deepicode-runtime-log-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    logPath = join(tmpDir, "runtime.jsonl")
    await mkdir(tmpDir, { recursive: true })
    delete process.env.DEEPICODE_LOG_LEVEL
    delete process.env.DEEPICODE_LOG_FILE
  })

  afterEach(async () => {
    if (originalLevel === undefined) delete process.env.DEEPICODE_LOG_LEVEL
    else process.env.DEEPICODE_LOG_LEVEL = originalLevel
    if (originalFile === undefined) delete process.env.DEEPICODE_LOG_FILE
    else process.env.DEEPICODE_LOG_FILE = originalFile
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("does not create a file when diagnostics are disabled", async () => {
    const logger = createRuntimeLoggerFromEnv({}, tmpDir)
    expect(logger.isEnabled()).toBe(false)
    logger.info("ignored", { value: 1 })
    await logger.flush()
    await expect(access(join(tmpDir, ".deepicode", "logs"))).rejects.toThrow()
  })

  it("writes JSONL records with child bindings", async () => {
    const logger = new RuntimeLogger({ filePath: logPath, bindings: { sessionId: "session-1" } })
    logger.child({ submitId: "submit-1" }).info("submit.start", { inputLength: 4 })
    await logger.flush()

    const record = JSON.parse((await readFile(logPath, "utf-8")).trim()) as Record<string, unknown>
    expect(record.event).toBe("submit.start")
    expect(record.level).toBe("info")
    expect(record.sessionId).toBe("session-1")
    expect(record.submitId).toBe("submit-1")
    expect(record.inputLength).toBe(4)
  })

  it("LOG-READABILITY-01: preserves correlation IDs across child loggers", async () => {
    const logger = new RuntimeLogger({ filePath: logPath, bindings: { sessionId: "session-1" } })
    logger
      .child({ submitId: "submit-1" })
      .child({ requestId: "request-1" })
      .child({ toolCallId: "tool-call-1" })
      .info("tool.execute.done")
    await logger.flush()

    const record = JSON.parse((await readFile(logPath, "utf-8")).trim()) as Record<string, unknown>
    expect(record.sessionId).toBe("session-1")
    expect(record.submitId).toBe("submit-1")
    expect(record.requestId).toBe("request-1")
    expect(record.toolCallId).toBe("tool-call-1")
  })

  it("redacts sensitive keys recursively", async () => {
    const logger = new RuntimeLogger({ filePath: logPath })
    logger.info("redaction", {
      apiKey: "secret-key",
      token: "generic-token",
      accessToken: "access-token",
      refresh_token: "refresh-token",
      nested: { Authorization: "Bearer secret", password: "hidden", authToken: "auth-token", safe: "visible" },
    })
    await logger.flush()

    const record = JSON.parse((await readFile(logPath, "utf-8")).trim()) as Record<string, any>
    expect(record.apiKey).toBe("[REDACTED]")
    expect(record.token).toBe("[REDACTED]")
    expect(record.accessToken).toBe("[REDACTED]")
    expect(record.refresh_token).toBe("[REDACTED]")
    expect(record.nested.Authorization).toBe("[REDACTED]")
    expect(record.nested.password).toBe("[REDACTED]")
    expect(record.nested.authToken).toBe("[REDACTED]")
    expect(record.nested.safe).toBe("visible")
  })

  it("LOG-READABILITY-01: preserves non-sensitive token statistics", async () => {
    const logger = new RuntimeLogger({ filePath: logPath })
    logger.info("api.usage", {
      promptTokens: 100,
      completionTokens: 50,
      cacheHitTokens: 25,
      cacheMissTokens: 5,
      totalTokens: 150,
    })
    await logger.flush()

    const record = JSON.parse((await readFile(logPath, "utf-8")).trim()) as Record<string, unknown>
    expect(record.promptTokens).toBe(100)
    expect(record.completionTokens).toBe(50)
    expect(record.cacheHitTokens).toBe(25)
    expect(record.cacheMissTokens).toBe(5)
    expect(record.totalTokens).toBe(150)
  })

  it("respects the configured minimum level", async () => {
    const logger = new RuntimeLogger({ filePath: logPath, level: "warn" })
    logger.info("ignored")
    logger.warn("kept")
    await logger.flush()

    const records = (await readFile(logPath, "utf-8")).trim().split("\n")
    expect(records).toHaveLength(1)
    expect(JSON.parse(records[0]).event).toBe("kept")
  })

  it("LOG0: off level disables all logging", async () => {
    const logger = new RuntimeLogger({ filePath: logPath, level: "off" as any })
    logger.debug("debug-msg")
    logger.info("info-msg")
    logger.warn("warn-msg")
    logger.error("error-msg")
    await logger.flush()

    const exists = await access(logPath).then(() => true).catch(() => false)
    expect(exists).toBe(false)
  })

  it("LOG0: truncates long strings to MAX_STRING_LENGTH", async () => {
    const logger = new RuntimeLogger({ filePath: logPath })
    const longString = "x".repeat(5000)
    logger.info("long.string", { value: longString })
    await logger.flush()

    const record = JSON.parse(await readFile(logPath, "utf-8")) as Record<string, any>
    expect(record.value.length).toBeLessThan(5000)
    expect(record.value).toContain("[TRUNCATED]")
  })

  it("LOG0: handles circular references without crashing", async () => {
    const logger = new RuntimeLogger({ filePath: logPath })
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular

    expect(() => logger.info("circular", { obj: circular })).not.toThrow()
    await logger.flush()

    const exists = await access(logPath).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it("LOG0: drops oldest records when queue exceeds maxQueueSize", async () => {
    const logger = new RuntimeLogger({ filePath: logPath, maxQueueSize: 10 })
    for (let i = 0; i < 20; i++) {
      logger.info("msg", { i })
    }
    await logger.flush()

    const records = (await readFile(logPath, "utf-8")).trim().split("\n").map(r => JSON.parse(r))
    expect(records.length).toBeLessThanOrEqual(10)
    expect(logger.getDroppedCount()).toBeGreaterThan(0)
  })

  it("LOG0: noop logger has all methods and returns itself", () => {
    const noop = new RuntimeLogger({ enabled: false })
    expect(noop.isEnabled()).toBe(false)
    expect(noop.child({})).toBe(noop)
    expect(() => noop.debug("test")).not.toThrow()
    expect(() => noop.info("test")).not.toThrow()
    expect(() => noop.warn("test")).not.toThrow()
    expect(() => noop.error("test")).not.toThrow()
  })

  it("LOG0: child logger merges bindings correctly", async () => {
    const parent = new RuntimeLogger({ filePath: logPath, bindings: { sessionId: "s1" } })
    const child = parent.child({ submitId: "sub1" })
    child.info("test", { extra: "data" })
    await child.flush()

    const record = JSON.parse(await readFile(logPath, "utf-8")) as Record<string, any>
    expect(record.sessionId).toBe("s1")
    expect(record.submitId).toBe("sub1")
    expect(record.extra).toBe("data")
  })

  it("LOG2: event filter excludes non-matching events", async () => {
    const logger = new RuntimeLogger({ filePath: logPath, filter: "api" })
    logger.info("api.request.start", { url: "test" })
    logger.info("tool.execute.done", { tool: "test" })
    await logger.flush()

    const exists = await access(logPath).then(() => true).catch(() => false)
    if (exists) {
      const records = (await readFile(logPath, "utf-8")).trim().split("\n").map(r => JSON.parse(r))
      expect(records.every(r => r.event.includes("api"))).toBe(true)
    }
  })

  it("LOG2: parseDebugArgs parses --debug flag", () => {
    expect(parseDebugArgs(["--debug"])).toEqual({ level: "debug" })
    expect(parseDebugArgs(["-d"])).toEqual({ level: "debug" })
    expect(parseDebugArgs(["--debug=api,tool"])).toEqual({ level: "debug", filter: "api,tool" })
    expect(parseDebugArgs(["--debug-file=/tmp/test.jsonl"])).toEqual({ file: "/tmp/test.jsonl" })
  })

  it("LOG2: cleanup registry registers and runs functions", async () => {
    let called = false
    const unregister = registerCleanup(async () => { called = true })
    await runCleanupFunctions()
    expect(called).toBe(true)
    unregister()
  })

  it("LOG2: symlink created when createSymlink is true", async () => {
    const symlinkPath = join(tmpDir, "latest.jsonl")
    const logger = new RuntimeLogger({ filePath: logPath, createSymlink: true })
    logger.info("test.event")
    await logger.flush()

    const stat = await lstat(symlinkPath).catch(() => null)
    expect(stat).not.toBeNull()
  })
})
