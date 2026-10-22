import { defineConfig, devices } from "@playwright/test"

const PORT = 4173
const CI = Boolean(process.env.CI)
const ORIGIN = `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: ORIGIN,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev:prepare && CLOUDFLARE_ENV=local pnpm --filter @strix/web build && CLOUDFLARE_VITE_FORCE_LOCAL=true pnpm --filter @strix/web preview --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
})
