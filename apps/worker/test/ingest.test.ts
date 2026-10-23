import { type Clip, type Crop, type Game, socketPath } from "@strix/contracts"
import { rangesFor, windowsFor } from "@strix/domain"
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { GameDO } from "../src/game/game-do.ts"
import { type IngestDeps, PROBE_KEY, PROBE_TIMED_OUT, PROBE_TIMEOUT_MS, setSource } from "../src/game/ingest.ts"
import { NO_CAPACITY, NO_CLIPS, type Ranges, RANGE_TIMED_OUT, RANGE_TIMEOUT_MS } from "../src/game/progress.ts"
import { checkRanges, queueRanges, runRanges } from "../src/game/ranges.ts"
import { readGame, saveClip, saveGame } from "../src/game/store.ts"
import { listGames } from "../src/games-index/games-index.ts"
import { urlsFor } from "../src/r2/presign.ts"
import { fixtureSlicer } from "../src/slicer/fixture-slicer.ts"
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

const unsliced = ({ index, startMs, durationMs }: { index: number; startMs: number; durationMs: number }): Clip => ({
  index,
  startMs,
  durationMs,
  renditions: [],
  state: null,
  stateConfidence: null,
  classification: "failed",
})

const depsWith = (instance: GameDO, state: DurableObjectState, gameId: string, slicer: Slicer): IngestDeps => ({
  ctx: state,
  env,
  gameId,
  publish: async () => undefined,
  slicer: async () => slicer,
  urls: urlsFor(env),
  clipReady: (clip) => instance.clipReady(clip),
  active: instance.active,
})

const queuedAgain = (id: string, attempts: number) =>
  vi.waitFor(async () => expect(await rangesOf(id)).toMatchObject({ 0: { status: "queued", attempts } }), {
    timeout: 10_000,
    interval: 25,
  })

const checkedBy = (id: string, slicer: Slicer): Promise<void> =>
  runInDurableObject(env.GAME.getByName(id), (instance, state) => checkRanges(depsWith(instance, state, id, slicer)))

const slicedBy = async (id: string, slicer: Slicer): Promise<void> => {
  await runInDurableObject(env.GAME.getByName(id), async (instance, state) => {
    const game = readGame(state.storage.sql)
    if (game === undefined) throw new Error("the game was not created")
    saveGame(state.storage.sql, { ...game, status: "slicing" })
    queueRanges(state.storage, 1, Date.now())
    await runRanges(depsWith(instance, state, id, slicer), rangesFor(FIXTURE_DURATION_MS))
  })
}

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
    expect(response.headers.get("cache-control")).toBe("private, no-store")
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
    await vi.waitFor(() => expect(messages).toEqual([changed("game", "clips", "events"), changed("game")]))
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
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number), attempts: 1 } })
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

  it("hands a range whose job dies back to the queue, keeping the clips it recorded", async () => {
    flags({ FIXTURES_FAIL_SLICE_AFTER: "1" })
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { id, sends } = await started()
    await queuedAgain(id, 1)

    expect(await gameOf(id)).toMatchObject({ status: "slicing", failure: null, counts: { clips: 1 } })
    expect((await clipsOf(id)).map((clip) => [clip.index, clip.classification])).toEqual([[0, "pending"]])
    expect(sends).toHaveBeenCalledExactlyOnceWith({ gameId: id, clipIndex: 0, pass: 1 })
    expect(consoleWarn).toHaveBeenCalledExactlyOnceWith({
      event: "range-retried",
      gameId: id,
      rangeIndex: 0,
      attempt: 1,
      cause: "fixture slice failed after 1 clips",
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("resumes the retried range from the windows without a clip until it completes", async () => {
    flags({ FIXTURES_FAIL_SLICE_AFTER: "1" })
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { id, sends } = await started()
    await queuedAgain(id, 1)
    await runDurableObjectAlarm(env.GAME.getByName(id))
    await queuedAgain(id, 2)
    await runDurableObjectAlarm(env.GAME.getByName(id))
    const game = await settled(id)

    expect(game).toMatchObject({ status: "classifying", failure: null, counts: { clips: FIXTURE_WINDOWS.length } })
    expect((await clipsOf(id)).map((clip) => clip.classification)).toEqual(FIXTURE_WINDOWS.map(() => "pending"))
    expect(sends.mock.calls.map(([job]) => job.clipIndex)).toEqual([0, 1, 2])
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number), attempts: 3 } })
  })

  it("fails the game when every job of every range dies before recording a clip", async () => {
    flags({ FIXTURES_FAIL_SLICE_AFTER: "0" })
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { id } = await started()
    await queuedAgain(id, 1)
    await runDurableObjectAlarm(env.GAME.getByName(id))
    await queuedAgain(id, 2)
    await runDurableObjectAlarm(env.GAME.getByName(id))
    const game = await settled(id)

    expect(game).toMatchObject({ status: "failed", failure: NO_CLIPS, counts: { clips: FIXTURE_WINDOWS.length } })
    expect(await clipsOf(id)).toEqual(FIXTURE_WINDOWS.map(unsliced))
    expect(await rangesOf(id)).toMatchObject({ 0: { status: "failed", attempts: 3 } })
    expect(await indexedGame(id)).toMatchObject({ status: "failed" })
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "range-failed",
      gameId: id,
      rangeIndex: 0,
      cause: "fixture slice failed after 0 clips",
    })
  })

  it("answers 400 to a crop with no width", async () => {
    const id = await probed()
    const response = await postJson(`/api/games/${id}/start`, { crop: { x: 0, y: 0, width: 0, height: 60 } })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ _tag: "InvalidInput" })
    expect(await gameOf(id)).toMatchObject({ status: "created" })
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

  it("fails a range quiet for 30 minutes once its attempts are spent, records its unsliced windows and settles on its clips", async () => {
    const stalled = Date.now() - RANGE_TIMEOUT_MS - 1_000
    const id = await slicing({ 0: { status: "running", startedAt: stalled, attempts: 3 } }, 1)

    expect(await runDurableObjectAlarm(env.GAME.getByName(id))).toBe(true)
    expect(await rangesOf(id)).toEqual({
      0: { status: "failed", startedAt: stalled, attempts: 3, reason: RANGE_TIMED_OUT },
    })
    expect((await clipsOf(id)).slice(1)).toEqual(FIXTURE_WINDOWS.slice(1).map(unsliced))
    const failure = "2 windows could not be sliced"
    expect(await gameOf(id)).toMatchObject({ status: "classifying", failure, counts: { clips: 3 } })
    expect(await indexedGame(id)).toMatchObject({ status: "classifying", failure })
    expect(await alarmOf(id)).toBeNull()
  })

  it("fails the game when the stalled range leaves no clips", async () => {
    const stalled = Date.now() - RANGE_TIMEOUT_MS - 1_000
    const id = await slicing({ 0: { status: "running", startedAt: stalled, attempts: 3 } }, 0)

    await runDurableObjectAlarm(env.GAME.getByName(id))
    expect(await gameOf(id)).toMatchObject({ status: "failed", failure: NO_CLIPS })
  })

  it("retries a range quiet for 30 minutes while attempts remain, from the windows without a clip", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const sends = spySends()
    const stalled = Date.now() - RANGE_TIMEOUT_MS - 1_000
    const id = await slicing({ 0: { status: "running", startedAt: stalled, attempts: 1 } }, 1)

    await runDurableObjectAlarm(env.GAME.getByName(id))
    const game = await settled(id)

    expect(game).toMatchObject({ status: "classifying", failure: null, counts: { clips: FIXTURE_WINDOWS.length } })
    expect(sends.mock.calls.map(([job]) => job.clipIndex)).toEqual([1, 2])
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number), attempts: 2 } })
    expect(consoleWarn).toHaveBeenCalledWith({
      event: "range-retried",
      gameId: id,
      rangeIndex: 0,
      attempt: 1,
      cause: RANGE_TIMED_OUT,
    })
  })

  it("decides what to resume from a read taken after the unsliced windows are recorded", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const stalled = Date.now() - RANGE_TIMEOUT_MS - 1_000
    const id = await slicing(
      { 0: { status: "running", startedAt: stalled, attempts: 3 }, 1: { status: "queued", startedAt: Date.now() } },
      0,
    )
    await runInDurableObject(env.GAME.getByName(id), async (instance, state) => {
      const game = readGame(state.storage.sql)
      if (game === undefined) throw new Error("the game was not created")
      saveGame(state.storage.sql, { ...game, durationMs: 2 * 600_000 })
      const claim = () => {
        const current = state.storage.kv.get<Ranges>("ranges") ?? {}
        state.storage.kv.put("ranges", { ...current, 1: { status: "running", startedAt: Date.now(), attempts: 1 } })
        instance.active.set(1, 0)
      }
      const deps: IngestDeps = {
        ...depsWith(instance, state, id, fixtureSlicer(env.BUCKET)),
        publish: async () => claim(),
      }
      await checkRanges(deps)
    })

    expect(await rangesOf(id)).toMatchObject({ 0: { status: "failed" }, 1: { status: "running", attempts: 1 } })
    expect(consoleWarn).not.toHaveBeenCalledWith(expect.objectContaining({ event: "range-resumed", rangeIndex: 1 }))
  })

  it("ignores what a job reports once the alarm has given its range to a new job", async () => {
    const id = await probed()
    const sends = spySends()
    await runInDurableObject(env.GAME.getByName(id), async (instance, state) => {
      const game = readGame(state.storage.sql)
      if (game === undefined) throw new Error("the game was not created")
      saveGame(state.storage.sql, { ...game, status: "slicing" })
      queueRanges(state.storage, 1, Date.now())
      const fixture = fixtureSlicer(env.BUCKET)
      const overtaken: Slicer = {
        probe: (req) => fixture.probe(req),
        slice: async (req, onProgress) => {
          const ranges = state.storage.kv.get<Ranges>("ranges") ?? {}
          state.storage.kv.put("ranges", { ...ranges, 0: { status: "running", startedAt: Date.now(), attempts: 2 } })
          await fixture.slice(req, onProgress)
        },
      }
      await runRanges(depsWith(instance, state, id, overtaken), rangesFor(FIXTURE_DURATION_MS))
    })

    expect(sends).not.toHaveBeenCalled()
    expect(await rangesOf(id)).toMatchObject({ 0: { status: "running", attempts: 2 } })
  })

  it("keeps slicing and re-arms while a range's job is still active in this instance", async () => {
    const id = await slicing({ 0: { status: "running", startedAt: Date.now() } }, 0)
    const sends = spySends()
    await runInDurableObject(env.GAME.getByName(id), (instance) => instance.active.set(0, 0))

    await runDurableObjectAlarm(env.GAME.getByName(id))
    expect(await gameOf(id)).toMatchObject({ status: "slicing" })
    expect(await rangesOf(id)).toMatchObject({ 0: { status: "running" } })
    expect(sends).not.toHaveBeenCalled()
    expect(await alarmOf(id)).not.toBeNull()
    await runInDurableObject(env.GAME.getByName(id), (instance) => instance.active.delete(0))
  })

  it("resumes a running range whose job was lost with the instance, slicing only the windows it had not recorded", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const sends = spySends()
    const id = await slicing({ 0: { status: "running", startedAt: Date.now() - 60_000 } }, 1)

    await runDurableObjectAlarm(env.GAME.getByName(id))
    const game = await settled(id)

    expect(game).toMatchObject({ status: "classifying", failure: null, counts: { clips: FIXTURE_WINDOWS.length } })
    expect((await clipsOf(id)).map((clip) => [clip.index, clip.classification, clip.renditions.length])).toEqual(
      FIXTURE_WINDOWS.map(({ index }) => [index, "pending", 3]),
    )
    expect(sends.mock.calls.map(([job]) => job.clipIndex)).toEqual([1, 2])
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number), attempts: 1 } })
    expect(consoleWarn).toHaveBeenCalledExactlyOnceWith({
      event: "range-resumed",
      gameId: id,
      rangeIndex: 0,
      windows: 2,
    })
  })

  it("resumes the queued ranges once nothing is active", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const sends = spySends()
    const id = await slicing({ 0: { status: "queued", startedAt: Date.now() - RANGE_TIMEOUT_MS * 2 } }, 0)

    await runDurableObjectAlarm(env.GAME.getByName(id))
    const game = await settled(id)

    expect(game).toMatchObject({ status: "classifying", failure: null, counts: { clips: FIXTURE_WINDOWS.length } })
    expect(sends).toHaveBeenCalledTimes(FIXTURE_WINDOWS.length)
  })

  it("marks a resumed range done without a slicer when every window already has its clip", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const sends = spySends()
    const id = await slicing({ 0: { status: "running", startedAt: Date.now() } }, FIXTURE_WINDOWS.length)

    await runDurableObjectAlarm(env.GAME.getByName(id))
    const game = await settled(id)

    expect(game).toMatchObject({ status: "classifying", failure: null })
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number), attempts: 1 } })
    expect(sends).not.toHaveBeenCalled()
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
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number), attempts: 1 } })
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "enqueue-failed",
      gameId: id,
      clipIndex: 0,
      cause: "queue unavailable",
    })
  })
})

describe("a window the slicer could not cut", () => {
  it("is logged with the slicer's reason and recorded as an unsliced clip", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    spySends()
    const id = await probed()
    const fixture = fixtureSlicer(env.BUCKET)
    const skipsTheMiddle: Slicer = {
      probe: () => Promise.reject(new Error("not probed here")),
      async slice(req, onProgress) {
        const [first, middle, last] = req.windows
        if (first === undefined || middle === undefined || last === undefined) throw new Error("expected 3 windows")
        await fixture.slice({ ...req, windows: [first] }, async (progress) => {
          if (progress.kind !== "done") await onProgress(progress)
        })
        await onProgress({ kind: "failed", index: middle.index, reason: "encoder exited with 1" })
        await fixture.slice({ ...req, windows: [last] }, onProgress)
      },
    }
    await slicedBy(id, skipsTheMiddle)

    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "window-failed",
      gameId: id,
      index: 1,
      reason: "encoder exited with 1",
    })
    expect(await rangesOf(id)).toEqual({ 0: { status: "done", startedAt: expect.any(Number), attempts: 1 } })
    const clips = await clipsOf(id)
    expect(clips.map((clip) => [clip.index, clip.classification])).toEqual([
      [0, "pending"],
      [1, "failed"],
      [2, "pending"],
    ])
    expect(clips[1]).toEqual(unsliced({ index: 1, startMs: 25_000, durationMs: 30_000 }))
    expect(await gameOf(id)).toMatchObject({ status: "classifying", failure: "1 window could not be sliced" })
  })
})

describe("the slicer slots", () => {
  const EIGHT_RANGES_MS = 8 * 600_000

  it("send a later range to the slot its predecessor freed, never asking for a seventh container", async () => {
    const id = await probed()
    const slots: number[] = []
    const done: Slicer = {
      probe: () => Promise.reject(new Error("not probed here")),
      slice: (_req, onProgress) => onProgress({ kind: "done" }),
    }
    await runInDurableObject(env.GAME.getByName(id), async (instance, state) => {
      const game = readGame(state.storage.sql)
      if (game === undefined) throw new Error("the game was not created")
      saveGame(state.storage.sql, { ...game, status: "slicing", durationMs: EIGHT_RANGES_MS })
      queueRanges(state.storage, 8, Date.now())
      const deps: IngestDeps = {
        ...depsWith(instance, state, id, done),
        slicer: async (slot) => {
          slots.push(slot)
          return done
        },
      }
      await runRanges(deps, rangesFor(EIGHT_RANGES_MS))
    })

    expect(slots).toHaveLength(8)
    expect(Math.max(...slots)).toBeLessThan(6)
    expect(Object.values((await rangesOf(id)) ?? {}).map((record) => record.status)).toEqual(Array(8).fill("done"))
  })

  it("touch the range's progress with every window the job reports", async () => {
    const id = await probed()
    const seen: Array<number | undefined> = []
    await runInDurableObject(env.GAME.getByName(id), async (instance, state) => {
      const game = readGame(state.storage.sql)
      if (game === undefined) throw new Error("the game was not created")
      saveGame(state.storage.sql, { ...game, status: "slicing" })
      queueRanges(state.storage, 1, Date.now())
      const reporting: Slicer = {
        probe: () => Promise.reject(new Error("not probed here")),
        slice: async (req, onProgress) => {
          seen.push(state.storage.kv.get<Ranges>("ranges")?.[0]?.progressAt)
          await onProgress({ kind: "failed", index: req.windows[0]?.index ?? 0, reason: "test" })
          seen.push(state.storage.kv.get<Ranges>("ranges")?.[0]?.progressAt)
          await onProgress({ kind: "done" })
        },
      }
      vi.spyOn(console, "error").mockImplementation(() => undefined)
      await runRanges(depsWith(instance, state, id, reporting), rangesFor(FIXTURE_DURATION_MS))
    })
    expect(seen[0]).toBeUndefined()
    expect(seen[1]).toEqual(expect.any(Number))
  })
})

describe("a slicer with no capacity", () => {
  const full: Slicer = {
    probe: () => Promise.reject(new Error("not probed here")),
    slice: () => Promise.reject(new Error("slicer /slice answered 503: There is no Container instance available")),
  }

  it("is retried from the alarm while attempts remain", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const id = await probed()
    await slicedBy(id, full)

    expect(await rangesOf(id)).toEqual({ 0: { status: "queued", startedAt: expect.any(Number), attempts: 1 } })
    expect(await gameOf(id)).toMatchObject({ status: "slicing", failure: null })
    expect(consoleWarn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: "range-retried", attempt: 1 }))
  })

  it("fails the game asking to try again later once the attempts are spent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const id = await probed()
    await slicedBy(id, full)
    await checkedBy(id, full)
    await queuedAgain(id, 2)
    await checkedBy(id, full)
    const game = await settled(id)

    expect(await rangesOf(id)).toMatchObject({ 0: { status: "failed", attempts: 3, reason: NO_CAPACITY } })
    expect(game).toMatchObject({ status: "failed", failure: "no slicer capacity: try again in a few minutes" })
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: "range-failed", gameId: id }))
  })
})

describe("a range whose job outlives the alarm", () => {
  const timedOut: Ranges = {
    0: { status: "failed", startedAt: Date.now() - RANGE_TIMEOUT_MS, reason: RANGE_TIMED_OUT },
  }

  const outlivedBy = (id: string, finish: (slicer: Slicer) => Slicer["slice"]) =>
    runInDurableObject(env.GAME.getByName(id), async (instance, state) => {
      const game = readGame(state.storage.sql)
      if (game === undefined) throw new Error("the game was not created")
      saveGame(state.storage.sql, { ...game, status: "slicing" })
      queueRanges(state.storage, 1, Date.now())
      const fixture = fixtureSlicer(env.BUCKET)
      const late: Slicer = {
        probe: (req) => fixture.probe(req),
        slice: (req, onProgress) => {
          state.storage.kv.put("ranges", timedOut)
          return finish(fixture)(req, onProgress)
        },
      }
      await runRanges(depsWith(instance, state, id, late), rangesFor(FIXTURE_DURATION_MS))
    })

  it("keeps the timed-out record and ignores the clips it reports late", async () => {
    const id = await probed()
    const sends = spySends()
    await outlivedBy(id, (fixture) => fixture.slice)

    expect(await rangesOf(id)).toEqual(timedOut)
    expect(await clipsOf(id)).toEqual([])
    expect(sends).not.toHaveBeenCalled()
    expect(await gameOf(id)).toMatchObject({ status: "failed", failure: NO_CLIPS })
  })

  it("keeps the timed-out reason when the late job dies", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const id = await probed()
    await outlivedBy(id, () => () => Promise.reject(new Error("container evicted")))

    expect(await rangesOf(id)).toEqual(timedOut)
    expect(await clipsOf(id)).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe("re-sourcing a game that failed while slicing", () => {
  it("forgets the previous attempt's clips and thumbnails, then slices the new source clean", async () => {
    flags({ FIXTURES_FAIL_SLICE_AFTER: "0" })
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { id, sends } = await started()
    await queuedAgain(id, 1)
    await runDurableObjectAlarm(env.GAME.getByName(id))
    await queuedAgain(id, 2)
    await runDurableObjectAlarm(env.GAME.getByName(id))
    expect(await settled(id)).toMatchObject({ status: "failed", counts: { clips: FIXTURE_WINDOWS.length } })
    await env.BUCKET.put(`thumbs/${id}/0.jpg`, new Uint8Array([0xff]))
    flags({ FIXTURES_FAIL_SLICE_AFTER: undefined })
    const messages = await listen(id)

    const response = await postJson(`/api/games/${id}/source`, { url: SOURCE_URL })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "created", failure: null, counts: { clips: 0 } })
    expect(await clipsOf(id)).toEqual([])
    expect(await env.BUCKET.head(`thumbs/${id}/0.jpg`)).toBeNull()
    await vi.waitFor(() => expect(messages[0]).toBe(changed("game", "clips", "events")))

    expect((await postJson(`/api/games/${id}/start`, { crop: null })).status).toBe(200)
    const game = await settled(id)
    expect(game).toMatchObject({ status: "classifying", failure: null, counts: { clips: FIXTURE_WINDOWS.length } })
    expect((await clipsOf(id)).map((clip) => clip.classification)).toEqual(FIXTURE_WINDOWS.map(() => "pending"))
    expect(sends).toHaveBeenCalledTimes(FIXTURE_WINDOWS.length)
  })
})

describe("a source shorter than one window", () => {
  const SHORT_MS = 15_300

  it("probes to created and slices into a single clip", async () => {
    const { id } = await createGame()
    const sends = spySends()
    const fixture = fixtureSlicer(env.BUCKET)
    const short: Slicer = {
      probe: async (req) => ({ ...(await fixture.probe(req)), durationMs: SHORT_MS }),
      slice: (req, onProgress) => fixture.slice(req, onProgress),
    }
    const probedGame = await runInDurableObject(env.GAME.getByName(id), (instance, state) =>
      setSource(depsWith(instance, state, id, short), SOURCE_URL),
    )
    expect(probedGame).toMatchObject({ status: "created", failure: null, durationMs: SHORT_MS })

    expect((await postJson(`/api/games/${id}/start`, { crop: null })).status).toBe(200)
    const game = await settled(id)
    expect(game).toMatchObject({ status: "classifying", failure: null, counts: { clips: 1 } })
    expect((await clipsOf(id)).map(({ index, startMs, durationMs }) => ({ index, startMs, durationMs }))).toEqual([
      { index: 0, startMs: 0, durationMs: SHORT_MS },
    ])
    expect(sends).toHaveBeenCalledExactlyOnceWith({ gameId: id, clipIndex: 0, pass: 1 })
  })
})
