import { describe, expect, it } from "vitest"
import { listedEvents, seekMs, selectedClipIndex, stepClip, stepEvent } from "../src/features/game/selection.ts"
import { clip, event } from "./fixtures.ts"

describe("stepEvent", () => {
  const ids = ["a", "b", "c"]

  it("moves to the next or previous listed event, stopping at the ends", () => {
    expect(stepEvent(ids, "a", 1)).toBe("b")
    expect(stepEvent(ids, "c", 1)).toBe("c")
    expect(stepEvent(ids, "b", -1)).toBe("a")
    expect(stepEvent(ids, "a", -1)).toBe("a")
  })

  it("starts at the first event going forward and the last going back when none listed is selected", () => {
    expect(stepEvent(ids, null, 1)).toBe("a")
    expect(stepEvent(ids, "gone", -1)).toBe("c")
  })

  it("selects nothing when nothing is listed", () => {
    expect(stepEvent([], null, 1)).toBeNull()
  })
})

describe("stepClip", () => {
  const indexes = [0, 1, 2]

  it("steps through clips, stopping at the ends", () => {
    expect(stepClip(indexes, 0, 1)).toBe(1)
    expect(stepClip(indexes, 2, 1)).toBe(2)
    expect(stepClip(indexes, 0, -1)).toBe(0)
  })

  it("selects nothing when there are no clips", () => {
    expect(stepClip([], null, 1)).toBeNull()
  })
})

describe("selectedClipIndex", () => {
  const clips = [clip(0, "live"), clip(1, "live"), clip(2, null)]

  it("follows the selected event's clip", () => {
    expect(selectedClipIndex({ kind: "event", id: "g" }, event("g", "goal", 2, "auto"), clips)).toBe(2)
  })

  it("keeps a clip chosen on the timeline", () => {
    expect(selectedClipIndex({ kind: "clip", index: 1 }, null, clips)).toBe(1)
  })

  it("falls back to the first clip when nothing listed is selected", () => {
    expect(selectedClipIndex(null, null, clips)).toBe(0)
    expect(selectedClipIndex({ kind: "event", id: "hidden" }, null, clips)).toBe(0)
    expect(selectedClipIndex(null, null, [])).toBeNull()
  })
})

describe("seekMs", () => {
  it("seeks to the event's moment within its clip", () => {
    expect(seekMs(event("g", "goal", 2, "auto"), clip(2, "live"))).toBe(5_000)
  })

  it("starts a clip from its beginning when no event is selected", () => {
    expect(seekMs(null, clip(1, "live"))).toBe(0)
  })
})

describe("listedEvents", () => {
  const events = [event("g", "goal", 0, "auto"), event("p", "penalty", 2, "discarded")]

  it("hides discarded events unless asked to show them", () => {
    expect(listedEvents(events, false).map(({ id }) => id)).toEqual(["g"])
    expect(listedEvents(events, true).map(({ id }) => id)).toEqual(["g", "p"])
  })
})
