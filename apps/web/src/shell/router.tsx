import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { GamePage } from "../features/game/game-page.tsx"
import { GamesPage } from "../features/games/games-page.tsx"
import { NotFoundPage } from "./not-found-page.tsx"
import { Shell } from "./shell.tsx"

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFoundPage })
const getParentRoute = () => rootRoute

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute, path: "/", component: GamesPage }),
  createRoute({ getParentRoute, path: "/games/$gameId", component: GamePage }),
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
