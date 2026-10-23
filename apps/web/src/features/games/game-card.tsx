import type { Game, GameCounts } from "@strix/contracts"
import { Link } from "@tanstack/react-router"
import { StatusBadge } from "@/components/status-badge.tsx"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const COUNT_LABELS: ReadonlyArray<{ readonly key: keyof GameCounts; readonly label: string }> = [
  { key: "clips", label: "Clips" },
  { key: "events", label: "Events" },
  { key: "drafts", label: "Drafts" },
  { key: "needs", label: "Needs" },
]

const created = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

export const GameCard = ({ game }: { readonly game: Game }) => (
  <Link
    to="/games/$gameId"
    params={{ gameId: game.id }}
    className="block rounded-xl transition-transform outline-none hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    <Card className="h-full transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="truncate text-base">{game.name}</CardTitle>
        <CardDescription className="truncate">
          {game.home.name} vs {game.away.name}
        </CardDescription>
        <CardAction>
          <StatusBadge status={game.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid grid-cols-4 gap-2">
          {COUNT_LABELS.map(({ key, label }) => (
            <div key={key} className="rounded-lg bg-muted px-2 py-1.5">
              <dt className="text-[0.7rem] tracking-wide text-muted-foreground uppercase">{label}</dt>
              <dd className="text-base font-semibold tabular-nums">{game.counts[key]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Created <time dateTime={new Date(game.createdAt).toISOString()}>{created.format(game.createdAt)}</time>
        </p>
      </CardContent>
    </Card>
  </Link>
)
