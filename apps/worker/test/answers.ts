import { type ClefAnswer, ClefResponse } from "@strix/contracts"
import { Schema } from "effect"
import goalFixture from "../fixtures/answers/goal.json"
import goalieChangeFixture from "../fixtures/answers/goalie-change.json"
import penaltyFixture from "../fixtures/answers/penalty.json"
import quietFixture from "../fixtures/answers/quiet.json"

const decodeResponse = Schema.decodeUnknownSync(ClefResponse)

export const GOAL = decodeResponse(goalFixture)
export const PENALTY = decodeResponse(penaltyFixture)
export const QUIET = decodeResponse(quietFixture)
export const GOALIE_CHANGE = decodeResponse(goalieChangeFixture)

export const withAnswer = (response: ClefResponse, id: string, answer: ClefAnswer): ClefResponse => ({
  ...response,
  answers: { ...response.answers, [id]: answer },
})

export const withoutAnswer = (response: ClefResponse, id: string): ClefResponse => ({
  ...response,
  answers: Object.fromEntries(Object.entries(response.answers).filter(([answerId]) => answerId !== id)),
})
