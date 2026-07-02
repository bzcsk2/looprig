import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { existsSync, rmSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { Mailbox } from "../src/agent-comm/mailbox.js"
import { AgentCommController } from "../src/agent-comm/controller.js"
import type { AgentMessage } from "../src/agent-comm/types.js"

const TEST_DIR = resolve(process.cwd(), ".covalo-test-mailbox")

function makeMailbox(): Mailbox {
  return new Mailbox(TEST_DIR)
}

function randomId(): string {
  return randomUUID()
}

describe("Mailbox", () => {
  let mailbox: Mailbox
  let threadId: string
  let goalId: string
  let workflowId: string

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    mailbox = makeMailbox()
    threadId = randomId()
    goalId = randomId()
    workflowId = randomId()
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("sends a message and persists to JSONL", () => {
    const msg = mailbox.send({
      threadId,
      goalId,
      workflowId,
      iteration: 1,
      from: "supervisor",
      to: "worker",
      kind: "task",
      delivery: "queue_only",
      content: "Please fix the bug",
    })

    expect(msg.id).toBeDefined()
    expect(msg.createdAt).toBeGreaterThan(0)

    const msgs = mailbox.read({ threadId })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe("Please fix the bug")
    expect(msgs[0].from).toBe("supervisor")
  })

  it("reads messages with goalId filtering", () => {
    const otherGoalId = randomId()

    mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "For current goal" })
    mailbox.send({ threadId, goalId: otherGoalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "For other goal" })

    const filtered = mailbox.read({ threadId, goalId })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].content).toBe("For current goal")
  })

  it("reads with workflowId filtering", () => {
    const otherWfId = randomId()

    mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "Current WF" })
    mailbox.send({ threadId, goalId, workflowId: otherWfId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "Other WF" })

    const filtered = mailbox.read({ threadId, workflowId })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].content).toBe("Current WF")
  })

  it("reads unread only", () => {
    const m1 = mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "First" })
    mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "Second" })

    mailbox.markRead(m1.id, threadId)

    const unread = mailbox.read({ threadId, unreadOnly: true })
    expect(unread).toHaveLength(1)
    expect(unread[0].content).toBe("Second")
  })

  it("marks message as read", () => {
    const msg = mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "Read me" })

    const result = mailbox.markRead(msg.id, threadId)
    expect(result).toBe(true)

    const msgs = mailbox.read({ threadId })
    expect(msgs[0].readAt).toBeGreaterThan(0)
  })

  it("markRead returns false for non-existent message", () => {
    const result = mailbox.markRead("nonexistent", threadId)
    expect(result).toBe(false)
  })

  it("returns empty array for non-existent thread", () => {
    const msgs = mailbox.read({ threadId: "nonexistent" })
    expect(msgs).toEqual([])
  })

  it("limits results", () => {
    for (let i = 0; i < 5; i++) {
      mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: `Msg ${i}` })
    }

    const limited = mailbox.read({ threadId, limit: 3 })
    expect(limited).toHaveLength(3)
  })

  it("hasTriggerTurnItems detects trigger_turn messages", () => {
    mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "No trigger" })
    expect(mailbox.hasTriggerTurnItems(threadId)).toBe(false)

    mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "trigger_turn", content: "Trigger!" })
    expect(mailbox.hasTriggerTurnItems(threadId)).toBe(true)
  })

  it("hasTriggerTurnItems filters by goalId", () => {
    const otherGoalId = randomId()
    mailbox.send({ threadId, goalId: otherGoalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "trigger_turn", content: "Wrong goal" })

    expect(mailbox.hasTriggerTurnItems(threadId, goalId)).toBe(false)
    expect(mailbox.hasTriggerTurnItems(threadId, otherGoalId)).toBe(true)
  })

  it("hasTriggerTurnItems ignores read trigger_turn", () => {
    const msg = mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "trigger_turn", content: "Trigger!" })
    mailbox.markRead(msg.id, threadId)

    expect(mailbox.hasTriggerTurnItems(threadId)).toBe(false)
  })

  it("filters by recipient role", () => {
    mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "To worker" })
    mailbox.send({ threadId, goalId, workflowId, iteration: 1, from: "worker", to: "supervisor", kind: "report", delivery: "queue_only", content: "To supervisor" })

    const workerMsgs = mailbox.read({ threadId, to: "worker" })
    expect(workerMsgs).toHaveLength(1)
    expect(workerMsgs[0].content).toBe("To worker")
  })
})

describe("AgentCommController", () => {
  let mailbox: Mailbox
  let controller: AgentCommController
  let threadId: string
  let goalId: string
  let workflowId: string

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    mailbox = makeMailbox()
    threadId = randomId()
    goalId = randomId()
    workflowId = randomId()
    controller = new AgentCommController({ threadId, goalId, workflowId, iteration: 1 }, mailbox)
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("sendMessage creates queue_only message", () => {
    const msg = controller.sendMessage("supervisor", "worker", "task", "Do the work")
    expect(msg.delivery).toBe("queue_only")
    expect(msg.goalId).toBe(goalId)
    expect(msg.workflowId).toBe(workflowId)
  })

  it("followupTask creates trigger_turn message", () => {
    const msg = controller.followupTask("supervisor", "Execute this")
    expect(msg.delivery).toBe("trigger_turn")
    expect(msg.kind).toBe("task")
    expect(msg.to).toBe("worker")
  })

  it("readMailbox returns messages for current goal", () => {
    controller.sendMessage("supervisor", "worker", "task", "Task 1")
    const msgs = controller.readMailbox()
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe("Task 1")
  })

  it("readMailbox filters by goalId by default", () => {
    controller.sendMessage("supervisor", "worker", "task", "Task 1")
    // Manually add message with different goalId
    mailbox.send({ threadId, goalId: "other-goal", workflowId, iteration: 1, from: "supervisor", to: "worker", kind: "task", delivery: "queue_only", content: "Other goal" })

    const msgs = controller.readMailbox()
    expect(msgs).toHaveLength(1)
  })

  it("markRead works via controller", () => {
    const msg = controller.sendMessage("supervisor", "worker", "task", "Read me")
    const result = controller.markRead(msg.id)
    expect(result).toBe(true)
  })

  it("hasPendingTrigger detects trigger_turn", () => {
    expect(controller.hasPendingTrigger()).toBe(false)
    controller.followupTask("supervisor", "Go!")
    expect(controller.hasPendingTrigger()).toBe(true)
  })
})
