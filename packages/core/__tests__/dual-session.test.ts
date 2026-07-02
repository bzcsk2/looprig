import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DualSession } from "../src/dual-session/session.js"
import { DualSessionStore } from "../src/dual-session/store.js"

describe("DualSession", () => {
  it("should create session with default options", () => {
    const session = new DualSession()

    expect(session.getSessionId()).toBeDefined()
    expect(session.getWorkerSessionId()).toBeDefined()
    expect(session.getSupervisorSessionId()).toBeDefined()
  })

  it("should create session with custom options", () => {
    const session = new DualSession({
      sessionId: "test-session",
      workerSessionId: "worker-1",
      supervisorSessionId: "supervisor-1",
    })

    expect(session.getSessionId()).toBe("test-session")
    expect(session.getWorkerSessionId()).toBe("worker-1")
    expect(session.getSupervisorSessionId()).toBe("supervisor-1")
  })

  it("should get role state", () => {
    const session = new DualSession()

    const workerState = session.getRoleState("worker")
    const supervisorState = session.getRoleState("supervisor")

    expect(workerState.role).toBe("worker")
    expect(supervisorState.role).toBe("supervisor")
  })

  it("should add messages to role", () => {
    const session = new DualSession()

    session.addMessage("worker", { role: "user", content: "Hello worker" })
    session.addMessage("supervisor", { role: "user", content: "Hello supervisor" })

    const workerMessages = session.getMessages("worker")
    const supervisorMessages = session.getMessages("supervisor")

    expect(workerMessages).toHaveLength(1)
    expect(workerMessages[0].content).toBe("Hello worker")
    expect(supervisorMessages).toHaveLength(1)
    expect(supervisorMessages[0].content).toBe("Hello supervisor")
  })

  it("should set system prompt", () => {
    const session = new DualSession()

    session.setSystemPrompt("worker", "You are a worker")
    session.setSystemPrompt("supervisor", "You are a supervisor")

    expect(session.getRoleState("worker").systemPrompt).toBe("You are a worker")
    expect(session.getRoleState("supervisor").systemPrompt).toBe("You are a supervisor")
  })

  it("should set thinking mode", () => {
    const session = new DualSession()

    session.setThinkingMode("worker", "high")
    session.setThinkingMode("supervisor", "off")

    expect(session.getRoleState("worker").thinkingMode).toBe("high")
    expect(session.getRoleState("supervisor").thinkingMode).toBe("off")
  })

  it("should set model target", () => {
    const session = new DualSession()

    session.setModelTarget("worker", "deepseek/deepseek-v4")
    session.setModelTarget("supervisor", "zen/mimo-v2.5-free")

    expect(session.getRoleState("worker").modelTarget).toBe("deepseek/deepseek-v4")
    expect(session.getRoleState("supervisor").modelTarget).toBe("zen/mimo-v2.5-free")
  })

  it("should update stats", () => {
    const session = new DualSession()

    session.updateStats("worker", { promptTokens: 100, completionTokens: 50 })

    const workerState = session.getRoleState("worker")
    expect(workerState.stats.promptTokens).toBe(100)
    expect(workerState.stats.completionTokens).toBe(50)
  })

  it("should set and get workflow checkpoint", () => {
    const session = new DualSession()

    const checkpoint = {
      workflowId: "workflow-1",
      state: {
        workflowId: "workflow-1",
        iteration: 1,
        maxRounds: 9,
        currentPhase: "worker_do" as const,
        phaseHistory: ["idle", "supervisor_analyse"],
        ledgerVersion: 0,
        goal: "Fix bugs",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      savedAt: Date.now(),
    }

    session.setWorkflowCheckpoint(checkpoint)
    const retrieved = session.getWorkflowCheckpoint()

    expect(retrieved).toBeDefined()
    expect(retrieved?.workflowId).toBe("workflow-1")
  })

  it("should add and get advice history", () => {
    const session = new DualSession()

    session.addAdviceHistory({
      workflowId: "workflow-1",
      iteration: 1,
      decision: "continue",
      adopted: true,
      timestamp: Date.now(),
    })

    const history = session.getAdviceHistory()
    expect(history).toHaveLength(1)
    expect(history[0].workflowId).toBe("workflow-1")
  })

  it("should check if advice is adopted", () => {
    const session = new DualSession()

    session.addAdviceHistory({
      workflowId: "workflow-1",
      iteration: 1,
      decision: "continue",
      adopted: true,
      timestamp: Date.now(),
    })

    session.addAdviceHistory({
      workflowId: "workflow-1",
      iteration: 2,
      decision: "revise",
      adopted: false,
      timestamp: Date.now(),
    })

    expect(session.isAdviceAdopted("workflow-1", 1)).toBe(true)
    expect(session.isAdviceAdopted("workflow-1", 2)).toBe(false)
    expect(session.isAdviceAdopted("workflow-2", 1)).toBe(false)
  })

  it("should convert to snapshot and restore", () => {
    const session = new DualSession({
      sessionId: "test-session",
      workerSessionId: "worker-1",
      supervisorSessionId: "supervisor-1",
    })

    session.addMessage("worker", { role: "user", content: "Hello" })
    session.setSystemPrompt("worker", "You are a worker")

    const snapshot = session.toSnapshot()
    const restored = DualSession.fromSnapshot(snapshot)

    expect(restored.getSessionId()).toBe("test-session")
    expect(restored.getMessages("worker")).toHaveLength(1)
    expect(restored.getRoleState("worker").systemPrompt).toBe("You are a worker")
  })

  it("should convert to checkpoint and restore", () => {
    const session = new DualSession({
      sessionId: "test-session",
    })

    session.addMessage("worker", { role: "user", content: "Hello" })

    const checkpoint = session.toCheckpoint()
    const restored = DualSession.fromCheckpoint(checkpoint)

    expect(restored.getSessionId()).toBe("test-session")
    expect(restored.getMessages("worker")).toHaveLength(1)
  })
})

describe("DualSessionStore", () => {
  let tmpDir: string
  let store: DualSessionStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "covalo-dual-session-"))
    store = new DualSessionStore({ sessionDir: tmpDir })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should save and load session", () => {
    const session = new DualSession({
      sessionId: "test-session",
    })

    session.addMessage("worker", { role: "user", content: "Hello" })

    const saved = store.save(session)
    expect(saved).toBe(true)

    const loaded = store.load("test-session")
    expect(loaded).toBeDefined()
    expect(loaded?.getSessionId()).toBe("test-session")
    expect(loaded?.getMessages("worker")).toHaveLength(1)
  })

  it("should return null for non-existent session", () => {
    const loaded = store.load("non-existent")
    expect(loaded).toBeNull()
  })

  it("should check if session exists", () => {
    expect(store.exists("test-session")).toBe(false)

    const session = new DualSession({ sessionId: "test-session" })
    store.save(session)

    expect(store.exists("test-session")).toBe(true)
  })

  it("should delete session", () => {
    const session = new DualSession({ sessionId: "test-session" })
    store.save(session)

    expect(store.exists("test-session")).toBe(true)

    const deleted = store.delete("test-session")
    expect(deleted).toBe(true)
    expect(store.exists("test-session")).toBe(false)
  })

  it("should list sessions", () => {
    const session1 = new DualSession({ sessionId: "session-1" })
    const session2 = new DualSession({ sessionId: "session-2" })

    store.save(session1)
    store.save(session2)

    const sessions = store.list()
    expect(sessions).toContain("session-1")
    expect(sessions).toContain("session-2")
  })

  it("should handle corrupted session file", () => {
    const fs = require("node:fs")
    const dir = join(tmpDir, "corrupted-session")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(join(dir, "dual-session.json"), "{invalid json}", "utf8")

    const loaded = store.load("corrupted-session")
    expect(loaded).toBeNull()
  })
})
