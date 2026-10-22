/**
 * Ingest: a game's source is probed within the request, so the answer already carries the duration (or the failure).
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
import { changeGame, readGame } from "./store.ts"

export interface IngestDeps {
  readonly ctx: DurableObjectState
  readonly env: Env
  readonly gameId: string
  readonly publish: Publish
  readonly slicer: (rangeIndex: number) => Promise<Slicer>
  readonly urls: Urls
  readonly clipReady: (clip: Clip) => Promise<void>
}

const PROBE_FRAME_AT_MS = 300_000

const SOURCE_SETTABLE: ReadonlySet<GameStatus> = new Set(["created", "failed"])

export const probeKey = (gameId: string): string => `thumbs/${gameId}/probe.jpg`

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

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

const probe = async (deps: IngestDeps, source: string): Promise<Game> => {
  const sql = deps.ctx.storage.sql
  try {
    const result = await (await deps.slicer(0)).probe({ source, frameAtMs: PROBE_FRAME_AT_MS })
    await deps.env.BUCKET.put(probeKey(deps.gameId), bytesOf(result.frameJpegBase64), {
      httpMetadata: { contentType: "image/jpeg" },
    })
    return changeGame(sql, (game) => ({ ...game, status: "created", durationMs: result.durationMs }))
  } catch (cause) {
    return changeGame(sql, (game) => ({ ...game, status: "failed", failure: messageOf(cause) }))
  }
}

export const setSource = async (deps: IngestDeps, url: string): Promise<Game> => {
  if (!isWebUrl(url)) throw invalid("url")
  const sql = deps.ctx.storage.sql
  if (!SOURCE_SETTABLE.has(existingGame(sql).status)) throw invalid("status")
  changeGame(sql, (game) => ({
    ...game,
    status: "probing",
    failure: null,
    source: { kind: "url", url },
    durationMs: null,
  }))
  await deps.publish(["game"])
  const probed = await probe(deps, url)
  await deps.publish(["game"])
  return probed
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
