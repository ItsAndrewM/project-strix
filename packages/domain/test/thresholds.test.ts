import { describe, expect, it } from "vitest"
import { decide } from "../src/index.ts"

const thresholds = { autoSave: 80, draft: 40 }

describe("decide in auto mode", () => {
  it("auto-saves at or above the auto-save threshold", () => {
    expect(decide(80, "auto", thresholds)).toBe("auto")
    expect(decide(100, "auto", thresholds)).toBe("auto")
  })

  it("discards between draft and auto-save", () => {
    expect(decide(79, "auto", thresholds)).toBe("discarded")
    expect(decide(40, "auto", thresholds)).toBe("discarded")
  })

  it("returns null below draft", () => {
    expect(decide(39, "auto", thresholds)).toBeNull()
  })
})

describe("decide in review mode", () => {
  it("drafts at or above the draft threshold", () => {
    expect(decide(40, "review", thresholds)).toBe("draft")
    expect(decide(95, "review", thresholds)).toBe("draft")
  })

  it("returns null below draft", () => {
    expect(decide(39, "review", thresholds)).toBeNull()
  })
})
