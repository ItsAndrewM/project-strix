import type { ClefResponse, Clip, GameEvent } from "@strix/contracts"
import { env, runInDurableObject } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import {
  countsOf,
  markClassification,
  readAnswers,
  readClip,
  readClips,
  readEvents,
  readGame,
  replaceEventsForClip,
  saveAnswer,
  saveClip,
  saveEvents,
  saveGame,
} from "../src/game/store.ts"
import { gameAt } from "./games.ts"

const inGameStorage = <R>(name: string, run: (storage: DurableObjectStorage) => R) =>
  runInDurableObject(env.GAME.getByName(name), (_instance, state) => run(state.storage))

const inGame = <R>(name: string, run: (sql: SqlStorage) => R) => inGameStorage(name, (storage) => run(storage.sql))

const clipAt = (index: number): Clip => ({
  index,
  startMs: index * 10_000,
  durationMs: 10_000,
  renditions: ["model-480", "view"],
  state: null,
  stateConfidence: null,
  classification: "pending",
})

const eventOf = (id: string, clipIndex: number, status: GameEvent["status"], needs: GameEvent["needs"]): GameEvent => ({
  id,
  type: "goal",
  team: "home",
  teamConfidence: 80,
  videoMs: clipIndex * 10_000 + 4_000,
  precisionMs: 500,
  clipIndex,
  confidence: 75,
  status,
  needs,
  period: null,
  clock: null,
  attrs: { scorer: 9, scorerConfidence: 60, assists: [{ jersey: 17, confidence: 40 }] },
  createdAt: Date.UTC(2026, 9, 21),
})

const response: ClefResponse = {
  model: "clef-omni",
  answers: { goal: { type: "noul", noul: 0.25 } },
  usage: { input_tokens: 1200, output_tokens: 30 },
}

describe("the game store", () => {
  it("round-trips the game and upserts it when saved again", async () => {
    const game = gameAt("store-game", Date.UTC(2026, 9, 21))
    const slicing = { ...game, status: "slicing" as const }
    const read = await inGame("store-game", (sql) => {
      saveGame(sql, game)
      const first = readGame(sql)
      saveGame(sql, slicing)
      return { first, second: readGame(sql) }
    })
    expect(read).toEqual({ first: game, second: slicing })
  })

  it("migrates a new game once, giving it every table", async () => {
    const { tables, applied } = await inGame("store-migrated", (sql) => ({
      tables: sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB '_cf_*' ORDER BY name",
        )
        .toArray()
        .map(({ name }) => name),
      applied: sql.exec<{ name: string }>("SELECT name FROM _migrations ORDER BY id").toArray(),
    }))
    expect(tables).toEqual(["_migrations", "answers", "clips", "events", "game"])
    expect(applied).toEqual([{ name: "0001-game" }])
  })

  it("stores the game the create RPC is given, twice without error", async () => {
    const game = gameAt("store-create", Date.UTC(2026, 9, 21))
    const stub = env.GAME.getByName("store-create")
    await stub.create(game)
    await stub.create(game)
    expect(await inGame("store-create", readGame)).toEqual(game)
  })

  it("reads no game before one is saved", async () => {
    expect(await inGame("store-empty", readGame)).toBeUndefined()
  })

  it("upserts a clip saved twice under the same index", async () => {
    const sliced: Clip = { ...clipAt(3), renditions: ["view"] }
    const { clips, clip } = await inGame("store-clips", (sql) => {
      saveClip(sql, clipAt(4))
      saveClip(sql, clipAt(3))
      saveClip(sql, sliced)
      return { clips: readClips(sql), clip: readClip(sql, 3) }
    })
    expect(clips).toEqual([sliced, clipAt(4)])
    expect(clip).toEqual(sliced)
  })

  it("marks a clip's classification and game state", async () => {
    const { marked, missing } = await inGame("store-mark", (sql) => {
      saveClip(sql, clipAt(0))
      markClassification(sql, 0, "done", "live", 92)
      return { marked: readClip(sql, 0), missing: readClip(sql, 1) }
    })
    expect(marked).toEqual({ ...clipAt(0), classification: "done", state: "live", stateConfidence: 92 })
    expect(missing).toBeUndefined()
  })

  it("appends answers and reads back only one clip's", async () => {
    const answers = await inGame("store-answers", (sql) => {
      saveAnswer(sql, 2, 1, 0, response)
      saveAnswer(sql, 2, 1, 1, response)
      saveAnswer(sql, 2, 1, 1, response)
      saveAnswer(sql, 5, 1, 0, response)
      return readAnswers(sql, 2)
    })
    expect(answers).toEqual([
      { pass: 1, window: 0, response },
      { pass: 1, window: 1, response },
      { pass: 1, window: 1, response },
    ])
  })

  it("replaces a clip's machine events but keeps the accepted one", async () => {
    const accepted = eventOf("accepted", 1, "accepted", [])
    const fresh = eventOf("fresh", 1, "draft", ["scorer"])
    const otherClip = eventOf("other", 2, "auto", [])
    const events = await inGameStorage("store-replace", (storage) => {
      saveEvents(storage.sql, [accepted, eventOf("stale", 1, "auto", []), otherClip])
      replaceEventsForClip(storage, 1, [fresh])
      return readEvents(storage.sql)
    })
    expect(events.map(({ id }) => id).toSorted()).toEqual(["accepted", "fresh", "other"])
    expect(events.find(({ id }) => id === "fresh")).toEqual(fresh)
  })

  it("reads events ordered by video time", async () => {
    const late = { ...eventOf("a-late", 0, "auto", []), videoMs: 9_000 }
    const early = { ...eventOf("b-early", 0, "auto", []), videoMs: 1_000 }
    const events = await inGame("store-order", (sql) => {
      saveEvents(sql, [late, early])
      return readEvents(sql)
    })
    expect(events).toEqual([early, late])
  })

  it("counts clips, classified clips, events, drafts and needs", async () => {
    const counts = await inGame("store-counts", (sql) => {
      saveClip(sql, clipAt(0))
      saveClip(sql, clipAt(1))
      saveClip(sql, clipAt(2))
      markClassification(sql, 0, "done", "live", 90)
      markClassification(sql, 1, "failed", null, null)
      saveEvents(sql, [eventOf("draft", 0, "draft", ["time"]), eventOf("auto", 0, "auto", [])])
      return countsOf(sql)
    })
    expect(counts).toEqual({ clips: 3, classified: 1, events: 2, drafts: 1, needs: 1 })
  })

  it("leaves discarded and rejected events out of the counts", async () => {
    const counts = await inGame("store-counts-skipped", (sql) => {
      saveEvents(sql, [eventOf("discarded", 0, "discarded", ["time"]), eventOf("rejected", 0, "rejected", ["scorer"])])
      return countsOf(sql)
    })
    expect(counts).toEqual({ clips: 0, classified: 0, events: 0, drafts: 0, needs: 0 })
  })
})
