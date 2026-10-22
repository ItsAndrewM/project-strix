import type { Clip, Game, GameEvent } from "@strix/contracts"
import { createExecutionContext, createMessageBatch, env, getQueueResult, runInDurableObject } from "cloudflare:test"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_CLIP_BYTES } from "../src/classify/consumer.ts"
import type { ClassifyJob } from "../src/classify/jobs.ts"
import { readAnswers } from "../src/game/store.ts"
import worker from "../src/index.ts"
import { applySchema, asDev, clearGames, NEW_GAME, postJson, SENT } from "./games.ts"

const SOURCE_URL = "https://video.example.test/game.mp4"

const gameOf = async (id: string): Promise<Game> => (await asDev(`/api/games/${id}`)).json()

const clipsOf = async (id: string): Promise<ReadonlyArray<Clip>> => (await asDev(`/api/games/${id}/clips`)).json()

const eventsOf = async (id: string): Promise<ReadonlyArray<GameEvent>> =>
  (await asDev(`/api/games/${id}/events`)).json()

const clipKey = (id: string, index: number) => `clips/${id}/${index}/model-480.mp4`

const startedAutoGame = async (): Promise<{ id: string; jobs: ReadonlyArray<ClassifyJob> }> => {
  const created = await postJson("/api/games", { ...NEW_GAME, mode: "auto" })
  const { id }: { id: string } = await created.json()
  expect((await postJson(`/api/games/${id}/source`, { url: SOURCE_URL })).status).toBe(200)
  const sends = vi.spyOn(env.CLASSIFY, "send").mockResolvedValue(SENT)
  expect((await postJson(`/api/games/${id}/start`, { crop: null })).status).toBe(200)
  await vi.waitFor(async () => expect((await gameOf(id)).status).toBe("classifying"), { timeout: 10_000, interval: 25 })
  return { id, jobs: sends.mock.calls.map(([job]) => job) }
}

const consumed = async (jobs: ReadonlyArray<ClassifyJob>, attempts = 1) => {
  const batch = createMessageBatch<ClassifyJob>(
    "strix-classify",
    jobs.map((body, index) => ({ id: `message-${index}`, timestamp: new Date(), attempts, body })),
  )
  await worker.queue(batch, env)
  return getQueueResult(batch, createExecutionContext())
}

const classificationsOf = async (id: string) =>
  (await clipsOf(id)).map(({ classification, state, stateConfidence }) => ({ classification, state, stateConfidence }))

const answersTo = (id: string, clipIndex: number) =>
  runInDurableObject(env.GAME.getByName(id), (_instance, state) => readAnswers(state.storage.sql, clipIndex))

beforeAll(async () => {
  await applySchema(env.DB)
})

beforeEach(async () => {
  await clearGames(env.DB)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the classify queue consumer", () => {
  it("classifies every clip, derives and merges the events and readies the game", async () => {
    const { id, jobs } = await startedAutoGame()
    expect(jobs).toEqual([0, 1, 2].map((clipIndex) => ({ gameId: id, clipIndex, pass: 1 })))

    const result = await consumed(jobs)

    expect(result.explicitAcks.toSorted()).toEqual(["message-0", "message-1", "message-2"])
    expect(result.retryMessages).toEqual([])
    expect(await classificationsOf(id)).toEqual([
      { classification: "done", state: "live", stateConfidence: 90 },
      { classification: "done", state: "live", stateConfidence: 86 },
      { classification: "done", state: "live", stateConfidence: 62 },
    ])
    const events = await eventsOf(id)
    expect(events.map(({ type, status, clipIndex, team }) => ({ type, status, clipIndex, team }))).toEqual([
      { type: "goal", status: "auto", clipIndex: 0, team: "away" },
      { type: "penalty", status: "discarded", clipIndex: 2, team: "home" },
    ])
    expect(await gameOf(id)).toMatchObject({
      status: "ready",
      counts: { clips: 3, classified: 3, events: 1, drafts: 0 },
    })
  })

  it("fails a clip over 14 MiB without sending it to Clef", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { id, jobs } = await startedAutoGame()
    await env.BUCKET.put(clipKey(id, 0), new Uint8Array(15 * 1024 * 1024))

    const result = await consumed(jobs)

    expect(result.explicitAcks.toSorted()).toEqual(["message-0", "message-1", "message-2"])
    expect((await classificationsOf(id)).map(({ classification }) => classification)).toEqual([
      "failed",
      "done",
      "done",
    ])
    expect(await answersTo(id, 0)).toEqual([])
    expect(consoleError).toHaveBeenCalledWith({
      event: "classification-failed",
      gameId: id,
      clipIndex: 0,
      reason: "clip over 14 MiB",
    })
    expect(await gameOf(id)).toMatchObject({ status: "ready", counts: { classified: 2 } })
  })

  it("sends a clip of exactly 14 MiB", async () => {
    const { id, jobs } = await startedAutoGame()
    await env.BUCKET.put(clipKey(id, 0), new Uint8Array(MAX_CLIP_BYTES))

    await consumed(jobs.slice(0, 1))

    expect((await clipsOf(id))[0]?.classification).toBe("done")
    expect(await answersTo(id, 0)).toHaveLength(1)
  })

  it("fails a clip missing from storage", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { id, jobs } = await startedAutoGame()
    await env.BUCKET.delete(clipKey(id, 1))

    const result = await consumed(jobs.slice(1, 2))

    expect(result.explicitAcks).toEqual(["message-0"])
    expect((await clipsOf(id))[1]?.classification).toBe("failed")
    expect(consoleError).toHaveBeenCalledWith({
      event: "classification-failed",
      gameId: id,
      clipIndex: 1,
      reason: "clip missing from storage",
    })
  })

  it("retries a job that throws before its third attempt, leaving the clip pending", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { id, jobs } = await startedAutoGame()
    vi.spyOn(env.BUCKET, "get").mockRejectedValue(new Error("r2 unavailable"))

    const result = await consumed(jobs.slice(0, 1), 2)

    expect(result.explicitAcks).toEqual([])
    expect(result.retryMessages).toEqual([{ msgId: "message-0" }])
    expect((await clipsOf(id))[0]?.classification).toBe("pending")
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "classify-failed",
      gameId: id,
      clipIndex: 0,
      attempts: 2,
      cause: "r2 unavailable",
    })
  })

  it("fails the clip and acks on the third failed attempt", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { id, jobs } = await startedAutoGame()
    vi.spyOn(env.BUCKET, "get").mockRejectedValue(new Error("r2 unavailable"))

    const result = await consumed(jobs.slice(0, 1), 3)

    expect(result.explicitAcks).toEqual(["message-0"])
    expect(result.retryMessages).toEqual([])
    expect((await clipsOf(id))[0]?.classification).toBe("failed")
    expect(consoleError).toHaveBeenCalledWith({
      event: "classify-failed",
      gameId: id,
      clipIndex: 0,
      attempts: 3,
      cause: "r2 unavailable",
    })
    expect(consoleError).toHaveBeenCalledWith({
      event: "classification-failed",
      gameId: id,
      clipIndex: 0,
      reason: "r2 unavailable",
    })
  })
})
