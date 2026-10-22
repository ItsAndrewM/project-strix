import type { Clip } from "@strix/contracts"
import { describe, expect, it } from "vitest"
import { cellsFor } from "../src/features/game/timeline-cells.ts"
import { clip, event } from "./fixtures.ts"

const CLIPS = [clip(0, "live"), clip(1, "stoppage"), clip(2, "live")]

describe("cellsFor", () => {
  it("gives one cell per clip, marks a goal on its clip and outlines the selected clip", () => {
    const cells = cellsFor(CLIPS, [event("g", "goal", 0, "auto")], 2)
    expect(cells).toEqual([
      { index: 0, state: "live", marks: ["goal"], selected: false },
      { index: 1, state: "stoppage", marks: [], selected: false },
      { index: 2, state: "live", marks: [], selected: true },
    ])
  })

  it("adds no mark for a discarded event or a goalie change", () => {
    const events = [event("p", "penalty", 2, "discarded"), event("c", "goalie_change", 1, "auto")]
    expect(cellsFor(CLIPS, events, null).map(({ marks }) => marks)).toEqual([[], [], []])
  })

  it("marks a goal and a penalty in the same clip once each", () => {
    const events = [event("p", "penalty", 1, "draft"), event("g1", "goal", 1, "auto"), event("g2", "goal", 1, "draft")]
    expect(cellsFor(CLIPS, events, null)[1]?.marks).toEqual(["goal", "penalty"])
  })

  it("shows a clip that could not be sliced or classified as failed, apart from pending", () => {
    const unsliced: Clip = { ...clip(1, null), renditions: [], classification: "failed" }
    expect(cellsFor([clip(0, null), unsliced], [], null).map(({ state }) => state)).toEqual(["pending", "failed"])
  })

  it("shows a clip that isn't classified yet as pending", () => {
    expect(cellsFor([clip(0, "live"), clip(1, null)], [], 0).map(({ state }) => state)).toEqual(["live", "pending"])
  })
})
