import type { ClefAnswer } from "@strix/contracts"
import { describe, expect, it } from "vitest"
import { PASS_ONE_IDS, type PassOneId } from "../src/classify/questions.ts"
import { readPassOne, ReadingError } from "../src/classify/reading.ts"
import { GOAL, GOALIE_CHANGE, PENALTY, QUIET, withAnswer, withoutAnswer } from "./answers.ts"

const NOUL: ClefAnswer = { type: "noul", noul: 0.5 }
const CHOICE: ClefAnswer = { type: "choice", choice: "home", probabilities: { home: 0.6, away: 0.4 }, confidence: 0.6 }
const SCORE: ClefAnswer = {
  type: "score",
  score: 0,
  legend: { 0: "0", 1: "1", 2: "2", 3: "3", 4: "4 or more" },
  probabilities: { 0: 0.6, 1: 0.2, 2: 0.1, 3: 0.05, 4: 0.05 },
  confidence: 0.6,
}

const WRONG_TYPE = {
  game_state: NOUL,
  goal: CHOICE,
  goal_team: SCORE,
  penalty: SCORE,
  penalty_team: NOUL,
  infraction: SCORE,
  penalty_class: NOUL,
  shots_home: CHOICE,
  shots_away: NOUL,
  goalie_change: CHOICE,
  goalie_change_team: SCORE,
} satisfies Record<PassOneId, ClefAnswer>

const choiceOf = (probabilities: Record<string, number>, choice: string, confidence = 0.7): ClefAnswer => ({
  type: "choice",
  choice,
  probabilities,
  confidence,
})

const failureOf = (read: () => void): Error => {
  try {
    read()
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error("expected the reading to fail")
}

describe("readPassOne", () => {
  it("reads a goal clip", () => {
    expect(readPassOne(GOAL)).toEqual({
      gameState: { state: "live", confidence: 90 },
      goal: 0.91,
      goalTeam: { team: "away", confidence: 80 },
      penalty: 0.05,
      penaltyTeam: { team: "home", confidence: 52 },
      infraction: { id: "other", confidence: 30 },
      penaltyClass: { id: "minor", confidence: 71 },
      shotsHome: { count: 1, confidence: 60 },
      shotsAway: { count: 2, confidence: 65 },
      goalieChange: 0.02,
      goalieChangeTeam: { team: "home", confidence: 55 },
    })
  })

  it("reads the infraction and class of a penalty clip", () => {
    const reading = readPassOne(PENALTY)
    expect(reading.penalty).toBe(0.66)
    expect(reading.penaltyTeam).toEqual({ team: "home", confidence: 74 })
    expect(reading.infraction).toEqual({ id: "slashing", confidence: 58 })
    expect(reading.penaltyClass).toEqual({ id: "minor", confidence: 83 })
  })

  it("reads the quiet and goalie-change fixtures", () => {
    expect(readPassOne(QUIET).gameState.state).toBe("live")
    expect(readPassOne(GOALIE_CHANGE).goalieChange).toBe(0.88)
    expect(readPassOne(GOALIE_CHANGE).goalieChangeTeam).toEqual({ team: "home", confidence: 84 })
  })

  it("fails naming penalty_team when Clef leaves it out", () => {
    const error = failureOf(() => readPassOne(withoutAnswer(GOAL, "penalty_team")))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain("penalty_team")
  })

  it("fails when goal comes back as a choice answer", () => {
    const error = failureOf(() => readPassOne(withAnswer(GOAL, "goal", CHOICE)))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain("goal")
  })

  it.each(PASS_ONE_IDS)("fails naming %s when it is missing", (id) => {
    const error = failureOf(() => readPassOne(withoutAnswer(GOAL, id)))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain(id)
  })

  it.each(PASS_ONE_IDS)("fails naming %s when it has the wrong type", (id) => {
    const error = failureOf(() => readPassOne(withAnswer(GOAL, id, WRONG_TYPE[id])))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain(id)
  })

  it("trusts the probabilities over the reported choice", () => {
    const answer = choiceOf({ home: 0.3, away: 0.7 }, "home")
    expect(readPassOne(withAnswer(GOAL, "goal_team", answer)).goalTeam).toEqual({ team: "away", confidence: 70 })
  })

  it("fails when the most likely team is not home or away", () => {
    const answer = choiceOf({ home: 0.2, visitors: 0.8 }, "visitors")
    const error = failureOf(() => readPassOne(withAnswer(GOAL, "goal_team", answer)))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain("goal_team")
  })

  it("fails when the most likely infraction is not a known infraction", () => {
    const answer = choiceOf({ spearing: 0.9, slashing: 0.1 }, "spearing")
    const error = failureOf(() => readPassOne(withAnswer(PENALTY, "infraction", answer)))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain("infraction")
  })

  it("fails when a choice has no probabilities", () => {
    const error = failureOf(() => readPassOne(withAnswer(GOAL, "game_state", choiceOf({}, "live"))))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain("game_state")
  })

  it("fails when the most likely shot level is not one of the five", () => {
    const answer: ClefAnswer = {
      type: "score",
      score: 7,
      legend: { 0: "0", 7: "7" },
      probabilities: { 0: 0.1, 7: 0.9 },
      confidence: 0.9,
    }
    const error = failureOf(() => readPassOne(withAnswer(GOAL, "shots_away", answer)))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain("shots_away")
  })

  it("resolves a shot level Clef keyed by its legend label", () => {
    const answer: ClefAnswer = {
      type: "score",
      score: 4,
      legend: { 0: "0", 1: "1", 2: "2", 3: "3", 4: "4 or more" },
      probabilities: { "0": 0.05, "1": 0.05, "2": 0.1, "3": 0.1, "4 or more": 0.7 },
      confidence: 0.7,
    }
    expect(readPassOne(withAnswer(GOAL, "shots_home", answer)).shotsHome).toEqual({ count: 4, confidence: 70 })
  })

  it("fails when the likeliest label matches more than one legend entry", () => {
    const answer: ClefAnswer = {
      type: "score",
      score: 3,
      legend: { 0: "0", 1: "1", 2: "2", 3: "many", 4: "many" },
      probabilities: { "0": 0.1, "1": 0.1, "2": 0.1, many: 0.7 },
      confidence: 0.7,
    }
    const error = failureOf(() => readPassOne(withAnswer(GOAL, "shots_home", answer)))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain("shots_home")
  })

  it("fails when a probability is outside 0..1", () => {
    const error = failureOf(() => readPassOne(withAnswer(GOAL, "goal", { type: "noul", noul: 1.4 })))
    expect(error).toBeInstanceOf(ReadingError)
    expect(error.message).toContain("goal")
    const choice = choiceOf({ home: 0.6, away: 0.4 }, "home", -0.1)
    expect(() => readPassOne(withAnswer(GOAL, "penalty_team", choice))).toThrow(/penalty_team/)
  })
})
