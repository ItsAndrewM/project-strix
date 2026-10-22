/**
 * The Clef port. The fixture Clef inlines its answers, so it is imported only when the fixture environment asks for
 * it. Workers AI's answer is decoded before anything reads it; a response that is not a `ClefResponse` throws, which
 * the consumer treats like any other failed attempt.
 */
import { type ClefRequest, ClefResponse } from "@strix/contracts"
import { Schema } from "effect"
import type { Env } from "../env.ts"

export interface Clef {
  run(request: ClefRequest): Promise<ClefResponse>
}

export const CLEF_MODEL = "@cf/cloudflare/clef-omni"

const decodeResponse = Schema.decodeUnknownSync(ClefResponse)

export const clefFor = async (env: Env): Promise<Clef> => {
  if (env.FIXTURES !== "1") return { run: async (request) => decodeResponse(await env.AI.run(CLEF_MODEL, request)) }
  const { fixtureClef } = await import("./fixture-clef.ts")
  return fixtureClef()
}
