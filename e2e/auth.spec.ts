import { expect, test } from "@playwright/test"

const DEV_EMAIL = "andrew@example.test"

test("the api answers only through the dev identity and a forged token changes nothing", async ({ page }) => {
  const bare = await page.request.get("/api/games")
  expect(bare.status()).toBe(200)

  const forged = await page.request.get("/api/games", { headers: { "cf-access-jwt-assertion": "garbage" } })
  expect(forged.status()).toBe(200)
  expect(Array.isArray(await forged.json())).toBe(true)
})

test("no page or api response exposes the signed-in identity", async ({ page }) => {
  const responses: Array<Promise<string>> = []
  page.on("response", (response) => {
    if (response.url().includes("/api/")) responses.push(response.text())
  })

  const listed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/games")
  await page.goto("/")
  await listed
  await expect(page.getByRole("heading", { name: "Games" })).toBeVisible()

  await expect(page.locator("body")).not.toContainText(DEV_EMAIL)
  expect(await page.content()).not.toContain(DEV_EMAIL)
  const bodies = await Promise.all(responses)
  expect(bodies.length).toBeGreaterThan(0)
  for (const body of bodies) expect(body).not.toContain(DEV_EMAIL)
})
