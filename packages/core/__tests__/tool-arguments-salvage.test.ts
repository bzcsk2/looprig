import { describe, expect, it } from "vitest"
import { salvageTruncatedToolJson } from "../src/tool-arguments/salvage.js"
import {
  shouldBlockSalvagedTruncatedWrite,
  buildSalvagedTruncatedWriteBlockMessage,
  SALVAGED_TRUNCATED_WRITE_TOOLS,
} from "../src/tool-arguments/truncation-recovery.js"

describe("salvageTruncatedToolJson", () => {
  it("extracts path and partial content from truncated JSON", () => {
    const raw = '{"path":"src/a.ts","content":"import x\\nfrom'
    const salvaged = salvageTruncatedToolJson(raw)
    expect(salvaged).toMatchObject({
      path: "src/a.ts",
      content: "import x\nfrom",
      _salvageTruncated: true,
    })
  })

  it("extracts edit_file search field", () => {
    const raw = '{"path":"a.ts","search":"foo","replace":"bar'
    const salvaged = salvageTruncatedToolJson(raw)
    expect(salvaged?.path).toBe("a.ts")
    expect(salvaged?.search).toBe("foo")
    expect(salvaged?.replace).toBe("bar")
  })
})

describe("shouldBlockSalvagedTruncatedWrite", () => {
  it("blocks salvaged truncated write tools", () => {
    const args = { path: "a.ts", content: "x", _salvageTruncated: true }
    for (const tool of SALVAGED_TRUNCATED_WRITE_TOOLS) {
      expect(shouldBlockSalvagedTruncatedWrite(tool, args)).toBe(true)
    }
  })

  it("allows read tools with salvaged args", () => {
    const args = { path: "a.ts", _salvageTruncated: true }
    expect(shouldBlockSalvagedTruncatedWrite("read_file", args)).toBe(false)
  })

  it("allows write tools with complete args", () => {
    const args = { path: "a.ts", content: "ok" }
    expect(shouldBlockSalvagedTruncatedWrite("write_file", args)).toBe(false)
  })

  it("buildSalvagedTruncatedWriteBlockMessage mentions truncation", () => {
    const msg = buildSalvagedTruncatedWriteBlockMessage("write_file", {
      path: "a.ts",
      content: "partial",
      _salvageTruncated: true,
    })
    expect(msg).toMatch(/truncated/i)
    expect(msg).toMatch(/write_file/)
  })
})
