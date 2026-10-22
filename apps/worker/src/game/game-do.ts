import type { Game } from "@strix/contracts"
import { DurableObject } from "cloudflare:workers"

export class GameDO extends DurableObject {
  create(_game: Game): void {}
}
