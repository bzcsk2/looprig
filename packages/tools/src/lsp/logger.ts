import type { RuntimeLogger } from "@covalo/core"

export interface LspLogContext {
  sessionId?: string
  submitId?: string
  toolCallId?: string
  lspServerId?: string
  requestId?: string
}

export class LspLogger {
  private logger: RuntimeLogger
  private context: LspLogContext

  constructor(logger: RuntimeLogger, context: LspLogContext = {}) {
    this.logger = logger
    this.context = context
  }

  child(context: Partial<LspLogContext>): LspLogger {
    return new LspLogger(this.logger, { ...this.context, ...context })
  }

  serverStart(language: string, workspaceRoot: string, command: string): void {
    this.logger.info("lsp.server.start", {
      language,
      workspaceRoot,
      command,
      ...this.context,
    })
  }

  serverReady(language: string, workspaceRoot: string, pid: number | undefined, uptimeMs: number): void {
    this.logger.info("lsp.server.ready", {
      language,
      workspaceRoot,
      pid,
      uptimeMs,
      ...this.context,
    })
  }

  serverExit(language: string, workspaceRoot: string, code: number | null, signal: NodeJS.Signals | null): void {
    this.logger.info("lsp.server.exit", {
      language,
      workspaceRoot,
      code,
      signal,
      ...this.context,
    })
  }

  serverRestart(language: string, workspaceRoot: string, reason: string): void {
    this.logger.info("lsp.server.restart", {
      language,
      workspaceRoot,
      reason,
      ...this.context,
    })
  }

  requestStart(method: string, language: string, filePath: string): void {
    this.logger.debug("lsp.request.start", {
      method,
      language,
      filePath,
      ...this.context,
    })
  }

  requestDone(method: string, language: string, filePath: string, durationMs: number, resultCount?: number): void {
    this.logger.debug("lsp.request.done", {
      method,
      language,
      filePath,
      durationMs,
      resultCount,
      ...this.context,
    })
  }

  requestTimeout(method: string, language: string, filePath: string, timeoutMs: number): void {
    this.logger.warn("lsp.request.timeout", {
      method,
      language,
      filePath,
      timeoutMs,
      ...this.context,
    })
  }

  documentOpen(filePath: string, language: string, version: number): void {
    this.logger.debug("lsp.document.open", {
      filePath,
      language,
      version,
      ...this.context,
    })
  }

  documentChange(filePath: string, language: string, version: number): void {
    this.logger.debug("lsp.document.change", {
      filePath,
      language,
      version,
      ...this.context,
    })
  }
}

export function createLspLogger(logger: RuntimeLogger, context?: LspLogContext): LspLogger {
  return new LspLogger(logger, context)
}
