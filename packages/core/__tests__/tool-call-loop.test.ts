import { describe, expect, it } from "vitest"
import {
  DUPLICATE_TOOL_BLOCK_THRESHOLD,
  DUPLICATE_TOOL_WARNING_THRESHOLD,
  createDuplicateDetector,
} from "../src/loop-helpers.js"
import type { ToolCall } from "../src/types.js"

function toolCall(name = "read_file", args = '{"path":"README.md"}'): ToolCall {
  return {
    id: crypto.randomUUID(),
    type: "function",
    function: { name, arguments: args },
  }
}

describe("duplicate tool-call detector", () => {
  it("warns on the third identical call and blocks the fifth", () => {
    const detector = createDuplicateDetector()

    for (let count = 1; count <= DUPLICATE_TOOL_BLOCK_THRESHOLD; count++) {
      const result = detector.check(toolCall())

      expect(result.count).toBe(count)
      expect(result.duplicate).toBe(count >= DUPLICATE_TOOL_WARNING_THRESHOLD)
      expect(result.blocked).toBe(count >= DUPLICATE_TOOL_BLOCK_THRESHOLD)
      expect(Boolean(result.warning)).toBe(count >= DUPLICATE_TOOL_WARNING_THRESHOLD)
    }
  })

  it("tracks different arguments independently", () => {
    const detector = createDuplicateDetector()

    for (let count = 1; count < DUPLICATE_TOOL_BLOCK_THRESHOLD; count++) {
      detector.check(toolCall())
    }

    const differentArgs = detector.check(toolCall("read_file", '{"path":"package.json"}'))
    expect(differentArgs).toMatchObject({ duplicate: false, blocked: false, count: 1 })
  })
})
