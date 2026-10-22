import type { GameEvent } from "@strix/contracts"
import { detailFields } from "./detail-fields.ts"
import { EventActions } from "./event-actions.tsx"
import type { Teams } from "./types.ts"

interface EventDetailProps {
  readonly event: GameEvent | null
  readonly teams: Teams
}

export const EventDetail = ({ event, teams }: EventDetailProps) => (
  <section aria-label="Event detail" className="grid gap-3">
    {event === null ? (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Select an event to see what Strix found. j / k step through the list.
      </p>
    ) : (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-background p-3 sm:grid-cols-3">
        {detailFields(event, teams).map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="text-sm font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
    )}
    <EventActions />
  </section>
)
