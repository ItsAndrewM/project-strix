# Strix

Hockey video event tagger on Cloudflare. Point it at a game video and it slices the video into clips, asks Workers AI
what happens in each, and lists the goals, penalties and goalie changes it finds for review.

- `apps/web`: the React app, served with its Worker by the Cloudflare Vite plugin
- `apps/worker`: the Worker (API, Access, game Durable Object, classify queue)
- `apps/slicer`: the ffmpeg container that probes and slices videos
- `packages/contracts`, `packages/domain`: shared schemas and pure game logic

## Prerequisites

- Node 24 via nvm (`nvm install && nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable`, or install `pnpm@10`)
- Docker, to build the slicer container image

## Develop

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs `pnpm dev:prepare` first, which applies the D1 migrations to the local database the dev server uses.
The dev server runs the `local` environment: fixture videos instead of real slicing and classification, and every
request signed in as `andrew@example.test`. It needs no Cloudflare login: the `local` environment never calls Workers
AI or Media Transformations, so `pnpm dev` turns remote bindings off (`CLOUDFLARE_VITE_FORCE_LOCAL=true`).

## Check

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm e2e
```

`pnpm format` fixes formatting. `pnpm e2e` builds the `local` environment, serves it on port 4173 with `vite preview`
and runs the Playwright specs in `e2e/` against it; install the browser once with
`pnpm exec playwright install chromium`.

## Deploy

`docs/runbooks/setup.md` creates the Cloudflare resources once and does the first deploy by hand. After that,
`.github/workflows/deploy.yml` deploys every green `CI` run on `main`.

## Design

- `docs/superpowers/specs/2026-10-21-strix-design.md`: the design
- `docs/superpowers/plans/2026-10-21-strix-foundation-and-first-slice.md`: the plan for this first slice
