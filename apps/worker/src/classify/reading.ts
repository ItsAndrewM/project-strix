/**
 * Reads Clef's pass-one answers. An id that is missing, answered with a different `type` than asked, answered with
 * no or out-of-range probabilities, or whose likeliest key was not among the criteria asked fails the whole clip with
 * a `ReadingError` naming the id, so a malformed answer never becomes an event. Choices and scores take the likeliest
 * key from `probabilities` rather than trusting Clef's own `choice` or `score`.
 */
import { type ClefAnswer, type ClefResponse, GameState, Infraction, PenaltyClass, Side } from "@strix/contracts"
import { argmax, percentOf } from "@strix/domain"
import { Schema } from "effect"
import type { PassOneId } from "./questions.ts"

export class ReadingError extends Error {
  override readonly name = "ReadingError"
}

export interface TeamReading {
  readonly team: Side
  readonly confidence: number
}

export interface ShotsReading {
  readonly count: number
  readonly confidence: number
}

export interface PassOneReading {
  readonly gameState: { readonly state: GameState; readonly confidence: number }
  readonly goal: number
  readonly goalTeam: TeamReading
  readonly penalty: number
  readonly penaltyTeam: TeamReading
  readonly infraction: { readonly id: Infraction; readonly confidence: number }
  readonly penaltyClass: { readonly id: PenaltyClass; readonly confidence: number }
  readonly shotsHome: ShotsReading
  readonly shotsAway: ShotsReading
  readonly goalieChange: number
  readonly goalieChangeTeam: TeamReading
}

interface Chosen<K extends string> {
  readonly key: K
  readonly confidence: number
}

type IsKey<K extends string> = (key: string) => key is K

const ShotLevel = Schema.Literals(["0", "1", "2", "3", "4"])

const isSide: IsKey<Side> = Schema.is(Side)
const isGameState: IsKey<GameState> = Schema.is(GameState)
const isInfraction: IsKey<Infraction> = Schema.is(Infraction)
const isPenaltyClass: IsKey<PenaltyClass> = Schema.is(PenaltyClass)
const isShotLevel: IsKey<typeof ShotLevel.Type> = Schema.is(ShotLevel)

const answerTo = (response: ClefResponse, id: PassOneId): ClefAnswer => {
  const answer = response.answers[id]
  if (answer === undefined) throw new ReadingError(`Clef did not answer ${id}`)
  return answer
}

const wrongType = (id: PassOneId, expected: ClefAnswer["type"], answer: ClefAnswer): ReadingError =>
  new ReadingError(`Clef answered ${id} as ${answer.type}, expected ${expected}`)

const isProbability = (value: number): boolean => value >= 0 && value <= 1

const probabilityOf = (id: PassOneId, value: number): number => {
  if (!isProbability(value)) throw new ReadingError(`Clef answered ${id} with probability ${value}, outside 0..1`)
  return value
}

const likeliestKey = <K extends string>(id: PassOneId, probabilities: Record<string, number>, isKey: IsKey<K>): K => {
  const entries = Object.entries(probabilities)
  if (entries.length === 0) throw new ReadingError(`Clef answered ${id} with no probabilities`)
  for (const [, probability] of entries) probabilityOf(id, probability)
  const { key } = argmax(new Map(entries))
  if (!isKey(key)) throw new ReadingError(`Clef's likeliest answer to ${id} is "${key}", which was not asked`)
  return key
}

const noulOf = (response: ClefResponse, id: PassOneId): number => {
  const answer = answerTo(response, id)
  if (answer.type !== "noul") throw wrongType(id, "noul", answer)
  return probabilityOf(id, answer.noul)
}

const choiceOf = <K extends string>(response: ClefResponse, id: PassOneId, isKey: IsKey<K>): Chosen<K> => {
  const answer = answerTo(response, id)
  if (answer.type !== "choice") throw wrongType(id, "choice", answer)
  const key = likeliestKey(id, answer.probabilities, isKey)
  return { key, confidence: percentOf(probabilityOf(id, answer.confidence)) }
}

const teamOf = (response: ClefResponse, id: PassOneId): TeamReading => {
  const { key, confidence } = choiceOf(response, id, isSide)
  return { team: key, confidence }
}

const shotsOf = (response: ClefResponse, id: PassOneId): ShotsReading => {
  const answer = answerTo(response, id)
  if (answer.type !== "score") throw wrongType(id, "score", answer)
  const level = likeliestKey(id, answer.probabilities, isShotLevel)
  return { count: Number(level), confidence: percentOf(probabilityOf(id, answer.confidence)) }
}

export const readPassOne = (response: ClefResponse): PassOneReading => {
  const gameState = choiceOf(response, "game_state", isGameState)
  const infraction = choiceOf(response, "infraction", isInfraction)
  const penaltyClass = choiceOf(response, "penalty_class", isPenaltyClass)
  return {
    gameState: { state: gameState.key, confidence: gameState.confidence },
    goal: noulOf(response, "goal"),
    goalTeam: teamOf(response, "goal_team"),
    penalty: noulOf(response, "penalty"),
    penaltyTeam: teamOf(response, "penalty_team"),
    infraction: { id: infraction.key, confidence: infraction.confidence },
    penaltyClass: { id: penaltyClass.key, confidence: penaltyClass.confidence },
    shotsHome: shotsOf(response, "shots_home"),
    shotsAway: shotsOf(response, "shots_away"),
    goalieChange: noulOf(response, "goalie_change"),
    goalieChangeTeam: teamOf(response, "goalie_change_team"),
  }
}
