import type { MemoryService } from "../memory-service.js"

export interface DeepreefMemoryBridgeConfig {
  autoObserve: boolean
  injectContext: boolean
}

export class DeepreefMemoryBridge {
  constructor(
    private memory: MemoryService,
    private config: DeepreefMemoryBridgeConfig,
  ) {}

  async onSessionStart(sessionId: string): Promise<void> {
    if (!this.config.autoObserve) return
    try {
      await this.memory.trigger("mem::observe", {
        hookType: "session_start",
        sessionId,
        timestamp: new Date().toISOString(),
        raw: JSON.stringify({ event: "session_started" }),
      })
    } catch { /* non-blocking */ }
  }

  async onSessionEnd(sessionId: string): Promise<void> {
    if (!this.config.autoObserve) return
    try {
      await this.memory.trigger("event::session::stopped", { sessionId })
      await this.memory.trigger("event::session::ended", { sessionId })
    } catch { /* non-blocking */ }
  }

  async onPromptSubmit(sessionId: string, prompt: string): Promise<void> {
    if (!this.config.autoObserve) return
    try {
      await this.memory.trigger("mem::observe", {
        hookType: "prompt_submit",
        sessionId,
        timestamp: new Date().toISOString(),
        userPrompt: prompt,
        raw: JSON.stringify({ event: "prompt_submit" }),
      })
    } catch { /* non-blocking */ }
  }

  async onPreToolUse(sessionId: string, toolName: string, toolInput: unknown): Promise<string | undefined> {
    if (!this.config.autoObserve && !this.config.injectContext) return
    let context = ""
    if (this.config.injectContext) {
      try {
        const result = await this.memory.trigger("mem::context", {
          sessionId,
          maxChars: 2000,
        })
        if (result && typeof result === "object" && "context" in result) {
          context = (result as { context: string }).context
        }
      } catch { /* non-blocking */ }
    }
    if (this.config.autoObserve) {
      try {
        await this.memory.trigger("mem::observe", {
          hookType: "pre_tool_use",
          sessionId,
          toolName,
          toolInput,
          timestamp: new Date().toISOString(),
          raw: JSON.stringify({ toolName, toolInput }),
        }).catch(() => {})
      } catch { /* non-blocking */ }
    }
    return context || undefined
  }

  async onPostToolUse(sessionId: string, toolName: string, toolOutput: unknown): Promise<void> {
    if (!this.config.autoObserve) return
    try {
      await this.memory.trigger("mem::observe", {
        hookType: "post_tool_use",
        sessionId,
        toolName,
        toolOutput,
        timestamp: new Date().toISOString(),
        raw: JSON.stringify({ toolName, toolOutput }),
      })
    } catch { /* non-blocking */ }
  }

  async onPostToolFailure(sessionId: string, toolName: string, error: string): Promise<void> {
    if (!this.config.autoObserve) return
    try {
      await this.memory.trigger("mem::observe", {
        hookType: "post_tool_failure",
        sessionId,
        toolName,
        timestamp: new Date().toISOString(),
        toolOutput: { error },
        raw: JSON.stringify({ toolName, error }),
      })
    } catch { /* non-blocking */ }
  }

  async onPreCompact(sessionId: string): Promise<void> {
    if (!this.config.autoObserve) return
    try {
      await this.memory.trigger("mem::observe", {
        hookType: "pre_compact",
        sessionId,
        timestamp: new Date().toISOString(),
        raw: JSON.stringify({ event: "pre_compact" }),
      })
    } catch { /* non-blocking */ }
  }

  async onSubagentStart(sessionId: string, subagentType: string, task: string): Promise<void> {
    if (!this.config.autoObserve) return
    try {
      await this.memory.trigger("mem::observe", {
        hookType: "subagent_start",
        sessionId,
        timestamp: new Date().toISOString(),
        raw: JSON.stringify({ subagentType, task }),
      })
    } catch { /* non-blocking */ }
  }

  async onSubagentStop(sessionId: string, subagentType: string): Promise<void> {
    if (!this.config.autoObserve) return
    try {
      await this.memory.trigger("mem::observe", {
        hookType: "subagent_stop",
        sessionId,
        timestamp: new Date().toISOString(),
        raw: JSON.stringify({ subagentType }),
      })
    } catch { /* non-blocking */ }
  }

  async onGenerationComplete(sessionId: string): Promise<void> {
    if (!this.config.autoObserve) return
    try {
      await this.memory.trigger("mem::observe", {
        hookType: "stop",
        sessionId,
        timestamp: new Date().toISOString(),
        raw: JSON.stringify({ event: "generation_complete" }),
      })
    } catch { /* non-blocking */ }
  }
}
