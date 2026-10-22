import { type Crop, DEFAULT_THRESHOLDS, type Game, type NewGame, TIMING_PRESETS } from "@strix/contracts"
import { createExecutionContext, env } from "cloudflare:test"
import { expect } from "vitest"
import schema from "../src/games-index/schema.sql"
import worker from "../src/index.ts"

export const ORIGIN = "https://strix.example.test"
export const EMAIL = "andrew@example.test"

export const SENT: QueueSendResponse = { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } }

export const NEW_GAME: NewGame = {
  name: "Vipers at Wolves",
  home: { name: "Wolves", jersey: "white", roster: [9, 17] },
  away: { name: "Vipers", jersey: "red", roster: [] },
  mode: "review",
  level: "junior-pro",
}

const devAccess: CloudflareAccessContext = { aud: "strix-local", getIdentity: async () => ({ email: EMAIL }) }

export const applySchema = async (db: D1Database): Promise<void> => {
  await db.prepare(schema).run()
}

export const clearGames = async (db: D1Database): Promise<void> => {
  await db.prepare("DELETE FROM games").run()
}

export const asDev = (path: string, init: RequestInit<IncomingRequestCfProperties> = {}) => {
  const ctx = createExecutionContext()
  Object.defineProperty(ctx, "access", { value: devAccess })
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx)
}

type Payload = NewGame | { readonly url: string } | { readonly crop: Crop | null }

export const postJson = (path: string, body: Payload) =>
  asDev(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

export const createGame = async (): Promise<{ id: string }> => {
  const response = await postJson("/api/games", NEW_GAME)
  expect(response.status).toBe(200)
  return response.json()
}

export const gameAt = (id: string, createdAt: number): Game => ({
  id,
  name: `Game ${id}`,
  home: { name: "Home", jersey: "white", roster: [] },
  away: { name: "Away", jersey: "black", roster: [] },
  mode: "review",
  level: "junior-pro",
  thresholds: DEFAULT_THRESHOLDS,
  timing: TIMING_PRESETS["junior-pro"],
  status: "created",
  failure: null,
  crop: null,
  source: null,
  durationMs: null,
  createdAt,
  counts: { clips: 0, classified: 0, events: 0, drafts: 0, needs: 0 },
})
