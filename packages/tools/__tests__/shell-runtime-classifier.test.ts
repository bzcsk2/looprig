import { describe, expect, it } from "vitest"
import {
  classifyShellCommand,
  pickBackgroundHardTimeout,
  pickForegroundTimeout,
  SOFT_TIMEOUT_MS,
  HARD_TIMEOUT_DEFAULT_MS,
  HARD_TIMEOUT_LONG_MS,
  SHORT_TIMEOUT_MAX_MS,
  BG_SUMMARY_INTERVAL_MS,
} from "../src/shell-dual-track/shell-runtime-classifier.js"

describe("shell-runtime-classifier — constants", () => {
  it("SOFT_TIMEOUT_MS is 8 seconds", () => {
    expect(SOFT_TIMEOUT_MS).toBe(8_000)
  })

  it("HARD_TIMEOUT_DEFAULT_MS is 5 minutes", () => {
    expect(HARD_TIMEOUT_DEFAULT_MS).toBe(5 * 60 * 1000)
  })

  it("HARD_TIMEOUT_LONG_MS is 24 hours", () => {
    expect(HARD_TIMEOUT_LONG_MS).toBe(24 * 60 * 60 * 1000)
  })

  it("SHORT_TIMEOUT_MAX_MS is 10 seconds", () => {
    expect(SHORT_TIMEOUT_MAX_MS).toBe(10_000)
  })

  it("BG_SUMMARY_INTERVAL_MS is 5 minutes", () => {
    expect(BG_SUMMARY_INTERVAL_MS).toBe(5 * 60 * 1000)
  })
})

describe("classifyShellCommand — long", () => {
  it.each([
    ["npm test"],
    ["npm t"],
    ["npm run test"],
    ["npm run dev"],
    ["vitest"],
    ["jest"],
    ["tsc --watch"],
    ["docker build ."],
    ["git clone https://github.com/foo/bar.git"],
  ])('classifies "%s" as long', (cmd) => {
    expect(classifyShellCommand(cmd)).toBe("long")
  })
})

describe("classifyShellCommand — short", () => {
  it.each([
    ["git status"],
    ["git diff"],
    ["ls"],
    ["echo hello"],
    ["tsc --noEmit"],
    ["node --version"],
  ])('classifies "%s" as short', (cmd) => {
    expect(classifyShellCommand(cmd)).toBe("short")
  })

  it("git diff --stat falls through to auto", () => {
    expect(classifyShellCommand("git diff --stat")).toBe("auto")
  })
})

describe("classifyShellCommand — auto", () => {
  it.each([
    ["some-unknown-command --flag"],
    ["make"],
    [""],
    ["   "],
  ])('classifies "%s" as auto', (cmd) => {
    expect(classifyShellCommand(cmd)).toBe("auto")
  })
})

describe("pickBackgroundHardTimeout", () => {
  it("returns 24h for long", () => {
    expect(pickBackgroundHardTimeout("long")).toBe(HARD_TIMEOUT_LONG_MS)
  })

  it("returns 5min for explicit background on auto", () => {
    expect(pickBackgroundHardTimeout("auto", { explicitBackground: true }))
      .toBe(HARD_TIMEOUT_DEFAULT_MS)
  })
})

describe("pickForegroundTimeout", () => {
  it("caps short to 10s", () => {
    expect(pickForegroundTimeout("short", undefined)).toBe(SHORT_TIMEOUT_MAX_MS)
    expect(pickForegroundTimeout("short", 30_000)).toBe(SHORT_TIMEOUT_MAX_MS)
  })

  it("auto uses args.timeout when provided", () => {
    expect(pickForegroundTimeout("auto", 20_000)).toBe(20_000)
  })

  it("auto uses 30s default when undefined", () => {
    expect(pickForegroundTimeout("auto", undefined)).toBe(30_000)
  })
})
