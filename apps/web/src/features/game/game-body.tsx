import type { Game } from "@strix/contracts"
import { Dashboard } from "./dashboard.tsx"
import { GameNotice } from "./game-notice.tsx"
import { StartPanel } from "./start-panel.tsx"

export const GameBody = ({ game }: { readonly game: Game }) => {
  switch (game.status) {
    case "created":
      return game.durationMs === null ? (
        <GameNotice title="No video yet">Give this game a video source to begin.</GameNotice>
      ) : (
        <StartPanel game={game} />
      )
    case "probing":
      return <GameNotice title="Reading the video…">Strix is probing the source for its length and a frame.</GameNotice>
    case "failed":
      return (
        <GameNotice title="This game failed" failed>
          {game.failure ?? "Something went wrong while processing the video."}
        </GameNotice>
      )
    default:
      return <Dashboard game={game} />
  }
}
