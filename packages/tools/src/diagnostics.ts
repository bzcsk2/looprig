/**
 * Minimal diagnostic logger interface for Tools module.
 * Does not depend on @covalo/core to avoid circular dependencies.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface ToolDiagnosticLogger {
  isEnabled(level?: LogLevel): boolean
  debug(event: string, data?: Record<string, unknown>): void
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, error?: unknown, data?: Record<string, unknown>): void
}

export const noopToolDiagnosticLogger: ToolDiagnosticLogger = {
  isEnabled: () => false,
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}
