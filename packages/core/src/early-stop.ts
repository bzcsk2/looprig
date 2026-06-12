/**
 * Early-Stop 退化行为检测
 *
 * DRF-20: 从 SmallCode early_stop.js 适配
 * Source: smallcode/src/governor/early_stop.js (MIT)
 */

/** 早停信号 */
export interface StopSignal {
  reason: string
  message: string
  action: "inject_correction" | "rewrite_file"
  injection: string
}

/** Deepreef 读取类工具集合 */
const READ_TOOLS = new Set([
  "read_file", "grep", "glob", "list_dir", "webfetch", "websearch",
])

/** 写入类工具 */
const WRITE_TOOLS = new Set(["write_file", "edit", "NotebookEdit", "bash"])

/**
 * 检测模型退化行为：重复输出、只读循环、patch 螺旋、问候回归
 */
export class EarlyStopDetector {
  private repetitionThreshold: number
  private repetitionWindowChars: number
  private maxPatchFailures: number
  private enableGreetingDetection: boolean
  private patchFailures: Record<string, number> = {}
  private _patchAttempts: Record<string, number> = {}
  private _readOnlyStreak = 0
  private _hasWrittenThisTurn = false

  constructor(config?: {
    repetitionThreshold?: number
    repetitionWindowChars?: number
    maxPatchFailures?: number
    enableGreetingDetection?: boolean
  }) {
    this.repetitionThreshold = config?.repetitionThreshold ?? 3
    this.repetitionWindowChars = config?.repetitionWindowChars ?? 200
    this.maxPatchFailures = config?.maxPatchFailures ?? 4
    this.enableGreetingDetection = config?.enableGreetingDetection !== false
  }

  /** 检测流式输出重复 */
  checkRepetition(buffer: string): StopSignal | null {
    if (buffer.length < this.repetitionWindowChars * 2) return null

    const tail = buffer.slice(-this.repetitionWindowChars)
    for (const windowSize of [50, 80, 120]) {
      if (tail.length < windowSize * this.repetitionThreshold) continue

      const pattern = tail.slice(-windowSize)
      let count = 0
      let searchFrom = 0
      while (true) {
        const idx = tail.indexOf(pattern, searchFrom)
        if (idx === -1) break
        count++
        searchFrom = idx + 1
        if (count >= this.repetitionThreshold) break
      }

      if (count >= this.repetitionThreshold) {
        return {
          reason: "repetition_loop",
          message: `Model repeating itself (${windowSize}-char pattern ${count}x).`,
          action: "inject_correction",
          injection: "[SYSTEM] You are repeating the same output in a loop. STOP. Take a different approach or state what is blocking you.",
        }
      }
    }
    return null
  }

  /** 跟踪只读工具调用 */
  recordReadTool(toolName: string): StopSignal | null {
    if (!READ_TOOLS.has(toolName)) {
      this._readOnlyStreak = 0
      return null
    }

    if (this._hasWrittenThisTurn) {
      this._readOnlyStreak = 0
      return null
    }

    this._readOnlyStreak++

    if (this._readOnlyStreak >= 8) {
      const count = this._readOnlyStreak
      this._readOnlyStreak = 0
      return {
        reason: "read_loop",
        message: `Model called read-only tools ${count} times without producing output.`,
        action: "inject_correction",
        injection: `[SYSTEM] You have read ${count} files/results without producing any output yet. STOP reading and START writing your findings or answer now.`,
      }
    }

    if (this._readOnlyStreak === 5) {
      return {
        reason: "read_loop_warning",
        message: "Model has read 5 things without producing output.",
        action: "inject_correction",
        injection: "[SYSTEM] You've read 5 files/results. After your next read (if needed), write your findings immediately.",
      }
    }

    return null
  }

  /** 跟踪 patch/edit 结果 */
  recordPatchResult(filePath: string, success: boolean, oldStr?: string, newStr?: string): StopSignal | null {
    this._patchAttempts[filePath] = (this._patchAttempts[filePath] || 0) + 1

    const isNoOp = success && oldStr && newStr && oldStr === newStr

    if (success && !isNoOp) {
      if (this.patchFailures[filePath]) {
        this.patchFailures[filePath] = Math.max(0, this.patchFailures[filePath] - 1)
      }
      return null
    }

    this.patchFailures[filePath] = (this.patchFailures[filePath] || 0) + 1
    const failCount = this.patchFailures[filePath]
    const totalAttempts = this._patchAttempts[filePath]

    if (failCount >= this.maxPatchFailures || totalAttempts >= 6) {
      delete this.patchFailures[filePath]
      delete this._patchAttempts[filePath]
      return {
        reason: "patch_spiral",
        message: `Patch stuck on ${filePath} (${failCount} failures, ${totalAttempts} attempts).`,
        action: "rewrite_file",
        injection: `[SYSTEM] You have attempted to patch ${filePath} ${totalAttempts} times. STOP using edit/patch. Use read_file then write_file to rewrite completely.`,
      }
    }
    return null
  }

  /** 记录写入工具成功 */
  recordWriteTool(toolName: string): void {
    if (WRITE_TOOLS.has(toolName)) {
      this._hasWrittenThisTurn = true
      this._readOnlyStreak = 0
    }
  }

  /** 检测问候回归（任务中途丢失上下文） */
  checkGreeting(content: string, hasToolCallsThisTurn: boolean): StopSignal | null {
    if (!this.enableGreetingDetection || !hasToolCallsThisTurn) return null

    const lc = content.toLowerCase()
    const patterns = [
      "how can i help",
      "what would you like",
      "what can i do for you",
      "how can i assist",
      "hello! i'm ready",
      "hi there! what",
    ]

    if (!patterns.some(p => lc.includes(p))) return null

    return {
      reason: "greeting_regression",
      message: "Model output a greeting mid-task (lost context).",
      action: "inject_correction",
      injection: "[SYSTEM] You output a greeting instead of completing the task. Continue where you left off.",
    }
  }

  /** 新轮次重置 */
  newTurn(): void {
    this.patchFailures = {}
    this._patchAttempts = {}
    this._readOnlyStreak = 0
    this._hasWrittenThisTurn = false
  }
}
