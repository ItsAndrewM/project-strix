import type { GameEvent } from "@strix/contracts"
import { cn } from "cn"
import { ConfidenceBar } from "./confidence-bar.tsx"
import { EventSummary } from "./event-summary.tsx"
import { formatVideoMs } from "./format.ts"
import { thumbUrl } from "./media.ts"

interface EventRowProps {
  readonly gameId: string
  readonly event: GameEvent
  readonly teamName: string
  readonly selected: boolean
  readonly onSelect: (id: string) => void
}

const revealRow = (node: HTMLButtonElement | null) => node?.scrollIntoView({ block: "nearest" })

export const EventRow = ({ gameId, event, teamName, selected, onSelect }: EventRowProps) => (
  <button
    type="button"
    ref={selected ? revealRow : undefined}
    aria-current={selected}
    onClick={() => onSelect(event.id)}
    className={cn(
      "flex w-full gap-3 px-4 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60",
      selected && "bg-muted shadow-[inset_3px_0_0_var(--foreground)] hover:bg-muted",
      event.status === "discarded" && "opacity-60",
    )}
  >
    <img
      src={thumbUrl(gameId, event.clipIndex)}
      alt=""
      loading="lazy"
      width={64}
      height={36}
      className="h-9 w-16 flex-none rounded bg-muted object-cover"
    />
    <span className="grid min-w-0 flex-1 gap-1">
      <span className="truncate text-[0.7rem] text-muted-foreground tabular-nums">
        {event.period === null ? "P?" : `P${event.period}`} · {formatVideoMs(event.videoMs)} · {teamName}
      </span>
      <EventSummary event={event} />
      <ConfidenceBar value={event.confidence} />
    </span>
  </button>
)
