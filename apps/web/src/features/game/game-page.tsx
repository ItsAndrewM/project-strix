import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useGame } from "@/api/games.ts"
import { StatusBadge } from "@/components/status-badge.tsx"
import { describeError } from "@/lib/describe-error.ts"

const route = getRouteApi("/games/$gameId")

const GameSummary = ({ gameId }: { readonly gameId: string }) => {
  const game = useGame(gameId)
  if (game.isPending) return <p className="text-sm text-muted-foreground">Loading game…</p>
  if (game.isError) return <p className="text-sm text-destructive">{describeError(game.error)}</p>
  return (
    <header className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{game.data.name}</h1>
        <StatusBadge status={game.data.status} />
      </div>
      <p className="text-muted-foreground">
        {game.data.home.name} vs {game.data.away.name}
      </p>
    </header>
  )
}

export const GamePage = () => {
  const { gameId } = route.useParams()
  return (
    <div className="grid gap-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        All games
      </Link>
      <GameSummary gameId={gameId} />
    </div>
  )
}
