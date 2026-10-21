# Strix foundation and first slice: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed site at `strix.andamonium.dev` where a signed-in user creates a game from a video URL, the game is sliced into clips by a container, every clip is classified by Clef-omni, and goals, penalties and goalie changes appear in a dashboard with a player, a timeline and confidence, in auto or review status.

**Architecture:** pnpm monorepo copied from the huckleberry clone's shape. A Worker (Effect) fronts everything behind Cloudflare Access, keeps a games index in D1, and runs one `GameDO` Durable Object per game. The DO drives a `SlicerContainer` (ffmpeg) over presigned R2 URLs, enqueues one classify job per clip on a Queue, interprets Clef answers into events with domain code, and pushes changes to the dashboard over a WebSocket. The web app is Vite 8, React 19, TanStack Router and Query, Tailwind v4, shadcn on Base UI. A `local` environment replaces the container, Clef and R2 presigning with fixtures so tests and e2e run without the account.

**Tech Stack:** TypeScript 5.9, Node 24.21, pnpm 10.32, Effect 4, Cloudflare Workers, Durable Objects, Containers (`@cloudflare/containers`), R2, D1, Queues, Workers AI (`@cf/cloudflare/clef-omni`), `aws4fetch`, `jose`, Vite 8, React 19, TanStack Router and Query, Tailwind v4, shadcn (base-nova), vitest 4, `@cloudflare/vitest-plugin`, Playwright, oxlint, oxfmt, ffmpeg in Debian slim.

**Spec:** `docs/superpowers/specs/2026-10-21-strix-design.md`. This plan implements build-order steps 1 and 2. Steps 3 to 6 (placement passes, period inference, needs queue, file upload, review mode, box score) are later plans.

## Global Constraints

- Node `>=24.21.0 <25`, `packageManager` `pnpm@10.32.1`, `.nvmrc` `24.21.0`.
- Catalog pins copied verbatim from `/Users/andamonium/Developer/experimental/huckleberry-clone/pnpm-workspace.yaml`, plus `@cloudflare/containers: 0.3.7` and `aws4fetch: 1.0.20`. Remove `@date-fns/tz`, `date-fns`, `@effect/sql-sqlite-do`, `@tanstack/charts`.
- `oxlint.config.ts` and `oxfmt.config.ts` copied from the clone with `@bt/` renamed `@strix/`, the date-fns rule removed, and a `packages/domain` boundary that forbids `@strix/**`, `effect`, `react`, `cloudflare:*`, `node:*`. All `anti-slop/*` rules on, `gamesheet/no-comments` on, `complexity` max 10, `denyWarnings`.
- `tsconfig.base.json` copied verbatim: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`.
- Package scope `@strix`: `@strix/domain`, `@strix/contracts`, `@strix/web`, `@strix/worker`, `@strix/slicer`.
- `@strix/domain` imports nothing from the workspace and no framework. `@strix/contracts` imports `@strix/domain` and `effect` only. `@strix/web` never imports `@strix/worker`; `@strix/worker` never imports `@strix/web`.
- No comments in code except a top-of-file JSDoc block where a file needs explanation, and `// SAFETY:` lines the lint rule requires on type assertions.
- "Tests pass" means `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all exit 0.
- Git identity for this repo: `user.name ItsAndrewM`, `user.email mcmillan.r.andrew@gmail.com` (local config). Branch `main`. Commit after every task with a conventional message.
- Clips: 30,000 ms windows every 25,000 ms. Renditions `model-480` (crop, 854×480), `model-720` (crop, 1280×720), `view` (no crop, 854×480), all H.264 and AAC. R2 keys `originals/<gameId>.mp4`, `clips/<gameId>/<index>/<rendition>.mp4`, `thumbs/<gameId>/<index>.jpg`.
- Clef-omni: model id `@cf/cloudflare/clef-omni`, request field `model: "clef-omni"`, one video per call as `{ content_type: "video/mp4", base64 }`, at most 64 questions.
- Thresholds defaults `autoSave 80, draft 40, period 85, scorer 70, assist 50`. Level presets: `youth-running` 15/1/0.5, `youth-stop` 15/3/1, `junior-pro` 20/8/3 for `periodMinutes`, `intermissionMin`, `ambiguousMin`.
- Hostname `strix.andamonium.dev` as a Custom Domain only. `workers_dev: false`, `preview_urls: false`.
- Account id `6624f09210327baade61004af0d9be84`.

## Review Focus

1. A game created with a URL that is not an MP4 or HLS source, or that 404s: the game must land in `failed` with a readable reason, never hang in `probing`. Test in Task 9.
2. A `slice` job whose container dies mid-range: the DO must mark the range failed and leave already-recorded clips intact, so a retry only redoes missing windows. Test in Task 9.
3. A clip whose `model-480` rendition exceeds 14 MiB after encoding: the consumer must record a failed classification rather than send an oversized request. Test in Task 11.
4. Clef answering with a question id missing or a different `type` than asked: the reader must fail that clip loudly, not produce an event with confidence 0. Test in Task 10.
5. Two overlapping clips both reporting the same goal: exactly one event, placed at the earlier clip's start. Test in Task 3.

---

### Task 1: Repository, tooling, CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitignore`, `.npmrc`, `tsconfig.base.json`, `tsconfig.json`, `oxlint.config.ts`, `oxfmt.config.ts`, `vitest.config.ts`, `README.md`
- Create: `tools/oxlint/anti-slop/**` (copy from the clone)
- Create: `packages/domain/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Create: `packages/contracts/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Create: `apps/worker/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Create: `apps/web/{package.json,tsconfig.json,vitest.config.ts,vite.config.ts,index.html,src/main.tsx,src/index.css}`
- Create: `apps/slicer/{package.json,tsconfig.json,vitest.config.ts,src/server.ts}`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: workspace scripts `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm dev`, `pnpm e2e`; the `@strix/*` packages every later task adds to.

- [ ] **Step 1: Initialise git identity and ignore files**

Run in `/Users/andamonium/Developer/experimental/project-strix`:

```bash
git config user.name ItsAndrewM && git config user.email mcmillan.r.andrew@gmail.com
```

`.gitignore`: `node_modules`, `dist`, `.wrangler`, `.dev.vars*`, `.env*`, `coverage`, `playwright-report`, `test-results`, `.superpowers/`, `.claude/settings.local.json`.

- [ ] **Step 2: Copy tooling from the clone**

Copy `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `oxlint.config.ts`, `oxfmt.config.ts`, `.nvmrc` and `tools/oxlint/anti-slop/` from `/Users/andamonium/Developer/experimental/huckleberry-clone`. Apply the Global Constraints edits: catalog entries, `@bt/` to `@strix/`, drop the date rule, domain boundary. `oxfmt` ignore list: drop the clone's `docs/api.json` and `packages/domain/data/who/**`; keep the rest.

Root `package.json`: name `strix`, `private`, `type: module`, scripts
`dev` = `pnpm --filter @strix/web dev`, `build` = `pnpm --filter @strix/web build`,
`lint` = `oxlint --disable-nested-config . && oxfmt --disable-nested-config --check .`,
`format` = `oxfmt --disable-nested-config .`,
`typecheck` = `tsc -p tsconfig.json && pnpm -r typecheck`,
`test` = `vitest run`, `coverage` = `vitest run --project domain --coverage`,
`e2e` = `playwright test`. Dev dependencies as in the clone's root (`@gamesheet-inc/oxlint-plugin`, `@oxlint/plugins`, `@playwright/test`, `@types/node`, `@vitest/coverage-v8`, `oxfmt`, `oxlint`, `typescript`, `vitest`), all `catalog:`.

- [ ] **Step 3: Create the five packages as empty shells**

Each `package.json` is modelled on the clone's counterpart (`@bt/domain`, `@bt/contracts`, `@bt/web`, `@bt/worker`), renamed. `@strix/domain` has no dependencies. `@strix/slicer`: `private`, `type: module`, scripts `typecheck` and nothing else, dev dependencies `typescript`, `vitest`, `@types/node`. Each `src/index.ts` exports an empty object or, for the worker, a fetch handler returning 404, and for `apps/web/src/main.tsx`, a root that renders the text `Strix`. `vitest.config.ts` per package as in the clone (`defineProject` with the project name). Root `vitest.config.ts` lists projects `packages/*/vitest.config.ts`, `apps/worker/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/slicer/vitest.config.ts`; coverage includes `packages/domain/src/**` with threshold 100.

`apps/web/vite.config.ts`: plugins `react()`, `tailwindcss()`, `cloudflare({ configPath: "../worker/wrangler.jsonc" })`, alias `@` to `src`. `apps/worker/wrangler.jsonc` is created in Task 8; until then give it a minimal file with `name: "strix"`, `main: "src/index.ts"`, `compatibility_date: "2026-10-06"`, `account_id`, `workers_dev: false`, `preview_urls: false`, `routes: [{ pattern: "strix.andamonium.dev", custom_domain: true }]`, `assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] }` and an `env.local` with `routes: []`.

- [ ] **Step 4: Install and verify the gate passes on the empty shells**

Run: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all exit 0; vitest reports no test files for each project without failing (set `passWithNoTests: true` in the root config).

- [ ] **Step 5: CI workflow**

`.github/workflows/ci.yml` copied from the clone with the `pins:check`, `coverage`, `bundle:check` steps removed and the e2e job kept but `playwright install --with-deps chromium` only. Add `docker/setup-buildx-action@v3` to the `check` job before `pnpm build` so a later Wrangler build of the container image can run.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold strix monorepo with clone tooling and CI"
```

---

### Task 2: Contracts

**Files:**
- Create: `packages/contracts/src/{errors.ts,game.ts,clip.ts,event.ts,clef.ts,api.ts,socket.ts,index.ts}`
- Test: `packages/contracts/test/{game.test.ts,event.test.ts,clef.test.ts}`

**Interfaces:**
- Produces (all Effect `Schema`, each with a `type X = typeof X.Type` export):
  - `errors.ts`: `Unauthorized`, `InvalidInput` + `invalidInputFrom(issue)`, `NotFound`, `ServiceUnavailable`, copied from the clone's `errors.ts` minus `Conflict`, `RateLimited` and the domain `VALIDATION_ISSUES` import (`FieldIssue` is `Schema.Literals(["invalid"])`).
  - `game.ts`: `Side = Literals(["home","away"])`, `Mode = Literals(["auto","review"])`, `Level = Literals(["youth-running","youth-stop","junior-pro"])`, `JerseyNumber = Int between 0 and 99`, `Team = Struct({ name: NonEmptyString, jersey: NonEmptyString, roster: Array(JerseyNumber) })`, `Thresholds = Struct({ autoSave, draft, period, scorer, assist })` each `Int` 1 to 100, `Timing = Struct({ periodMinutes: Int 1..60, intermissionMin: Finite >= 0, ambiguousMin: Finite >= 0 })`, `Crop = Struct({ x, y, width, height })` non-negative `Int`, `Source = Union([Struct({ kind: Literal("url"), url: String }), Struct({ kind: Literal("upload"), key: String })])`, `GameStatus = Literals(["created","probing","slicing","classifying","ready","failed"])`, `GameCounts = Struct({ clips, classified, events, drafts, needs })` all `Int`, `NewGame = Struct({ name, home: Team, away: Team, mode, level, thresholds: optional(Thresholds), timing: optional(Timing) })`, `Game = Struct({ id, name, home, away, mode, level, thresholds, timing, status, failure: NullOr(String), crop: NullOr(Crop), source: NullOr(Source), durationMs: NullOr(Int), createdAt: Int, counts: GameCounts })`, constants `DEFAULT_THRESHOLDS`, `TIMING_PRESETS: Record<Level, Timing>`.
  - `clip.ts`: `GameState = Literals(["live","stoppage","intermission","warmup","empty"])`, `Rendition = Literals(["model-480","model-720","view"])`, `Clip = Struct({ index: Int, startMs: Int, durationMs: Int, renditions: Array(Rendition), state: NullOr(GameState), stateConfidence: NullOr(Int), classification: Literals(["pending","done","failed"]) })`.
  - `event.ts`: `EventType = Literals(["goal","penalty","goalie_change"])`, `EventStatus = Literals(["auto","draft","accepted","rejected","manual","discarded"])`, `Need = Literals(["time","scorer","assists","player"])`, `Infraction = Literals([...the 15 from the spec as snake_case ids])`, `PenaltyClass = Literals(["minor","double_minor","major","misconduct"])`, `PENALTY_MINUTES: Record<PenaltyClass, 2|4|5|10>`, `GoalAttrs = Struct({ scorer: NullOr(JerseyNumber), scorerConfidence: NullOr(Int), assists: Array(Struct({ jersey, confidence })) })`, `PenaltyAttrs = Struct({ infraction, infractionConfidence: Int, class: PenaltyClass, classConfidence: Int, player: NullOr(JerseyNumber) })`, `GoalieChangeAttrs = Struct({})`, `GameEvent = Struct({ id: String, type, team: Side, teamConfidence: Int, videoMs: Int, precisionMs: Int, clipIndex: Int, confidence: Int, status, needs: Array(Need), period: NullOr(Int), clock: NullOr(String), attrs: Union([GoalAttrs, PenaltyAttrs, GoalieChangeAttrs]), createdAt: Int })`.
  - `clef.ts`: `ClefQuestion = Union([Struct({ type: Literal("noul"), instructions }), Struct({ type: Literal("choice"), instructions, criteria: Record(String, String) }), Struct({ type: Literal("score"), instructions, criteria: Array(String) })])`, `ClefVideo = Struct({ content_type: Literal("video/mp4"), base64: String })`, `ClefRequest = Struct({ model: Literal("clef-omni"), state: Json, questions: Record(String, ClefQuestion), videos: Array(ClefVideo) })`, `ClefAnswer = Union([Struct({ type: Literal("noul"), noul: Finite }), Struct({ type: Literal("choice"), choice: String, probabilities: Record(String, Finite), confidence: Finite }), Struct({ type: Literal("score"), score: Finite, legend: Record(String, String), probabilities: Record(String, Finite), confidence: Finite })])`, `ClefResponse = Struct({ model: String, answers: Record(String, ClefAnswer), usage: Struct({ input_tokens: Int, output_tokens: Int }) })`.
  - `api.ts`: `CurrentUser` context service holding `{ email: string }`, `Authorization` middleware (error `Unauthorized`, provides `CurrentUser`), `InvalidInputs` middleware, and `Api` with groups: `games` (`listGames` GET `/games` → `Array(Game)`; `createGame` POST `/games` payload `NewGame` → `Game`; `getGame` GET `/games/:id` → `Game`, 404 `NotFound`; `setSource` POST `/games/:id/source` payload `Struct({ url: String })` → `Game`; `startGame` POST `/games/:id/start` payload `Struct({ crop: NullOr(Crop) })` → `Game`), `clips` (`listClips` GET `/games/:id/clips` → `Array(Clip)`), `events` (`listEvents` GET `/games/:id/events` → `Array(GameEvent)`), prefixed `/api`, both middlewares, `ParseOptions errors: "all"`.
  - `socket.ts`: `socketPath(gameId: string): string` = `/api/games/<id>/ws`, `HEARTBEAT = { ping: "ping", pong: "pong" }`, `Changed = Literals(["game","clips","events"])`, `ChangedMessage = Struct({ changed: Array(Changed) })`.
  - `index.ts`: barrel of all of the above.

- [ ] **Step 1: Write failing tests**

`game.test.ts`: `NewGame` decodes a minimal valid payload; rejects roster `100`; `TIMING_PRESETS["junior-pro"]` equals `{ periodMinutes: 20, intermissionMin: 8, ambiguousMin: 3 }`; `DEFAULT_THRESHOLDS` equals `{ autoSave: 80, draft: 40, period: 85, scorer: 70, assist: 50 }`.
`event.test.ts`: `GameEvent` round-trips through `Schema.toCodecJson` for a goal with two assists and for a penalty; `PENALTY_MINUTES.double_minor === 4`.
`clef.test.ts`: `ClefResponse` decodes the three answer shapes from the spec's output schema; decoding fails when `noul` is the string `"0.5"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run --project contracts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the schemas**

Follow the clone's style (`Schema.Struct`, `Schema.Literals`, `Schema.Int.check(...)`); never `Schema.Number`.

- [ ] **Step 4: Run tests and the gate**

Run: `pnpm vitest run --project contracts && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts && git commit -m "feat(contracts): game, clip, event, clef and api schemas"
```

---

### Task 3: Domain: windows, thresholds, confidence, overlap merge

**Files:**
- Create: `packages/domain/src/{index.ts,windows.ts,thresholds.ts,confidence.ts,merge.ts}`
- Test: `packages/domain/test/{windows.test.ts,thresholds.test.ts,confidence.test.ts,merge.test.ts}`

**Interfaces:**
- Produces:
  - `windows.ts`: `WINDOW_MS = 30_000`, `STEP_MS = 25_000`, `RANGE_MS = 600_000`; `interface Window { readonly index: number; readonly startMs: number; readonly durationMs: number }`; `windowsFor(durationMs: number): ReadonlyArray<Window>` (last window shortened to the remaining duration, minimum 5,000 ms or dropped); `interface Range { readonly startMs: number; readonly endMs: number; readonly windows: ReadonlyArray<Window> }`; `rangesFor(durationMs: number): ReadonlyArray<Range>` grouping windows whose `startMs` falls in each 600,000 ms range.
  - `thresholds.ts`: `type Mode = "auto" | "review"`; `interface Thresholds { autoSave: number; draft: number }` (the other three are unused until later plans); `type Decision = "auto" | "draft" | "discarded"`; `decide(confidence: number, mode: Mode, thresholds: Thresholds): Decision | null`.
  - `confidence.ts`: `percentOf(probability: number): number` = `Math.round(p * 100)` clamped to 1..100; `argmax(probabilities: ReadonlyMap<string, number>): { key: string; probability: number }`.
  - `merge.ts`: `MERGE_WITHIN_MS = 15_000`; `interface Mergeable { readonly type: string; readonly team: string; readonly clipIndex: number; readonly videoMs: number; readonly confidence: number }`; `mergeAdjacent<T extends Mergeable>(events: ReadonlyArray<T>): ReadonlyArray<T>` keeps, for any two events of equal `type` and `team` from clip indexes differing by 1 whose `videoMs` differ by at most 15,000, the one with the higher confidence, and gives it the earlier `videoMs` and the lower `clipIndex`.

- [ ] **Step 1: Write failing tests**

`windows.test.ts`: `windowsFor(60_000)` → indexes 0,1,2 at 0, 25,000, 50,000 with durations 30,000, 30,000, 10,000; `windowsFor(4_000)` → empty; `rangesFor(1_250_000)` → 3 ranges, the second holding windows with `startMs` in `[600_000, 1_200_000)`; property test (fast-check): windows cover every millisecond of `[0, durationMs)` for durations up to 4 hours.
`thresholds.test.ts`: with `{ autoSave: 80, draft: 40 }`: `decide(80,"auto")` → `"auto"`, `decide(79,"auto")` → `"discarded"`, `decide(39,"auto")` → `null`, `decide(40,"review")` → `"draft"`, `decide(95,"review")` → `"draft"`.
`confidence.test.ts`: `percentOf(0)` → 1, `percentOf(0.004)` → 1, `percentOf(0.715)` → 72, `percentOf(1)` → 100; `argmax` of `{a: 0.2, b: 0.7, c: 0.1}` → `{ key: "b", probability: 0.7 }`.
`merge.test.ts`: goal in clip 3 at 90,000 (conf 71) and goal in clip 4 at 100,000 (conf 84) → one event, conf 84, videoMs 90,000, clipIndex 3; same but clips 3 and 5 → two events; different teams → two events (Review Focus 5).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run --project domain`
Expected: FAIL.

- [ ] **Step 3: Implement**

Plain TypeScript, no imports.

- [ ] **Step 4: Run tests, coverage and the gate**

Run: `pnpm coverage && pnpm lint && pnpm typecheck`
Expected: PASS with 100% domain coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/domain && git commit -m "feat(domain): clip windows, decisions, confidence and overlap merge"
```

---

### Task 4: Worker skeleton: Access, errors, logs, games index in D1

**Files:**
- Create: `apps/worker/src/{index.ts,access.ts,error-response.ts,logs.ts,api-router.ts,env.ts}`
- Create: `apps/worker/src/games-index/{games-index.ts,schema.sql}`
- Create: `apps/worker/migrations/0001-games.sql` (D1 migration, same SQL as `schema.sql`)
- Create: `apps/worker/wrangler.jsonc` (full, see Step 3)
- Test: `apps/worker/test/{access.test.ts,games-index.test.ts,api-router.test.ts}`

**Interfaces:**
- Consumes: `@strix/contracts` `Game`, `NewGame`, `Unauthorized`, `NotFound`, `ServiceUnavailable`.
- Produces:
  - `access.ts`: copied from the clone verbatim (`Caller`, `callerOf`, `remoteAccessKeys`).
  - `error-response.ts`, `logs.ts`: copied, `x-bt-` renamed `x-strix-`, `caregiver` wording removed.
  - `env.ts`: `interface Env { readonly DB: D1Database; readonly BUCKET: R2Bucket; readonly AI: Ai; readonly MEDIA: MediaBinding (typed as `unknown` until Task 12 needs it); readonly GAME: DurableObjectNamespace; readonly SLICER: DurableObjectNamespace; readonly CLASSIFY: Queue<{ gameId: string; clipIndex: number; pass: 1 }>; readonly ACCESS_TEAM_DOMAIN?: string; readonly ACCESS_AUD?: string; readonly R2_ACCESS_KEY_ID?: string; readonly R2_SECRET_ACCESS_KEY?: string; readonly R2_ENDPOINT?: string; readonly FIXTURES?: "1" }`.
  - `games-index.ts`: `insertGame(db: D1Database, game: Game): Promise<void>`, `listGames(db): Promise<ReadonlyArray<Game>>` newest first, `updateGame(db, game: Game): Promise<void>` (replaces the JSON blob and the status and counts columns). Table `games (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL)`.
  - `api-router.ts`: `routeApi(request: Request, caller: Caller, env: Env): Promise<Response>`: refuses unauthenticated callers with 401, service tokens with 401; `GET /api/games` and `POST /api/games` are answered here (create: decode `NewGame`, build a `Game` with `crypto.randomUUID()`, `status "created"`, thresholds and timing filled from defaults and preset, `counts` zero, insert in D1, then call `env.GAME.getByName(id)` RPC `create(game)`); every other `/api/games/:id/...` path is forwarded to that game's DO `fetch` with an `x-strix-email` header, as the clone does; the DO's 404 for an unknown game passes through.
  - `index.ts`: default export with `fetch` (only `/api/*`, else 404, assets handle the rest) and `queue` (delegates to Task 11's consumer; until then, a function that acks every message); exports placeholder `GameDO` and `SlicerContainer` classes (each `extends DurableObject` with no behaviour) that Tasks 5, 6 and 8 replace. Task 6 narrows `Env.GAME` to `DurableObjectNamespace<GameDO>` and Task 8 narrows `Env.SLICER`.

- [ ] **Step 1: Write failing tests**

Use `@cloudflare/vitest-plugin` with `env` from `cloudflare:test`.
`access.test.ts`: copy the clone's access tests for `callerOf` (no token → `no-token`; dev identity → user).
`games-index.test.ts`: insert two games, `listGames` returns newest first; `updateGame` changes status.
`api-router.test.ts`: `POST /api/games` with a valid `NewGame` and the local identity returns 200 with a `Game` whose `thresholds` equal `DEFAULT_THRESHOLDS` and `timing` equals the `junior-pro` preset; `GET /api/games` lists it; an unauthenticated request returns 401.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run --project worker`
Expected: FAIL.

- [ ] **Step 3: Write `wrangler.jsonc`**

Top level: `name "strix"`, `main`, `compatibility_date "2026-10-06"`, `account_id`, `routes` Custom Domain, `workers_dev false`, `preview_urls false`, `observability { enabled: true, logs: { invocation_logs: false } }`, `assets` as Task 1, `vars { ACCESS_TEAM_DOMAIN: "https://misty-wildflower-0505.cloudflareaccess.com", ACCESS_AUD: "" (filled in Task 15), R2_ENDPOINT: "https://6624f09210327baade61004af0d9be84.r2.cloudflarestorage.com" }`, `d1_databases [{ binding: "DB", database_name: "strix", database_id: "" (Task 15), migrations_dir: "migrations" }]`, `r2_buckets [{ binding: "BUCKET", bucket_name: "strix" }]`, `ai { binding: "AI" }`, `media { binding: "MEDIA" }`, `queues { producers: [{ binding: "CLASSIFY", queue: "strix-classify" }], consumers: [{ queue: "strix-classify", max_batch_size: 1, max_retries: 3, dead_letter_queue: "strix-classify-dlq" }] }`, `durable_objects.bindings [{ name: "GAME", class_name: "GameDO" }, { name: "SLICER", class_name: "SlicerContainer" }]`, `migrations [{ tag: "v1", new_sqlite_classes: ["GameDO", "SlicerContainer"] }]`, `containers [{ class_name: "SlicerContainer", image: "../slicer/Dockerfile", max_instances: 6, instance_type: "standard-2" }]`, `access.dev { aud: "strix-local", identity: { email: "andrew@example.test", name: "Andrew (local)" } }`.
`env.local`: `routes []`, `vars { ACCESS_TEAM_DOMAIN same, ACCESS_AUD "", R2_ENDPOINT "", FIXTURES: "1" }`, the same bindings repeated (wrangler does not inherit them), and no `containers` entry (the local env never starts Docker; Task 9's fixture slicer replaces it).

- [ ] **Step 4: Implement the files**

- [ ] **Step 5: Run tests and the gate**

Run: `pnpm vitest run --project worker && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker && git commit -m "feat(worker): access, games index and api router"
```

---

### Task 5: GameDO storage: migrations and row mappers

**Files:**
- Create: `apps/worker/src/game/db/{migrate.ts,migrations.ts,migrations/0001-game.sql}`
- Create: `apps/worker/src/game/{store.ts}`
- Create: `apps/worker/src/sql.d.ts` (copy)
- Test: `apps/worker/test/game-store.test.ts`

**Interfaces:**
- Consumes: contracts `Game`, `Clip`, `GameEvent`, `ClefResponse`.
- Produces (`store.ts`, all synchronous over `SqlStorage`):
  - `saveGame(sql, game: Game): void`, `readGame(sql): Game | undefined`.
  - `saveClip(sql, clip: Clip): void`, `readClips(sql): ReadonlyArray<Clip>`, `readClip(sql, index: number): Clip | undefined`, `markClassification(sql, index, classification: Clip["classification"], state: GameState | null, stateConfidence: number | null): void`.
  - `saveAnswer(sql, clipIndex: number, pass: number, window: number, response: ClefResponse): void` (append-only), `readAnswers(sql, clipIndex): ReadonlyArray<{ pass; window; response }>`.
  - `saveEvents(sql, events: ReadonlyArray<GameEvent>): void`, `replaceEventsForClip(sql, clipIndex, events): void` (deletes events with that `clipIndex` and status in `auto|draft|discarded`, inserts the new ones; accepted, rejected and manual rows are never touched), `readEvents(sql): ReadonlyArray<GameEvent>` ordered by `videoMs`.
  - `countsOf(sql): GameCounts`.
- Tables in `0001-game.sql`, all `STRICT`: `game (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)`, `clips (idx INTEGER PRIMARY KEY, start_ms, duration_ms, renditions TEXT, state TEXT NULL, state_confidence INTEGER NULL, classification TEXT NOT NULL)`, `answers (id INTEGER PRIMARY KEY, clip_idx INTEGER NOT NULL, pass INTEGER NOT NULL, window INTEGER NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL)`, `events (id TEXT PRIMARY KEY, clip_idx INTEGER NOT NULL, video_ms INTEGER NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL)` with an index on `video_ms`.

- [ ] **Step 1: Write failing tests**

Use `runInDurableObject` from `cloudflare:test` on a `GameDO` stub (the class exists after Task 6; for this task create a minimal `GameDO` that only runs `migrate` in its constructor). Tests: `saveGame` then `readGame` round-trips; `saveClip` twice with the same index upserts; `replaceEventsForClip` keeps an `accepted` event and removes an `auto` one; `countsOf` after two events (`draft` with needs `["time"]`, `auto` without needs) returns `{ clips: n, classified: m, events: 2, drafts: 1, needs: 1 }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run --project worker -t store`
Expected: FAIL.

- [ ] **Step 3: Implement**

`migrate.ts` and `migrations.ts` copied from the clone. Rows store JSON blobs encoded with `Schema.toCodecJson`; columns hold only what queries filter or order on.

- [ ] **Step 4: Run tests and the gate**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker && git commit -m "feat(worker): game durable object storage"
```

---

### Task 6: GameDO HTTP API and WebSocket

**Files:**
- Create: `apps/worker/src/game/{game-do.ts,http.ts,sockets.ts}`
- Modify: `apps/worker/src/index.ts` (export `GameDO`)
- Test: `apps/worker/test/game-http.test.ts`

**Interfaces:**
- Consumes: Task 5 store; contracts `Api`, `Authorization`, `CurrentUser`, `InvalidInputs`, `socketPath`, `ChangedMessage`, `HEARTBEAT`.
- Produces:
  - `class GameDO extends DurableObject<Env>` with RPC methods `create(game: Game): void` (saves the game; idempotent), `clipReady(clip: Clip): void` (Task 9 fills in behaviour: save, enqueue), `answerReady(clipIndex: number, pass: number, window: number, response: ClefResponse): void` (Task 10), `classificationFailed(clipIndex: number, reason: string): void`, and `fetch` serving the `Api` groups `games` (`getGame`, `setSource`, `startGame`), `clips`, `events` plus the socket path.
  - `http.ts`: `gameApi(ctx: DurableObjectState, actions: GameActions): { handler: (request: Request) => Promise<Response> }` built like the clone's `householdApi`, where `interface GameActions { setSource(url: string): Promise<Game>; start(crop: Crop | null): Promise<Game> }` is implemented by Task 9. `getGame` returns 404 `NotFound` when `readGame` is undefined.
  - `sockets.ts`: `acceptSocket(ctx, request)`, `broadcastTo(ctx): (changed: ReadonlyArray<Changed>) => void`, `heartbeat()`, `answerClose`, adapted from the clone without caregiver tags.
  - Every mutation in later tasks calls `broadcast(["clips"])`, `broadcast(["events"])` or `broadcast(["game"])` after writing, and updates D1 through `updateGame` when status or counts change.

- [ ] **Step 1: Write failing tests**

`game-http.test.ts` through the Worker's `fetch` with the dev identity: create a game via `POST /api/games`, then `GET /api/games/:id` returns it; `GET /api/games/unknown` is 404; `GET /api/games/:id/clips` and `/events` return `[]`; a WebSocket upgrade on `socketPath(id)` from the same origin is accepted (status 101) and answers `ping` with `pong`.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement**

Copy the clone's `http.ts` structure: `HttpApiBuilder.group` per group, `authorization` layer reading `x-strix-email`, `invalidInputs`, `unknownRoute`, `logDefects`, `HttpRouter.toWebHandler`. `GameActions` for this task is a stub that throws `NotFound` for `setSource` and `start`; Task 9 replaces it.

- [ ] **Step 4: Run tests and the gate**

- [ ] **Step 5: Commit**

```bash
git add apps/worker && git commit -m "feat(worker): game durable object http api and socket"
```

---

### Task 7: Slicer container image and job protocol

**Files:**
- Create: `apps/slicer/Dockerfile`, `apps/slicer/src/{server.ts,ffmpeg.ts,jobs.ts,protocol.ts}`
- Test: `apps/slicer/test/{ffmpeg.test.ts,protocol.test.ts}`

**Interfaces:**
- Produces (`protocol.ts`, plain TypeScript types shared by copy with the worker; the worker re-declares them in `slicer/protocol.ts` and a test asserts the JSON shapes match a committed fixture):
  - `ProbeRequest { source: string; frameAtMs: number }` → `ProbeResult { durationMs: number; width: number; height: number; frameJpegBase64: string }`.
  - `SliceRequest { source: string; crop: { x; y; width; height } | null; windows: Array<{ index: number; startMs: number; durationMs: number; puts: { "model-480": string; "model-720": string; view: string } }> }` → NDJSON stream of `SliceProgress = { kind: "clip"; index: number; bytes: { "model-480": number; "model-720": number; view: number } } | { kind: "failed"; index: number; reason: string } | { kind: "done" }`.
  - HTTP: `POST /probe`, `POST /slice`, `GET /health` → 200. Port 8080.
- `ffmpeg.ts`: `probeArgs(source: string): string[]` (ffprobe, JSON format and streams), `frameArgs(source, atMs): string[]` (one JPEG to stdout), `sliceArgs(source, window, crop): string[]` producing three outputs to temp files via `filter_complex` with `split=3`, a `crop=` filter on two branches, `scale=854:-2` and `scale=1280:-2`, `-ss` before `-i` for a fast seek, `-t` for duration, `libx264 -preset veryfast`, bitrate caps `1M`, `2M`, `1M`, AAC `64k`, `64k`, `96k`, `-movflags +faststart`.
- `jobs.ts`: `runProbe(req): Promise<ProbeResult>`, `runSlice(req, emit: (p: SliceProgress) => void): Promise<void>`: windows run with a concurrency of 1 (one vCPU), each output `PUT` to its presigned URL with `fetch`, a window whose any rendition exceeds 14 MiB re-encodes once at half the bitrate caps, then `failed` if still over.

- [ ] **Step 1: Write failing tests**

`ffmpeg.test.ts`: `sliceArgs("https://x/y.mp4", { index: 3, startMs: 75_000, durationMs: 30_000 }, { x: 0, y: 0, width: 400, height: 60 })` contains `-ss 75` before `-i`, `-t 30`, a `crop=` expression that removes the top 60 rows of a 400-wide box (crop is implemented by `drawbox` filled black over the rectangle, since cutting pixels changes the aspect ratio: assert `drawbox=x=0:y=0:w=400:h=60:color=black:t=fill`), `scale=854:-2` and `scale=1280:-2`; with `crop: null` no `drawbox`. `protocol.test.ts`: the committed `fixtures/slice-request.json` decodes to `SliceRequest`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run --project slicer`

- [ ] **Step 3: Implement**

`Dockerfile`: `FROM node:24-bookworm-slim`, `apt-get install -y ffmpeg`, copy `src`, run with `node --experimental-strip-types src/server.ts` (or compile with `tsc` in the image; builder's choice), `EXPOSE 8080`. `server.ts` uses `node:http`, streams NDJSON with `res.write` per progress line.

- [ ] **Step 4: Smoke the image locally**

Run: `docker build -t strix-slicer apps/slicer && docker run --rm -p 8080:8080 strix-slicer` then `curl -s localhost:8080/health`
Expected: `200`. Then a `POST /probe` against a public sample MP4 (for example the Cloudflare docs' `https://pub-8613b7f94d6146408add8fefb52c52e8.r2.dev/aus-mobile-demo.mp4`) returns a `durationMs` and a non-empty frame.

- [ ] **Step 5: Run the gate and commit**

```bash
git add apps/slicer && git commit -m "feat(slicer): ffmpeg container with probe and slice jobs"
```

---

### Task 8: Presigned R2 URLs and the `Slicer` port

**Files:**
- Create: `apps/worker/src/r2/presign.ts`, `apps/worker/src/slicer/{protocol.ts,slicer.ts,slicer-container.ts,fixture-slicer.ts}`
- Create: `apps/worker/fixtures/clips/{0,1,2}/{model-480,model-720,view}.mp4` (three windows cut from any short public-domain hockey clip, under 300 KB each, no overlay) and `apps/worker/fixtures/probe.json`
- Test: `apps/worker/test/{presign.test.ts,fixture-slicer.test.ts}`

**Interfaces:**
- Produces:
  - `presign.ts`: `presignGet(env: Env, key: string, expiresSeconds: number): Promise<string>`, `presignPut(env, key, expiresSeconds): Promise<string>` with `aws4fetch` `AwsClient` against `R2_ENDPOINT/strix/<key>`; throws when the secrets are unset.
  - `slicer.ts`: `interface Slicer { probe(req: ProbeRequest): Promise<ProbeResult>; slice(req: SliceRequest, onProgress: (p: SliceProgress) => Promise<void>): Promise<void> }`; `slicerFor(env: Env, gameId: string): Slicer` returns the fixture slicer when `env.FIXTURES === "1"`, otherwise the container slicer.
  - `slicer-container.ts`: `class SlicerContainer extends Container` (`defaultPort = 8080`, `sleepAfter = "10m"`); `containerSlicer(namespace: DurableObjectNamespace<SlicerContainer>, gameId: string, rangeIndex: number): Slicer` using `getContainer(namespace, `${gameId}:${rangeIndex}`).fetch(...)` and reading the NDJSON body line by line.
  - `fixture-slicer.ts`: `fixtureSlicer(bucket: R2Bucket): Slicer`: `probe` returns `fixtures/probe.json` (durationMs 80,000); `slice` writes the three fixture windows into the bucket at the request's keys (derived by parsing the "presigned" URL path, which the fixture environment makes a plain `r2://<key>` string) and emits a `clip` line each, then `done`.

- [ ] **Step 1: Write failing tests**

`presign.test.ts`: with fake secrets, `presignGet` returns a URL whose host is the endpoint, path `/strix/clips/g/0/view.mp4`, and query has `X-Amz-Signature` and `X-Amz-Expires=3600`; without secrets it rejects.
`fixture-slicer.test.ts`: `slice` with three windows emits three `clip` lines and `done`, and the bucket has nine objects.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement**

`presignPut` in the fixture environment is replaced inside `slicerFor` by `(key) => "r2://" + key`; the DO (Task 9) only ever obtains URLs through a `Urls` helper `{ get(key): Promise<string>; put(key): Promise<string> }` returned by `urlsFor(env)` in `presign.ts`, which picks real or fixture.

- [ ] **Step 4: Run tests and the gate**

- [ ] **Step 5: Commit**

```bash
git add apps/worker && git commit -m "feat(worker): presigned r2 urls and slicer port with fixtures"
```

---

### Task 9: Ingest: set source, probe, start, slice, record clips

**Files:**
- Create: `apps/worker/src/game/{ingest.ts,progress.ts}`
- Modify: `apps/worker/src/game/game-do.ts` (real `GameActions`, `clipReady`, alarms)
- Test: `apps/worker/test/ingest.test.ts`

**Interfaces:**
- Consumes: Task 3 `windowsFor`, `rangesFor`; Task 8 `slicerFor`, `urlsFor`; Task 5 store; Task 6 broadcast.
- Produces:
  - `ingest.ts`: `setSource(deps, url: string): Promise<Game>` (status `probing`, stores `source {kind:"url"}`, runs `probe` with `frameAtMs = min(300_000, duration/2)`, stores `durationMs` and writes the frame to `thumbs/<gameId>/probe.jpg` in R2, status `created` with `durationMs` set; on probe failure status `failed` with `failure` = the error message), `start(deps, crop: Crop | null): Promise<Game>` (requires `durationMs`; status `slicing`; builds ranges; for each range builds a `SliceRequest` with `puts` from `urls.put`, stores a `ranges` row set in DO storage `ranges: Record<number, "running"|"done"|"failed">`, and runs up to 6 ranges concurrently with `ctx.waitUntil`; each `clip` progress line calls `clipReady`; a `failed` line marks the clip's classification `failed`; when every range is done, status `classifying` or `failed` if any range failed and no clips exist). `interface IngestDeps { ctx: DurableObjectState; env: Env; gameId: string; broadcast; slicer: (rangeIndex: number) => Slicer; urls: Urls }`.
  - `GameDO.clipReady(clip)`: `saveClip` with `classification "pending"`, `env.CLASSIFY.send({ gameId, clipIndex: clip.index, pass: 1 })`, broadcast `["clips","game"]`, `updateGame` in D1 with new counts.
  - `progress.ts`: `statusAfterRanges(ranges: Record<number, ...>, clipCount: number): GameStatus`.
  - A DO alarm every 60 s while `slicing` re-checks ranges; a range `running` for more than 30 minutes is marked `failed` (Review Focus 2).
  - `GET /api/games/:id/probe.jpg` served by the DO from R2.

- [ ] **Step 1: Write failing tests**

`ingest.test.ts` in the fixture environment: `POST /api/games/:id/source` with any URL → game `durationMs` 80,000 and `probe.jpg` fetchable; `POST /api/games/:id/start` with a crop → within the test, `GET /clips` returns 3 clips with `classification "pending"` and the queue (use `cloudflare:test`'s queue helpers or a spy on `env.CLASSIFY.send`) received 3 jobs; game status `classifying`. Failure cases: a fixture slicer configured (via `env.FIXTURES_FAIL_PROBE = "1"`) to reject the probe leaves the game `failed` with the reason (Review Focus 1); a slicer that emits one `clip` then throws leaves that clip saved and the range `failed`, and `statusAfterRanges` keeps `classifying` because clips exist (Review Focus 2).

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and the gate**

- [ ] **Step 5: Commit**

```bash
git add apps/worker && git commit -m "feat(worker): url ingest, probe, slicing and clip recording"
```

---

### Task 10: Pass-one questions and answer interpretation

**Files:**
- Create: `apps/worker/src/classify/{questions.ts,reading.ts,events-from-pass-one.ts}`
- Create: `apps/worker/fixtures/answers/{goal.json,penalty.json,quiet.json,goalie-change.json}` (hand-written `ClefResponse` objects in the spec's output shape)
- Test: `apps/worker/test/{questions.test.ts,reading.test.ts,events-from-pass-one.test.ts}`

**Interfaces:**
- Consumes: contracts `ClefQuestion`, `ClefResponse`, `GameEvent`, `Team`, `Thresholds`, `Mode`; domain `decide`, `percentOf`, `argmax`.
- Produces:
  - `questions.ts`: `PASS_ONE_IDS` tuple of the 11 ids from the spec (`game_state`, `goal`, `goal_team`, `penalty`, `penalty_team`, `infraction`, `penalty_class`, `shots_home`, `shots_away`, `goalie_change`, `goalie_change_team`); `passOneQuestions(home: Team, away: Team): Record<PassOneId, ClefQuestion>` with the instructions from the spec's table, team criteria `{ home: "<name>, wearing <jersey>", away: ... }`, infraction criteria keyed by `Infraction` ids with plain-English descriptions, shots as `score` with criteria `["0","1","2","3","4 or more"]` and instructions ending "in the first 25 seconds of this clip".
  - `reading.ts`: `interface PassOneReading { gameState: { state: GameState; confidence: number }; goal: number; goalTeam: { team: Side; confidence: number }; penalty: number; penaltyTeam; infraction: { id: Infraction; confidence: number }; penaltyClass: { id: PenaltyClass; confidence: number }; shotsHome: { count: number; confidence: number }; shotsAway; goalieChange: number; goalieChangeTeam }` (confidences already in 1..100); `readPassOne(response: ClefResponse): PassOneReading` throws `ReadingError` naming the id when a question is missing or has the wrong `type` (Review Focus 4).
  - `events-from-pass-one.ts`: `eventsFromPassOne(clip: { index: number; startMs: number }, reading: PassOneReading, mode: Mode, thresholds: Thresholds, now: number, newId: () => string): ReadonlyArray<GameEvent>`: a goal event when `decide(percentOf(reading.goal))` is not null, with `confidence`, `team`, `teamConfidence`, `videoMs = clip.startMs`, `precisionMs 30_000`, `period null`, `clock null`, `needs ["time","scorer","assists"]`, attrs with null scorer and empty assists; a penalty event likewise with `needs ["time","player"]` and attrs from `infraction` and `penaltyClass`; a goalie_change event with `needs ["time"]`.

- [ ] **Step 1: Write failing tests**

`questions.test.ts`: the record has exactly the 11 ids; `goal_team.criteria.home` contains the home name and jersey; `shots_home.instructions` contains "first 25 seconds"; `infraction.criteria` has 15 keys.
`reading.test.ts`: `readPassOne(goal.json)` → `goal` 0.91, `goalTeam.team "away"`, `gameState.state "live"`; a response missing `penalty_team` throws `ReadingError` with message containing `penalty_team`; a response where `goal` is a `choice` answer throws.
`events-from-pass-one.test.ts`: `goal.json` in auto mode with defaults → one event, status `auto`, confidence 91, needs `["time","scorer","assists"]`; same in review → status `draft`; `quiet.json` → no events; `penalty.json` (penalty 0.66) in auto → one event status `discarded`, attrs infraction `slashing` class `minor`; `goalie-change.json` → one `goalie_change` event.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and the gate**

- [ ] **Step 5: Commit**

```bash
git add apps/worker && git commit -m "feat(worker): pass-one questions, reading and event derivation"
```

---

### Task 11: Clef client, queue consumer, `answerReady`

**Files:**
- Create: `apps/worker/src/classify/{clef.ts,consumer.ts,fixture-clef.ts,jobs.ts}`
- Modify: `apps/worker/src/index.ts` (`queue` handler), `apps/worker/src/game/game-do.ts` (`answerReady`, `classificationFailed`)
- Create: `apps/worker/fixtures/answers/by-clip.json` (maps fixture clip index 0, 1, 2 to `goal.json`, `quiet.json`, `penalty.json`)
- Test: `apps/worker/test/{consumer.test.ts,answer-ready.test.ts}`

**Interfaces:**
- Consumes: Task 10; Task 5 store; domain `mergeAdjacent`.
- Produces:
  - `jobs.ts`: `interface ClassifyJob { readonly gameId: string; readonly clipIndex: number; readonly pass: 1 }`.
  - `clef.ts`: `interface Clef { run(request: ClefRequest): Promise<ClefResponse> }`; `clefFor(env: Env): Clef` returns the fixture when `FIXTURES === "1"`, else `{ run: (req) => env.AI.run("@cf/cloudflare/clef-omni", req) }` with the result decoded by `ClefResponse` (a decode failure is thrown).
  - `MAX_CLIP_BYTES = 14 * 1024 * 1024`.
  - `consumer.ts`: `consume(batch: MessageBatch<ClassifyJob>, env: Env): Promise<void>`: for each message, read the game from its DO (`getByName(gameId)` RPC `snapshot(): { game: Game; clip: Clip }`), get `clips/<gameId>/<index>/model-480.mp4` from R2, if `size > MAX_CLIP_BYTES` call `classificationFailed(index, "clip over 14 MiB")` and ack (Review Focus 3), else base64 the body, build `ClefRequest` with `state = { game: { home, away }, clip: { index, startMs } }` and `passOneQuestions`, call `clef.run`, then `answerReady(index, 1, 0, response)`; on any thrown error, `message.retry()`, and after `message.attempts >= 3`, `classificationFailed` and ack.
  - `GameDO.answerReady`: `saveAnswer`; `readPassOne` (a `ReadingError` → `classificationFailed`); `markClassification(index, "done", state, stateConfidence)`; `eventsFromPassOne`; `replaceEventsForClip`; then recompute the merge over all `auto|draft|discarded` events with `mergeAdjacent` and write the result back; `countsOf` → `updateGame`; broadcast `["clips","events","game"]`; when every clip is `done` or `failed`, status `ready`.
  - `GameDO.snapshot(clipIndex)` RPC as above.

- [ ] **Step 1: Write failing tests**

`consumer.test.ts` in the fixture environment: after Task 9's start, run `consume` with the three queued jobs → clips are `done`, `GET /events` has one goal (auto, from clip 0) and one discarded penalty (from clip 2); an R2 object replaced by a 15 MiB blob makes that clip `failed` with the reason.
`answer-ready.test.ts`: two adjacent clips each answering `goal.json` → one goal event (merge); a malformed response → that clip `failed` and no events.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and the gate**

- [ ] **Step 5: Commit**

```bash
git add apps/worker && git commit -m "feat(worker): clef client, classify queue consumer and event pipeline"
```

---

### Task 12: Clip media routes: view rendition and thumbnails

**Files:**
- Create: `apps/worker/src/game/media.ts`
- Modify: `apps/worker/src/game/game-do.ts` (routes), `apps/worker/src/env.ts` (`MEDIA` type from `@cloudflare/workers-types` if present, else a local `interface MediaBinding { input(body: ReadableStream): { transform(o): ...; output(o): { response(): Promise<Response> } } }`)
- Test: `apps/worker/test/media.test.ts`

**Interfaces:**
- Produces: `GET /api/games/:id/clips/:index/view.mp4` streams the R2 object with `Range` support (pass the request's `range` header to `bucket.get(key, { range })`, answer 206 with `content-range`); `GET /api/games/:id/clips/:index/thumb.jpg` returns `thumbs/<gameId>/<index>.jpg` from R2, and when missing, in the real environment generates it with `env.MEDIA.input(view.body).output({ mode: "frame", time: "15s", format: "jpeg" })`, stores it, and returns it; in the fixture environment returns `fixtures/thumb.jpg` and stores that. `cache-control: private, max-age=3600` on both.

- [ ] **Step 1: Write failing tests**

`media.test.ts`: after a fixture start, `GET .../clips/0/view.mp4` with `Range: bytes=0-99` → 206 with 100 bytes; `GET .../clips/0/thumb.jpg` → 200 `image/jpeg` and the R2 key now exists.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and the gate**

- [ ] **Step 5: Commit**

```bash
git add apps/worker && git commit -m "feat(worker): clip playback and thumbnail routes"
```

---

### Task 13: Web app shell, API client, games page

**Files:**
- Create: `apps/web/src/{main.tsx,index.css,app-context.ts}`, `apps/web/src/shell/{router.tsx,shell.tsx,not-found-page.tsx}`, `apps/web/src/api/{client.ts,query-client.ts,errors.ts,games.ts}`, `apps/web/src/features/games/{games-page.tsx,create-game-form.tsx,game-card.tsx}`, `apps/web/components.json`, `apps/web/src/lib/utils.ts`, `apps/web/src/components/ui/*` (shadcn: button, input, label, select, badge, card, dialog, textarea, toggle-group)
- Test: `apps/web/test/{client.test.ts,create-game-form.test.ts}`

**Interfaces:**
- Consumes: contracts `Api`, `Game`, `NewGame`, `Level`, `Mode`.
- Produces:
  - `client.ts`: `connectApi({ baseUrl?, fetch? })` → `{ request<A, E>(call: (client: ApiClient) => Effect<A, E>): Promise<A> }`, adapted from the clone without connectivity reporting.
  - `games.ts`: query keys `gamesKeys.list()`, `gamesKeys.one(id)`, `gamesKeys.clips(id)`, `gamesKeys.events(id)`; hooks `useGames()`, `useGame(id)`, `useCreateGame()`, `useSetSource(id)`, `useStartGame(id)` with React Query.
  - Routes: `/` → `GamesPage`; `/games/$gameId` → placeholder until Task 14.
  - `GamesPage`: list of `GameCard` (name, teams, status badge, counts) and `CreateGameForm`: name, home and away name and jersey text, rosters as comma-separated numbers, mode toggle (auto, review), level select (fills timing shown read-only), URL field; submit creates the game then sets its source, then navigates to `/games/$gameId`.
  - Theme: copy the clone's `index.css` token structure with a neutral palette; dark mode via `data-theme` and `prefers-color-scheme`.

- [ ] **Step 1: Write failing tests**

`client.test.ts`: `request` against a stub `fetch` returning a `Game` JSON resolves to the decoded game; a 401 rejects with `Unauthorized`.
`create-game-form.test.ts` (react testing with `@testing-library/react`, environment `happy-dom`, add both to the catalog): submitting with name, teams, URL and level `junior-pro` calls the `onSubmit` prop with a `NewGame` whose `timing` is the preset and a `url`.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement**

Run `pnpm dlx shadcn@latest init` in `apps/web` with style `base-nova`, base colour neutral, then `pnpm dlx shadcn@latest add button input label select badge card dialog textarea toggle-group`. Invoke the `frontend-ui-expert` skill before writing components.

- [ ] **Step 4: Run tests, the gate, and look at it**

Run: `pnpm dev` and open `http://localhost:5173/`.
Expected: the games page renders, creating a game with any URL in the fixture environment moves to `/games/<id>` (placeholder) and the game shows in the list with status `created` and `durationMs` 80,000.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "feat(web): app shell, api client and games page"
```

---

### Task 14: Game dashboard: start, live socket, event list, player, timeline, detail

**Files:**
- Create: `apps/web/src/api/{live.ts,clips.ts,events.ts}`, `apps/web/src/features/game/{game-page.tsx,game-header.tsx,start-panel.tsx,crop-box.tsx,event-list.tsx,event-row.tsx,confidence-bar.tsx,clip-player.tsx,timeline-strip.tsx,event-detail.tsx,keyboard.ts}`
- Modify: `apps/web/src/shell/router.tsx`
- Test: `apps/web/test/{live.test.ts,timeline-strip.test.ts,keyboard.test.ts}`

**Interfaces:**
- Consumes: Task 13 client and hooks; contracts `socketPath`, `ChangedMessage`, `HEARTBEAT`, `Clip`, `GameEvent`.
- Produces:
  - `live.ts`: `startLive({ open, onChanged, onStale })` adapted from the clone's `live-connection.ts` and `live.ts` (reconnect with jitter, heartbeat), invalidating `gamesKeys.one|clips|events` by the `changed` list.
  - `StartPanel`: shown while status is `created` with a `durationMs`: the probe frame with `CropBox` (a draggable, resizable rectangle in displayed pixels mapped to source pixels), a "No overlay" toggle, and a Start button calling `useStartGame`.
  - `GameHeader`: name, teams, mode badge, status, `counts.drafts`, `counts.needs`, `classified/clips` progress.
  - `EventList`: rows for events with status not `discarded` (a "Show discarded" toggle includes them), each `EventRow` with thumbnail (`/thumb.jpg`), type badge, team name, `videoMs` as `h:mm:ss`, period or "P?", `ConfidenceBar`, status tag, and `needs` tags; selected row highlighted.
  - `ClipPlayer`: `<video>` on `/clips/<index>/view.mp4` for the selected event's clip, seeking to `videoMs - clip.startMs`.
  - `TimelineStrip`: one cell per clip coloured by `state` (`live`, `stoppage`, `intermission`, `warmup`, `empty`, pending), event marks for goals and penalties, the selected clip outlined; click seeks. Pure helper `cellsFor(clips, events, selectedIndex): ReadonlyArray<{ index; state; marks; selected }>`.
  - `EventDetail`: fields from the mockup, read-only in this plan (Accept, Reject and Set time arrive with the review plan).
  - `keyboard.ts`: `keyFor(key: string): "next" | "prev" | "clipNext" | "clipPrev" | "playPause" | null` for `j`, `k`, `ArrowRight`, `ArrowLeft`, space.

- [ ] **Step 1: Write failing tests**

`live.test.ts`: a fake socket that sends `{"changed":["events"]}` causes `onChanged(["events"])`; a dropped socket reconnects.
`timeline-strip.test.ts`: `cellsFor` with 3 clips, a goal in clip 0, selected 2 → cell 0 has mark `goal`, cell 2 `selected`.
`keyboard.test.ts`: the five mappings and `null` for `x`.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement**

Invoke `frontend-ui-expert` first. Layout from the mockup: header, left list 42% width, right column with player, strip, detail.

- [ ] **Step 4: Run tests, the gate, and look at it**

Run: `pnpm dev`, create a game, draw a crop, Start.
Expected: three clips appear in the strip, the queue is consumed by `vite dev`'s local queue, the goal and the discarded penalty appear, the player plays the fixture view clip, the thumbnail loads.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "feat(web): game dashboard with live updates, player and timeline"
```

---

### Task 15: E2E, Cloudflare resources, deploy

**Files:**
- Create: `playwright.config.ts`, `e2e/{create-and-classify.spec.ts,auth.spec.ts}`
- Create: `.github/workflows/deploy.yml`, `docs/runbooks/setup.md`
- Modify: `apps/worker/wrangler.jsonc` (ids from setup), `.github/workflows/ci.yml` (e2e job already present)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the e2e specs**

`playwright.config.ts` from the clone with the desktop Chromium project only, `webServer` command `CLOUDFLARE_ENV=local pnpm --filter @strix/web build && pnpm --filter @strix/web preview --port 4173 --strictPort`.
`create-and-classify.spec.ts`: create a game with a URL, click Start with "No overlay", expect the strip to show 3 cells, expect an event row "Goal" with status `auto`, click it, expect the video element's `src` to end in `/clips/0/view.mp4`.
`auth.spec.ts`: a request to `/api/games` without the dev identity (use `page.request` with a header that makes the Worker skip `access.dev`; if the plugin always injects the identity, assert instead that the identity email appears nowhere in the page and skip the 401 case with a comment-free `test.skip` and an issue).

- [ ] **Step 2: Run e2e locally**

Run: `pnpm exec playwright install chromium && pnpm e2e`
Expected: PASS.

- [ ] **Step 3: Write `docs/runbooks/setup.md`**

One-time commands Andrew runs, in order, with `wrangler` logged into the account: `wrangler r2 bucket create strix`; `wrangler d1 create strix` (paste the id into `wrangler.jsonc`); `wrangler d1 migrations apply strix --remote`; `wrangler queues create strix-classify`; `wrangler queues create strix-classify-dlq`; create an R2 API token scoped to the `strix` bucket and `wrangler secret put R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`; in Zero Trust create the Access application "Strix" for `strix.andamonium.dev` with an email one-time-code policy listing `andrew@gamesheetinc.com` and `mcmillan.r.andrew@gmail.com`, paste its AUD tag into `ACCESS_AUD`; enable the Workers AI and Media Transformations products if the dashboard asks; add the `CLOUDFLARE_API_TOKEN` repository secret with Workers, D1, R2, Queues, Containers and Durable Objects edit permissions; `wrangler deploy` once by hand to create the Custom Domain and the container application.

- [ ] **Step 4: `deploy.yml`**

The clone's `deploy.yml` with the Deploy step replaced by `pnpm --filter @strix/worker exec wrangler d1 migrations apply strix --remote && pnpm --filter @strix/worker exec wrangler deploy` and a `docker/setup-buildx-action@v3` step before it.

- [ ] **Step 5: Deploy and verify**

Run the runbook, push `main`, watch the Deploy workflow.
Expected: `https://strix.andamonium.dev/` prompts for an Access code, then shows the games page; creating a game from the Cloudflare sample MP4 URL with "No overlay" slices it, classifies it, and shows a strip and a (probably empty) event list; the Cloudflare dashboard shows the queue drained and the container application present.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: e2e, setup runbook and deploy workflow"
```

---

## Self-review notes

- Spec coverage for build-order steps 1 and 2: repo and tooling (T1), contracts (T2), domain (T3), Access and games index (T4), DO storage and API (T5, T6), container (T7), presigning and ports (T8), URL ingest and slicing (T9), questions and events (T10), Clef and queue (T11), media routes (T12), web shell (T13), dashboard (T14), e2e and deploy (T15). File upload, crop defaults in D1, passes 2 and 3, period inference, the needs queue UI, review actions, box score, settings and export are later plans; the schemas and tables here already carry their fields.
- Names used across tasks: `slicerFor`, `urlsFor`, `Urls`, `Slicer`, `clipReady`, `answerReady`, `classificationFailed`, `snapshot`, `readPassOne`, `eventsFromPassOne`, `passOneQuestions`, `mergeAdjacent`, `decide`, `percentOf`, `argmax`, `windowsFor`, `rangesFor`, `countsOf`, `replaceEventsForClip`, `updateGame`, `gamesKeys`, `socketPath`, `ChangedMessage`. Each is defined once and consumed by name.
- Review Focus items 1 to 5 each have a named test in T9, T9, T11, T10 and T3.
