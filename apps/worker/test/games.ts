import { DEFAULT_THRESHOLDS, type Game, TIMING_PRESETS } from "@strix/contracts"
import schema from "../src/games-index/schema.sql"

export const applySchema = async (db: D1Database): Promise<void> => {
  await db.prepare(schema).run()
}

export const clearGames = async (db: D1Database): Promise<void> => {
  await db.prepare("DELETE FROM games").run()
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
