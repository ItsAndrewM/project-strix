/**
 * Publishing a change: mirror the game as it now is into the D1 index, then tell the sockets. Index writes run one at a
 * time and each writes the game as stored when it runs, so concurrent changes (six ranges recording clips) cannot land
 * out of order and leave the index behind the game. The index is a listing aid; a failed write is logged and the next
 * change rewrites the whole row.
 */
import type { Changed } from "@strix/contracts"
import { updateGame } from "../games-index/games-index.ts"
import { logIndexFailure } from "../logs.ts"
import type { Broadcast } from "./sockets.ts"
import { readGame } from "./store.ts"

export type Publish = (changed: ReadonlyArray<Changed>) => Promise<void>

const indexLatest = async (sql: SqlStorage, db: D1Database): Promise<void> => {
  const game = readGame(sql)
  if (game === undefined) return
  await updateGame(db, game).catch((cause: unknown) => logIndexFailure(game.id, cause))
}

export const publisherFor = (ctx: DurableObjectState, db: D1Database, broadcast: Broadcast): Publish => {
  let indexed = Promise.resolve()
  return async (changed) => {
    indexed = indexed.then(() => indexLatest(ctx.storage.sql, db))
    await indexed
    broadcast(changed)
  }
}
