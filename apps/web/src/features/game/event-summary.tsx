import type { GameEvent } from "@strix/contracts"
import { cn } from "cn"
import { infractionLabel, isPenalty } from "./format.ts"
import { NeedTags } from "./need-tags.tsx"
import { EVENT_STATUS_TONES } from "./tones.ts"
import { TypeBadge } from "./type-badge.tsx"

const infractionOf = (event: GameEvent) => (isPenalty(event.attrs) ? infractionLabel(event.attrs.infraction) : null)

export const EventSummary = ({ event }: { readonly event: GameEvent }) => {
  const infraction = infractionOf(event)
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-sm">
      <TypeBadge type={event.type} />
      {infraction === null ? null : <span className="truncate text-xs text-muted-foreground">{infraction}</span>}
      <span className={cn("rounded px-1.5 text-[0.7rem] font-medium", EVENT_STATUS_TONES[event.status])}>
        {event.status}
      </span>
      <NeedTags needs={event.needs} />
    </span>
  )
}
