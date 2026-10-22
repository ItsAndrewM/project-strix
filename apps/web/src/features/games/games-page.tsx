import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CreateGameForm } from "./create-game-form.tsx"
import { GamesList } from "./games-list.tsx"
import { useAddGame } from "./use-add-game.ts"

export const GamesPage = () => {
  const { submit, pending, error } = useAddGame()
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start">
      <section aria-labelledby="games-heading" className="grid gap-4">
        <h1 id="games-heading" className="text-2xl font-semibold tracking-tight">
          Games
        </h1>
        <GamesList />
      </section>
      <Card className="lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle className="text-base">New game</CardTitle>
          <CardDescription>Point Strix at a game video and it will find the events.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateGameForm onSubmit={submit} pending={pending} error={error} />
        </CardContent>
      </Card>
    </div>
  )
}
