import type { Game } from "@strix/contracts"
import { DurableObject } from "cloudflare:workers"
import type { Env } from "../env.ts"
import { migrate } from "./db/migrate.ts"
import { MIGRATIONS } from "./db/migrations.ts"
import { saveGame } from "./store.ts"

export class GameDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    void ctx.blockConcurrencyWhile(async () => migrate(ctx.storage, MIGRATIONS, Date.now()))
  }

  create(game: Game): void {
    saveGame(this.ctx.storage.sql, game)
  }
}
