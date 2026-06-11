/**
 * OpenTUI 渲染入口
 *
 * 职责：
 * - 初始化 @opentui/react 渲染循环
 * - 注入初始 fixture（演示用）
 * - 提供退出处理
 *
 * 注意：此实现为最小可运行版本，真实集成时需替换为真实事件源
 */

import React from "react";
import { render } from "@opentui/react";
import { OrchestrationDashboard } from "./components/dashboard/OrchestrationDashboard.js";
import { replayEvents, sampleOrchestrationFixture } from "./store/index.js";

export interface OpenTUIAppProps {
  // 后续可传入真实 engine 等
}

export function OpenTUIApp(_props: OpenTUIAppProps) {
  // 启动时重放示例 fixture，让用户能立即看到有数据的界面
  React.useEffect(() => {
    replayEvents(sampleOrchestrationFixture);
  }, []);

  // 简单获取终端宽度（实际应使用 useTerminalSize）
  const terminalWidth = process.stdout.columns || 120;

  return (
    <box style={{ flexDirection: "column", height: "100%" }}>
      <box style={{ padding: 1, backgroundColor: "#24283b" }}>
        <text bold color="#c0caf5">Deepreef · OpenTUI (DEEPREEF_TUI=opentui)</text>
      </box>
      <OrchestrationDashboard terminalWidth={terminalWidth} />
      <box style={{ padding: 1 }}>
        <text color="#787c99">按 Ctrl+C 退出 | 1-6 切换页面（待实现）</text>
      </box>
    </box>
  );
}

export async function startOpenTUI(options: OpenTUIAppProps = {}): Promise<void> {
  await render(<OpenTUIApp {...options} />, {
    // OpenTUI render 配置（后续可扩展）
  });
}