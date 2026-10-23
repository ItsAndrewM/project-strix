import type { Game } from "@strix/contracts"
import { Dashboard } from "./dashboard.tsx"
import { GameNotice } from "./game-notice.tsx"
import { ResourceForm } from "./resource-form.tsx"
import { StartPanel } from "./start-panel.tsx"

const PartialFailure = ({ failure }: { readonly failure: string | null }) =>
  failure === null ? null : (
    <GameNotice title="Some of the video is missing" failed>
      {failure}
    </GameNotice>
  )

export const GameBody = ({ game }: { readonly game: Game }) => {
  switch (game.status) {
    case "created":
      return game.durationMs === null ? (
        <GameNotice title="No video yet" action={<ResourceForm gameId={game.id} />}>
          Give this game a video source to begin.
        </GameNotice>
      ) : (
        <StartPanel game={game} />
      )
    case "probing":
      return <GameNotice title="Reading the video…">Strix is probing the source for its length and a frame.</GameNotice>
    case "failed":
      return (
        <GameNotice title="This game failed" failed action={<ResourceForm gameId={game.id} />}>
          {game.failure ?? "Something went wrong while processing the video."}
        </GameNotice>
      )
    default:
      return (
        <>
          <PartialFailure failure={game.failure} />
          <Dashboard game={game} />
        </>
      )
  }
}
