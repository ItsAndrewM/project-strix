/**
 * Re-merging the machine's events after a clip's events are replaced. Only `auto`, `draft` and `discarded` rows take
 * part: an event a person accepted, rejected or entered is never merged away or rewritten. Survivors are upserted
 * (a merge may move one to an earlier clip and time) and the machine rows merged into them are deleted, in one
 * transaction.
 */
import type { EventStatus } from "@strix/contracts"
import { mergeAdjacent } from "@strix/domain"
import { readEvents, saveEvents } from "./store.ts"

const MACHINE: ReadonlySet<EventStatus> = new Set(["auto", "draft", "discarded"])

export const mergeBack = (storage: DurableObjectStorage): void => {
  storage.transactionSync(() => {
    const machine = readEvents(storage.sql).filter((event) => MACHINE.has(event.status))
    const merged = mergeAdjacent(machine)
    const kept = new Set(merged.map((event) => event.id))
    for (const event of machine) {
      if (kept.has(event.id)) continue
      storage.sql.exec("DELETE FROM events WHERE id = ? AND status IN ('auto', 'draft', 'discarded')", event.id)
    }
    saveEvents(storage.sql, merged)
  })
}
