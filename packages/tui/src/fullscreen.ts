/**
 * TTY 下默认启用 Alternate Screen，减少 main-buffer full reset 导致的闪屏。
 * `DEEPCODE_NO_FLICKER=0` 显式关闭；`=1` 强制开启（非 TTY 亦生效）。
 */
export function isFullscreenEnvEnabled(): boolean {
  if (process.env.DEEPCODE_NO_FLICKER === '0') return false;
  if (process.env.DEEPCODE_NO_FLICKER === '1') return true;
  return Boolean(process.stdin.isTTY);
}

/**
 * 是否启用鼠标跟踪（wheel / click / drag）。
 *
 * 默认关闭。Alternate Screen 没有终端原生 scrollback，开启鼠标跟踪后
 * ScrollBox 能接收滚轮事件来滚动消息区；但开启也会拦截终端原生的文本
 * 选择/复制行为，部分用户更希望保留终端原生选择能力。
 *
 * 用 DEEPREEF_ENABLE_MOUSE=1 显式开启（含滚轮滚动）。
 */
export function isMouseTrackingEnabled(): boolean {
  return process.env.DEEPREEF_ENABLE_MOUSE === '1';
}

export function isFullscreenActive(): boolean {
  return isFullscreenEnvEnabled();
}
