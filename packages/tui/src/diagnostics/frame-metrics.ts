import type { FrameEvent } from '@covalo/ink';

const REPORT_INTERVAL_MS = 10_000;

/**
 * 是否启用 TUI 帧诊断（`DEEPCODE_TUI_METRICS=1`）。
 */
export function isFrameMetricsEnabled(): boolean {
  return process.env.DEEPCODE_TUI_METRICS === '1';
}

/**
 * 创建 Ink `onFrame` 回调：周期性输出 p95 帧耗时与 full_reset 计数。
 */
export function createFrameMetricsHandler(): ((event: FrameEvent) => void) | undefined {
  if (!isFrameMetricsEnabled()) return undefined;

  const durations: number[] = [];
  let fullResetCount = 0;
  let frameCount = 0;
  let lastReport = Date.now();

  return (event: FrameEvent) => {
    frameCount += 1;
    durations.push(event.durationMs);
    fullResetCount += event.flickers.filter(
      flicker => flicker.reason === 'clear' || flicker.reason === 'offscreen',
    ).length;

    const now = Date.now();
    if (now - lastReport < REPORT_INTERVAL_MS) return;

    if (durations.length > 0) {
      const sorted = [...durations].sort((a, b) => a - b);
      const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      const p95 = sorted[p95Index] ?? 0;
      process.stderr.write(
        `[covalo-tui-metrics] frames=${frameCount} p95=${p95.toFixed(1)}ms full_reset=${fullResetCount}\n`,
      );
    }

    durations.length = 0;
    fullResetCount = 0;
    frameCount = 0;
    lastReport = now;
  };
}
