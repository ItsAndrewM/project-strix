import { ClefQuestion, Infraction, type Team } from "@strix/contracts"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { PASS_ONE_IDS, passOneQuestions } from "../src/classify/questions.ts"

const HOME: Team = { name: "Kelowna Rockets", jersey: "red with white trim", roster: [9, 17] }
const AWAY: Team = { name: "Kamloops Blazers", jersey: "white with orange numbers", roster: [] }

const questions = passOneQuestions(HOME, AWAY)

const criteriaKeysOf = (question: ClefQuestion): ReadonlyArray<string> =>
  question.type === "choice" ? Object.keys(question.criteria) : []

describe("passOneQuestions", () => {
  it("asks exactly the eleven pass-one questions", () => {
    const ids = [
      "game_state",
      "goal",
      "goal_team",
      "penalty",
      "penalty_team",
      "infraction",
      "penalty_class",
      "shots_home",
      "shots_away",
      "goalie_change",
      "goalie_change_team",
    ]
    expect(PASS_ONE_IDS).toEqual(ids)
    expect(Object.keys(questions).toSorted()).toEqual(ids.toSorted())
  })

  it("asks only questions Clef accepts", () => {
    for (const question of Object.values(questions)) {
      expect(Schema.is(ClefQuestion)(question)).toBe(true)
    }
  })

  it("describes each team by name and jersey in every team question", () => {
    const teams = {
      home: "Kelowna Rockets, wearing red with white trim",
      away: "Kamloops Blazers, wearing white with orange numbers",
    }
    expect(questions.goal_team).toMatchObject({ type: "choice", criteria: teams })
    expect(questions.penalty_team).toMatchObject({ type: "choice", criteria: teams })
    expect(questions.goalie_change_team).toMatchObject({ type: "choice", criteria: teams })
  })

  it("asks the three event questions as noul with the spec's wording", () => {
    expect(questions.goal).toEqual({
      type: "noul",
      instructions:
        "A goal is scored in this clip: the puck crosses the goal line, players celebrate, the horn sounds, teams reset at centre ice",
    })
    expect(questions.penalty).toEqual({
      type: "noul",
      instructions:
        "A penalty is called in this clip: the referee raises an arm or signals, a player goes to the box, play resumes short-handed",
    })
    expect(questions.goalie_change).toEqual({
      type: "noul",
      instructions: "A goalie leaves and another takes the net, or the net is left empty for an extra attacker",
    })
  })

  it("asks the game state over the five states", () => {
    expect(questions.game_state).toMatchObject({
      type: "choice",
      criteria: {
        live: "live play, puck in play",
        stoppage: "stoppage with players on the ice",
        intermission: "intermission or ice resurfacing",
        warmup: "pre-game warmup",
        empty: "empty ice or other",
      },
    })
  })

  it("asks the infraction over all fifteen infraction ids", () => {
    expect(questions.infraction.type).toBe("choice")
    expect(criteriaKeysOf(questions.infraction).toSorted()).toEqual(Infraction.literals.toSorted())
  })

  it("asks the penalty class with its minutes", () => {
    expect(questions.penalty_class).toMatchObject({
      type: "choice",
      criteria: {
        minor: "minor, 2 minutes",
        double_minor: "double minor, 4 minutes",
        major: "major, 5 minutes",
        misconduct: "misconduct, 10 minutes",
      },
    })
  })

  it("asks shots per team as a score over the first 25 seconds", () => {
    expect(questions.shots_home).toEqual({
      type: "score",
      instructions: "How many shots on goal did Kelowna Rockets take in the first 25 seconds of this clip?",
      criteria: ["0", "1", "2", "3", "4 or more"],
    })
    expect(questions.shots_away).toEqual({
      type: "score",
      instructions: "How many shots on goal did Kamloops Blazers take in the first 25 seconds of this clip?",
      criteria: ["0", "1", "2", "3", "4 or more"],
    })
  })
})
