import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      "packages/*/vitest.config.ts",
      "apps/worker/vitest.config.ts",
      "apps/web/vitest.config.ts",
      "apps/web/vitest.dom.config.ts",
      "apps/slicer/vitest.config.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/domain/src/**/*.ts"],
      thresholds: { 100: true },
    },
  },
})
