import { DEFAULT_THRESHOLDS, type Game, TIMING_PRESETS } from "@strix/contracts"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { connectApi } from "../src/api/client.ts"
import { gamesKeys } from "../src/api/games.ts"
import { AppContext } from "../src/app-context.ts"
import { GameBody } from "../src/features/game/game-body.tsx"

const BASE = "https://strix.example.test"
const VIDEO = "https://video.example.test/game.mp4"

const failedGame: Game = {
  id: "g1",
  name: "Hawks at Eagles",
  home: { name: "Eagles", jersey: "white", roster: [] },
  away: { name: "Hawks", jersey: "black", roster: [] },
  mode: "review",
  level: "junior-pro",
  thresholds: DEFAULT_THRESHOLDS,
  timing: TIMING_PRESETS["junior-pro"],
  status: "failed",
  failure: "no slicer capacity: try again in a few minutes",
  crop: null,
  source: { kind: "url", url: VIDEO },
  durationMs: 75_000,
  createdAt: 0,
  counts: { clips: 0, classified: 0, events: 0, drafts: 0, needs: 0 },
}

type Answer = (request: Request) => Response

const renderBody = (game: Game, answer: Answer) => {
  const requests: Array<Request> = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init)
    requests.push(request.clone())
    return answer(request)
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AppContext value={{ api: connectApi({ baseUrl: BASE, fetch }) }}>
      <QueryClientProvider client={queryClient}>
        <GameBody game={game} />
      </QueryClientProvider>
    </AppContext>,
  )
  return { requests, queryClient, user: userEvent.setup() }
}

const probing = (request: Request) =>
  request.method === "POST" ? Response.json({ ...failedGame, status: "probing" }) : Response.json([])

afterEach(cleanup)

describe("GameBody", () => {
  it("shows why a game failed and re-sources it from the URL given", async () => {
    const { requests, queryClient, user } = renderBody(failedGame, probing)
    expect(screen.getByRole("alert").textContent).toContain("no slicer capacity: try again in a few minutes")

    await user.type(screen.getByLabelText("Video URL"), VIDEO)
    await user.click(screen.getByRole("button", { name: "Use this video" }))

    await vi.waitFor(() => expect(queryClient.getQueryData(gamesKeys.one("g1"))).toMatchObject({ status: "probing" }))
    const [request] = requests
    expect(request?.method).toBe("POST")
    expect(request?.url).toBe(`${BASE}/api/games/g1/source`)
    expect(await request?.json()).toEqual({ url: VIDEO })
  })

  it("asks for a video source on a created game that has none", () => {
    renderBody({ ...failedGame, status: "created", failure: null, source: null, durationMs: null }, probing)
    expect(screen.getByText("No video yet")).toBeTruthy()
    expect(screen.getByLabelText("Video URL")).toBeTruthy()
  })

  it("refuses a URL that isn't http or https without asking the server", async () => {
    const { requests, user } = renderBody(failedGame, probing)
    await user.type(screen.getByLabelText("Video URL"), "ftp://video.example.test/game.mp4")
    await user.click(screen.getByRole("button", { name: "Use this video" }))

    expect(screen.getByText("Enter an http or https URL")).toBeTruthy()
    expect(requests).toEqual([])
  })

  it("shows the server's refusal of the source", async () => {
    const refusal = Response.json(
      { _tag: "InvalidInput", fieldErrors: [{ path: "url", issue: "invalid" }] },
      { status: 400 },
    )
    const { user } = renderBody(failedGame, () => refusal)
    await user.type(screen.getByLabelText("Video URL"), VIDEO)
    await user.click(screen.getByRole("button", { name: "Use this video" }))

    expect(await screen.findByText("Check the video URL.")).toBeTruthy()
  })

  it("shows a partial slicing failure above the dashboard", async () => {
    const partial: Game = { ...failedGame, status: "classifying", failure: "2 windows could not be sliced" }
    renderBody(partial, () => Response.json([]))

    expect(screen.getByRole("alert").textContent).toContain("2 windows could not be sliced")
    expect(screen.queryByLabelText("Video URL")).toBeNull()
    expect(await screen.findByText("No clips yet")).toBeTruthy()
  })

  it("shows no failure notice for a game that sliced cleanly", () => {
    renderBody({ ...failedGame, status: "ready", failure: null }, () => Response.json([]))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
