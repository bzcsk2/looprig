/**
 * Minimal diagnostic logger interface for TUI module.
 * Does not depend on @deepicode/core to avoid circular dependencies.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface TuiDiagnosticLogger {
  isEnabled(level?: LogLevel): boolean
  debug(event: string, data?: Record<string, unknown>): void
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, error?: unknown, data?: Record<string, unknown>): void
}

export const noopTuiDiagnosticLogger: TuiDiagnosticLogger = {
  isEnabled: () => false,
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export function createTuiDiagnosticLoggerFromEnv(): TuiDiagnosticLogger {
  if (process.env.DEEPICODE_TUI_DEBUG !== "1") {
    return noopTuiDiagnosticLogger
  }
  // Simple console-based logger for TUI debugging
  return {
    isEnabled: () => true,
    debug: (event, data) => console.debug(`[TUI:${event}]`, data),
    info: (event, data) => console.info(`[TUI:${event}]`, data),
    warn: (event, data) => console.warn(`[TUI:${event}]`, data),
    error: (event, error, data) => console.error(`[TUI:${event}]`, error, data),
  }
}
