import { Exit, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ClefRequest, ClefResponse } from "../src/index.ts"

const decodeResponse = Schema.decodeUnknownExit(Schema.toCodecJson(ClefResponse))
const decodeRequest = Schema.decodeUnknownExit(Schema.toCodecJson(ClefRequest))

const response = (answers: Schema.Json) => ({
  model: "clef-omni",
  answers,
  usage: { input_tokens: 1200, output_tokens: 14 },
})

describe("ClefResponse", () => {
  it("decodes the noul answer shape", () => {
    expect(Exit.isSuccess(decodeResponse(response({ goal: { type: "noul", noul: 0.5 } })))).toBe(true)
  })

  it("decodes the choice answer shape", () => {
    const choice = { type: "choice", choice: "live", probabilities: { live: 0.9, stoppage: 0.1 }, confidence: 0.9 }
    expect(Exit.isSuccess(decodeResponse(response({ state: choice })))).toBe(true)
  })

  it("decodes the score answer shape", () => {
    const score = {
      type: "score",
      score: 17,
      legend: { "17": "jersey 17" },
      probabilities: { "17": 0.7 },
      confidence: 0.7,
    }
    expect(Exit.isSuccess(decodeResponse(response({ scorer: score })))).toBe(true)
  })

  it("fails when noul is the string 0.5", () => {
    expect(Exit.isFailure(decodeResponse(response({ goal: { type: "noul", noul: "0.5" } })))).toBe(true)
  })

  it("fails on an answer with an unknown type", () => {
    expect(Exit.isFailure(decodeResponse(response({ goal: { type: "rank", rank: 1 } })))).toBe(true)
  })
})

describe("ClefRequest", () => {
  it("decodes a request with each question type and a video", () => {
    const request = {
      model: "clef-omni",
      state: { period: 2, nested: [1, null, "a"] },
      questions: {
        goal: { type: "noul", instructions: "Was a goal scored?" },
        state: { type: "choice", instructions: "Game state?", criteria: { live: "play is live" } },
        scorer: { type: "score", instructions: "Jersey number?", criteria: ["0", "1"] },
      },
      videos: [{ content_type: "video/mp4", base64: "AAAA" }],
    }
    expect(Exit.isSuccess(decodeRequest(request))).toBe(true)
  })

  it("rejects a model other than clef-omni", () => {
    expect(Exit.isFailure(decodeRequest({ model: "other", state: null, questions: {}, videos: [] }))).toBe(true)
  })
})
