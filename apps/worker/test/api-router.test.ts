import { DEFAULT_THRESHOLDS, type NewGame, TIMING_PRESETS } from "@strix/contracts"
import { env, SELF } from "cloudflare:test"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Caller } from "../src/access.ts"
import { forGame, routeApi } from "../src/api-router.ts"
import { listGames } from "../src/games-index/games-index.ts"
import { applySchema, clearGames } from "./games.ts"

const ORIGIN = "https://strix.example.test"
const andrew: Caller = { kind: "user", email: "andrew@example.test" }
const serviceToken: Caller = { kind: "service", clientId: "strix-admin.access" }

const NEW_GAME: NewGame = {
  name: "Vipers at Wolves",
  home: { name: "Wolves", jersey: "white", roster: [9, 17] },
  away: { name: "Vipers", jersey: "red", roster: [] },
  mode: "review",
  level: "junior-pro",
}

const post = (body: string) =>
  new Request(`${ORIGIN}/api/games`, { method: "POST", headers: { "content-type": "application/json" }, body })

const create = async (newGame: NewGame) => (await routeApi(post(JSON.stringify(newGame)), andrew, env)).json()

beforeAll(async () => {
  await applySchema(env.DB)
})

beforeEach(async () => {
  await clearGames(env.DB)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("POST /api/games", () => {
  it("creates a game with the default thresholds and its level's timing preset", async () => {
    const before = Date.now()
    const response = await routeApi(post(JSON.stringify(NEW_GAME)), andrew, env)
    expect(response.status).toBe(200)
    const game = await response.json<{ createdAt: number }>()
    expect(game).toEqual({
      ...NEW_GAME,
      id: expect.any(String),
      thresholds: DEFAULT_THRESHOLDS,
      timing: TIMING_PRESETS["junior-pro"],
      status: "created",
      failure: null,
      crop: null,
      source: null,
      durationMs: null,
      createdAt: expect.any(Number),
      counts: { clips: 0, classified: 0, events: 0, drafts: 0, needs: 0 },
    })
    expect(game.createdAt).toBeGreaterThanOrEqual(before)
  })

  it("keeps the thresholds and timing the caller chose", async () => {
    const thresholds = { autoSave: 90, draft: 30, period: 80, scorer: 60, assist: 40 }
    const timing = { periodMinutes: 12, intermissionMin: 2, ambiguousMin: 1 }
    expect(await create({ ...NEW_GAME, thresholds, timing })).toMatchObject({ thresholds, timing })
  })

  it("answers 400 naming the invalid fields of a payload that isn't a NewGame", async () => {
    const response = await routeApi(post(JSON.stringify({ ...NEW_GAME, name: "", level: "beer-league" })), andrew, env)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      _tag: "InvalidInput",
      fieldErrors: expect.arrayContaining([
        { path: "name", issue: "invalid" },
        { path: "level", issue: "invalid" },
      ]),
    })
  })

  it("answers 400 to a body that isn't JSON", async () => {
    const response = await routeApi(post("{"), andrew, env)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ _tag: "InvalidInput", fieldErrors: [{ path: "", issue: "invalid" }] })
  })

  it("answers 415 to a body that isn't declared as JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const request = new Request(`${ORIGIN}/api/games`, { method: "POST", body: JSON.stringify(NEW_GAME) })
    expect((await routeApi(request, andrew, env)).status).toBe(415)
  })
})

describe("creating a game whose Durable Object can't be created", () => {
  it("answers 503 and leaves no game in the index", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(env.GAME, "getByName").mockImplementation(() => {
      throw new Error("storage unavailable")
    })
    const response = await routeApi(post(JSON.stringify(NEW_GAME)), andrew, env)
    expect(response.status).toBe(503)
    expect(await listGames(env.DB)).toEqual([])
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "index-unavailable",
      route: "POST /api/games",
      cause: "storage unavailable",
    })
  })
})

describe("a request forwarded to a game", () => {
  const forwarded = (headers: HeadersInit) =>
    forGame(new Request(`${ORIGIN}/api/games/g1/clips`, { headers }), andrew.email)

  it.each(["X-Strix-Email", "x-strix-email", "X-STRIX-EMAIL"])(
    "carries the caller's email in place of a client-sent %s",
    (name) => {
      expect(forwarded({ [name]: "attacker@x.test" }).headers.get("x-strix-email")).toBe(andrew.email)
    },
  )

  it("drops every other x-strix- header the client sent and keeps the rest", () => {
    const request = forwarded({ "X-Strix-Role": "admin", "x-strix-game": "g2", accept: "application/json" })
    expect([...request.headers]).toEqual([
      ["accept", "application/json"],
      ["x-strix-email", andrew.email],
    ])
  })
})

describe("GET /api/games", () => {
  it("lists the games created", async () => {
    const created = await create(NEW_GAME)
    const response = await routeApi(new Request(`${ORIGIN}/api/games`), andrew, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([created])
  })
})

describe("other API paths", () => {
  it("answers 405 to a method /api/games doesn't take", async () => {
    const request = new Request(`${ORIGIN}/api/games`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
    })
    const response = await routeApi(request, andrew, env)
    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("GET, POST")
  })

  it("answers 404 to a path outside /api/games", async () => {
    const response = await routeApi(new Request(`${ORIGIN}/api/teams`), andrew, env)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ _tag: "NotFound" })
  })

  it("answers 503 when Access's signing keys are out of reach", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const caller: Caller = { kind: "keys-unavailable", cause: "Network connection lost" }
    const response = await routeApi(new Request(`${ORIGIN}/api/games`), caller, env)
    expect(response.status).toBe(503)
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "keys-unavailable",
      route: "GET /api/games",
      cause: "Network connection lost",
    })
  })
})

describe("callers the API refuses", () => {
  it("answers 401 through the Worker when nothing vouches for the caller", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const response = await SELF.fetch(`${ORIGIN}/api/games`)
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ _tag: "Unauthorized" })
    expect(consoleWarn).toHaveBeenCalledExactlyOnceWith({
      event: "refused",
      reason: "no-token",
      route: "GET /api/games",
    })
  })

  it("answers 401 to a service token", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const response = await routeApi(new Request(`${ORIGIN}/api/games`), serviceToken, env)
    expect(response.status).toBe(401)
    expect(consoleWarn).toHaveBeenCalledExactlyOnceWith({
      event: "refused",
      reason: "service-token",
      route: "GET /api/games",
    })
  })

  it("leaves non-API paths to Static Assets", async () => {
    expect((await SELF.fetch(`${ORIGIN}/games`)).status).toBe(404)
  })
})
