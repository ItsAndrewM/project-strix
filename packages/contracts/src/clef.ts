import { Schema } from "effect"

export const ClefQuestion = Schema.Union([
  Schema.Struct({ type: Schema.Literal("noul"), instructions: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    instructions: Schema.String,
    criteria: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    instructions: Schema.String,
    criteria: Schema.Array(Schema.String),
  }),
])
export type ClefQuestion = typeof ClefQuestion.Type

export const ClefVideo = Schema.Struct({ content_type: Schema.Literal("video/mp4"), base64: Schema.String })
export type ClefVideo = typeof ClefVideo.Type

export const ClefRequest = Schema.Struct({
  model: Schema.Literal("clef-omni"),
  state: Schema.Json,
  questions: Schema.Record(Schema.String, ClefQuestion),
  videos: Schema.Array(ClefVideo),
})
export type ClefRequest = typeof ClefRequest.Type

export const ClefAnswer = Schema.Union([
  Schema.Struct({ type: Schema.Literal("noul"), noul: Schema.Finite }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: Schema.String,
    probabilities: Schema.Record(Schema.String, Schema.Finite),
    confidence: Schema.Finite,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    score: Schema.Finite,
    legend: Schema.Record(Schema.String, Schema.String),
    probabilities: Schema.Record(Schema.String, Schema.Finite),
    confidence: Schema.Finite,
  }),
])
export type ClefAnswer = typeof ClefAnswer.Type

export const ClefResponse = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(Schema.String, ClefAnswer),
  usage: Schema.Struct({ input_tokens: Schema.Int, output_tokens: Schema.Int }),
})
export type ClefResponse = typeof ClefResponse.Type
