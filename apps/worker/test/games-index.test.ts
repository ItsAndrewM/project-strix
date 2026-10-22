import { env } from "cloudflare:test"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import migration from "../migrations/0001-games.sql"
import { insertGame, listGames, updateGame } from "../src/games-index/games-index.ts"
import schema from "../src/games-index/schema.sql"
import { applySchema, clearGames, gameAt } from "./games.ts"

beforeAll(async () => {
  await applySchema(env.DB)
})

beforeEach(async () => {
  await clearGames(env.DB)
})

describe("the games index in D1", () => {
  it("is created by the same SQL the D1 migration applies", () => {
    expect(schema).toBe(migration)
  })

  it("lists nothing before any game is created", async () => {
    expect(await listGames(env.DB)).toEqual([])
  })

  it("lists games newest first", async () => {
    const older = gameAt("older", Date.UTC(2026, 9, 1))
    const newer = gameAt("newer", Date.UTC(2026, 9, 2))
    await insertGame(env.DB, older)
    await insertGame(env.DB, newer)
    expect(await listGames(env.DB)).toEqual([newer, older])
  })

  it("replaces a game's status and JSON on update", async () => {
    const game = gameAt("g1", Date.UTC(2026, 9, 1))
    await insertGame(env.DB, game)
    const slicing = { ...game, status: "slicing" as const, counts: { ...game.counts, clips: 12 } }
    await updateGame(env.DB, slicing)
    expect(await listGames(env.DB)).toEqual([slicing])
    const row = await env.DB.prepare("SELECT status FROM games WHERE id = ?").bind("g1").first<{ status: string }>()
    expect(row?.status).toBe("slicing")
  })
})
