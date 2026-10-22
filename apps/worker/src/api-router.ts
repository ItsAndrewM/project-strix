import {
  DEFAULT_THRESHOLDS,
  Game,
  invalidInputFrom,
  NewGame,
  NotFound,
  ServiceUnavailable,
  TIMING_PRESETS,
  Unauthorized,
} from "@strix/contracts"
import { Result, Schema } from "effect"
import type { Caller } from "./access.ts"
import type { Env } from "./env.ts"
import { errorResponse } from "./error-response.ts"
import { insertGame, listGames } from "./games-index/games-index.ts"
import { logOutage, logRefusal, type Outage, type Refused, routeOf } from "./logs.ts"

const INTERNAL_HEADER_PREFIX = "x-strix-"
const GAMES_PATH = "/api/games"
const GAME_PATH = /^\/api\/games\/(?<id>[^/]+)(?:\/.*)?$/
const NO_STORE = { "cache-control": "no-store" }

const decodeNewGame = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.toCodecJson(NewGame)), {
  errors: "all",
})
const encodeGame = Schema.encodeSync(Schema.toCodecJson(Game))
const encodeGames = Schema.encodeSync(Schema.toCodecJson(Schema.Array(Game)))

const refuse = (route: string, reason: Refused): Response => {
  logRefusal(route, reason)
  return errorResponse(new Unauthorized())
}

const unavailable = (route: string, outage: Outage) => (error: Error) => {
  logOutage(outage, route, error.message)
  return errorResponse(new ServiceUnavailable())
}

const mediaTypeOf = (request: Request): string =>
  (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""

const isJsonOrRead = (request: Request): boolean =>
  request.method === "GET" || request.method === "HEAD" || mediaTypeOf(request) === "application/json"

export const forGame = (request: Request, email: string): Request => {
  const headers = new Headers([...request.headers].filter(([name]) => !name.startsWith(INTERNAL_HEADER_PREFIX)))
  headers.set("x-strix-email", email)
  return new Request(request, { headers })
}

const gameFrom = (newGame: NewGame): Game => ({
  id: crypto.randomUUID(),
  name: newGame.name,
  home: newGame.home,
  away: newGame.away,
  mode: newGame.mode,
  level: newGame.level,
  thresholds: newGame.thresholds ?? DEFAULT_THRESHOLDS,
  timing: newGame.timing ?? TIMING_PRESETS[newGame.level],
  status: "created",
  failure: null,
  crop: null,
  source: null,
  durationMs: null,
  createdAt: Date.now(),
  counts: { clips: 0, classified: 0, events: 0, drafts: 0, needs: 0 },
})

const createGame = async (request: Request, env: Env): Promise<Response> => {
  const decoded = decodeNewGame(await request.text())
  if (Result.isFailure(decoded)) return errorResponse(invalidInputFrom(decoded.failure.issue))
  const game = gameFrom(decoded.success)
  await env.GAME.getByName(game.id).create(game)
  await insertGame(env.DB, game)
  return Response.json(encodeGame(game), { headers: NO_STORE })
}

const gamesList = async (env: Env): Promise<Response> =>
  Response.json(encodeGames(await listGames(env.DB)), { headers: NO_STORE })

const routeGames = (request: Request, route: string, env: Env): Promise<Response> => {
  if (request.method === "GET") return gamesList(env).catch(unavailable(route, "index-unavailable"))
  if (request.method === "POST") return createGame(request, env).catch(unavailable(route, "index-unavailable"))
  return Promise.resolve(new Response(null, { status: 405, headers: { allow: "GET, POST", ...NO_STORE } }))
}

const routeUser = (request: Request, route: string, email: string, env: Env): Promise<Response> => {
  const { pathname } = new URL(request.url)
  if (pathname === GAMES_PATH) return routeGames(request, route, env)
  const id = GAME_PATH.exec(pathname)?.groups?.["id"]
  if (id === undefined) return Promise.resolve(errorResponse(new NotFound()))
  return env.GAME.getByName(id).fetch(forGame(request, email)).catch(unavailable(route, "game-unavailable"))
}

export const routeApi = async (request: Request, caller: Caller, env: Env): Promise<Response> => {
  const route = routeOf(request.method, request.url)
  if (caller.kind === "keys-unavailable") {
    logOutage("keys-unavailable", route, caller.cause)
    return errorResponse(new ServiceUnavailable())
  }
  if (caller.kind === "unauthenticated") return refuse(route, caller.reason)
  if (caller.kind === "service") return refuse(route, "service-token")
  if (!isJsonOrRead(request)) {
    logRefusal(route, "not-json")
    return new Response(null, { status: 415, headers: NO_STORE })
  }
  return routeUser(request, route, caller.email, env)
}
