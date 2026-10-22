import type { Clip, Game, GameEvent } from "@strix/contracts"
import { STEP_MS, WINDOW_MS } from "@strix/domain"
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  mergedEventsOf,
  readAnswers,
  readClips,
  readEvents,
  readGame,
  saveClip,
  saveEvents,
  saveGame,
} from "../src/game/store.ts"
import { GOAL, QUIET, withoutAnswer } from "./answers.ts"
import { applySchema, gameAt } from "./games.ts"

const clipAt = (index: number): Clip => ({
  index,
  startMs: index * STEP_MS,
  durationMs: WINDOW_MS,
  renditions: ["model-480", "model-720", "view"],
  state: null,
  stateConfidence: null,
  classification: "pending",
})

const classifying = async (clipCount: number, status: Game["status"] = "classifying"): Promise<string> => {
  const id = crypto.randomUUID()
  await runInDurableObject(env.GAME.getByName(id), (_instance, state) => {
    saveGame(state.storage.sql, { ...gameAt(id, Date.now()), mode: "auto", status })
    for (let index = 0; index < clipCount; index++) saveClip(state.storage.sql, clipAt(index))
  })
  return id
}

const stored = (id: string) =>
  runInDurableObject(env.GAME.getByName(id), (_instance, state) => {
    const game = readGame(state.storage.sql)
    if (game === undefined) throw new Error("the game was not created")
    return {
      game,
      clips: readClips(state.storage.sql),
      rows: readEvents(state.storage.sql),
      events: mergedEventsOf(state.storage.sql),
      answers: readAnswers(state.storage.sql, 0),
    }
  })

const kept = (id: string, status: "accepted" | "manual", clipIndex: number): GameEvent => ({
  id,
  type: "penalty",
  team: "away",
  teamConfidence: 80,
  videoMs: clipIndex * STEP_MS,
  precisionMs: 30_000,
  clipIndex,
  confidence: 95,
  status,
  needs: [],
  period: null,
  clock: null,
  attrs: { infraction: "tripping", infractionConfidence: 90, class: "minor", classConfidence: 90, player: null },
  createdAt: Date.UTC(2026, 9, 21),
})

const answeredInOrder = async (order: ReadonlyArray<number>): Promise<string> => {
  const id = await classifying(order.length)
  for (const index of order) await env.GAME.getByName(id).answerReady(index, 1, 0, GOAL)
  return id
}

const goalsOf = (events: ReadonlyArray<GameEvent>) =>
  events
    .filter((event) => event.type === "goal")
    .map(({ clipIndex, videoMs, status }) => ({ clipIndex, videoMs, status }))

beforeAll(async () => {
  await applySchema(env.DB)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("GameDO.answerReady", () => {
  it("shows the goal two adjacent windows both saw as one event", async () => {
    const { clips, rows, events, game } = await stored(await answeredInOrder([0, 1]))

    expect(clips.map(({ classification, state, stateConfidence }) => [classification, state, stateConfidence])).toEqual(
      [
        ["done", "live", 90],
        ["done", "live", 90],
      ],
    )
    expect(rows).toHaveLength(2)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "goal", team: "away", status: "auto", clipIndex: 0, videoMs: 0 })
    expect(game).toMatchObject({ status: "ready", counts: { clips: 2, classified: 2, events: 1 } })
  })

  it.each([[[0, 1, 2]], [[0, 2, 1]], [[2, 1, 0]]])(
    "shows one goal for three consecutive windows answered in the order %j",
    async (order) => {
      const { rows, events, game } = await stored(await answeredInOrder(order))

      expect(rows).toHaveLength(3)
      expect(goalsOf(events)).toEqual([{ clipIndex: 0, videoMs: 0, status: "auto" }])
      expect(game.counts.events).toBe(1)
    },
  )

  it("keeps one goal when a clip's answer is delivered twice, leaving kept events untouched", async () => {
    const id = await classifying(2)
    const accepted = kept("accepted-penalty", "accepted", 1)
    const manual = kept("manual-penalty", "manual", 0)
    await runInDurableObject(env.GAME.getByName(id), (_instance, state) => {
      saveEvents(state.storage.sql, [accepted, manual])
    })
    const game = env.GAME.getByName(id)
    await game.answerReady(0, 1, 0, GOAL)
    await game.answerReady(1, 1, 0, GOAL)
    await game.answerReady(0, 1, 0, GOAL)

    const { rows, events } = await stored(id)
    expect(goalsOf(events)).toEqual([{ clipIndex: 0, videoMs: 0, status: "auto" }])
    expect(rows.filter((event) => event.type === "goal")).toHaveLength(2)
    expect(events.filter((event) => event.type === "penalty")).toEqual([manual, accepted])
  })

  it("fails the clip of a malformed answer, deriving no events", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const id = await classifying(1)
    await env.GAME.getByName(id).answerReady(0, 1, 0, withoutAnswer(GOAL, "goal"))

    const { clips, rows, answers, game } = await stored(id)
    expect(clips.map((clip) => clip.classification)).toEqual(["failed"])
    expect(rows).toEqual([])
    expect(answers).toHaveLength(1)
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "classification-failed",
      gameId: id,
      clipIndex: 0,
      reason: expect.stringContaining("goal"),
    })
    expect(game).toMatchObject({ status: "ready", counts: { classified: 0, events: 0 } })
  })

  it("keeps the game classifying while a clip is still pending", async () => {
    const id = await classifying(2)
    await env.GAME.getByName(id).answerReady(0, 1, 0, QUIET)

    expect((await stored(id)).game).toMatchObject({ status: "classifying", counts: { classified: 1 } })
  })

  it("does not ready a game still slicing", async () => {
    const id = await classifying(1, "slicing")
    await env.GAME.getByName(id).answerReady(0, 1, 0, QUIET)

    expect((await stored(id)).game).toMatchObject({ status: "slicing", counts: { classified: 1 } })
  })
})

describe("GameDO.classificationFailed", () => {
  it("fails the clip, logs the reason and readies the game once no clip is pending", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const id = await classifying(2)
    const game = env.GAME.getByName(id)
    await game.answerReady(0, 1, 0, QUIET)
    await game.classificationFailed(1, "clip over 14 MiB")

    const { clips, game: after } = await stored(id)
    expect(clips.map((clip) => clip.classification)).toEqual(["done", "failed"])
    expect(after.status).toBe("ready")
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "classification-failed",
      gameId: id,
      clipIndex: 1,
      reason: "clip over 14 MiB",
    })
  })
})

describe("slicing that settles after every clip is classified", () => {
  it("readies the game", async () => {
    const id = await classifying(1, "slicing")
    await env.GAME.getByName(id).answerReady(0, 1, 0, QUIET)
    await runInDurableObject(env.GAME.getByName(id), async (_instance, state) => {
      state.storage.kv.put("ranges", { 0: { status: "done", startedAt: Date.now() } })
      await state.storage.setAlarm(Date.now() + 60_000)
    })

    await runDurableObjectAlarm(env.GAME.getByName(id))
    expect((await stored(id)).game.status).toBe("ready")
  })
})
