import { Schema } from "effect"
import { JerseyNumber, Side } from "./game.ts"

export const EventType = Schema.Literals(["goal", "penalty", "goalie_change"])
export type EventType = typeof EventType.Type

export const EventStatus = Schema.Literals(["auto", "draft", "accepted", "rejected", "manual", "discarded"])
export type EventStatus = typeof EventStatus.Type

export const Need = Schema.Literals(["time", "scorer", "assists", "player"])
export type Need = typeof Need.Type

export const Infraction = Schema.Literals([
  "holding",
  "slashing",
  "roughing",
  "cross_checking",
  "checking_from_behind",
  "tripping",
  "hooking",
  "high_sticking",
  "interference",
  "delay_of_game",
  "too_many_men",
  "boarding",
  "elbowing",
  "unsportsmanlike",
  "other",
])
export type Infraction = typeof Infraction.Type

export const PenaltyClass = Schema.Literals(["minor", "double_minor", "major", "misconduct"])
export type PenaltyClass = typeof PenaltyClass.Type

export const PENALTY_MINUTES = {
  minor: 2,
  double_minor: 4,
  major: 5,
  misconduct: 10,
} as const satisfies Record<PenaltyClass, 2 | 4 | 5 | 10>

export const GoalAttrs = Schema.Struct({
  scorer: Schema.NullOr(JerseyNumber),
  scorerConfidence: Schema.NullOr(Schema.Int),
  assists: Schema.Array(Schema.Struct({ jersey: JerseyNumber, confidence: Schema.Int })),
})
export type GoalAttrs = typeof GoalAttrs.Type

export const PenaltyAttrs = Schema.Struct({
  infraction: Infraction,
  infractionConfidence: Schema.Int,
  class: PenaltyClass,
  classConfidence: Schema.Int,
  player: Schema.NullOr(JerseyNumber),
})
export type PenaltyAttrs = typeof PenaltyAttrs.Type

export const GoalieChangeAttrs = Schema.StructWithRest(Schema.Struct({}), [Schema.Record(Schema.String, Schema.Never)])
export type GoalieChangeAttrs = typeof GoalieChangeAttrs.Type

export const GameEvent = Schema.Struct({
  id: Schema.String,
  type: EventType,
  team: Side,
  teamConfidence: Schema.Int,
  videoMs: Schema.Int,
  precisionMs: Schema.Int,
  clipIndex: Schema.Int,
  confidence: Schema.Int,
  status: EventStatus,
  needs: Schema.Array(Need),
  period: Schema.NullOr(Schema.Int),
  clock: Schema.NullOr(Schema.String),
  attrs: Schema.Union([GoalAttrs, PenaltyAttrs, GoalieChangeAttrs]),
  createdAt: Schema.Int,
})
export type GameEvent = typeof GameEvent.Type
