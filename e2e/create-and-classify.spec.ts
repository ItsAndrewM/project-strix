import { expect, test } from "@playwright/test"

test("creates a game from a url, slices it and classifies its clips", async ({ page }) => {
  await page.goto("/")

  await page.getByLabel("Game name").fill(`E2E ${Date.now()}`)
  await page.getByLabel("Home team").fill("Hawks")
  await page.getByLabel("Home jersey").fill("white")
  await page.getByLabel("Home roster").fill("2, 7, 19")
  await page.getByLabel("Away team").fill("Eagles")
  await page.getByLabel("Away jersey").fill("black")
  await page.getByLabel("Away roster").fill("4, 11, 30")
  await page.getByRole("button", { name: "Auto", exact: true }).click()
  await page.getByLabel("Level").click()
  await page.getByRole("option", { name: "Junior / pro" }).click()
  await page.getByLabel("Video URL").fill("https://example.com/game.mp4")
  await page.getByRole("button", { name: "Create game" }).click()

  await expect(page).toHaveURL(/\/games\/[^/]+$/u)
  await page.getByRole("switch", { name: "No overlay" }).click()
  await page.getByRole("button", { name: "Start", exact: true }).click()

  const timeline = page.getByRole("list", { name: "Clip timeline" })
  await expect(timeline.getByRole("button")).toHaveCount(3)

  const events = page.getByRole("region", { name: /^Events/u })
  const goal = events.getByRole("button").filter({ hasText: "Goal" }).filter({ hasText: "auto" })
  await expect(goal).toHaveCount(1)
  await goal.click()
  await expect(page.locator("video")).toHaveAttribute("src", /\/clips\/0\/view\.mp4$/u)

  const penalties = events.getByRole("button").filter({ hasText: "Penalty" })
  await expect(penalties).toHaveCount(0)
  await page.getByRole("switch", { name: "Show discarded" }).click()
  await expect(penalties.filter({ hasText: "discarded" })).toHaveCount(1)
})
