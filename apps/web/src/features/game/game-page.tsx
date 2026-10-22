import type { Changed } from "@strix/contracts"
import { useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useEffect } from "react"
import { gamesKeys, useGame } from "@/api/games.ts"
import { socketUrl, startLive } from "@/api/live.ts"
import { describeError } from "@/lib/describe-error.ts"
import { GameBody } from "./game-body.tsx"
import { GameHeader } from "./game-header.tsx"

const route = getRouteApi("/games/$gameId")

const ALL: ReadonlyArray<Changed> = ["game", "clips", "events"]

const KEYS = { game: gamesKeys.one, clips: gamesKeys.clips, events: gamesKeys.events } satisfies Record<
  Changed,
  (id: string) => ReadonlyArray<string>
>

const useLiveGame = (gameId: string) => {
  const queryClient = useQueryClient()
  useEffect(() => {
    const refetch = (changed: ReadonlyArray<Changed>) => {
      for (const kind of changed) void queryClient.invalidateQueries({ queryKey: KEYS[kind](gameId), exact: true })
    }
    const live = startLive({
      open: () => new WebSocket(socketUrl(window.location, gameId)),
      onChanged: refetch,
      onStale: () => refetch(ALL),
    })
    return live.stop
  }, [gameId, queryClient])
}

const GameView = ({ gameId }: { readonly gameId: string }) => {
  const game = useGame(gameId)
  if (game.isPending) return <p className="text-sm text-muted-foreground">Loading game…</p>
  if (game.isError) return <p className="text-sm text-destructive">{describeError(game.error)}</p>
  return (
    <>
      <GameHeader game={game.data} />
      <GameBody game={game.data} />
    </>
  )
}

export const GamePage = () => {
  const { gameId } = route.useParams()
  useLiveGame(gameId)
  return (
    <div className="grid gap-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        All games
      </Link>
      <GameView gameId={gameId} />
    </div>
  )
}
