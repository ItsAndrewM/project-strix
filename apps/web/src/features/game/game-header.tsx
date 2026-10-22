import type { Game } from "@strix/contracts"
import { StatusBadge } from "@/components/status-badge.tsx"
import { Badge } from "@/components/ui/badge"
import { HeaderCount } from "./header-count.tsx"

export const GameHeader = ({ game }: { readonly game: Game }) => (
  <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
    <div className="grid min-w-0 gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{game.name}</h1>
        <StatusBadge status={game.status} />
        <Badge variant="outline" className="capitalize">
          {game.mode}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {game.away.name} @ {game.home.name}
      </p>
    </div>
    <dl className="ml-auto flex flex-wrap items-center gap-2">
      <HeaderCount label="Drafts" value={String(game.counts.drafts)} alert={game.counts.drafts > 0} />
      <HeaderCount label="Needs" value={String(game.counts.needs)} alert={game.counts.needs > 0} />
      <HeaderCount label="Classified" value={`${game.counts.classified}/${game.counts.clips}`} alert={false} />
    </dl>
  </header>
)
