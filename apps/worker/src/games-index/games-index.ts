import { Game } from "@strix/contracts"
import { Schema } from "effect"

const GameJson = Schema.fromJsonString(Schema.toCodecJson(Game))
const encodeGame = Schema.encodeSync(GameJson)
const decodeGame = Schema.decodeUnknownSync(GameJson)

export const insertGame = async (db: D1Database, game: Game): Promise<void> => {
  await db
    .prepare("INSERT INTO games (id, created_at, status, json) VALUES (?, ?, ?, ?)")
    .bind(game.id, game.createdAt, game.status, encodeGame(game))
    .run()
}

export const listGames = async (db: D1Database): Promise<ReadonlyArray<Game>> => {
  const { results } = await db.prepare("SELECT json FROM games ORDER BY created_at DESC").all<{ json: string }>()
  return results.map(({ json }) => decodeGame(json))
}

export const updateGame = async (db: D1Database, game: Game): Promise<void> => {
  await db
    .prepare("UPDATE games SET status = ?, json = ? WHERE id = ?")
    .bind(game.status, encodeGame(game), game.id)
    .run()
}
