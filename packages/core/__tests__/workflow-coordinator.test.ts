import { describe, it, expect, vi } from "vitest"
import { WorkflowCoordinator } from "../src/workflow-coordinator/coordinator.js"
import type { WorkflowSupervisorAdvice } from "../src/workflow-coordinator/types.js"

describe("WorkflowCoordinator", () => {
  it("yields phase events before role output so consumers can label each role", async () => {
    const roleEvent = { role: "assistant_final", content: "plan" } as const
    const runtime = {
      getSupervisor: () => ({
        submit: async function* () { yield roleEvent },
        getState: () => ({ messages: [{ role: "assistant", content: "approve" }] }),
      }),
      getWorker: () => ({
        submit: async function* () { yield { role: "assistant_final", content: "done" } },
        getState: () => ({ messages: [{ role: "assistant", content: "done" }] }),
      }),
    }
    const coordinator = new WorkflowCoordinator({ runtime: runtime as any })
    coordinator.startWorkflow({ goal: "test" })

    const events: any[] = []
    for await (const event of coordinator.runWorkflow()) events.push(event)

    const supervisorPhase = events.findIndex(event => event.type === "phase_change" && event.phase === "supervisor_analyse")
    const supervisorOutput = events.findIndex(event => event.role === "assistant_final" && event.content === "plan")
    const workerPhase = events.findIndex(event => event.type === "phase_change" && event.phase === "worker_do")
    const workerOutput = events.findIndex(event => event.role === "assistant_final" && event.content === "done")

    expect(supervisorPhase).toBeGreaterThanOrEqual(0)
    expect(supervisorOutput).toBeGreaterThan(supervisorPhase)
    expect(workerPhase).toBeGreaterThan(supervisorOutput)
    expect(workerOutput).toBeGreaterThan(workerPhase)
  })

  it("blocks instead of starting Worker when Supervisor analysis fails", async () => {
    let workerCalls = 0
    const runtime = {
      getSupervisor: () => ({
        submit: async function* () { yield { role: "error", content: "HTTP 400" } },
        getState: () => ({ messages: [] }),
      }),
      getWorker: () => ({
        submit: async function* () { workerCalls++ },
        getState: () => ({ messages: [] }),
      }),
    }
    const coordinator = new WorkflowCoordinator({ runtime: runtime as any })
    coordinator.startWorkflow({ goal: "test" })

    const events: any[] = []
    for await (const event of coordinator.runWorkflow()) events.push(event)

    expect(workerCalls).toBe(0)
    expect(coordinator.getState()?.currentPhase).toBe("blocked")
    expect(events).toContainEqual(expect.objectContaining({ type: "blocked", reason: "HTTP 400" }))
  })

  it("blocks instead of starting Worker when Supervisor returns no plan", async () => {
    let workerCalls = 0
    const runtime = {
      getSupervisor: () => ({
        submit: async function* () { yield { role: "done" } },
        getState: () => ({ messages: [{ role: "assistant", content: "" }] }),
      }),
      getWorker: () => ({
        submit: async function* () { workerCalls++ },
        getState: () => ({ messages: [] }),
      }),
    }
    const coordinator = new WorkflowCoordinator({ runtime: runtime as any })
    coordinator.startWorkflow({ goal: "test" })

    for await (const _event of coordinator.runWorkflow()) { /* consume */ }

    expect(workerCalls).toBe(0)
    expect(coordinator.getState()?.blockedReason).toBe("Supervisor did not produce a plan")
  })

  it("should create coordinator with default config", () => {
    const coordinator = new WorkflowCoordinator()
    const config = coordinator.getConfig()

    expect(config.maxRounds).toBe(9)
    expect(config.requireSupervisorPlan).toBe(true)
    expect(config.requireVerificationGate).toBe(true)
  })

  it("should create coordinator with custom config", () => {
    const coordinator = new WorkflowCoordinator({
      config: { maxRounds: 5, requireSupervisorPlan: false },
    })
    const config = coordinator.getConfig()

    expect(config.maxRounds).toBe(5)
    expect(config.requireSupervisorPlan).toBe(false)
    expect(config.requireVerificationGate).toBe(true)
  })

  it("should start workflow", () => {
    const coordinator = new WorkflowCoordinator()
    const state = coordinator.startWorkflow({ goal: "Fix all bugs" })

    expect(state.workflowId).toBeDefined()
    expect(state.goal).toBe("Fix all bugs")
    expect(state.iteration).toBe(0)
    expect(state.currentPhase).toBe("idle")
    expect(state.maxRounds).toBe(9)
  })

  it("should not start workflow if already in progress", () => {
    const coordinator = new WorkflowCoordinator()
    coordinator.startWorkflow({ goal: "Fix all bugs" })

    expect(() => coordinator.startWorkflow({ goal: "New goal" })).toThrow("Workflow already in progress")
  })

  it("should transition between phases", () => {
    const coordinator = new WorkflowCoordinator()
    coordinator.startWorkflow({ goal: "Fix all bugs" })

    coordinator.transition("supervisor_analyse")
    expect(coordinator.getState()?.currentPhase).toBe("supervisor_analyse")
    expect(coordinator.getState()?.iteration).toBe(1)

    coordinator.transition("worker_do")
    expect(coordinator.getState()?.currentPhase).toBe("worker_do")
    expect(coordinator.getState()?.iteration).toBe(1)

    coordinator.transition("worker_report")
    expect(coordinator.getState()?.currentPhase).toBe("worker_report")

    coordinator.transition("supervisor_check")
    expect(coordinator.getState()?.currentPhase).toBe("supervisor_check")
  })

  it("should track phase history", () => {
    const coordinator = new WorkflowCoordinator()
    coordinator.startWorkflow({ goal: "Fix all bugs" })

    coordinator.transition("supervisor_analyse")
    coordinator.transition("worker_do")
    coordinator.transition("worker_report")

    const state = coordinator.getState()
    expect(state?.phaseHistory).toEqual(["idle", "supervisor_analyse", "worker_do"])
  })

  it("should set supervisor plan", () => {
    const coordinator = new WorkflowCoordinator()
    coordinator.startWorkflow({ goal: "Fix all bugs" })

    coordinator.setSupervisorPlan("1. Analyze code\n2. Fix bugs\n3. Test")
    expect(coordinator.getState()?.supervisorPlan).toBe("1. Analyze code\n2. Fix bugs\n3. Test")
  })

  it("should set worker report", () => {
    const coordinator = new WorkflowCoordinator()
    coordinator.startWorkflow({ goal: "Fix all bugs" })

    coordinator.setWorkerReport("Fixed 5 bugs, all tests pass")
    expect(coordinator.getState()?.workerReport).toBe("Fixed 5 bugs, all tests pass")
  })

  it("should apply valid advice", () => {
    const coordinator = new WorkflowCoordinator()
    const state = coordinator.startWorkflow({ goal: "Fix all bugs" })

    coordinator.transition("supervisor_analyse")

    const advice: WorkflowSupervisorAdvice = {
      workflowId: state.workflowId,
      iteration: 1,
      ledgerVersion: 0,
      decision: "continue",
      feedback: "Good progress",
      timestamp: Date.now(),
      stale: false,
    }

    const applied = coordinator.applyAdvice(advice)
    expect(applied).toBe(true)
    expect(coordinator.getState()?.lastDecision).toBe("continue")
  })

  it("should reject advice with wrong workflowId", () => {
    const coordinator = new WorkflowCoordinator()
    coordinator.startWorkflow({ goal: "Fix all bugs" })
    coordinator.transition("supervisor_analyse")

    const advice: WorkflowSupervisorAdvice = {
      workflowId: "wrong-id",
      iteration: 1,
      ledgerVersion: 0,
      decision: "continue",
      timestamp: Date.now(),
      stale: false,
    }

    const applied = coordinator.applyAdvice(advice)
    expect(applied).toBe(false)
  })

  it("should reject advice with wrong iteration", () => {
    const coordinator = new WorkflowCoordinator()
    const state = coordinator.startWorkflow({ goal: "Fix all bugs" })
    coordinator.transition("supervisor_analyse")

    const advice: WorkflowSupervisorAdvice = {
      workflowId: state.workflowId,
      iteration: 2,
      ledgerVersion: 0,
      decision: "continue",
      timestamp: Date.now(),
      stale: false,
    }

    const applied = coordinator.applyAdvice(advice)
    expect(applied).toBe(false)
  })

  it("should reject stale advice", () => {
    const coordinator = new WorkflowCoordinator()
    const state = coordinator.startWorkflow({ goal: "Fix all bugs" })
    coordinator.transition("supervisor_analyse")

    const advice: WorkflowSupervisorAdvice = {
      workflowId: state.workflowId,
      iteration: 1,
      ledgerVersion: 0,
      decision: "continue",
      timestamp: Date.now(),
      stale: true,
    }

    const applied = coordinator.applyAdvice(advice)
    expect(applied).toBe(false)
  })

  it("should mark advice as stale if ledgerVersion mismatch", () => {
    const coordinator = new WorkflowCoordinator()
    const state = coordinator.startWorkflow({ goal: "Fix all bugs" })
    coordinator.transition("supervisor_analyse")

    const advice: WorkflowSupervisorAdvice = {
      workflowId: state.workflowId,
      iteration: 1,
      ledgerVersion: 5,
      decision: "continue",
      timestamp: Date.now(),
      stale: false,
    }

    const applied = coordinator.applyAdvice(advice)
    expect(applied).toBe(false)
    expect(advice.stale).toBe(true)
  })

  it("should apply revise advice and update goal", () => {
    const coordinator = new WorkflowCoordinator()
    const state = coordinator.startWorkflow({ goal: "Fix all bugs" })
    coordinator.transition("supervisor_analyse")

    const advice: WorkflowSupervisorAdvice = {
      workflowId: state.workflowId,
      iteration: 1,
      ledgerVersion: 0,
      decision: "revise",
      revisedGoal: "Fix critical bugs only",
      timestamp: Date.now(),
      stale: false,
    }

    const applied = coordinator.applyAdvice(advice)
    expect(applied).toBe(true)
    expect(coordinator.getState()?.goal).toBe("Fix critical bugs only")
  })

  it("should check if workflow can continue", () => {
    const coordinator = new WorkflowCoordinator({ config: { maxRounds: 2 } })
    coordinator.startWorkflow({ goal: "Fix all bugs" })

    expect(coordinator.canContinue()).toBe(true)

    coordinator.transition("supervisor_analyse")
    coordinator.transition("worker_do")
    coordinator.transition("worker_report")
    coordinator.transition("supervisor_check")

    coordinator.transition("supervisor_analyse")
    coordinator.transition("worker_do")
    coordinator.transition("worker_report")
    coordinator.transition("supervisor_check")

    expect(coordinator.canContinue()).toBe(false)
  })

  it("should check if workflow is finished", () => {
    const coordinator = new WorkflowCoordinator()
    coordinator.startWorkflow({ goal: "Fix all bugs" })

    expect(coordinator.isFinished()).toBe(false)

    coordinator.transition("completed")
    expect(coordinator.isFinished()).toBe(true)
  })

  it("should save and restore checkpoint", () => {
    const coordinator = new WorkflowCoordinator()
    coordinator.startWorkflow({ goal: "Fix all bugs" })
    coordinator.transition("supervisor_analyse")
    coordinator.setSupervisorPlan("Test plan")

    const checkpoint = coordinator.saveCheckpoint()
    expect(checkpoint.state.goal).toBe("Fix all bugs")
    expect(checkpoint.state.currentPhase).toBe("supervisor_analyse")
    expect(checkpoint.state.supervisorPlan).toBe("Test plan")

    const newCoordinator = new WorkflowCoordinator()
    newCoordinator.restoreCheckpoint(checkpoint)

    expect(newCoordinator.getState()?.goal).toBe("Fix all bugs")
    expect(newCoordinator.getState()?.currentPhase).toBe("supervisor_analyse")
    expect(newCoordinator.getState()?.supervisorPlan).toBe("Test plan")
  })

  it("should reset workflow", () => {
    const coordinator = new WorkflowCoordinator()
    coordinator.startWorkflow({ goal: "Fix all bugs" })
    coordinator.transition("supervisor_analyse")

    coordinator.reset()
    expect(coordinator.getState()).toBeNull()
  })

  it("should emit events", () => {
    const events: any[] = []
    const coordinator = new WorkflowCoordinator({
      onEvent: (event) => events.push(event),
    })

    coordinator.startWorkflow({ goal: "Fix all bugs" })
    coordinator.transition("supervisor_analyse")
    coordinator.transition("worker_do")

    expect(events).toHaveLength(4)
    expect(events[0].type).toBe("phase_change")
    expect(events[0].phase).toBe("idle")
    expect(events[1].type).toBe("iteration_change")
    expect(events[1].iteration).toBe(1)
    expect(events[2].type).toBe("phase_change")
    expect(events[2].phase).toBe("supervisor_analyse")
    expect(events[3].type).toBe("phase_change")
    expect(events[3].phase).toBe("worker_do")
  })

  it("should emit blocked event", () => {
    const events: any[] = []
    const coordinator = new WorkflowCoordinator({
      onEvent: (event) => events.push(event),
    })

    coordinator.startWorkflow({ goal: "Fix all bugs" })
    coordinator.transition("blocked", "Max rounds reached")

    const blockedEvent = events.find((e) => e.type === "blocked")
    expect(blockedEvent).toBeDefined()
    expect(blockedEvent.reason).toBe("Max rounds reached")
  })

  it("should not transition if no workflow in progress", () => {
    const coordinator = new WorkflowCoordinator()
    const result = coordinator.transition("supervisor_analyse")
    expect(result.success).toBe(false)
    expect(result.error).toBe("No workflow in progress")
  })

  describe("supervisor_intervene 中途干预", () => {
    it("should transition to supervisor_intervene from worker_do", () => {
      const coordinator = new WorkflowCoordinator()
      coordinator.startWorkflow({ goal: "Fix all bugs" })

      coordinator.transition("supervisor_analyse")
      coordinator.transition("worker_do")

      const result = coordinator.transition("supervisor_intervene")
      expect(result.success).toBe(true)
      expect(coordinator.getState()?.currentPhase).toBe("supervisor_intervene")
    })

    it("should emit supervisor_intervene event", () => {
      const events: any[] = []
      const coordinator = new WorkflowCoordinator({
        onEvent: (event) => events.push(event),
      })

      coordinator.startWorkflow({ goal: "Fix all bugs" })
      coordinator.transition("supervisor_analyse")
      coordinator.transition("worker_do")
      coordinator.transition("supervisor_intervene")

      const interveneEvent = events.find((e) => e.type === "supervisor_intervene")
      expect(interveneEvent).toBeDefined()
      expect(interveneEvent.workflowId).toBeDefined()
    })

    it("should transition from supervisor_intervene back to worker_do", () => {
      const coordinator = new WorkflowCoordinator()
      coordinator.startWorkflow({ goal: "Fix all bugs" })

      coordinator.transition("supervisor_analyse")
      coordinator.transition("worker_do")
      coordinator.transition("supervisor_intervene")

      const result = coordinator.transition("worker_do")
      expect(result.success).toBe(true)
      expect(coordinator.getState()?.currentPhase).toBe("worker_do")
    })

    it("should transition from supervisor_intervene to supervisor_check", () => {
      const coordinator = new WorkflowCoordinator()
      coordinator.startWorkflow({ goal: "Fix all bugs" })

      coordinator.transition("supervisor_analyse")
      coordinator.transition("worker_do")
      coordinator.transition("supervisor_intervene")

      const result = coordinator.transition("supervisor_check")
      expect(result.success).toBe(true)
      expect(coordinator.getState()?.currentPhase).toBe("supervisor_check")
    })

    it("should track intervention count", () => {
      const coordinator = new WorkflowCoordinator()
      coordinator.startWorkflow({ goal: "Fix all bugs" })

      coordinator.transition("supervisor_analyse")
      coordinator.transition("worker_do")
      coordinator.transition("supervisor_intervene")
      coordinator.transition("worker_do")
      coordinator.transition("supervisor_intervene")

      expect(coordinator.getState()?.interventionCount).toBe(2)
    })

    it("should not transition to supervisor_intervene from supervisor_check", () => {
      const coordinator = new WorkflowCoordinator()
      coordinator.startWorkflow({ goal: "Fix all bugs" })

      coordinator.transition("supervisor_analyse")
      coordinator.transition("worker_do")
      coordinator.transition("worker_report")
      coordinator.transition("supervisor_check")

      const result = coordinator.transition("supervisor_intervene")
      expect(result.success).toBe(false)
    })
  })
})
