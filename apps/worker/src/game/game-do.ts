import { type ClefResponse, type Clip, type Game, NotFound, socketPath, Unauthorized } from "@strix/contracts"
import { DurableObject } from "cloudflare:workers"
import type { Env } from "../env.ts"
import { errorResponse } from "../error-response.ts"
import { logDefect, logRefusal, routeOf } from "../logs.ts"
import { urlsFor } from "../r2/presign.ts"
import { slicerFor } from "../slicer/slicer.ts"
import { migrate } from "./db/migrate.ts"
import { MIGRATIONS } from "./db/migrations.ts"
import { type GameApi, gameApi } from "./http.ts"
import { type IngestDeps, probeKey, setSource, start } from "./ingest.ts"
import { type Publish, publisherFor } from "./publish.ts"
import { checkRanges } from "./ranges.ts"
import { acceptSocket, answerClose, type Broadcast, broadcastTo, heartbeat } from "./sockets.ts"
import { changeGame, readGame, saveClip, saveGame } from "./store.ts"

const probePath = (gameId: string): string => `/api/games/${gameId}/probe.jpg`

const PROBE_CACHE = "private, max-age=3600"

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
    if (game !== undefined && pathname === probePath(game.id) && request.method === "GET") {
      return this.probeFrame(request, game.id)
    }
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
    if (game !== undefined) await checkRanges(this.ingestDeps(game.id))
  }

  create(game: Game): void {
    saveGame(this.ctx.storage.sql, game)
  }

  async clipReady(clip: Clip): Promise<void> {
    const sql = this.ctx.storage.sql
    const game = readGame(sql)
    if (game === undefined) throw new NotFound()
    saveClip(sql, clip)
    await this.env.CLASSIFY.send({ gameId: game.id, clipIndex: clip.index, pass: 1 })
    changeGame(sql, (current) => current)
    await this.publish(["clips", "game"])
  }

  answerReady(_clipIndex: number, _pass: number, _window: number, _response: ClefResponse): void {
    throw new Error("not implemented")
  }

  classificationFailed(_clipIndex: number, _reason: string): void {
    throw new Error("not implemented")
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

  private async probeFrame(request: Request, gameId: string): Promise<Response> {
    if (request.headers.get("x-strix-email") === null) {
      logRefusal(routeOf(request.method, request.url), "no-forwarded-email")
      return errorResponse(new Unauthorized())
    }
    const frame = await this.env.BUCKET.get(probeKey(gameId))
    if (frame === null) return errorResponse(new NotFound())
    return new Response(frame.body, { headers: { "content-type": "image/jpeg", "cache-control": PROBE_CACHE } })
  }
}
