/**
 * `@cloudflare/containers` ships source maps that point at sources it does not publish, so Vite warns once per file
 * while loading it. `withoutPublishedSourcemaps` loads that package's files without their source map comment.
 */
import { readFile } from "node:fs/promises"
import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineProject, type Plugin } from "vitest/config"

const UNMAPPED_PACKAGE = "/@cloudflare/containers/dist/"

const withoutPublishedSourcemaps: Plugin = {
  name: "strix:without-published-sourcemaps",
  enforce: "pre",
  async load(id) {
    if (!id.includes(UNMAPPED_PACKAGE)) return null
    const code = await readFile(id, "utf8")
    return code.replace(/^\/\/# sourceMappingURL=.*$/m, "")
  },
}

export default defineProject({
  plugins: [
    withoutPublishedSourcemaps,
    cloudflareTest({ remoteBindings: false, wrangler: { configPath: "./wrangler.jsonc", environment: "local" } }),
  ],
  test: { name: "worker" },
})
