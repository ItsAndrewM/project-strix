/**
 * The fixture Clef answers by clip index alone, cycling the committed answers the way the fixture slicer cycles its
 * clips (`by-clip.json` maps `index % 3` to an answer file). It never looks at the video.
 */
import { ClefResponse } from "@strix/contracts"
import { Schema } from "effect"
import byClip from "../../fixtures/answers/by-clip.json"
import goal from "../../fixtures/answers/goal.json"
import penalty from "../../fixtures/answers/penalty.json"
import quiet from "../../fixtures/answers/quiet.json"
import type { Clef } from "./clef.ts"

const ANSWERS = { "goal.json": goal, "penalty.json": penalty, "quiet.json": quiet }

const AnswerFile = Schema.Literals(["goal.json", "penalty.json", "quiet.json"])
const FILES = Schema.decodeUnknownSync(Schema.Record(Schema.String, AnswerFile))(byClip)
const CYCLE = Object.keys(FILES).length

const FixtureState = Schema.Struct({ clip: Schema.Struct({ index: Schema.Int }) })
const decodeState = Schema.decodeUnknownSync(FixtureState)
const decodeResponse = Schema.decodeUnknownSync(ClefResponse)

const answerFor = (index: number): ClefResponse => {
  const file = FILES[String(index % CYCLE)]
  if (file === undefined) throw new Error(`no fixture answer for clip ${index}`)
  return decodeResponse(ANSWERS[file])
}

export const fixtureClef = (): Clef => ({
  run: async (request) => answerFor(decodeState(request.state).clip.index),
})
