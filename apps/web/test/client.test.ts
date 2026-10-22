import { type Game, InvalidInput, ServiceUnavailable, TIMING_PRESETS, Unauthorized } from "@strix/contracts"
import { describe, expect, it } from "vitest"
import { connectApi } from "../src/api/client.ts"
import { Unexpected } from "../src/api/errors.ts"

const ORIGIN = "https://strix.example.test"

const GAME: Game = {
  id: "game-1",
  name: "Hawks at Eagles",
  home: { name: "Eagles", jersey: "white", roster: [7, 12] },
  away: { name: "Hawks", jersey: "black", roster: [9] },
  mode: "review",
  level: "junior-pro",
  thresholds: { autoSave: 80, draft: 40, period: 85, scorer: 70, assist: 50 },
  timing: TIMING_PRESETS["junior-pro"],
  status: "created",
  failure: null,
  crop: null,
  source: null,
  durationMs: null,
  createdAt: Date.UTC(2026, 9, 21),
  counts: { clips: 0, classified: 0, events: 0, drafts: 0, needs: 0 },
}

const json = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "application/json" } })

const server = (answer: () => Promise<Response>) => {
  const requests: Request[] = []
  const api = connectApi({
    baseUrl: ORIGIN,
    fetch: (input, init) => {
      requests.push(new Request(input, init))
      return answer()
    },
  })
  return { api, requests }
}

const getGame = (api: ReturnType<typeof connectApi>) =>
  api.request((client) => client.games.getGame({ params: { id: "game-1" } }))

describe("connectApi", () => {
  it("asks for the game with same-origin credentials and decodes it", async () => {
    const { api, requests } = server(async () => json(200, JSON.stringify(GAME)))
    await expect(getGame(api)).resolves.toEqual(GAME)
    expect(requests.map((request) => [request.method, request.url, request.credentials])).toEqual([
      ["GET", `${ORIGIN}/api/games/game-1`, "same-origin"],
    ])
  })

  it("sends a POST body as application/json, which the Worker requires", async () => {
    const { api, requests } = server(async () => json(200, JSON.stringify(GAME)))
    await api.request((client) => client.games.setSource({ params: { id: "game-1" }, payload: { url: "https://v" } }))
    expect(requests.map((request) => request.headers.get("content-type"))).toEqual(["application/json"])
  })

  it("decodes a 401 as Unauthorized", async () => {
    const { api } = server(async () => json(401, '{"_tag":"Unauthorized"}'))
    await expect(getGame(api)).rejects.toBeInstanceOf(Unauthorized)
  })

  it("decodes a 400 as InvalidInput with its field errors", async () => {
    const body = '{"_tag":"InvalidInput","fieldErrors":[{"path":"home.name","issue":"invalid"}]}'
    const { api } = server(async () => json(400, body))
    await expect(getGame(api)).rejects.toEqual(
      new InvalidInput({ fieldErrors: [{ path: "home.name", issue: "invalid" }] }),
    )
  })

  it("reads a 503 as ServiceUnavailable", async () => {
    const { api } = server(async () => json(503, '{"_tag":"ServiceUnavailable"}'))
    await expect(getGame(api)).rejects.toBeInstanceOf(ServiceUnavailable)
  })

  it("keeps the status of any other answer it can't decode", async () => {
    const { api } = server(async () => new Response("Internal Server Error", { status: 500 }))
    await expect(getGame(api)).rejects.toEqual(new Unexpected({ status: 500 }))
  })

  it("refuses a body that doesn't match the contract", async () => {
    const { api } = server(async () => json(200, '{"id":null}'))
    await expect(getGame(api)).rejects.toEqual(new Unexpected({ status: null }))
  })
})
