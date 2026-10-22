/**
 * The fixture slicer inlines its clips, so it is imported only when the fixture environment asks for it and production
 * cold starts never parse those bytes.
 */
import type { Env } from "../env.ts"
import type { ProbeRequest, ProbeResult, SliceProgress, SliceRequest } from "./protocol.ts"
import { containerSlicer } from "./slicer-container.ts"

export interface Slicer {
  probe(req: ProbeRequest): Promise<ProbeResult>
  slice(req: SliceRequest, onProgress: (p: SliceProgress) => Promise<void>): Promise<void>
}

export const slicerFor = async (env: Env, gameId: string, rangeIndex: number): Promise<Slicer> => {
  if (env.FIXTURES !== "1") return containerSlicer(env.SLICER, gameId, rangeIndex)
  const { fixtureFailuresOf, fixtureSlicer } = await import("./fixture-slicer.ts")
  return fixtureSlicer(env.BUCKET, fixtureFailuresOf(env))
}
