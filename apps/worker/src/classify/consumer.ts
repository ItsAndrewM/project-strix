/**
 * The classify queue consumer. Each job sends one clip's 480p rendition to Clef and hands the answer to the game's
 * DO. A clip over `MAX_CLIP_BYTES` (Clef's request limit) or missing from R2 is failed without calling Clef. Any
 * other error retries the message; the third failed attempt fails the clip and acks, so a clip never sits pending
 * behind a job that keeps failing. If even failing the clip throws, the message retries into the dead-letter queue.
 */
import type { ClefRequest, Clip, Game } from "@strix/contracts"
import type { Env } from "../env.ts"
import { logClassifyFailure, messageOf } from "../logs.ts"
import { type Clef, clefFor } from "./clef.ts"
import type { ClassifyJob } from "./jobs.ts"
import { passOneQuestions } from "./questions.ts"

export const MAX_CLIP_BYTES = 14 * 1024 * 1024
export const MAX_ATTEMPTS = 3

const CHUNK_BYTES = 0x8000

const clipKey = (job: ClassifyJob): string => `clips/${job.gameId}/${job.clipIndex}/model-480.mp4`

export const base64Of = (bytes: Uint8Array): string => {
  const chunks: Array<string> = []
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_BYTES)))
  }
  return btoa(chunks.join(""))
}

const requestFor = (game: Game, clip: Clip, base64: string): ClefRequest => ({
  model: "clef-omni",
  state: { game: { home: game.home, away: game.away }, clip: { index: clip.index, startMs: clip.startMs } },
  questions: passOneQuestions(game.home, game.away),
  videos: [{ content_type: "video/mp4", base64 }],
})

const classify = async (job: ClassifyJob, env: Env, clef: Clef): Promise<void> => {
  const stub = env.GAME.getByName(job.gameId)
  const { game, clip } = await stub.snapshot(job.clipIndex)
  const object = await env.BUCKET.get(clipKey(job))
  if (object === null) return stub.classificationFailed(job.clipIndex, "clip missing from storage")
  if (object.size > MAX_CLIP_BYTES) {
    await object.body.cancel()
    return stub.classificationFailed(job.clipIndex, "clip over 14 MiB")
  }
  const response = await clef.run(requestFor(game, clip, base64Of(new Uint8Array(await object.arrayBuffer()))))
  return stub.answerReady(job.clipIndex, 1, 0, response)
}

const giveUp = async (message: Message<ClassifyJob>, env: Env, cause: unknown): Promise<void> => {
  const { gameId, clipIndex } = message.body
  try {
    await env.GAME.getByName(gameId).classificationFailed(clipIndex, messageOf(cause))
    message.ack()
  } catch (failure) {
    logClassifyFailure(gameId, clipIndex, message.attempts, failure)
    message.retry()
  }
}

const handle = async (message: Message<ClassifyJob>, env: Env, clef: Clef): Promise<void> => {
  try {
    await classify(message.body, env, clef)
    message.ack()
  } catch (cause) {
    logClassifyFailure(message.body.gameId, message.body.clipIndex, message.attempts, cause)
    if (message.attempts >= MAX_ATTEMPTS) await giveUp(message, env, cause)
    else message.retry()
  }
}

export const consume = async (batch: MessageBatch<ClassifyJob>, env: Env): Promise<void> => {
  const clef = await clefFor(env)
  for (const message of batch.messages) await handle(message, env, clef)
}
