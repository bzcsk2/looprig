/**
 * Orchestration 事件适配器
 *
 * 职责（TUI-OT-60）：
 * - 将 Core 的 LoopEvent (role: "orchestration") 转换为 TuiStore 状态
 * - 提供统一的监听接口供 TUI 使用
 * - 保持 Core 与 TUI 的解耦
 *
 * 中文注释：
 * - 此适配器运行在 TUI 侧，不修改 Core
 * - Core 通过 AsyncGenerator yield LoopEvent
 * - 适配器消费事件并更新 TuiStore
 */

import type { LoopEvent } from "@deepreef/core";
import type { OrchestrationEvent } from "../store/types.js";
import { dispatchOrchestrationEvent } from "../store/tui-store.js";

/**
 * 处理单个 LoopEvent
 * 如果是 orchestration 事件，转换为 TuiStore 动作
 */
export function handleLoopEvent(event: LoopEvent): void {
  if (event.role !== "orchestration" || !event.orchestration) {
    return; // 非 orchestration 事件，忽略
  }

  const payload = event.orchestration;

  // 将 Core 的 payload 转换为 TUI 的 OrchestrationEvent
  switch (payload.kind) {
    case "worker_upsert": {
      const tuiEvent: OrchestrationEvent = {
        role: "orchestration",
        kind: "worker_upsert",
        worker: payload.worker,
      };
      dispatchOrchestrationEvent(tuiEvent);
      break;
    }

    case "worker_remove": {
      const tuiEvent: OrchestrationEvent = {
        role: "orchestration",
        kind: "worker_remove",
        workerId: payload.workerId,
      };
      dispatchOrchestrationEvent(tuiEvent);
      break;
    }

    case "supervisor_upsert": {
      const tuiEvent: OrchestrationEvent = {
        role: "orchestration",
        kind: "supervisor_upsert",
        supervisor: payload.supervisor,
      };
      dispatchOrchestrationEvent(tuiEvent);
      break;
    }

    case "supervisor_advice": {
      const tuiEvent: OrchestrationEvent = {
        role: "orchestration",
        kind: "supervisor_advice",
        advice: {
          supervisorId: payload.supervisorId,
          workerId: payload.workerId,
          advice: payload.advice,
          adopted: payload.adopted,
        },
      };
      dispatchOrchestrationEvent(tuiEvent);
      break;
    }

    case "loop_transition": {
      const tuiEvent: OrchestrationEvent = {
        role: "orchestration",
        kind: "loop_transition",
        transition: payload.transition,
      };
      dispatchOrchestrationEvent(tuiEvent);
      break;
    }

    case "runtime_signal": {
      const tuiEvent: OrchestrationEvent = {
        role: "orchestration",
        kind: "runtime_signal",
        signal: payload.signal,
      };
      dispatchOrchestrationEvent(tuiEvent);
      break;
    }

    case "agent_tree_upsert": {
      const tuiEvent: OrchestrationEvent = {
        role: "orchestration",
        kind: "agent_tree_upsert",
        node: payload.node,
      };
      dispatchOrchestrationEvent(tuiEvent);
      break;
    }

    case "checkpoint": {
      const tuiEvent: OrchestrationEvent = {
        role: "orchestration",
        kind: "checkpoint",
        checkpoint: payload.checkpoint,
      };
      dispatchOrchestrationEvent(tuiEvent);
      break;
    }

    default:
      // 未知事件类型，忽略
      break;
  }
}

/**
 * 包装 AsyncGenerator，监听所有 LoopEvent
 * 返回原始事件流，同时更新 TuiStore
 */
export async function* wrapLoopEventStream(
  source: AsyncGenerator<LoopEvent>
): AsyncGenerator<LoopEvent> {
  for await (const event of source) {
    // 处理 orchestration 事件
    handleLoopEvent(event);
    // 原样返回事件，供其他消费者使用
    yield event;
  }
}

/**
 * 创建 TUI 侧的事件消费者
 * 用于直接监听 Core Engine 的事件流
 */
export function createOrchestrationStream(
  eventSource: AsyncGenerator<LoopEvent>
): AsyncGenerator<LoopEvent> {
  return wrapLoopEventStream(eventSource);
}
