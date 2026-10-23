import type { Game } from "@strix/contracts"
import { ClipPlayer } from "./clip-player.tsx"
import { EventDetail } from "./event-detail.tsx"
import { EventList } from "./event-list.tsx"
import { TimelineStrip } from "./timeline-strip.tsx"
import { useDashboard } from "./use-dashboard.ts"

export const Dashboard = ({ game }: { readonly game: Game }) => {
  const { events, showDiscarded, setShowDiscarded, selectedEvent, selectEvent, selectClip, videoRef, player, cells } =
    useDashboard(game.id)
  const teams = { home: game.home.name, away: game.away.name }
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card lg:flex-row">
      <EventList
        gameId={game.id}
        teams={teams}
        events={events}
        selectedId={selectedEvent?.id ?? null}
        onSelect={selectEvent}
        showDiscarded={showDiscarded}
        onShowDiscarded={setShowDiscarded}
      />
      <section aria-label="Review" className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        <ClipPlayer
          key={`${player.clip?.index ?? "none"}:${selectedEvent?.id ?? ""}`}
          gameId={game.id}
          clip={player.clip}
          startAtMs={player.startAtMs}
          autoPlay={player.autoPlay}
          ref={videoRef}
        />
        <TimelineStrip cells={cells} onSelect={selectClip} />
        <EventDetail event={selectedEvent} teams={teams} />
      </section>
    </div>
  )
}
