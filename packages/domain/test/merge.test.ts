import { describe, expect, it } from "vitest"
import { MERGE_WITHIN_MS, mergeAdjacent } from "../src/index.ts"

interface Event {
  readonly id: string
  readonly type: string
  readonly team: string
  readonly clipIndex: number
  readonly videoMs: number
  readonly confidence: number
  readonly precisionMs: number
}

const event = (overrides: Partial<Event>): Event => ({
  id: "e",
  type: "goal",
  team: "home",
  clipIndex: 3,
  videoMs: 90_000,
  confidence: 71,
  precisionMs: 10_000,
  ...overrides,
})

describe("mergeAdjacent", () => {
  it("exposes the merge window", () => {
    expect(MERGE_WITHIN_MS).toBe(15_000)
  })

  it("merges adjacent clips keeping the higher confidence at the earlier position", () => {
    const merged = mergeAdjacent([
      event({ id: "a", clipIndex: 3, videoMs: 90_000, confidence: 71 }),
      event({ id: "b", clipIndex: 4, videoMs: 100_000, confidence: 84 }),
    ])
    expect(merged).toEqual([event({ id: "b", clipIndex: 3, videoMs: 90_000, confidence: 84 })])
  })

  it("keeps the earlier event's data when it has the higher confidence", () => {
    const merged = mergeAdjacent([
      event({ id: "a", confidence: 90 }),
      event({ id: "b", clipIndex: 4, videoMs: 100_000, confidence: 60 }),
    ])
    expect(merged).toEqual([event({ id: "a", confidence: 90 })])
  })

  it("merges at exactly the merge window", () => {
    expect(mergeAdjacent([event({}), event({ clipIndex: 4, videoMs: 105_000 })])).toHaveLength(1)
  })

  it("does not merge beyond the merge window", () => {
    expect(mergeAdjacent([event({}), event({ clipIndex: 4, videoMs: 105_001 })])).toHaveLength(2)
  })

  it("widens the window to the events' precision when that is coarser", () => {
    const coarse = { precisionMs: 30_000 }
    expect(mergeAdjacent([event(coarse), event({ ...coarse, clipIndex: 4, videoMs: 115_000 })])).toHaveLength(1)
    expect(mergeAdjacent([event(coarse), event({ ...coarse, clipIndex: 4, videoMs: 120_000 })])).toHaveLength(1)
    expect(mergeAdjacent([event(coarse), event({ ...coarse, clipIndex: 4, videoMs: 120_001 })])).toHaveLength(2)
  })

  it("keeps the merge window for events finer than it", () => {
    expect(mergeAdjacent([event({}), event({ clipIndex: 4, videoMs: 115_000 })])).toHaveLength(2)
  })

  it("takes the finer precision of the two events", () => {
    const merged = mergeAdjacent([
      event({ precisionMs: 30_000 }),
      event({ clipIndex: 4, videoMs: 115_000, precisionMs: 10_000 }),
    ])
    expect(merged).toHaveLength(2)
    expect(
      mergeAdjacent([event({ precisionMs: 10_000 }), event({ clipIndex: 4, videoMs: 115_000, precisionMs: 30_000 })]),
    ).toHaveLength(2)
  })

  it("merges pass-one events of a chain of 25 s windows at 30 s precision", () => {
    const passOne = (id: string, clipIndex: number) =>
      event({ id, clipIndex, videoMs: clipIndex * 25_000, precisionMs: 30_000 })
    const merged = mergeAdjacent([passOne("a", 0), passOne("c", 2), passOne("b", 1)])
    expect(merged.map((e) => [e.id, e.clipIndex, e.videoMs])).toEqual([["a", 0, 0]])
  })

  it("does not merge clips two apart", () => {
    expect(mergeAdjacent([event({ clipIndex: 3 }), event({ clipIndex: 5, videoMs: 100_000 })])).toHaveLength(2)
  })

  it("does not merge events from the same clip", () => {
    expect(mergeAdjacent([event({}), event({ videoMs: 95_000 })])).toHaveLength(2)
  })

  it("does not merge different teams", () => {
    expect(mergeAdjacent([event({}), event({ team: "away", clipIndex: 4, videoMs: 100_000 })])).toHaveLength(2)
  })

  it("does not merge different types", () => {
    expect(mergeAdjacent([event({}), event({ type: "penalty", clipIndex: 4, videoMs: 100_000 })])).toHaveLength(2)
  })

  it("merges a chain of three adjacent clips into one event", () => {
    const merged = mergeAdjacent([
      event({ id: "a", clipIndex: 3, videoMs: 90_000, confidence: 70 }),
      event({ id: "b", clipIndex: 4, videoMs: 100_000, confidence: 80 }),
      event({ id: "c", clipIndex: 5, videoMs: 110_000, confidence: 75 }),
    ])
    expect(merged).toEqual([event({ id: "b", clipIndex: 3, videoMs: 90_000, confidence: 80 })])
  })

  it("does not collapse two events of the same clip by bridging through a neighbouring clip", () => {
    const merged = mergeAdjacent([
      event({ id: "a", clipIndex: 3, videoMs: 90_000 }),
      event({ id: "b", clipIndex: 4, videoMs: 100_000 }),
      event({ id: "d", clipIndex: 3, videoMs: 104_000 }),
    ])
    expect(merged.map((e) => e.id)).toEqual(["a", "d"])
  })

  it("sorts by video time before merging", () => {
    const merged = mergeAdjacent([
      event({ id: "b", clipIndex: 4, videoMs: 100_000, confidence: 84 }),
      event({ id: "a", clipIndex: 3, videoMs: 90_000, confidence: 71 }),
    ])
    expect(merged).toEqual([event({ id: "b", clipIndex: 3, videoMs: 90_000, confidence: 84 })])
  })

  it("breaks video time ties by clip index", () => {
    const merged = mergeAdjacent([
      event({ id: "b", clipIndex: 4, videoMs: 100_000, confidence: 84 }),
      event({ id: "a", clipIndex: 3, videoMs: 100_000, confidence: 71 }),
    ])
    expect(merged).toEqual([event({ id: "b", clipIndex: 3, videoMs: 100_000, confidence: 84 })])
  })

  it("merges across an interleaved event of another type", () => {
    const merged = mergeAdjacent([
      event({ id: "a", clipIndex: 3, videoMs: 90_000 }),
      event({ id: "p", type: "penalty", clipIndex: 3, videoMs: 95_000 }),
      event({ id: "b", clipIndex: 4, videoMs: 100_000, confidence: 84 }),
    ])
    expect(merged.map((e) => e.id)).toEqual(["b", "p"])
  })

  it("returns a new array without mutating the inputs", () => {
    const first = event({ id: "a" })
    const second = event({ id: "b", clipIndex: 4, videoMs: 100_000, confidence: 84 })
    const input = [second, first]
    const snapshot = structuredClone(input)
    const merged = mergeAdjacent(input)
    expect(merged).not.toBe(input)
    expect(input).toEqual(snapshot)
    expect(input[0]).toBe(second)
  })

  it("returns an empty array for no events", () => {
    expect(mergeAdjacent([])).toEqual([])
  })
})
