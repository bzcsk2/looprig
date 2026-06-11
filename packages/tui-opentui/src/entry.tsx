/**
 * OpenTUI 渲染入口
 *
 * 功能：
 * - 使用本地 /vol4/Agent/opentui 源码
 * - 多页面切换（Chat/Orchestration/Workers/Supervisor/Loop/System）
 * - 键盘快捷键支持（1-6 切换页面，Esc/q 返回）
 * - 终端状态恢复（防止鼠标乱码）
 *
 * 中文注释：
 * - 开发阶段 useMouse: false，最终测试时改为 true
 * - 所有 Hook 已移除，避免多 React 实例冲突
 */

import { createCliRenderer, CliRenderEvents } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { MainLayout } from "./components/layout/MainLayout.js";
import { tuiStore, replayEvents, sampleOrchestrationFixture } from "./store/index.js";
import { uiStore, switchPage, closeDetail, pageKeyMap } from "./store/ui-store.js";
import type { PageId } from "./store/ui-store.js";

/**
 * 恢复终端状态（防止鼠标跟踪乱码）
 */
function restoreTerminal(): void {
  const stdout = process.stdout;
  if (!stdout) return;

  stdout.write("\x1b[?1000l");  // X10 鼠标
  stdout.write("\x1b[?1002l");  // 按钮事件
  stdout.write("\x1b[?1003l");  // 任意事件
  stdout.write("\x1b[?1006l");  // SGR 扩展鼠标
  stdout.write("\x1b[?1049l");  // 退出备用屏幕
  stdout.write("\x1b[?25h");    // 恢复光标
  stdout.write("\x1b[0m");      // 重置属性
  stdout.write("\r\n");
}

/**
 * 设置键盘处理
 */
function setupKeyHandlers(renderer: any): void {
  // 页面切换快捷键（1-6）
  for (let i = 1; i <= 6; i++) {
    const key = String(i);
    renderer.keyInput?.on?.(key, () => {
      const page = pageKeyMap[key];
      if (page) {
        switchPage(page);
      }
    });
  }

  // Esc/q 关闭详情或返回
  renderer.keyInput?.on?.("escape", () => {
    const ui = uiStore.getState();
    if (ui.showDetail) {
      closeDetail();
    }
  });

  renderer.keyInput?.on?.("q", () => {
    const ui = uiStore.getState();
    if (ui.showDetail) {
      closeDetail();
    }
  });
}

export async function startOpenTUI(): Promise<void> {
  // 注册退出清理
  const cleanup = () => {
    try {
      restoreTerminal();
    } catch {}
  };

  process.once("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.once("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    cleanup();
    process.exit(1);
  });

  try {
    // 初始化 fixture 数据
    replayEvents(sampleOrchestrationFixture);

    // 创建 renderer（开发阶段禁用鼠标）
    const cliRenderer = await createCliRenderer({
      exitOnCtrlC: true,
      targetFps: 30,
      useMouse: false,
      enableMouseMovement: false,
    });

    const root = createRoot(cliRenderer);

    // 设置键盘处理
    setupKeyHandlers(cliRenderer);

    // 监听销毁事件
    cliRenderer.once(CliRenderEvents.DESTROY, cleanup);

    // 状态订阅与渲染
    let currentTuiState = tuiStore.getState();
    let currentUiState = uiStore.getState();

    const renderApp = () => {
      root.render(
        <MainLayout
          tuiState={currentTuiState}
          uiState={currentUiState}
          onSwitchPage={switchPage}
          onCloseDetail={closeDetail}
        />
      );
    };

    // 首次渲染
    renderApp();

    // 订阅 TuiStore 更新
    tuiStore.subscribe((newState) => {
      currentTuiState = newState;
      renderApp();
    });

    // 订阅 UiStore 更新
    uiStore.subscribe((newState) => {
      currentUiState = newState;
      renderApp();
    });

    // 保持运行
    await new Promise<void>((resolve) => {
      cliRenderer.once(CliRenderEvents.DESTROY, () => {
        resolve();
      });
    });

  } finally {
    cleanup();
  }
}
