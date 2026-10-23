import type { Clip, GameEvent } from "@strix/contracts"

export const CLIP_MS = 25_000

export const clip = (index: number, state: Clip["state"]): Clip => ({
  index,
  startMs: index * CLIP_MS,
  durationMs: CLIP_MS,
  renditions: ["model-480", "view"],
  state,
  stateConfidence: state === null ? null : 90,
  classification: state === null ? "pending" : "done",
})

export const event = (
  id: string,
  type: GameEvent["type"],
  clipIndex: number,
  status: GameEvent["status"],
): GameEvent => ({
  id,
  type,
  team: "home",
  teamConfidence: 90,
  videoMs: clipIndex * CLIP_MS + 5_000,
  precisionMs: 2_000,
  clipIndex,
  confidence: 90,
  status,
  needs: [],
  period: 1,
  clock: null,
  attrs: { scorer: null, scorerConfidence: null, assists: [] },
  createdAt: 0,
})
