import { DEFAULT_THRESHOLDS, GameEvent } from "@strix/contracts"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { eventsFromPassOne } from "../src/classify/events-from-pass-one.ts"
import { readPassOne } from "../src/classify/reading.ts"
import { GOAL, GOALIE_CHANGE, PENALTY, QUIET } from "./answers.ts"

const NOW = 1_800_000_000_000
const CLIP = { index: 7, startMs: 175_000 }

const idsFrom = (): (() => string) => {
  let next = 0
  return () => {
    next += 1
    return `event-${next}`
  }
}

const isGameEvent = Schema.is(GameEvent)

describe("eventsFromPassOne", () => {
  it("auto-saves a confident goal", () => {
    const events = eventsFromPassOne(CLIP, readPassOne(GOAL), "auto", DEFAULT_THRESHOLDS, NOW, idsFrom())
    expect(events).toEqual([
      {
        id: "event-1",
        type: "goal",
        team: "away",
        teamConfidence: 80,
        videoMs: 175_000,
        precisionMs: 30_000,
        clipIndex: 7,
        confidence: 91,
        status: "auto",
        needs: ["time", "scorer", "assists"],
        period: null,
        clock: null,
        attrs: { scorer: null, scorerConfidence: null, assists: [] },
        createdAt: NOW,
      },
    ])
    expect(events.every(isGameEvent)).toBe(true)
  })

  it("drafts the same goal in review mode", () => {
    const events = eventsFromPassOne(CLIP, readPassOne(GOAL), "review", DEFAULT_THRESHOLDS, NOW, idsFrom())
    expect(events.map((event) => [event.type, event.status])).toEqual([["goal", "draft"]])
  })

  it("makes no event from a quiet clip", () => {
    expect(eventsFromPassOne(CLIP, readPassOne(QUIET), "auto", DEFAULT_THRESHOLDS, NOW, idsFrom())).toEqual([])
    expect(eventsFromPassOne(CLIP, readPassOne(QUIET), "review", DEFAULT_THRESHOLDS, NOW, idsFrom())).toEqual([])
  })

  it("discards a penalty below auto-save in auto mode, keeping its infraction and class", () => {
    const events = eventsFromPassOne(CLIP, readPassOne(PENALTY), "auto", DEFAULT_THRESHOLDS, NOW, idsFrom())
    expect(events).toEqual([
      {
        id: "event-1",
        type: "penalty",
        team: "home",
        teamConfidence: 74,
        videoMs: 175_000,
        precisionMs: 30_000,
        clipIndex: 7,
        confidence: 66,
        status: "discarded",
        needs: ["time", "player"],
        period: null,
        clock: null,
        attrs: { infraction: "slashing", infractionConfidence: 58, class: "minor", classConfidence: 83, player: null },
        createdAt: NOW,
      },
    ])
    expect(events.every(isGameEvent)).toBe(true)
  })

  it("auto-saves a goalie change with empty attrs", () => {
    const events = eventsFromPassOne(CLIP, readPassOne(GOALIE_CHANGE), "auto", DEFAULT_THRESHOLDS, NOW, idsFrom())
    expect(events).toEqual([
      {
        id: "event-1",
        type: "goalie_change",
        team: "home",
        teamConfidence: 84,
        videoMs: 175_000,
        precisionMs: 30_000,
        clipIndex: 7,
        confidence: 88,
        status: "auto",
        needs: ["time"],
        period: null,
        clock: null,
        attrs: {},
        createdAt: NOW,
      },
    ])
    expect(events.every(isGameEvent)).toBe(true)
  })

  it("orders goal, penalty then goalie change and draws one id per event", () => {
    const reading = { ...readPassOne(GOAL), penalty: 0.85, goalieChange: 0.95 }
    const events = eventsFromPassOne(CLIP, reading, "auto", DEFAULT_THRESHOLDS, NOW, idsFrom())
    expect(events.map((event) => [event.id, event.type])).toEqual([
      ["event-1", "goal"],
      ["event-2", "penalty"],
      ["event-3", "goalie_change"],
    ])
  })

  it("follows the game's thresholds", () => {
    const thresholds = { ...DEFAULT_THRESHOLDS, autoSave: 60 }
    const events = eventsFromPassOne(CLIP, readPassOne(PENALTY), "auto", thresholds, NOW, idsFrom())
    expect(events.map((event) => event.status)).toEqual(["auto"])
    const strict = { ...DEFAULT_THRESHOLDS, draft: 95, autoSave: 95 }
    expect(eventsFromPassOne(CLIP, readPassOne(GOAL), "review", strict, NOW, idsFrom())).toEqual([])
  })
})
