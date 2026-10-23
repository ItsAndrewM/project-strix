import { describeError } from "@/lib/describe-error.ts"
import { EventRow } from "./event-row.tsx"
import type { ListedEvents, Teams } from "./types.ts"

interface EventListBodyProps {
  readonly gameId: string
  readonly teams: Teams
  readonly events: ListedEvents
  readonly selectedId: string | null
  readonly onSelect: (id: string) => void
}

const Notice = ({ children }: { readonly children: string }) => (
  <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
)

export const EventListBody = ({ gameId, teams, events, selectedId, onSelect }: EventListBodyProps) => {
  if (events.error !== null) return <Notice>{describeError(events.error)}</Notice>
  if (events.isPending) return <Notice>Loading events…</Notice>
  if (events.listed.length === 0) return <Notice>No events yet. They appear here as clips are classified.</Notice>
  return (
    <ul className="max-h-[32rem] divide-y overflow-y-auto lg:max-h-[42rem]">
      {events.listed.map((event) => (
        <li key={event.id}>
          <EventRow
            gameId={gameId}
            event={event}
            teamName={teams[event.team]}
            selected={event.id === selectedId}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  )
}
