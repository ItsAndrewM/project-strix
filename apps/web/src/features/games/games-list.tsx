import { useGames } from "@/api/games.ts"
import { describeError } from "@/lib/describe-error.ts"
import { GameCard } from "./game-card.tsx"

const Message = ({ children }: { readonly children: string }) => (
  <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>
)

export const GamesList = () => {
  const games = useGames()
  if (games.isPending) return <Message>Loading games…</Message>
  if (games.isError) return <Message>{describeError(games.error)}</Message>
  if (games.data.length === 0) return <Message>No games yet. Create one to start tagging.</Message>
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {games.data.map((game) => (
        <li key={game.id}>
          <GameCard game={game} />
        </li>
      ))}
    </ul>
  )
}
