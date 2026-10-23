import { DEFAULT_THRESHOLDS, type NewGame, TIMING_PRESETS } from "@strix/contracts"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CreateGameForm } from "../src/features/games/create-game-form.tsx"

afterEach(cleanup)

const setup = () => {
  const onSubmit = vi.fn<(game: NewGame, url: string) => void>()
  render(<CreateGameForm onSubmit={onSubmit} pending={false} />)
  return { onSubmit, user: userEvent.setup() }
}

const fillGame = async (user: ReturnType<typeof userEvent.setup>, homeRoster: string) => {
  await user.type(screen.getByLabelText("Game name"), "Hawks at Eagles")
  await user.type(screen.getByLabelText("Home team"), "Eagles")
  await user.type(screen.getByLabelText("Home jersey"), "white")
  await user.type(screen.getByLabelText("Home roster"), homeRoster)
  await user.type(screen.getByLabelText("Away team"), "Hawks")
  await user.type(screen.getByLabelText("Away jersey"), "black")
  await user.type(screen.getByLabelText("Away roster"), "9")
  await user.type(screen.getByLabelText("Video URL"), "https://video.example.test/game.mp4")
}

describe("CreateGameForm", () => {
  it("submits a NewGame with the junior-pro timing preset and the video URL", async () => {
    const { onSubmit, user } = setup()
    await fillGame(user, "7, 12, ,30")
    await user.click(screen.getByRole("button", { name: "Create game" }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      {
        name: "Hawks at Eagles",
        home: { name: "Eagles", jersey: "white", roster: [7, 12, 30] },
        away: { name: "Hawks", jersey: "black", roster: [9] },
        mode: "review",
        level: "junior-pro",
        thresholds: DEFAULT_THRESHOLDS,
        timing: TIMING_PRESETS["junior-pro"],
      },
      "https://video.example.test/game.mp4",
    )
  })

  it("shows the level's timing read-only", () => {
    setup()
    expect(screen.getByText("20 min periods")).toBeTruthy()
    expect(screen.getByText("8 min intermissions")).toBeTruthy()
    expect(screen.getByText("3 min ambiguous")).toBeTruthy()
  })

  it("submits auto mode once it is toggled on", async () => {
    const { onSubmit, user } = setup()
    await fillGame(user, "7")
    await user.click(screen.getByRole("button", { name: "Auto" }))
    await user.click(screen.getByRole("button", { name: "Create game" }))
    expect(onSubmit.mock.calls[0]?.[0].mode).toBe("auto")
  })

  it("shows an error for a roster that isn't jersey numbers and does not submit", async () => {
    const { onSubmit, user } = setup()
    await fillGame(user, "7, twelve")
    await user.click(screen.getByRole("button", { name: "Create game" }))
    expect(screen.getByText("Use jersey numbers 0–99, separated by commas")).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("rejects a video URL that isn't http or https", async () => {
    const { onSubmit, user } = setup()
    await fillGame(user, "7")
    await user.clear(screen.getByLabelText("Video URL"))
    await user.type(screen.getByLabelText("Video URL"), "ftp://video.example.test/game.mp4")
    await user.click(screen.getByRole("button", { name: "Create game" }))
    expect(screen.getByText("Enter an http or https URL")).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("shows the error it is given", () => {
    render(
      <CreateGameForm
        onSubmit={vi.fn<(game: NewGame, url: string) => void>()}
        pending={false}
        error="Home team name is invalid"
      />,
    )
    expect(screen.getByText("Home team name is invalid")).toBeTruthy()
  })
})
