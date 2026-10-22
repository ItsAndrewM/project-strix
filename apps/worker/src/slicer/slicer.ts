import type { Env } from "../env.ts"
import { fixtureFailuresOf, fixtureSlicer } from "./fixture-slicer.ts"
import type { ProbeRequest, ProbeResult, SliceProgress, SliceRequest } from "./protocol.ts"
import { containerSlicer } from "./slicer-container.ts"

export interface Slicer {
  probe(req: ProbeRequest): Promise<ProbeResult>
  slice(req: SliceRequest, onProgress: (p: SliceProgress) => Promise<void>): Promise<void>
}

export const slicerFor = (env: Env, gameId: string, rangeIndex: number): Slicer =>
  env.FIXTURES === "1"
    ? fixtureSlicer(env.BUCKET, fixtureFailuresOf(env))
    : containerSlicer(env.SLICER, gameId, rangeIndex)
