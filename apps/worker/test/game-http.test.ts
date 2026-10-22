import { type Clip, HEARTBEAT, socketPath } from "@strix/contracts"
import { env, runInDurableObject } from "cloudflare:test"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { saveClip } from "../src/game/store.ts"
import { applySchema, asDev, clearGames, createGame, ORIGIN } from "./games.ts"

const CLIP: Clip = {
  index: 0,
  startMs: 0,
  durationMs: 10_000,
  renditions: ["model-480", "view"],
  state: null,
  stateConfidence: null,
  classification: "pending",
}

const direct = (id: string, path: string, headers: Record<string, string>) =>
  env.GAME.getByName(id).fetch(`${ORIGIN}${path}`, { headers })

const connect = async (id: string) => {
  const response = await asDev(socketPath(id), { headers: { upgrade: "websocket", origin: ORIGIN } })
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (socket === null) throw new Error("the game answered 101 without a socket")
  socket.accept()
  return socket
}

const nextMessage = (socket: WebSocket) =>
  new Promise<string>((resolve) => {
    socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true })
  })

beforeAll(async () => {
  await applySchema(env.DB)
})

beforeEach(async () => {
  await clearGames(env.DB)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("GET /api/games/:id", () => {
  it("answers the game created, no-store", async () => {
    const created = await createGame()
    const response = await asDev(`/api/games/${created.id}`)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual(created)
  })

  it("counts the game's clips as they are when it's read", async () => {
    const { id } = await createGame()
    await runInDurableObject(env.GAME.getByName(id), (_instance, state) => {
      saveClip(state.storage.sql, CLIP)
    })
    expect(await (await asDev(`/api/games/${id}`)).json()).toMatchObject({ counts: { clips: 1, classified: 0 } })
    expect(await (await asDev(`/api/games/${id}/clips`)).json()).toEqual([CLIP])
  })

  it("answers 404 to a game that was never created", async () => {
    const response = await asDev("/api/games/unknown")
    expect(response.status).toBe(404)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ _tag: "NotFound" })
  })
})

describe("a game's clips and events", () => {
  it.each(["clips", "events"])("lists no %s for a new game", async (list) => {
    const { id } = await createGame()
    const response = await asDev(`/api/games/${id}/${list}`)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual([])
  })

  it.each(["clips", "events"])("answers 404 to the %s of a game that was never created", async (list) => {
    const response = await asDev(`/api/games/unknown/${list}`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ _tag: "NotFound" })
  })
})

describe("starting a game", () => {
  it("answers 400 naming the field of a start payload that isn't one", async () => {
    const { id } = await createGame()
    const response = await asDev(`/api/games/${id}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ crop: "wide" }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ _tag: "InvalidInput", fieldErrors: [{ path: "crop", issue: "invalid" }] })
  })
})

describe("a request that reaches the game without the router", () => {
  it("is refused with 401 when it carries no forwarded email", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { id } = await createGame()
    const response = await direct(id, `/api/games/${id}`, {})
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ _tag: "Unauthorized" })
    expect(consoleWarn).toHaveBeenCalledExactlyOnceWith({
      event: "refused",
      reason: "no-forwarded-email",
      route: `GET /api/games/${id}`,
    })
  })

  it("is refused a socket with 401 when it carries no forwarded email", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { id } = await createGame()
    const response = await direct(id, socketPath(id), { upgrade: "websocket", origin: ORIGIN })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ _tag: "Unauthorized" })
  })
})

describe("the game's socket", () => {
  it("answers the heartbeat on a same-origin upgrade", async () => {
    const { id } = await createGame()
    const socket = await connect(id)
    const pong = nextMessage(socket)
    socket.send(HEARTBEAT.ping)
    expect(await pong).toBe(HEARTBEAT.pong)
  })

  it.each([
    ["another site", { origin: "https://evil.test" }],
    ["the app over plain HTTP", { origin: "http://strix.example.test" }],
    ["a sandboxed page", { origin: "null" }],
    ["no origin at all", {}],
  ])("refuses an upgrade from %s with 403", async (_label, origin) => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { id } = await createGame()
    const response = await asDev(socketPath(id), { headers: { upgrade: "websocket", ...origin } })
    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(consoleWarn).toHaveBeenCalledExactlyOnceWith({
      event: "refused",
      reason: "foreign-origin",
      route: `GET ${socketPath(id)}`,
    })
  })

  it("answers a same-origin request without an upgrade with 426, naming the upgrade it needs", async () => {
    const { id } = await createGame()
    const response = await asDev(socketPath(id), { headers: { origin: ORIGIN } })
    expect(response.status).toBe(426)
    expect(response.headers.get("upgrade")).toBe("websocket")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("answers 404 to a socket on a game that was never created", async () => {
    const response = await asDev(socketPath("unknown"), { headers: { upgrade: "websocket", origin: ORIGIN } })
    expect(response.status).toBe(404)
  })
})
