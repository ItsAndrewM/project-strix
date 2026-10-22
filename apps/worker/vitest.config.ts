import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineProject } from "vitest/config"

export default defineProject({
  plugins: [
    cloudflareTest({ remoteBindings: false, wrangler: { configPath: "./wrangler.jsonc", environment: "local" } }),
  ],
  test: { name: "worker" },
})
