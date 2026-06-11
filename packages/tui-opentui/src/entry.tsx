/**
 * OpenTUI 渲染入口（使用本地 /vol4/Agent/opentui 源码）
 *
 * 注意：本地 @opentui/react 的 API 与 npm 0.2.x 版本不同。
 * 正确用法是：createCliRenderer() + createRoot()
 *
 * 重要：由于 @opentui/react 使用自己的 React 实例，本包不能使用任何 React Hook。
 * 所有状态通过外部订阅管理，通过 props 传递给组件。
 */

import { createCliRenderer, CliRenderEvents } from "@opentui/core"
import { createRoot } from "@opentui/react"
import type { TuiState } from "./store/types.js"
import { tuiStore, replayEvents, sampleOrchestrationFixture } from "./store/index.js"
import { OrchestrationDashboard } from "./components/dashboard/OrchestrationDashboard.js"

export interface OpenTUIAppProps {
  state: TuiState;
}

// 纯函数组件，不包含任何 Hook
export function OpenTUIApp({ state }: OpenTUIAppProps) {
  const terminalWidth = process.stdout.columns || 120

  return (
    <box style={{ flexDirection: "column", height: "100%" }}>
      <box style={{ padding: 1, backgroundColor: "#24283b" }}>
        <text bold color="#c0caf5">Deepreef · OpenTUI (本地源码模式)</text>
      </box>
      <OrchestrationDashboard terminalWidth={terminalWidth} state={state} />
      <box style={{ padding: 1 }}>
        <text color="#787c99">按 Ctrl+C 退出</text>
      </box>
    </box>
  )
}

/**
 * 手动恢复终端状态（防止鼠标跟踪乱码）
 * 这些序列必须在程序退出时发送，无论正常退出还是异常退出
 */
function restoreTerminal(): void {
  const stdout = process.stdout
  if (!stdout) return

  // 禁用鼠标跟踪（所有常见模式）
  stdout.write('\x1b[?1000l')  // X10 鼠标模式
  stdout.write('\x1b[?1002l')  // 按钮事件跟踪
  stdout.write('\x1b[?1003l')  // 任意事件跟踪
  stdout.write('\x1b[?1006l')  // SGR 扩展鼠标模式

  // 退出备用屏幕缓冲区
  stdout.write('\x1b[?1049l')

  // 恢复光标
  stdout.write('\x1b[?25h')

  // 重置所有属性
  stdout.write('\x1b[0m')

  stdout.write('\r\n')  // 换行确保提示符在新行
}

export async function startOpenTUI(): Promise<void> {
  // 捕获异常确保终端恢复
  const cleanup = () => {
    try {
      restoreTerminal()
    } catch {
      // 忽略恢复时的错误
    }
  }

  // 注册多种退出方式的清理
  process.once('exit', cleanup)
  process.once('SIGINT', () => {
    cleanup()
    process.exit(0)
  })
  process.once('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })
  process.once('uncaughtException', (err) => {
    console.error('Uncaught exception:', err)
    cleanup()
    process.exit(1)
  })

  try {
    // 初始化 fixture 数据
    replayEvents(sampleOrchestrationFixture)

    // 开发阶段配置：禁用鼠标，简化调试
    // TODO: 最终测试前将 useMouse 改为 true 启用鼠标支持
    const cliRenderer = await createCliRenderer({
      exitOnCtrlC: true,
      targetFps: 30,
      useMouse: false,
      enableMouseMovement: false,
    })

    const root = createRoot(cliRenderer)

    // 监听 renderer 销毁事件进行额外清理
    cliRenderer.once(CliRenderEvents.DESTROY, () => {
      cleanup()
    })

    // 外部订阅：状态变化时重新渲染整个 App
    let currentState = tuiStore.getState()

    const renderApp = () => {
      root.render(<OpenTUIApp state={currentState} />)
    }

    // 首次渲染
    renderApp()

    // 订阅后续更新
    tuiStore.subscribe((newState) => {
      currentState = newState
      renderApp()
    })

    // 保持程序运行，直到显式退出
    // 在 SSH 环境中，renderer 可能会立即完成，需要阻塞等待
    await new Promise<void>((resolve) => {
      cliRenderer.once(CliRenderEvents.DESTROY, () => {
        resolve()
      })
    })

  } finally {
    cleanup()
  }
}