/**
 * Ingest: a game's source is probed within the request, so the answer already carries the duration (or the failure).
 * Each probe is an attempt recorded under `probe` in DO KV with an alarm at its deadline: a probe that hangs, or dies
 * with an evicted DO, is failed by the alarm, and only the attempt still recorded may settle the game, so a late probe
 * never overwrites a newer source or a timed-out game. Setting a source forgets everything a previous attempt
 * recorded (clips, events, answers, cached thumbnails), so a game re-sourced after a failed slice starts clean.
 * Starting queues every range and returns while the ranges slice in the background, six at a time (see ranges.ts).
 */
import { type Clip, type Crop, type Game, type GameStatus, InvalidInput, NotFound } from "@strix/contracts"
import { rangesFor } from "@strix/domain"
import type { Env } from "../env.ts"
import { messageOf } from "../logs.ts"
import type { Urls } from "../r2/presign.ts"
import type { Slicer } from "../slicer/slicer.ts"
import type { Publish } from "./publish.ts"
import { queueRanges, runRanges, SLICING_CHECK_MS } from "./ranges.ts"
import { changeGame, forgetClips, readGame } from "./store.ts"

export interface ActiveJob {
  readonly slot: number
  readonly attempt: number
}

export interface IngestDeps {
  readonly ctx: DurableObjectState
  readonly env: Env
  readonly gameId: string
  readonly publish: Publish
  readonly slicer: (slot: number) => Promise<Slicer>
  readonly urls: Urls
  readonly clipReady: (clip: Clip) => Promise<void>
  readonly active: Map<number, ActiveJob>
}

export interface ProbeAttempt {
  readonly id: string
  readonly probingSince: number
}

export const PROBE_KEY = "probe"
export const PROBE_TIMEOUT_MS = 5 * 60_000
export const PROBE_TIMED_OUT = "probe timed out"

const PROBE_FRAME_AT_MS = 300_000

const SOURCE_SETTABLE: ReadonlySet<GameStatus> = new Set(["created", "probing", "failed"])

const thumbsPrefix = (gameId: string): string => `thumbs/${gameId}/`

export const probeKey = (gameId: string): string => `${thumbsPrefix(gameId)}probe.jpg`

const clearPrefix = async (bucket: R2Bucket, prefix: string): Promise<void> => {
  const listed = await bucket.list({ prefix })
  if (listed.objects.length === 0) return
  await bucket.delete(listed.objects.map((object) => object.key))
  if (listed.truncated) await clearPrefix(bucket, prefix)
}

const forgetAttempt = async (deps: IngestDeps): Promise<void> => {
  forgetClips(deps.ctx.storage.sql)
  await clearPrefix(deps.env.BUCKET, thumbsPrefix(deps.gameId))
}

const invalid = (path: string) => new InvalidInput({ fieldErrors: [{ path, issue: "invalid" }] })

const isWebUrl = (url: string): boolean => {
  const protocol = URL.parse(url)?.protocol
  return protocol === "http:" || protocol === "https:"
}

const existingGame = (sql: SqlStorage): Game => {
  const game = readGame(sql)
  if (game === undefined) throw new NotFound()
  return game
}

export const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

const isCurrent = (storage: DurableObjectStorage, attempt: ProbeAttempt): boolean =>
  readGame(storage.sql)?.status === "probing" && storage.kv.get<ProbeAttempt>(PROBE_KEY)?.id === attempt.id

const settleProbe = (storage: DurableObjectStorage, attempt: ProbeAttempt, change: (game: Game) => Game): Game => {
  if (!isCurrent(storage, attempt)) return existingGame(storage.sql)
  storage.kv.delete(PROBE_KEY)
  return changeGame(storage.sql, change)
}

const probe = async (deps: IngestDeps, source: string, attempt: ProbeAttempt): Promise<Game> => {
  const { storage } = deps.ctx
  try {
    const result = await (await deps.slicer(0)).probe({ source, frameAtMs: PROBE_FRAME_AT_MS })
    if (!isCurrent(storage, attempt)) return existingGame(storage.sql)
    await deps.env.BUCKET.put(probeKey(deps.gameId), bytesOf(result.frameJpegBase64), {
      httpMetadata: { contentType: "image/jpeg" },
    })
    return settleProbe(storage, attempt, (game) => ({ ...game, status: "created", durationMs: result.durationMs }))
  } catch (cause) {
    return settleProbe(storage, attempt, (game) => ({ ...game, status: "failed", failure: messageOf(cause) }))
  }
}

export const setSource = async (deps: IngestDeps, url: string): Promise<Game> => {
  if (!isWebUrl(url)) throw invalid("url")
  const { storage } = deps.ctx
  if (!SOURCE_SETTABLE.has(existingGame(storage.sql).status)) throw invalid("status")
  await forgetAttempt(deps)
  const attempt: ProbeAttempt = { id: crypto.randomUUID(), probingSince: Date.now() }
  storage.kv.put(PROBE_KEY, attempt)
  changeGame(storage.sql, (game) => ({
    ...game,
    status: "probing",
    failure: null,
    source: { kind: "url", url },
    durationMs: null,
  }))
  await storage.setAlarm(attempt.probingSince + PROBE_TIMEOUT_MS)
  await deps.publish(["game", "clips", "events"])
  const probed = await probe(deps, url, attempt)
  await deps.publish(["game"])
  return probed
}

export const checkProbe = async (deps: IngestDeps): Promise<void> => {
  const { storage } = deps.ctx
  if (readGame(storage.sql)?.status !== "probing") return
  const attempt = storage.kv.get<ProbeAttempt>(PROBE_KEY)
  if (attempt !== undefined && Date.now() - attempt.probingSince < PROBE_TIMEOUT_MS) {
    await storage.setAlarm(attempt.probingSince + PROBE_TIMEOUT_MS)
    return
  }
  storage.kv.delete(PROBE_KEY)
  changeGame(storage.sql, (game) => ({ ...game, status: "failed", failure: PROBE_TIMED_OUT }))
  await deps.publish(["game"])
}

export const start = async (deps: IngestDeps, crop: Crop | null): Promise<Game> => {
  const { storage } = deps.ctx
  const game = existingGame(storage.sql)
  if (game.status !== "created" || game.durationMs === null || game.source === null) throw invalid("status")
  const ranges = rangesFor(game.durationMs)
  if (ranges.length === 0) throw invalid("durationMs")
  queueRanges(storage, ranges.length, Date.now())
  const slicing = changeGame(storage.sql, (current) => ({ ...current, status: "slicing", failure: null, crop }))
  await storage.setAlarm(Date.now() + SLICING_CHECK_MS)
  const announced = deps.publish(["game"])
  deps.ctx.waitUntil(runRanges(deps, ranges))
  await announced
  return slicing
}
