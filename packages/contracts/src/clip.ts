import { Schema } from "effect"

export const GameState = Schema.Literals(["live", "stoppage", "intermission", "warmup", "empty"])
export type GameState = typeof GameState.Type

export const Rendition = Schema.Literals(["model-480", "model-720", "view"])
export type Rendition = typeof Rendition.Type

export const Clip = Schema.Struct({
  index: Schema.Int,
  startMs: Schema.Int,
  durationMs: Schema.Int,
  renditions: Schema.Array(Rendition),
  state: Schema.NullOr(GameState),
  stateConfidence: Schema.NullOr(Schema.Int),
  classification: Schema.Literals(["pending", "done", "failed"]),
})
export type Clip = typeof Clip.Type
