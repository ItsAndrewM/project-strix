import type { GameEvent, Side } from "@strix/contracts"

export type Teams = Readonly<Record<Side, string>>

export interface ListedEvents {
  readonly listed: ReadonlyArray<GameEvent>
  readonly isPending: boolean
  readonly error: Error | null
}
