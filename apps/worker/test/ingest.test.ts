import { type Clip, type Crop, type Game, socketPath } from "@strix/contracts"
import { rangesFor, windowsFor } from "@strix/domain"
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { PROBE_KEY, PROBE_TIMED_OUT, PROBE_TIMEOUT_MS } from "../src/game/ingest.ts"
import { type Ranges, RANGE_TIMEOUT_MS } from "../src/game/progress.ts"
import { queueRanges, runRanges } from "../src/game/ranges.ts"
import { readGame, saveClip, saveGame } from "../src/game/store.ts"
import { listGames } from "../src/games-index/games-index.ts"
import { urlsFor } from "../src/r2/presign.ts"
import { RENDITIONS } from "../src/slicer/protocol.ts"
import type { Slicer } from "../src/slicer/slicer.ts"
import { applySchema, asDev, clearGames, createGame, ORIGIN, postJson, SENT } from "./games.ts"

const SOURCE_URL = "https://video.example.test/game.mp4"
const CROP: Crop = { x: 0, y: 40, width: 1280, height: 600 }
const FIXTURE_DURATION_MS = 75_000
const FIXTURE_WINDOWS = windowsFor(FIXTURE_DURATION_MS)

const flags = (values: { FIXTURES_FAIL_PROBE?: "1" | undefined; FIXTURES_FAIL_SLICE_AFTER?: string | undefined }) => {
  Object.assign(env, values)
}

const gameOf = async (id: string): Promise<Game> => (await asDev(`/api/games/${id}`)).json()

const clipsOf = async (id: string): Promise<ReadonlyArray<Clip>> => (await asDev(`/api/games/${id}/clips`)).json()

const indexedGame = async (id: string): Promise<Game | undefined> =>
  (await listGames(env.DB)).find((game) => game.id === id)

const rangesOf = (id: string) =>
  runInDurableObject(env.GAME.getByName(id), (_instance, state) => state.storage.kv.get<Ranges>("ranges"))

const probed = async (): Promise<string> => {
  const { id } = await createGame()
  const response = await postJson(`/api/games/${id}/source`, { url: SOURCE_URL })
  expect(response.status).toBe(200)
  return id
}

const settled = async (id: string): Promise<Game> => {
  let game = await gameOf(id)
  await vi.waitFor(
    async () => {
      game = await gameOf(id)
      expect(game.status).not.toBe("slicing")
    },
    { timeout: 10_000, interval: 25 },
  )
  return game
}

const started = async (crop: Crop | null = CROP): Promise<{ id: string; sends: ReturnType<typeof spySends> }> => {
  const id = await probed()
  const sends = spySends()
  const response = await postJson(`/api/games/${id}/start`, { crop })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ id, status: "slicing", crop })
  return { id, sends }
}

const spySends = () => vi.spyOn(env.CLASSIFY, "send").mockResolvedValue(SENT)

const listen = async (id: string): Promise<ReadonlyArray<string>> => {
  const response = await asDev(socketPath(id), { headers: { upgrade: "websocket", origin: ORIGIN } })
  const socket = response.webSocket
  if (socket === null) throw new Error("the game answered without a socket")
  socket.accept()
  const messages: Array<string> = []
  socket.addEventListener("message", (event) => {
    messages.push(String(event.data))
  })
  return messages
}

const changed = (...kinds: ReadonlyArray<string>) => JSON.stringify({ changed: kinds })

beforeAll(async () => {
  await applySchema(env.DB)
})

beforeEach(async () => {
  await clearGames(env.DB)
})

afterEach(() => {
  vi.restoreAllMocks()
  flags({ FIXTURES_FAIL_PROBE: undefined, FIXTURES_FAIL_SLICE_AFTER: undefined })
})

describe("POST /api/games/:id/source", () => {
  it("probes the source, storing its duration and the probe frame", async () => {
    const { id } = await createGame()
    const response = await postJson(`/api/games/${id}/source`, { url: SOURCE_URL })

    expect(response.status).toBe(200)
    const game: Game = await response.json()
    expect(game).toMatchObject({
      status: "created",
      failure: null,
      durationMs: FIXTURE_DURATION_MS,
      source: { kind: "url", url: SOURCE_URL },
    })
    expect(await indexedGame(id)).toMatchObject({ status: "created", durationMs: FIXTURE_DURATION_MS })
  })

  it("serves the probe frame as a private JPEG", async () => {
    const id = await probed()
    const response = await asDev(`/api/games/${id}/probe.jpg`)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600")
    const jpeg = new Uint8Array(await response.arrayBuffer())
    expect([jpeg[0], jpeg[1], jpeg.at(-2), jpeg.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9])
    expect(await env.BUCKET.head(`thumbs/${id}/probe.jpg`)).not.toBeNull()
  })

  it("answers 404 to the probe frame of a game not yet probed", async () => {
    const { id } = await createGame()
    const response = await asDev(`/api/games/${id}/probe.jpg`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ _tag: "NotFound" })
  })

  it("announces probing and then the probed game on the socket", async () => {
    const { id } = await createGame()
    const messages = await listen(id)
    await postJson(`/api/games/${id}/source`, { url: SOURCE_URL })
    await vi.waitFor(() => expect(messages).toEqual([changed("game"), changed("game")]))
  })

  it("leaves a game whose probe fails failed with the reason, never probing", async () => {
    flags({ FIXTURES_FAIL_PROBE: "1" })
    const { id } = await createGame()
    const response = await postJson(`/api/games/${id}/source`, { url: SOURCE_URL })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "failed", failure: "fixture probe failed", durationMs: null })
    expect(await gameOf(id)).toMatchObject({ status: "failed", failure: "fixture probe failed" })
    expect(await indexedGame(id)).toMatchObject({ status: "failed", failure: "fixture probe failed" })
  })

  it.each(["not a url", "ftp://video.example.test/game.mp4", "javascript:alert(1)"])(
    "answers 400 naming the url when given %s",
    async (url) => {
      const { id } = await createGame()
      const response = await postJson(`/api/games/${id}/source`, { url })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ _tag: "InvalidInput", fieldErrors: [{ path: "url", issue: "invalid" }] })
      expect(await gameOf(id)).toMatchObject({ status: "created", source: null })
    },
  )

  it("answers 404 to a game that was never created", async () => {
    const response = await postJson("/api/games/unknown/source", { url: SOURCE_URL })
    expect(response.status).toBe(404)
  })
})

describe("POST /api/games/:id/start", () => {
  it("slices every window into pending clips and queues each for classification", async () => {
    const { id, sends } = await started()
    const game = await settled(id)

    expect(game).toMatchObject({ status: "classifying", crop: CROP, counts: { clips: FIXTURE_WINDOWS.length } })
    const clips = await clipsOf(id)
    expect(clips).toEqual(
      FIXTURE_WINDOWS.map(({ index, startMs, durationMs }) => ({
        index,
        startMs,
        durationMs,
        renditions: ["model-480", "model-720", "view"],
        state: null,
        stateConfidence: null,
        classification: "pending",
      })),
    )
    expect(sends.mock.calls.map(([message]) => message)).toEqual(
      FIXTURE_WINDOWS.map(({ index }) => ({ gameId: id, clipIndex: index, pass: 1 })),
    )
    const keys = (await env.BUCKET.list({ prefix: `clips/${id}/` })).objects.map((object) => object.key).toSorted()
    expect(keys).toEqual(
      FIXTURE_WINDOWS.flatMap(({ index }) => RENDITIONS.map((rendition) => `clips/${id}/${index}/${rendition}.mp4`)),
    )
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number) } })
    expect(await indexedGame(id)).toMatchObject({ status: "classifying", counts: { clips: FIXTURE_WINDOWS.length } })
  })

  it("announces each clip and the settled game on the socket", async () => {
    const id = await probed()
    const messages = await listen(id)
    spySends()
    await postJson(`/api/games/${id}/start`, { crop: null })
    await settled(id)
    await vi.waitFor(() =>
      expect(messages).toEqual([
        changed("game"),
        ...FIXTURE_WINDOWS.map(() => changed("clips", "game")),
        changed("game"),
      ]),
    )
  })

  it("arms the progress alarm while slicing", async () => {
    const { id } = await started()
    const alarm = await runInDurableObject(env.GAME.getByName(id), (_instance, state) => state.storage.getAlarm())
    expect(alarm).toBeGreaterThan(Date.now())
    await settled(id)
  })

  it("keeps the clips recorded before a range dies and marks that range failed", async () => {
    flags({ FIXTURES_FAIL_SLICE_AFTER: "1" })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { id, sends } = await started()
    const game = await settled(id)

    expect(game).toMatchObject({ status: "classifying", failure: null, counts: { clips: 1 } })
    expect((await clipsOf(id)).map((clip) => [clip.index, clip.classification])).toEqual([[0, "pending"]])
    expect(sends).toHaveBeenCalledExactlyOnceWith({ gameId: id, clipIndex: 0, pass: 1 })
    expect(await rangesOf(id)).toEqual({ 0: { status: "failed", startedAt: expect.any(Number) } })
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "range-failed",
      gameId: id,
      rangeIndex: 0,
      cause: "fixture slice failed after 1 clips",
    })
  })

  it("fails the game when every range dies before recording a clip", async () => {
    flags({ FIXTURES_FAIL_SLICE_AFTER: "0" })
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { id } = await started()
    const game = await settled(id)

    expect(game).toMatchObject({ status: "failed", failure: expect.stringContaining("no clips"), counts: { clips: 0 } })
    expect(await indexedGame(id)).toMatchObject({ status: "failed" })
  })

  it.each([
    ["has no source", false],
    ["is already slicing", true],
  ])("answers 400 naming the status when the game %s", async (_label, startFirst) => {
    const id = startFirst ? (await started()).id : (await createGame()).id
    const response = await postJson(`/api/games/${id}/start`, { crop: null })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ _tag: "InvalidInput", fieldErrors: [{ path: "status", issue: "invalid" }] })
    if (startFirst) await settled(id)
  })

  it("answers 404 to a game that was never created", async () => {
    const response = await postJson("/api/games/unknown/start", { crop: null })
    expect(response.status).toBe(404)
  })
})

describe("the slicing alarm", () => {
  const slicing = async (ranges: Ranges, clips: number): Promise<string> => {
    const id = await probed()
    await runInDurableObject(env.GAME.getByName(id), async (_instance, state) => {
      const game = readGame(state.storage.sql)
      if (game === undefined) throw new Error("the game was not created")
      saveGame(state.storage.sql, { ...game, status: "slicing" })
      for (const window of FIXTURE_WINDOWS.slice(0, clips)) {
        saveClip(state.storage.sql, {
          ...window,
          renditions: ["model-480", "model-720", "view"],
          state: null,
          stateConfidence: null,
          classification: "pending",
        })
      }
      state.storage.kv.put("ranges", ranges)
      await state.storage.setAlarm(Date.now() + 60_000)
    })
    return id
  }

  const alarmOf = (id: string) =>
    runInDurableObject(env.GAME.getByName(id), (_instance, state) => state.storage.getAlarm())

  it("fails a range running for over 30 minutes and settles the game on its clips", async () => {
    const stalled = Date.now() - RANGE_TIMEOUT_MS - 1_000
    const id = await slicing(
      { 0: { status: "done", startedAt: stalled }, 1: { status: "running", startedAt: stalled } },
      1,
    )

    expect(await runDurableObjectAlarm(env.GAME.getByName(id))).toBe(true)
    expect(await rangesOf(id)).toEqual({
      0: { status: "done", startedAt: stalled },
      1: { status: "failed", startedAt: stalled },
    })
    expect(await gameOf(id)).toMatchObject({ status: "classifying" })
    expect(await indexedGame(id)).toMatchObject({ status: "classifying" })
    expect(await alarmOf(id)).toBeNull()
  })

  it("fails the game when the stalled range leaves no clips", async () => {
    const stalled = Date.now() - RANGE_TIMEOUT_MS - 1_000
    const id = await slicing({ 0: { status: "running", startedAt: stalled } }, 0)

    await runDurableObjectAlarm(env.GAME.getByName(id))
    expect(await gameOf(id)).toMatchObject({ status: "failed", failure: expect.stringContaining("no clips") })
  })

  it("keeps slicing and re-arms while a range is still within its time", async () => {
    const id = await slicing({ 0: { status: "running", startedAt: Date.now() } }, 0)

    await runDurableObjectAlarm(env.GAME.getByName(id))
    expect(await gameOf(id)).toMatchObject({ status: "slicing" })
    expect(await alarmOf(id)).not.toBeNull()
  })
})

describe("the probing alarm", () => {
  const probing = async (probingSince: number): Promise<string> => {
    const { id } = await createGame()
    await runInDurableObject(env.GAME.getByName(id), async (_instance, state) => {
      const game = readGame(state.storage.sql)
      if (game === undefined) throw new Error("the game was not created")
      saveGame(state.storage.sql, { ...game, status: "probing", source: { kind: "url", url: SOURCE_URL } })
      state.storage.kv.put(PROBE_KEY, { id: "stuck", probingSince })
      await state.storage.setAlarm(Date.now() + 60_000)
    })
    return id
  }

  const alarmOf = (id: string) =>
    runInDurableObject(env.GAME.getByName(id), (_instance, state) => state.storage.getAlarm())

  it("arms a deadline for the probe when the source is set", async () => {
    const before = Date.now()
    const id = await probed()
    expect(await alarmOf(id)).toBeGreaterThanOrEqual(before + PROBE_TIMEOUT_MS)
  })

  it("fails a game still probing past the deadline", async () => {
    const id = await probing(Date.now() - PROBE_TIMEOUT_MS - 1_000)

    expect(await runDurableObjectAlarm(env.GAME.getByName(id))).toBe(true)
    expect(await gameOf(id)).toMatchObject({ status: "failed", failure: PROBE_TIMED_OUT })
    expect(await indexedGame(id)).toMatchObject({ status: "failed", failure: PROBE_TIMED_OUT })
  })

  it("keeps a probe within its deadline probing and re-arms for the deadline", async () => {
    const probingSince = Date.now()
    const id = await probing(probingSince)

    await runDurableObjectAlarm(env.GAME.getByName(id))
    expect(await gameOf(id)).toMatchObject({ status: "probing" })
    expect(await alarmOf(id)).toBe(probingSince + PROBE_TIMEOUT_MS)
  })

  it("lets a game stuck probing be given its source again", async () => {
    const id = await probing(Date.now())
    const response = await postJson(`/api/games/${id}/source`, { url: SOURCE_URL })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "created", durationMs: FIXTURE_DURATION_MS })
  })
})

describe("a clip the queue refuses", () => {
  it("is marked failed while the range records and enqueues the rest", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const id = await probed()
    const sends = spySends().mockRejectedValueOnce(new Error("queue unavailable"))
    await postJson(`/api/games/${id}/start`, { crop: null })
    const game = await settled(id)

    expect(game).toMatchObject({ status: "classifying", counts: { clips: FIXTURE_WINDOWS.length } })
    expect((await clipsOf(id)).map((clip) => clip.classification)).toEqual([
      "failed",
      ...FIXTURE_WINDOWS.slice(1).map(() => "pending"),
    ])
    expect(sends).toHaveBeenCalledTimes(FIXTURE_WINDOWS.length)
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number) } })
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "enqueue-failed",
      gameId: id,
      clipIndex: 0,
      cause: "queue unavailable",
    })
  })
})

describe("a window the slicer could not cut", () => {
  it("is logged with the slicer's reason", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const id = await probed()
    const cutsNothing: Slicer = {
      probe: () => Promise.reject(new Error("not probed here")),
      async slice(_req, onProgress) {
        await onProgress({ kind: "failed", index: 1, reason: "encoder exited with 1" })
        await onProgress({ kind: "done" })
      },
    }
    await runInDurableObject(env.GAME.getByName(id), async (instance, state) => {
      const game = readGame(state.storage.sql)
      if (game === undefined) throw new Error("the game was not created")
      saveGame(state.storage.sql, { ...game, status: "slicing" })
      queueRanges(state.storage, 1, Date.now())
      await runRanges(
        {
          ctx: state,
          env,
          gameId: id,
          publish: async () => undefined,
          slicer: async () => cutsNothing,
          urls: urlsFor(env),
          clipReady: (clip) => instance.clipReady(clip),
        },
        rangesFor(FIXTURE_DURATION_MS),
      )
    })

    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "window-failed",
      gameId: id,
      index: 1,
      reason: "encoder exited with 1",
    })
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number) } })
  })
})
