import { type ClefResponse, type Clip, type Game, NotFound, socketPath, Unauthorized } from "@strix/contracts"
import { DurableObject } from "cloudflare:workers"
import { eventsFromPassOne } from "../classify/events-from-pass-one.ts"
import { type PassOneReading, ReadingError, readPassOne } from "../classify/reading.ts"
import type { Env } from "../env.ts"
import { errorResponse } from "../error-response.ts"
import { logClassificationFailure, logDefect, logEnqueueFailure, logRefusal, routeOf } from "../logs.ts"
import { urlsFor } from "../r2/presign.ts"
import { slicerFor } from "../slicer/slicer.ts"
import { migrate } from "./db/migrate.ts"
import { MIGRATIONS } from "./db/migrations.ts"
import { type GameApi, gameApi } from "./http.ts"
import { checkProbe, type IngestDeps, probeKey, setSource, start } from "./ingest.ts"
import { serveThumb, serveView } from "./media.ts"
import { type Publish, publisherFor } from "./publish.ts"
import { checkRanges } from "./ranges.ts"
import { acceptSocket, answerClose, type Broadcast, broadcastTo, heartbeat } from "./sockets.ts"
import {
  changeGame,
  markClassification,
  readClip,
  readGame,
  readiedIfClassified,
  replaceEventsForClip,
  saveAnswer,
  saveClip,
  saveGame,
} from "./store.ts"

const probePath = (gameId: string): string => `/api/games/${gameId}/probe.jpg`

export interface ClipSnapshot {
  readonly game: Game
  readonly clip: Clip
}

const readingOf = (response: ClefResponse): PassOneReading | ReadingError => {
  try {
    return readPassOne(response)
  } catch (error) {
    if (error instanceof ReadingError) return error
    throw error
  }
}

const PROBE_CACHE = "private, no-store"

const CLIP_MEDIA = /^\/api\/games\/([^/]+)\/clips\/(\d+)\/(view\.mp4|thumb\.jpg)$/

const refusalWithoutEmail = (request: Request): Response | undefined => {
  if (request.headers.get("x-strix-email") !== null) return undefined
  logRefusal(routeOf(request.method, request.url), "no-forwarded-email")
  return errorResponse(new Unauthorized())
}

export class GameDO extends DurableObject<Env> {
  protected readonly broadcast: Broadcast
  private readonly publish: Publish
  private readonly api: GameApi

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    void ctx.blockConcurrencyWhile(async () => migrate(ctx.storage, MIGRATIONS, Date.now()))
    ctx.setWebSocketAutoResponse(heartbeat())
    this.broadcast = broadcastTo(ctx)
    this.publish = publisherFor(ctx, env.DB, this.broadcast)
    this.api = gameApi(ctx, {
      setSource: (url) => this.ingest((deps) => setSource(deps, url)),
      start: (crop) => this.ingest((deps) => start(deps, crop)),
    })
  }

  override async fetch(request: Request): Promise<Response> {
    const game = readGame(this.ctx.storage.sql)
    const { pathname } = new URL(request.url)
    if (game !== undefined && pathname === socketPath(game.id)) return acceptSocket(this.ctx, request)
    const media = game === undefined ? undefined : this.mediaRoute(request, game.id, pathname)
    if (media !== undefined) return media
    const response = await this.api.handler(request)
    if (response.status === 500) logDefect({ route: routeOf(request.method, request.url), gameId: game?.id ?? null })
    response.headers.set("cache-control", "no-store")
    return response
  }

  override webSocketClose(socket: WebSocket, code: number, reason: string): void {
    answerClose(socket, code, reason)
  }

  override async alarm(): Promise<void> {
    const game = readGame(this.ctx.storage.sql)
    if (game === undefined) return
    const deps = this.ingestDeps(game.id)
    await checkProbe(deps)
    await checkRanges(deps)
  }

  create(game: Game): void {
    saveGame(this.ctx.storage.sql, game)
  }

  async clipReady(clip: Clip): Promise<void> {
    const sql = this.ctx.storage.sql
    const game = readGame(sql)
    if (game === undefined) throw new NotFound()
    saveClip(sql, clip)
    try {
      await this.env.CLASSIFY.send({ gameId: game.id, clipIndex: clip.index, pass: 1 })
    } catch (cause) {
      logEnqueueFailure(game.id, clip.index, cause)
      markClassification(sql, clip.index, "failed", null, null)
    }
    changeGame(sql, (current) => current)
    await this.publish(["clips", "game"])
  }

  snapshot(clipIndex: number): ClipSnapshot {
    const sql = this.ctx.storage.sql
    const game = readGame(sql)
    const clip = readClip(sql, clipIndex)
    if (game === undefined) throw new Error("the game has not been created")
    if (clip === undefined) throw new Error(`the game has no clip ${clipIndex}`)
    return { game, clip }
  }

  async answerReady(clipIndex: number, pass: number, window: number, response: ClefResponse): Promise<void> {
    const { storage } = this.ctx
    const { game, clip } = this.snapshot(clipIndex)
    saveAnswer(storage.sql, clipIndex, pass, window, response)
    const reading = readingOf(response)
    if (reading instanceof ReadingError) return this.classificationFailed(clipIndex, reading.message)
    markClassification(storage.sql, clipIndex, "done", reading.gameState.state, reading.gameState.confidence)
    const events = eventsFromPassOne(clip, reading, game.mode, game.thresholds, Date.now(), () => crypto.randomUUID())
    replaceEventsForClip(storage, clipIndex, events)
    this.settleClassification()
    await this.publish(["clips", "events", "game"])
  }

  async classificationFailed(clipIndex: number, reason: string): Promise<void> {
    const { game } = this.snapshot(clipIndex)
    markClassification(this.ctx.storage.sql, clipIndex, "failed", null, null)
    logClassificationFailure(game.id, clipIndex, reason)
    this.settleClassification()
    await this.publish(["clips", "game"])
  }

  private settleClassification(): void {
    const sql = this.ctx.storage.sql
    changeGame(sql, (game) => ({ ...game, status: readiedIfClassified(sql, game.status) }))
  }

  private ingest(run: (deps: IngestDeps) => Promise<Game>): Promise<Game> {
    const game = readGame(this.ctx.storage.sql)
    return game === undefined ? Promise.reject(new NotFound()) : run(this.ingestDeps(game.id))
  }

  private ingestDeps(gameId: string): IngestDeps {
    return {
      ctx: this.ctx,
      env: this.env,
      gameId,
      publish: this.publish,
      slicer: (rangeIndex) => slicerFor(this.env, gameId, rangeIndex),
      urls: urlsFor(this.env),
      clipReady: (clip) => this.clipReady(clip),
    }
  }

  private mediaRoute(request: Request, gameId: string, pathname: string): Promise<Response> | undefined {
    if (request.method !== "GET") return undefined
    if (pathname === probePath(gameId)) return this.probeFrame(request, gameId)
    const match = CLIP_MEDIA.exec(pathname)
    return match?.[1] === gameId ? this.clipMedia(request, gameId, match) : undefined
  }

  private async clipMedia(request: Request, gameId: string, match: RegExpExecArray): Promise<Response> {
    const refusal = refusalWithoutEmail(request)
    if (refusal !== undefined) return refusal
    const index = Number(match[2])
    const clip = Number.isSafeInteger(index) ? readClip(this.ctx.storage.sql, index) : undefined
    if (clip === undefined) return errorResponse(new NotFound())
    return match[3] === "view.mp4" ? serveView(this.env, gameId, index, request) : serveThumb(this.env, gameId, clip)
  }

  private async probeFrame(request: Request, gameId: string): Promise<Response> {
    const refusal = refusalWithoutEmail(request)
    if (refusal !== undefined) return refusal
    const frame = await this.env.BUCKET.get(probeKey(gameId))
    if (frame === null) return errorResponse(new NotFound())
    return new Response(frame.body, { headers: { "content-type": "image/jpeg", "cache-control": PROBE_CACHE } })
  }
}
