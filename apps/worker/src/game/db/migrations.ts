import type { Migration } from "./migrate.ts"
import game from "./migrations/0001-game.sql"

export const MIGRATIONS: ReadonlyArray<Migration> = [{ name: "0001-game", sql: game }]
