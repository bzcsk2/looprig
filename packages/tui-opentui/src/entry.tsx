/**
 * OpenTUI 渲染入口（使用本地 /vol4/Agent/opentui 源码）
 *
 * 注意：本地 @opentui/react 的 API 与 npm 0.2.x 版本不同。
 * 正确用法是：createCliRenderer() + createRoot()
 */

import React from "react"
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { OrchestrationDashboard } from "./components/dashboard/OrchestrationDashboard.js"
import { replayEvents, sampleOrchestrationFixture } from "./store/index.js"

export interface OpenTUIAppProps {
  // 后续可传入真实 engine 等
}

export function OpenTUIApp(_props: OpenTUIAppProps) {
  React.useEffect(() => {
    replayEvents(sampleOrchestrationFixture)
  }, [])

  const terminalWidth = process.stdout.columns || 120

  return (
    <box style={{ flexDirection: "column", height: "100%" }}>
      <box style={{ padding: 1, backgroundColor: "#24283b" }}>
        <text bold color="#c0caf5">Deepreef · OpenTUI (本地源码模式)</text>
      </box>
      <OrchestrationDashboard terminalWidth={terminalWidth} />
      <box style={{ padding: 1 }}>
        <text color="#787c99">按 Ctrl+C 退出</text>
      </box>
    </box>
  )
}

export async function startOpenTUI(options: OpenTUIAppProps = {}): Promise<void> {
  const cliRenderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
  })
  const root = createRoot(cliRenderer)
  root.render(<OpenTUIApp {...options} />)
}