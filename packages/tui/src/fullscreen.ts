/**
 * TTY 下默认启用 Alternate Screen，减少 main-buffer full reset 导致的闪屏。
 * `DEEPCODE_NO_FLICKER=0` 显式关闭；`=1` 强制开启（非 TTY 亦生效）。
 */
export function isFullscreenEnvEnabled(): boolean {
  if (process.env.DEEPCODE_NO_FLICKER === '0') return false;
  if (process.env.DEEPCODE_NO_FLICKER === '1') return true;
  return Boolean(process.stdin.isTTY);
}

/** 鼠标追踪模式 */
export type MouseTrackingMode = 'off' | 'wheel' | 'full';

/**
 * 鼠标追踪模式。
 *
 * 默认 'wheel'：仅启用滚轮 + 基础点击（DEC 1000 + 1006），不启用拖拽
 * （1002）和任意位置（1003），因此不拦截终端原生的文本选择/复制。滚轮
 * 事件经 ink 解析为 wheelup/wheeldown 按键，由 useMessageScroll 接到
 * ScrollBox 实现历史消息滚动。
 *
 * COVALO_ENABLE_MOUSE 环境变量覆盖：
 *   =0    完全关闭（含滚轮，纯键盘操作）
 *   =1    全功能（含拖拽/悬停，会拦截终端文本选择）
 *   =wheel 仅滚轮（默认）
 */
export function getMouseTrackingMode(): MouseTrackingMode {
  const v = process.env.COVALO_ENABLE_MOUSE;
  if (v === '0') return 'off';
  if (v === '1') return 'full';
  return 'wheel';
}

/**
 * @deprecated 用 getMouseTrackingMode() 替代。保留 boolean 视图供旧调用点。
 */
export function isMouseTrackingEnabled(): boolean {
  return getMouseTrackingMode() !== 'off';
}

export function isFullscreenActive(): boolean {
  return isFullscreenEnvEnabled();
}
