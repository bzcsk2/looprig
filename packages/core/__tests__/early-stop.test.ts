import { describe, it, expect } from "vitest"
import { EarlyStopDetector } from "../src/early-stop.js"

describe("EarlyStopDetector", () => {
  it("should detect repetition in streaming buffer", () => {
    const detector = new EarlyStopDetector({ repetitionWindowChars: 200, repetitionThreshold: 3 })
    const buffer = "THE QUICK BROWN FOX ".repeat(50)
    const signal = detector.checkRepetition(buffer)
    expect(signal).not.toBeNull()
    expect(signal!.reason).toBe("repetition_loop")
  })

  it("should not trigger on short buffer", () => {
    const detector = new EarlyStopDetector()
    expect(detector.checkRepetition("short text")).toBeNull()
  })

  it("should detect read-only loop", () => {
    const detector = new EarlyStopDetector()
    for (let i = 0; i < 7; i++) {
      detector.recordReadTool("read_file")
    }
    const signal = detector.recordReadTool("read_file")
    expect(signal).not.toBeNull()
    expect(signal!.reason).toBe("read_loop")
  })

  it("should reset read streak on write tool", () => {
    const detector = new EarlyStopDetector()
    for (let i = 0; i < 5; i++) detector.recordReadTool("read_file")
    detector.recordWriteTool("write_file")
    expect(detector.recordReadTool("read_file")).toBeNull()
  })

  it("should detect patch spiral", () => {
    const detector = new EarlyStopDetector({ maxPatchFailures: 4 })
    let signal = null
    for (let i = 0; i < 4; i++) {
      signal = detector.recordPatchResult("src/foo.ts", false)
    }
    expect(signal).not.toBeNull()
    expect(signal!.reason).toBe("patch_spiral")
  })

  it("should detect greeting regression", () => {
    const detector = new EarlyStopDetector()
    const signal = detector.checkGreeting("Hello! How can I help you today?", true)
    expect(signal).not.toBeNull()
    expect(signal!.reason).toBe("greeting_regression")
  })

  it("should not detect greeting without prior tool calls", () => {
    const detector = new EarlyStopDetector()
    expect(detector.checkGreeting("How can I help?", false)).toBeNull()
  })

  it("should reset on new turn", () => {
    const detector = new EarlyStopDetector()
    for (let i = 0; i < 5; i++) detector.recordReadTool("read_file")
    detector.newTurn()
    expect(detector.recordReadTool("read_file")).toBeNull()
  })
})
