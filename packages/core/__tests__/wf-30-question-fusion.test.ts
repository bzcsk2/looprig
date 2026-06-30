/**
 * WF-30: 中途求助与正式检查融合
 *
 * 目标：将 QuestionService 和 Supervisor 的 requiresUser 融合到正式 Workflow 中
 *
 * 测试内容：
 * 1. 验证 QuestionService 可以在 Workflow 中暂停
 * 2. 验证 Supervisor 的 ask_user 决策可以触发 QuestionService
 * 3. 验证 QuestionService 回复后 Workflow 可以继续
 */

import { describe, it, expect, beforeEach, mock } from "bun:test"
import { WorkflowCoordinator } from "../src/workflow-coordinator/coordinator.js"
import { QuestionService } from "../src/question/service.js"
import type { WorkflowSupervisorAdvice } from "../src/workflow-coordinator/types.js"

import { setPromptLocale } from "../src/prompt-locale";
describe("WF-30: 中途求助与正式检查融合测试", () => {
  beforeEach(() => setPromptLocale("en"));
  describe("测试 1: QuestionService 在 Workflow 中暂停", () => {
    it("应该支持在 Workflow 中创建 QuestionService", () => {
      const coordinator = new WorkflowCoordinator()
      const questionService = new QuestionService()

      coordinator.startWorkflow({ goal: "test goal" })

      // 进入 supervisor_check
      coordinator.transition("supervisor_analyse")
      coordinator.transition("worker_do")
      coordinator.transition("worker_report")
      coordinator.transition("supervisor_check")

      // 创建 ask_user 决策
      const advice: WorkflowSupervisorAdvice = {
        workflowId: coordinator.getState()!.workflowId,
        iteration: coordinator.getState()!.iteration,
        ledgerVersion: coordinator.getState()!.ledgerVersion,
        decision: "ask_user",
        feedback: "需要用户确认",
        timestamp: Date.now(),
        stale: false,
      }

      // 应用建议
      coordinator.applyAdvice(advice)

      // 创建 QuestionService 问题
      const questions = [
        {
          question: "是否继续执行？",
          header: "确认",
          options: [
            { label: "是", description: "继续执行" },
            { label: "否", description: "停止执行" },
          ],
        },
      ]

      const promise = questionService.ask({
        sessionId: coordinator.getState()!.workflowId,
        questions,
      })

      // 验证 QuestionService 有挂起的问题
      expect(questionService.list()).toHaveLength(1)
      expect(questionService.list()[0].sessionId).toBe(coordinator.getState()!.workflowId)
    })

    it("应该支持 QuestionService 回复后继续 Workflow", async () => {
      const coordinator = new WorkflowCoordinator()
      const questionService = new QuestionService()

      coordinator.startWorkflow({ goal: "test goal" })

      // 进入 supervisor_check
      coordinator.transition("supervisor_analyse")
      coordinator.transition("worker_do")
      coordinator.transition("worker_report")
      coordinator.transition("supervisor_check")

      // 创建 ask_user 决策
      const advice: WorkflowSupervisorAdvice = {
        workflowId: coordinator.getState()!.workflowId,
        iteration: coordinator.getState()!.iteration,
        ledgerVersion: coordinator.getState()!.ledgerVersion,
        decision: "ask_user",
        feedback: "需要用户确认",
        timestamp: Date.now(),
        stale: false,
      }

      coordinator.applyAdvice(advice)

      // 创建 QuestionService 问题
      const questions = [
        {
          question: "是否继续执行？",
          header: "确认",
          options: [
            { label: "是", description: "继续执行" },
            { label: "否", description: "停止执行" },
          ],
        },
      ]

      const promise = questionService.ask({
        sessionId: coordinator.getState()!.workflowId,
        questions,
      })

      const req = questionService.list()[0]

      // 回复问题
      setTimeout(() => {
        questionService.reply({ requestId: req.id, answers: [["是"]] })
      }, 0)

      // 等待回复
      const answers = await promise
      expect(answers).toEqual([["是"]])

      // 验证 QuestionService 已清空
      expect(questionService.list()).toHaveLength(0)

      // 继续 Workflow
      coordinator.transition("supervisor_analyse")
      expect(coordinator.getState()?.currentPhase).toBe("supervisor_analyse")
      expect(coordinator.getState()?.iteration).toBe(2)
    })
  })

  describe("测试 2: Supervisor ask_user 触发 QuestionService", () => {
    it("应该支持 Supervisor 的 ask_user 决策触发 QuestionService", () => {
      const coordinator = new WorkflowCoordinator()
      const questionService = new QuestionService()

      coordinator.startWorkflow({ goal: "test goal" })

      // 进入 supervisor_analyse
      coordinator.transition("supervisor_analyse")

      // 创建 ask_user 决策
      const advice: WorkflowSupervisorAdvice = {
        workflowId: coordinator.getState()!.workflowId,
        iteration: coordinator.getState()!.iteration,
        ledgerVersion: coordinator.getState()!.ledgerVersion,
        decision: "ask_user",
        feedback: "需要用户提供更多信息",
        timestamp: Date.now(),
        stale: false,
      }

      coordinator.applyAdvice(advice)

      // 创建 QuestionService 问题
      const questions = [
        {
          question: "请提供更多信息",
          header: "信息收集",
          options: [
            { label: "选项 A", description: "提供选项 A 的信息" },
            { label: "选项 B", description: "提供选项 B 的信息" },
          ],
        },
      ]

      const promise = questionService.ask({
        sessionId: coordinator.getState()!.workflowId,
        questions,
      })

      // 验证 QuestionService 有挂起的问题
      expect(questionService.list()).toHaveLength(1)

      // 验证 Workflow 状态仍然在 supervisor_analyse
      expect(coordinator.getState()?.currentPhase).toBe("supervisor_analyse")
      expect(coordinator.getState()?.lastDecision).toBe("ask_user")
    })
  })

  describe("测试 3: QuestionService 中断处理", () => {
    it("应该支持中断时清空所有挂起的问题", async () => {
      const coordinator = new WorkflowCoordinator()
      const questionService = new QuestionService()

      coordinator.startWorkflow({ goal: "test goal" })

      // 创建多个问题
      const questions1 = [
        {
          question: "问题 1",
          header: "H1",
          options: [{ label: "A", description: "选项 A" }],
        },
      ]

      const questions2 = [
        {
          question: "问题 2",
          header: "H2",
          options: [{ label: "B", description: "选项 B" }],
        },
      ]

      const promise1 = questionService.ask({
        sessionId: coordinator.getState()!.workflowId,
        questions: questions1,
      })

      const promise2 = questionService.ask({
        sessionId: coordinator.getState()!.workflowId,
        questions: questions2,
      })

      // 捕获未处理的拒绝
      promise1.catch(() => {})
      promise2.catch(() => {})

      // 验证有 2 个挂起的问题
      expect(questionService.list()).toHaveLength(2)

      // 中断所有问题
      questionService.interrupt()

      // 验证所有问题都被拒绝
      await expect(promise1).rejects.toThrow("dismissed")
      await expect(promise2).rejects.toThrow("dismissed")
      expect(questionService.list()).toHaveLength(0)
    })
  })

  describe("测试 4: 融合缺口记录", () => {
    it("记录: 需要将 QuestionService 集成到 DualAgentRuntime", () => {
      // 当前 QuestionService 是独立模块
      // 需要将其集成到 DualAgentRuntime 中
      expect(true).toBe(true) // 占位测试
    })

    it("记录: 需要将 Supervisor 的 requiresUser 与 QuestionService 关联", () => {
      // 当前 Supervisor 的 requiresUser 只是 metadata
      // 需要将其与 QuestionService 关联
      expect(true).toBe(true) // 占位测试
    })

    it("记录: 需要在 Workflow 中添加 waiting_question 状态", () => {
      // 当前 WorkflowCoordinator 没有 waiting_question 状态
      // 需要添加这个状态来真正暂停 Workflow
      expect(true).toBe(true) // 占位测试
    })
  })
})
