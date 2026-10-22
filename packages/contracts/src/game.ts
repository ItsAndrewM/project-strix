import { Schema } from "effect"

export const Side = Schema.Literals(["home", "away"])
export type Side = typeof Side.Type

export const Mode = Schema.Literals(["auto", "review"])
export type Mode = typeof Mode.Type

export const Level = Schema.Literals(["youth-running", "youth-stop", "junior-pro"])
export type Level = typeof Level.Type

export const JerseyNumber = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99 }))
export type JerseyNumber = typeof JerseyNumber.Type

export const Team = Schema.Struct({
  name: Schema.NonEmptyString,
  jersey: Schema.NonEmptyString,
  roster: Schema.Array(JerseyNumber),
})
export type Team = typeof Team.Type

const Percent = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))

export const Thresholds = Schema.Struct({
  autoSave: Percent,
  draft: Percent,
  period: Percent,
  scorer: Percent,
  assist: Percent,
})
export type Thresholds = typeof Thresholds.Type

export const Timing = Schema.Struct({
  periodMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
  intermissionMin: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  ambiguousMin: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type Timing = typeof Timing.Type

const Pixels = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Crop = Schema.Struct({ x: Pixels, y: Pixels, width: Pixels, height: Pixels })
export type Crop = typeof Crop.Type

export const Source = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("url"), url: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("upload"), key: Schema.String }),
])
export type Source = typeof Source.Type

export const GameStatus = Schema.Literals(["created", "probing", "slicing", "classifying", "ready", "failed"])
export type GameStatus = typeof GameStatus.Type

export const GameCounts = Schema.Struct({
  clips: Schema.Int,
  classified: Schema.Int,
  events: Schema.Int,
  drafts: Schema.Int,
  needs: Schema.Int,
})
export type GameCounts = typeof GameCounts.Type

export const NewGame = Schema.Struct({
  name: Schema.NonEmptyString,
  home: Team,
  away: Team,
  mode: Mode,
  level: Level,
  thresholds: Schema.optional(Thresholds),
  timing: Schema.optional(Timing),
})
export type NewGame = typeof NewGame.Type

export const Game = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  home: Team,
  away: Team,
  mode: Mode,
  level: Level,
  thresholds: Thresholds,
  timing: Timing,
  status: GameStatus,
  failure: Schema.NullOr(Schema.String),
  crop: Schema.NullOr(Crop),
  source: Schema.NullOr(Source),
  durationMs: Schema.NullOr(Schema.Int),
  createdAt: Schema.Int,
  counts: GameCounts,
})
export type Game = typeof Game.Type

export const DEFAULT_THRESHOLDS: Thresholds = { autoSave: 80, draft: 40, period: 85, scorer: 70, assist: 50 }

export const TIMING_PRESETS = {
  "youth-running": { periodMinutes: 15, intermissionMin: 1, ambiguousMin: 0.5 },
  "youth-stop": { periodMinutes: 15, intermissionMin: 3, ambiguousMin: 1 },
  "junior-pro": { periodMinutes: 20, intermissionMin: 8, ambiguousMin: 3 },
} satisfies Record<Level, Timing>
