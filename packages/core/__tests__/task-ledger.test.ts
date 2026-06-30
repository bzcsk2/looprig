import { describe, expect, it } from "vitest"

import {
import { setPromptLocale } from "../src/prompt-locale";
  TaskLedgerTracker,
  shouldCreateLedger,
  parsePlanSteps,
  serializePlan,
  formatPlanForContext,
  formatLedgerForContext,
  hashCommand,
  DEFAULT_MIN_STEPS,
} from "../src/task-ledger.js"
import { inferTaskIntent, shouldCreateLedgerByIntent } from "../src/governance/task-state.js"

describe("shouldCreateLedger", () => {
  beforeEach(() => setPromptLocale("en"));
  it("长消息触发 ledger", () => {
    expect(shouldCreateLedger("x".repeat(301))).toBe(true)
  })

  it("简单短消息不触发", () => {
    expect(shouldCreateLedger("hello")).toBe(false)
  })

  it("refactor 关键词触发", () => {
    expect(shouldCreateLedger("refactor the auth module")).toBe(true)
  })
})

describe("parsePlanSteps", () => {
  it("解析编号计划", () => {
    const text = `PLAN:
1. Read existing code
2. Fix the bug
3. Run tests`
    const steps = parsePlanSteps(text)
    expect(steps).not.toBeNull()
    expect(steps!.length).toBe(3)
    expect(steps![0].text).toBe("Read existing code")
    expect(steps![0].status).toBe("active")
    expect(steps![1].status).toBe("pending")
  })

  it("解析无序列表计划", () => {
    const text = `- step one
- step two`
    const steps = parsePlanSteps(text, { minSteps: 2 })
    expect(steps).not.toBeNull()
    expect(steps!.length).toBe(2)
  })

  it("步骤不足 minSteps 时返回 null", () => {
    expect(parsePlanSteps("1. only one step", { minSteps: DEFAULT_MIN_STEPS })).toBeNull()
  })
})

describe("serializePlan / formatPlanForContext", () => {
  it("serialize 后可被 parse 识别", () => {
    const steps = parsePlanSteps("1. a\n2. b")!
    const serialized = serializePlan(steps)
    expect(serialized).toContain("PLAN:")
    expect(serialized).toContain("1. a")
    const reparsed = parsePlanSteps(serialized)
    expect(reparsed?.length).toBe(2)
  })

  it("formatPlanForContext 渲染 active 标记", () => {
    const steps = parsePlanSteps("1. first\n2. second\n3. third")!
    steps[0].status = "done"
    steps[1].status = "active"
    const formatted = formatPlanForContext(steps)
    expect(formatted).toContain("ACTIVE PLAN")
    expect(formatted).toContain("✓ 1.")
    expect(formatted).toContain("→ 2.")
  })
})

describe("TaskLedgerTracker", () => {
  it("写入文件后 verificationPending=true", () => {
    const tracker = new TaskLedgerTracker("fix bug")
    tracker.recordToolResult("write_file", { path: "src/a.ts" }, { isError: false })
    expect(tracker.changedFiles).toContain("src/a.ts")
    expect(tracker.verificationPending).toBe(true)
  })

  it("验收命令成功后清除 pending", () => {
    const tracker = new TaskLedgerTracker("fix bug")
    tracker.recordFileChange("src/a.ts")
    tracker.recordCommandRun("npm test", true, {
      content: "Tests  5 passed (5)",
      metadata: { exitCode: 0 },
    })
    expect(tracker.verificationPending).toBe(false)
    expect(tracker.lastVerification?.exitCode).toBe(0)
  })

  it("验收命令失败后保持 pending 并添加 blocker", () => {
    const tracker = new TaskLedgerTracker("fix bug")
    tracker.recordFileChange("src/a.ts")
    tracker.recordCommandRun("npm test", false, {
      content: "FAIL test/a.test.ts\nAssertionError: expected true",
      metadata: { exitCode: 1 },
    })
    expect(tracker.verificationPending).toBe(true)
    expect(tracker.blockers.some(b => b.startsWith("[verification]"))).toBe(true)
  })

  it("ingestPlanFromText 提取计划", () => {
    const tracker = new TaskLedgerTracker("implement feature")
    const ok = tracker.ingestPlanFromText("PLAN:\n1. design\n2. implement\n3. test")
    expect(ok).toBe(true)
    expect(tracker.plan.length).toBe(3)
  })

  it("snapshot / applySnapshot round-trip", () => {
    const tracker = new TaskLedgerTracker("goal")
    tracker.recordFileChange("a.ts")
    const snap = tracker.snapshot()
    const restored = new TaskLedgerTracker("old")
    restored.applySnapshot(snap)
    expect(restored.goal).toBe("goal")
    expect(restored.changedFiles).toEqual(["a.ts"])
    expect(restored.verificationPending).toBe(true)
  })

  it("formatLedgerForContext 包含 goal 与 verification 状态", () => {
    const tracker = new TaskLedgerTracker("my goal")
    tracker.recordFileChange("x.ts")
    const text = formatLedgerForContext(tracker.snapshot())
    expect(text).toContain("TASK GOAL")
    expect(text).toContain("my goal")
    expect(text).toContain("VERIFICATION: pending")
  })
})

describe("hashCommand", () => {
  it("相同命令产生相同哈希", () => {
    expect(hashCommand("npm test")).toBe(hashCommand("npm test"))
    expect(hashCommand("npm test")).not.toBe(hashCommand("npm run build"))
  })
})

describe("inferTaskIntent", () => {
  it("question 不创建 ledger", () => {
    expect(inferTaskIntent("为什么这个函数报错？")).toBe("question")
    expect(shouldCreateLedgerByIntent("为什么这个函数报错？")).toBe(false)
  })

  it("edit/debug 创建 ledger", () => {
    expect(shouldCreateLedgerByIntent("修复 login 模块的 bug")).toBe(true)
    expect(shouldCreateLedgerByIntent("重构 auth 服务")).toBe(true)
  })
})
