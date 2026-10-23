import { fileURLToPath } from "node:url"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ configPath: "../worker/wrangler.jsonc" })],
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                { name: "effect", test: /node_modules[\\/].*effect/u },
                { name: "react", test: /node_modules[\\/].*(react|scheduler)/u },
                { name: "vendor", test: /node_modules/u },
              ],
            },
          },
        },
      },
    },
  },
})
