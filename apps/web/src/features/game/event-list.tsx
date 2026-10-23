import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { EventListBody } from "./event-list-body.tsx"
import type { ListedEvents, Teams } from "./types.ts"

interface EventListProps {
  readonly gameId: string
  readonly teams: Teams
  readonly events: ListedEvents
  readonly selectedId: string | null
  readonly onSelect: (id: string) => void
  readonly showDiscarded: boolean
  readonly onShowDiscarded: (show: boolean) => void
}

export const EventList = ({ showDiscarded, onShowDiscarded, ...body }: EventListProps) => (
  <section
    aria-labelledby="events-heading"
    className="flex min-h-0 flex-col border-b lg:w-[42%] lg:border-r lg:border-b-0"
  >
    <header className="flex items-center gap-3 border-b px-4 py-2.5">
      <h2 id="events-heading" className="text-sm font-semibold">
        Events
        <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{body.events.listed.length}</span>
      </h2>
      <div className="ml-auto flex items-center gap-2">
        <Switch id="show-discarded" size="sm" checked={showDiscarded} onCheckedChange={onShowDiscarded} />
        <Label htmlFor="show-discarded" className="text-xs font-normal text-muted-foreground">
          Show discarded
        </Label>
      </div>
    </header>
    <EventListBody {...body} />
  </section>
)
