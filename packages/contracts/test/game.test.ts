import { Exit, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { DEFAULT_THRESHOLDS, NewGame, TIMING_PRESETS } from "../src/index.ts"

const codec = Schema.toCodecJson(NewGame)
const decode = Schema.decodeUnknownExit(codec)

const team = (roster: ReadonlyArray<number>) => ({ name: "Hawks", jersey: "white", roster })

const newGame = (roster: ReadonlyArray<number>) => ({
  name: "Hawks at Eagles",
  home: team(roster),
  away: team([1, 2, 3]),
  mode: "auto",
  level: "youth-stop",
})

describe("NewGame", () => {
  it("decodes a minimal valid payload", () => {
    expect(Exit.isSuccess(decode(newGame([7, 12, 99])))).toBe(true)
  })

  it("leaves thresholds and timing absent when omitted", () => {
    const decoded = Schema.decodeUnknownSync(codec)(newGame([7]))
    expect(decoded.thresholds).toBeUndefined()
    expect(decoded.timing).toBeUndefined()
  })

  it("rejects a roster jersey of 100", () => {
    expect(Exit.isFailure(decode(newGame([7, 100])))).toBe(true)
  })

  it("rejects a negative roster jersey", () => {
    expect(Exit.isFailure(decode(newGame([-1])))).toBe(true)
  })

  it("rejects a threshold above 100", () => {
    const withThresholds = { ...newGame([7]), thresholds: { ...DEFAULT_THRESHOLDS, scorer: 101 } }
    expect(Exit.isFailure(decode(withThresholds))).toBe(true)
  })
})

describe("TIMING_PRESETS", () => {
  it("holds the junior-pro preset", () => {
    expect(TIMING_PRESETS["junior-pro"]).toEqual({ periodMinutes: 20, intermissionMin: 8, ambiguousMin: 3 })
  })

  it("holds the youth presets", () => {
    expect(TIMING_PRESETS["youth-running"]).toEqual({ periodMinutes: 15, intermissionMin: 1, ambiguousMin: 0.5 })
    expect(TIMING_PRESETS["youth-stop"]).toEqual({ periodMinutes: 15, intermissionMin: 3, ambiguousMin: 1 })
  })
})

describe("DEFAULT_THRESHOLDS", () => {
  it("holds the documented defaults", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ autoSave: 80, draft: 40, period: 85, scorer: 70, assist: 50 })
  })
})
