import { type ClefResponse, type Clip, type Game, NotFound, socketPath } from "@strix/contracts"
import { DurableObject } from "cloudflare:workers"
import type { Env } from "../env.ts"
import { logDefect, routeOf } from "../logs.ts"
import { migrate } from "./db/migrate.ts"
import { MIGRATIONS } from "./db/migrations.ts"
import { type GameActions, type GameApi, gameApi } from "./http.ts"
import { acceptSocket, answerClose, type Broadcast, broadcastTo, heartbeat } from "./sockets.ts"
import { readGame, saveGame } from "./store.ts"

const notYet = (): Promise<Game> => Promise.reject(new NotFound())

const pendingActions: GameActions = { setSource: notYet, start: notYet }

export class GameDO extends DurableObject<Env> {
  protected readonly broadcast: Broadcast
  private readonly api: GameApi

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    void ctx.blockConcurrencyWhile(async () => migrate(ctx.storage, MIGRATIONS, Date.now()))
    ctx.setWebSocketAutoResponse(heartbeat())
    this.broadcast = broadcastTo(ctx)
    this.api = gameApi(ctx, pendingActions)
  }

  override async fetch(request: Request): Promise<Response> {
    const game = readGame(this.ctx.storage.sql)
    if (game !== undefined && new URL(request.url).pathname === socketPath(game.id)) {
      return acceptSocket(this.ctx, request)
    }
    const response = await this.api.handler(request)
    if (response.status === 500) logDefect({ route: routeOf(request.method, request.url), gameId: game?.id ?? null })
    response.headers.set("cache-control", "no-store")
    return response
  }

  override webSocketClose(socket: WebSocket, code: number, reason: string): void {
    answerClose(socket, code, reason)
  }

  create(game: Game): void {
    saveGame(this.ctx.storage.sql, game)
  }

  clipReady(_clip: Clip): void {
    throw new Error("not implemented")
  }

  answerReady(_clipIndex: number, _pass: number, _window: number, _response: ClefResponse): void {
    throw new Error("not implemented")
  }

  classificationFailed(_clipIndex: number, _reason: string): void {
    throw new Error("not implemented")
  }
}
