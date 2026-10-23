import { Exit, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { GameEvent, PENALTY_MINUTES } from "../src/index.ts"

const codec = Schema.toCodecJson(GameEvent)
const roundTrip = (event: Schema.Json) => Schema.encodeUnknownSync(codec)(Schema.decodeUnknownSync(codec)(event))

const base = {
  id: "event-1",
  team: "home",
  teamConfidence: 90,
  videoMs: 125_000,
  precisionMs: 2_000,
  clipIndex: 4,
  confidence: 88,
  status: "auto",
  needs: [],
  period: 2,
  clock: "07:31",
  createdAt: 1_760_000_000_000,
}

const goal = {
  ...base,
  type: "goal",
  attrs: {
    scorer: 17,
    scorerConfidence: 82,
    assists: [
      { jersey: 4, confidence: 61 },
      { jersey: 9, confidence: 55 },
    ],
  },
}

const penalty = {
  ...base,
  id: "event-2",
  type: "penalty",
  team: "away",
  status: "draft",
  needs: ["player"],
  attrs: { infraction: "cross_checking", infractionConfidence: 77, class: "minor", classConfidence: 91, player: null },
}

describe("GameEvent", () => {
  it("round-trips a goal with two assists", () => {
    expect(roundTrip(goal)).toEqual(goal)
  })

  it("round-trips a penalty", () => {
    expect(roundTrip(penalty)).toEqual(penalty)
  })

  it("round-trips a goalie change", () => {
    const change = { ...base, id: "event-3", type: "goalie_change", attrs: {} }
    expect(roundTrip(change)).toEqual(change)
  })

  it("rejects an unknown infraction", () => {
    const invalid = { ...penalty, attrs: { ...penalty.attrs, infraction: "diving" } }
    expect(Exit.isFailure(Schema.decodeUnknownExit(codec)(invalid))).toBe(true)
  })

  it("rejects a scorer jersey above 99", () => {
    const invalid = { ...goal, attrs: { ...goal.attrs, scorer: 100 } }
    expect(Exit.isFailure(Schema.decodeUnknownExit(codec)(invalid))).toBe(true)
  })
})

describe("PENALTY_MINUTES", () => {
  it("maps each class to its minutes", () => {
    expect(PENALTY_MINUTES.double_minor).toBe(4)
    expect(PENALTY_MINUTES).toEqual({ minor: 2, double_minor: 4, major: 5, misconduct: 10 })
  })
})
