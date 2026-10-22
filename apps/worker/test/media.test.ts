/**
 * Clip media routes: the view rendition streamed with byte ranges, and the clip thumbnail generated once and kept.
 */
import { env } from "cloudflare:test"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { applySchema, asDev, clearGames, createGame, postJson, SENT } from "./games.ts"

const SOURCE_URL = "https://video.example.test/game.mp4"

const viewKey = (id: string) => `clips/${id}/0/view.mp4`
const thumbKey = (id: string) => `thumbs/${id}/0.jpg`

const startedGame = async (): Promise<string> => {
  const { id } = await createGame()
  expect((await postJson(`/api/games/${id}/source`, { url: SOURCE_URL })).status).toBe(200)
  vi.spyOn(env.CLASSIFY, "send").mockResolvedValue(SENT)
  expect((await postJson(`/api/games/${id}/start`, { crop: null })).status).toBe(200)
  await vi.waitFor(async () => expect(await env.BUCKET.head(viewKey(id))).not.toBeNull(), {
    timeout: 10_000,
    interval: 25,
  })
  return id
}

const viewSize = async (id: string): Promise<number> => (await env.BUCKET.head(viewKey(id)))?.size ?? 0

const withoutEmail = (id: string, path: string) =>
  env.GAME.getByName(id).fetch(`https://strix.example.test/api/games/${id}/clips/${path}`)

beforeAll(async () => {
  await applySchema(env.DB)
})

beforeEach(async () => {
  await clearGames(env.DB)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("GET /api/games/:id/clips/:index/view.mp4", () => {
  it("answers a byte range with 206 and its content-range", async () => {
    const id = await startedGame()
    const size = await viewSize(id)
    const response = await asDev(`/api/games/${id}/clips/0/view.mp4`, { headers: { range: "bytes=0-99" } })

    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe(`bytes 0-99/${size}`)
    expect(response.headers.get("content-length")).toBe("100")
    expect(response.headers.get("content-type")).toBe("video/mp4")
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600")
    expect((await response.arrayBuffer()).byteLength).toBe(100)
  })

  it("answers an open-ended range from its offset to the end", async () => {
    const id = await startedGame()
    const size = await viewSize(id)
    const response = await asDev(`/api/games/${id}/clips/0/view.mp4`, { headers: { range: "bytes=100-" } })

    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe(`bytes 100-${size - 1}/${size}`)
    expect((await response.arrayBuffer()).byteLength).toBe(size - 100)
  })

  it("answers a suffix range with the last bytes", async () => {
    const id = await startedGame()
    const size = await viewSize(id)
    const response = await asDev(`/api/games/${id}/clips/0/view.mp4`, { headers: { range: "bytes=-50" } })

    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe(`bytes ${size - 50}-${size - 1}/${size}`)
    expect((await response.arrayBuffer()).byteLength).toBe(50)
  })

  it("answers the whole clip with 200 when no range is requested", async () => {
    const id = await startedGame()
    const size = await viewSize(id)
    const response = await asDev(`/api/games/${id}/clips/0/view.mp4`)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-length")).toBe(String(size))
    expect(response.headers.get("content-range")).toBeNull()
    expect(response.headers.get("content-type")).toBe("video/mp4")
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600")
    expect((await response.arrayBuffer()).byteLength).toBe(size)
  })

  it("answers 416 to a range past the end of the clip", async () => {
    const id = await startedGame()
    const size = await viewSize(id)
    const response = await asDev(`/api/games/${id}/clips/0/view.mp4`, { headers: { range: "bytes=999999999-" } })

    expect(response.status).toBe(416)
    expect(response.headers.get("content-range")).toBe(`bytes */${size}`)
  })

  it("answers 404 to a clip the game does not have", async () => {
    const id = await startedGame()

    expect((await asDev(`/api/games/${id}/clips/7/view.mp4`)).status).toBe(404)
  })

  it("answers 404 to a game that does not exist", async () => {
    expect((await asDev("/api/games/missing/clips/0/view.mp4")).status).toBe(404)
  })

  it("answers 401 without the forwarded email", async () => {
    const id = await startedGame()

    expect((await withoutEmail(id, "0/view.mp4")).status).toBe(401)
  })
})

describe("GET /api/games/:id/clips/:index/thumb.jpg", () => {
  it("generates the thumbnail once, storing it", async () => {
    const id = await startedGame()
    expect(await env.BUCKET.head(thumbKey(id))).toBeNull()

    const response = await asDev(`/api/games/${id}/clips/0/thumb.jpg`)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600")
    const jpeg = new Uint8Array(await response.arrayBuffer())
    expect([jpeg[0], jpeg[1], jpeg.at(-2), jpeg.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9])
    expect(await env.BUCKET.head(thumbKey(id))).not.toBeNull()
  })

  it("serves the stored thumbnail on later requests", async () => {
    const id = await startedGame()
    expect((await asDev(`/api/games/${id}/clips/0/thumb.jpg`)).status).toBe(200)
    await env.BUCKET.put(thumbKey(id), new Uint8Array([7]), { httpMetadata: { contentType: "image/jpeg" } })

    const response = await asDev(`/api/games/${id}/clips/0/thumb.jpg`)

    expect(response.status).toBe(200)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([7])
  })

  it("answers 404 to a clip the game does not have", async () => {
    const id = await startedGame()

    expect((await asDev(`/api/games/${id}/clips/7/thumb.jpg`)).status).toBe(404)
  })

  it("answers 401 without the forwarded email", async () => {
    const id = await startedGame()

    expect((await withoutEmail(id, "0/thumb.jpg")).status).toBe(401)
  })
})
