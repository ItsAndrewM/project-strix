# Strix: hockey event tagging with Clef, design

Date: 2026-10-21. Status: approved for planning once Andrew signs off on the calls below.

## Intent

A dashboard-style web app that watches hockey footage and tags game events the way
GameSheet's play-by-play records them: goals with scorer and assists, penalties with
infraction and length, shots on goal, goalie changes, and the period each happened in.
Classification is done by Cloudflare's Clef-omni decision model on Workers AI, which answers
typed questions about a short video clip with calibrated probabilities. The look and feel
follows Carson Jones's vibes.to NHL tagger: a list of tagged moments on the left, a player and
timeline on the right, confidence everywhere.

The end goal is a model working off a live feed and feeding a GameSheet scorekeeper. Pre-taped
games and clips exist to prove that events can be classified at all. A product manager must be
able to open a live site, drop in a game, and watch events appear, with no command line.

## Goals

- Upload a whole game (file or URL) in the browser and get a tagged event log back.
- Two modes, chosen per game: **auto** (the model's decision is saved) and **review** (the
  model drafts, a human accepts or rejects, and a rejection opens a manual picker).
- Every event carries a 1 to 100 confidence. The human queue in both modes is small and honest.
- Events match GameSheet's vocabulary so a later integration is a mapping, not a redesign.
- The pipeline's ingest boundary is "a timestamped clip of 60 seconds or less", so a live feed
  slots in later without touching classification, storage or UI.
- Every model draft and every human verdict is kept, so the labelled data for a later
  fine-tune falls out for free.
- Same engineering standards as the huckleberry clone: Effect, oxlint with the anti-slop and
  gamesheet plugins, oxfmt, vitest, Playwright, CI gates, deploy on merge.

## Non-goals (day one)

- The live feed itself. The design leaves the slot; nothing is built for it.
- Firebase or GameSheet integration. Export is a JSONL file.
- Shootout rounds, three stars, player names, lineups beyond jersey numbers.
- Fine-tuning Clef. The data is kept; no training runs.
- Reading the game clock. Clock time is always entered by a human.
- Shot type, celebration, scrum, camera angle and the other vibes.to tags.

## Anti-goals

- **The model must not cheat.** Pre-taped games carry a scoreboard overlay; live rink feeds
  will not. Clef never sees the overlay. Everything the model is asked must be answerable from
  the ice and the sound.
- **No fake certainty.** If the period is unsure, it is blank and flagged, even in auto mode.
  Same for scorer and assists. A blank with a flag beats a wrong number.
- **No CLI for the PM.** Anything that needs a terminal is not part of the demo path.
- **Nothing the reviewer does destroys the model's draft.** Verdicts append; they never edit.

## Platform facts the design is built on

Checked against Cloudflare's docs on 2026-10-21.

| Fact | Consequence |
|---|---|
| Clef-omni takes at most 2 videos per call, each MP4 or WebM, 60 s and 16 MiB max, sampled at 2 fps, audio used only if every video has it. Media is embedded (data URL or base64), never a URL. | Clips are 30 s, encoded small, one per call. |
| Clef-omni costs $0.15 per million input tokens; video costs up to 256 tokens per second at full resolution and about 144 tokens per second at 480p; audio about 13 tokens per second. 64K context. | A 30 s 480p clip with sound is about 5,000 tokens, under a tenth of a cent. |
| Questions: 1 to 64 per call. Types `noul` (yes/no probability), `choice` (2 to 255 options, returns the top option, per-option probabilities and a confidence), `score` (2 to 10 ordered levels, returns a weighted score, per-level probabilities and a confidence). | One call per clip carries the whole first-pass battery. Rosters up to 25 numbers fit in the attribution pass. |
| Media Transformations binding (`env.MEDIA`) cuts, resizes and grabs frames from a video in R2 inside a Worker. Input at most 100 MB and 10 minutes; output video at most 60 s. Binding use is free during beta. | Not usable on a whole game. Used for sub-windows cut from 30 s clips, and for thumbnails. |
| Workers cannot run ffmpeg. Cloudflare Containers run any Linux image next to a Worker, started by a Durable Object, on Workers Paid. Instance types from `lite` (1/16 vCPU) to `standard-4` (4 vCPU, 12 GiB, 20 GB disk). Local dev needs Docker. | Slicing lives in a container. |
| Worker request bodies are limited per zone plan (100 MB on Free and Pro). R2 multipart parts are 5 MiB to 5 GiB, all equal but the last. | Browser uploads go through the Worker in 50 MB parts. |
| Presigned R2 URLs work only on the S3 endpoint, signed with an R2 API token. | The container reads input and writes clips through short-lived presigned URLs. No credentials in the image. |
| Access verifies email one-time codes and puts a JWT on every request; the huckleberry clone already verifies it with jose. | Auth is Access plus an allowlist. No login UI. |

## System shape

```
browser ──upload parts / URL──▶ Worker ──▶ R2 originals/
   │                                │
   │                                ├─▶ GameDO (one per game, SQLite)
   │                                │     ├─ starts SlicerContainer jobs (ranges of the game)
   │                                │     ├─ enqueues classify jobs on a Queue
   │                                │     ├─ applies thresholds, overlap merge, period inference
   │                                │     └─ pushes changes to dashboards over WebSocket
   │                                │
   │                                ├─▶ Queue consumer: R2 clip ──▶ Workers AI (Clef-omni) ──▶ GameDO
   │                                ├─▶ MEDIA binding: sub-windows and thumbnails from clips
   │                                └─▶ D1: games index, cross-game lists
   │
   └──WebSocket + REST──▶ dashboard (TanStack Router, React Query)

SlicerContainer (ffmpeg): presigned GET of the original or the pasted URL
   ──▶ 30 s windows, 5 s overlap, three renditions ──▶ presigned PUT to R2 clips/
```

## Repository

`project-strix`, a pnpm monorepo laid out like the huckleberry clone. Package scope `@strix`.

- `apps/web`: Vite 8, React 19, TanStack Router, TanStack Query, Tailwind v4, shadcn on
  Base UI, lucide icons. Built by the Cloudflare Vite plugin and served as Worker assets.
- `apps/worker`: the Worker, Effect throughout. Durable Objects (`GameDO`, `SlicerContainer`
  via `@cloudflare/containers`), Queue consumer, Workers AI, MEDIA, R2 and D1 bindings, Access
  JWT verification (copied from the clone), Effect SQL on the DO's SQLite.
- `apps/slicer`: the container image. Debian slim with ffmpeg and a small Node HTTP server.
  Endpoints: `probe` (duration, resolution, a JPEG frame at a given offset) and `slice` (a
  range job, streams NDJSON progress lines back).
- `packages/domain`: pure TypeScript, no framework imports. Period inference, overlap merge,
  thresholds, penalty expiry arithmetic, box-score aggregation, assist selection.
- `packages/contracts`: Effect Schema for the HTTP API, WebSocket messages, Clef request and
  response shapes, event and verdict records, JSONL export rows.
- `tools/oxlint/anti-slop`: copied from the clone.
- `e2e`: Playwright.

Tooling copied from the clone and adapted: `oxlint.config.ts` with the same plugins, categories,
`denyWarnings`, `complexity` max 10, `gamesheet/no-comments`, every `anti-slop/*` rule, the
`Schema.Number` and `Schema.NumberFromString` bans, and import boundaries: domain imports nothing
from the workspace and no framework; contracts import domain only; web never imports worker;
worker never imports web. `oxfmt.config.ts` identical (print width 120, no semicolons, sorted
imports). `tsconfig.base.json` identical (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Node 24.21, pnpm 10.32, catalog pins
copied from the clone's `pnpm-workspace.yaml` plus `@cloudflare/containers` and `aws4fetch`.
Scripts: `dev`, `build`, `lint`, `format`, `typecheck`, `test`, `coverage`, `e2e`. The full
gate (`lint`, `typecheck`, `test`, `build`) is what "tests pass" means.

Git: GitHub under ItsAndrewM, personal account, so the repo gets a local `user.email` override
(Andrew's personal address, as the clone has). Branches `feature/<name>.<id>`, PRs target `main`,
CI must pass, merge to `main` deploys. `.superpowers/` is gitignored.

## Ingest

### Creating a game

`POST /api/games` with: a name, home and away team names, a one-line jersey description per
team (for example "white with green trim"), a roster of jersey numbers per team (optional, up
to 25 each), the mode (`auto` or `review`), a level preset that fills `periodMinutes`,
`intermissionMin` and `ambiguousMin` (youth running-time: 15, 1, 0.5; youth stop-time: 15, 3,
1; junior or pro: 20, 8, 3), and thresholds (defaults below). Every preset value is editable.
Returns the game id.
The game's row goes in D1 and its `GameDO` is created.

### Source: file

`POST /api/games/:id/upload` starts an R2 multipart upload and returns an upload id. The browser
sends `PUT /api/games/:id/upload/:uploadId/parts/:n` for each 50 MB part, four in flight, each
retried up to three times, then `POST .../complete` with the part etags. The Worker streams each
part into R2 with the binding; nothing is buffered. Progress and pause-resume live in the
browser. The object is `originals/<gameId>.mp4`. Incomplete uploads die after seven days.

### Source: URL

`POST /api/games/:id/source` with a URL to an MP4 or an HLS playlist. Nothing is copied; the
container reads it directly. The URL is stored on the game.

### Probe and crop

After either source lands, the DO asks the container to `probe` it: duration, width, height,
and a JPEG of the frame five minutes in. The upload page shows that frame with a draggable crop
box. The box defaults to the last one used on this account (stored in D1). The uploader
confirms with `POST /api/games/:id/start` carrying the crop rectangle in source pixels, or
`null` for footage with no overlay. Crop is per game and immutable once slicing starts.

### Slicing

The DO splits the duration into ranges of 10 minutes and runs one `slice` job per range, up to
six at once, on `standard-2` instances (1 vCPU, 6 GiB). Each job: ffmpeg seeks into the
presigned source URL (HTTP range requests, nothing downloaded to disk), decodes once, and
writes three renditions per 30-second window with a 5-second overlap (windows start every 25 s):

| Rendition | Purpose | Spec |
|---|---|---|
| `model-480` | pass 1 | crop applied, 854×480, H.264, AAC 64 kbps mono, target 4 MB |
| `model-720` | passes 2 and 3 | crop applied, 1280×720, H.264, AAC 64 kbps mono, target 8 MB |
| `view` | humans | no crop, 854×480, H.264, AAC 96 kbps, target 4 MB |

Keys are `clips/<gameId>/<index>/<rendition>.mp4`, written through presigned PUT URLs issued by
the DO for the job (one per object, one-hour expiry). Any rendition over 14 MiB fails the job's
window, which is retried once at a lower bitrate. The container streams one NDJSON line per
finished window back to the DO: `{ index, startMs, durationMs, renditions }`. The DO records the
clip and enqueues its pass-1 job immediately, so classification starts while slicing continues.
Originals are kept until the game is deleted.

The clip-ready line is the ingest boundary. A live feed later means a `follow` job on the same
container that reads an HLS playlist and emits the same lines as windows complete.

## Classification

### Question battery, pass 1

One Clef-omni call per clip with `model-480`. The `state` carries the game context as JSON:
team names, jersey descriptions, home and away, the clip's index and offset, and the running
score so far. Question ids and types:

| id | type | asks |
|---|---|---|
| `game_state` | choice | live play, stoppage with players on ice, intermission or ice resurfacing, warmup, empty ice or other |
| `goal` | noul | a goal is scored in this clip: puck crosses the line, celebration, horn, players reset at centre |
| `goal_team` | choice | home or away, described by jersey |
| `penalty` | noul | a penalty is called: referee arm up or signal, player to the box, teams reset short-handed |
| `penalty_team` | choice | home or away |
| `infraction` | choice | holding, slashing, roughing, cross-checking, checking from behind, tripping, hooking, high-sticking, interference, delay of game, too many men, boarding, elbowing, unsportsmanlike, other |
| `penalty_class` | choice | minor 2, double minor 4, major 5, misconduct 10 |
| `shots_home` | score | 0, 1, 2, 3, 4 or more shots on goal by home in the first 25 seconds of this clip |
| `shots_away` | score | same for away |
| `goalie_change` | noul | a goalie leaves and another takes the net, or the net is empty for an extra attacker |
| `goalie_change_team` | choice | home or away |

Dependent questions are asked in the same call regardless and only read when their parent
clears a threshold. The raw answer object is stored as-is, append-only.

### Thresholds (per game, editable, defaults)

| Name | Default | Meaning |
|---|---|---|
| `autoSave` | 80 | auto mode saves an event at or above this |
| `draft` | 40 | review mode drafts an event at or above this; below it the answer is stored but no event is made |
| `period` | 85 | an inferred period is set only if its gap-cleanliness confidence is at or above this |
| `scorer` | 70 | scorer set only at or above this |
| `assist` | 50 | a jersey counts as an assist only at or above this |

Confidence shown to humans is the relevant probability times 100, rounded.

### Pass 2: placement

When `goal` or `penalty` clears `draft`, the DO enqueues a pass-2 job. The consumer cuts three
10-second sub-windows (0 to 10, 10 to 20, 20 to 30) from `model-720` with the MEDIA binding and
asks the single parent question on each. The event is placed at the start of the strongest
window; its `precisionMs` is 10,000. If no sub-window clears `draft`, the event keeps the
clip-level placement with `precisionMs` 30,000.

### Overlap merge

Two events of the same type and team whose placements are within 15 s of each other, from
adjacent clips, merge into one. The merged event keeps the higher confidence and the earlier
placement. This runs in the DO as answers arrive, in domain code.

### Pass 3: attribution (goals only, when a roster exists)

A 20-second sub-window from `model-720` ending 3 s after the placed goal time (clamped to the
clip). Questions, with the scoring team's roster:

- `scorer`: choice over the roster's jersey numbers.
- `touch_<n>` for each roster number: noul, "#n of <team> touched the puck in the 15 seconds
  before the goal".

Scorer is set if its confidence clears `scorer`. Assists are the top two `touch_<n>` at or above
`assist`, excluding the scorer, ordered by probability. Anything below the bar stays blank and
flags the event. Reading numbers off a 720p clip at 2 frames per second is the least reliable
thing in this design and the document says so on the dashboard: scorer and assists show their
own confidence next to the event's.

### Period inference

Domain code, run by the DO whenever a clip's `game_state` lands and whenever a human sets a
period marker. Take the sequence of clips in order with their top `game_state`. Collapse into
runs. Leading non-live runs are warmup. A non-live run of at least the game's `intermissionMin`
(default 8 minutes) between live runs is an intermission and starts a new period. A non-live run
between `ambiguousMin` (default 3 minutes) and `intermissionMin` is ambiguous. Both are per-game
settings alongside `periodMinutes` (default 20), which penalty expiry needs.
Periods 1 to 3 are numbered; a fourth and later are OT. An event's period is the number of
clean intermissions before it plus one, with confidence 100 if every gap before it is clean,
reduced by 30 per ambiguous gap, and 0 if the game-state answers for the gap are below 60
confidence. The period is set on the event only at or above the `period` threshold. Manual
period markers (a human saying "period 2 starts at 41:10 video") override inference from that
point. Game state runs also feed the timeline strip.

### Cost of a 2.5-hour game

| Item | Tokens | Cost |
|---|---|---|
| Pass 1, about 360 clips | 1.8M | $0.27 |
| Pass 2, about 40 clips × 3 | 180K | $0.03 |
| Pass 3, about 10 goals | 60K | $0.01 |
| Container, 6 × standard-2 for about 25 minutes | | about $0.10 |
| R2, about 5 GB of clips per game | | $0.08 per month |

## Events, verdicts, flags

### Event record

`id`, `gameId`, `type` (`goal`, `penalty`, `shot_window`, `goalie_change`), `team`, `videoMs`,
`precisionMs`, `clipIndex`, `confidence` (1 to 100), `status`, `needs` (set of `time`,
`scorer`, `assists`, `player`), `attrs`, `createdAt`, and the derived `period` and the
human-entered `clock` (mm:ss remaining). Attributes by type:

- goal: `scorer`, `assists` (0 to 2 jerseys), each with its confidence.
- penalty: `infraction`, `class`, `minutes`, `player`; `expiresAt` computed from `clock` and
  `minutes` once a clock exists, rolling into the next period like GameSheet does.
- shot_window: `home`, `away` counts for the clip. Not an event a human reviews: it is a clip
  fact, always counted regardless of mode, and summed into the box score. The pass-1 question
  asks for shots in the first 25 seconds of the clip so the 5-second overlap is attributed to
  the earlier clip only. The box score page lets a human override a period's shot total.
- goalie_change: `team`.

Status is one of `auto`, `draft`, `accepted`, `rejected`, `manual`, `discarded`. Events never
change type or team in place: a rejection with a replacement creates a new `manual` event that
links back with `replaces`.

### Verdicts

Append-only: `eventId`, `by` (email from Access), `at`, `action` (`accept`, `reject`,
`replace`, `set_time`, `set_player`, `set_period_marker`), `payload`. The JSONL export is
events joined with their verdicts and the raw answers for their clips, one line per event.

### Modes

- **auto**: a first-pass event at or above `autoSave` is saved with status `auto`. Between
  `draft` and `autoSave` it is stored as `discarded` and hidden behind a filter. No accept or
  reject buttons. The needs queue still exists.
- **review**: at or above `draft` it is a `draft`. Accept marks it `accepted`. Reject marks it
  `rejected` and opens the manual picker; saving the picker creates a `manual` event, cancelling
  leaves the rejection standing with no replacement. The model never re-guesses a rejected event.
- Switching a game's mode applies to events created after the switch.

### The needs queue

An event needs the scorekeeper when its period is blank (`time`), when a goal has no scorer or
fewer than two assists above the bar (`scorer`, `assists`), or when a penalty has no player
(`player`). Both modes show the count and the list. Resolving one is a verdict.

## Dashboard

Routes in `apps/web`:

- `/`: games list from D1 with status, mode, event counts, needs counts, running cost; an
  upload drop zone and a URL field; the create-game form.
- `/games/$gameId`: the dashboard, layout A from the brainstorm mockup, kept at
  `docs/superpowers/specs/assets/2026-10-21-dashboard-mockup.html`. Header: game name,
  mode toggle, Drafts and Needs time counters, processing progress, running cost. Left: the
  event list with thumbnail, type badge, team, period and clock or video offset, confidence bar,
  status tag; filters for drafts only, needs only, type. Right: the player on the `view`
  rendition, a timeline strip of clips coloured by game state with event marks, a detail panel
  (event, confidence, placement, period, clock, scorer and assists with their confidences,
  infraction and class for penalties), and the action row: Accept, Reject, Set period and
  clock. Keyboard: `j` and `k` move between drafts, `a` accept, `r` reject, `t` set time, left
  and right step clips, space plays and pauses.
- `/games/$gameId/box-score`: scoring by period, shots by period, penalties by period and
  goalie changes, computed from `auto`, `accepted` and `manual` events plus every clip's shot
  counts, laid out like gamesheetstats. A period's shot total can be overridden by hand (a
  verdict). Export JSONL button.
- `/games/$gameId/settings`: mode, thresholds, rosters, period length and intermission
  thresholds, crop (read-only after start), delete.

Live updates: the dashboard opens a WebSocket to the game's DO; messages carry changed clips,
events and counters. React Query holds the lists and the socket patches them, as the clone does.

Manual picker modal: event type (goal, penalty, shot on goal, goalie change, nothing), team,
infraction and class for penalties, player number, scorer and assists for goals, period and
clock. Prefilled with the rejected draft's values so a near-miss is a two-click fix.

Thumbnails: `GET /api/games/:id/clips/:index/thumb` cuts a frame with the MEDIA binding from
`view` at the clip's midpoint, writes it to `thumbs/<gameId>/<index>.jpg`, and serves from R2
after that.

## Auth, domain, deploy

Cloudflare Access application "Strix" on `strix.andamonium.dev`, email one-time code, an
allowlist policy with Andrew's addresses and invited PMs. The Worker has a Custom Domain route
for that hostname only, no workers.dev, no preview URLs, no wildcard route. The Worker verifies
the Access JWT on every `/api/*` request and on the WebSocket upgrade, and reads the email for
verdicts. Local dev signs in as a fixed identity through wrangler's `access.dev` block, as the
clone does.

Secrets: `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, an R2 API token scoped to the `strix`
bucket, used only to presign container URLs. Set with `wrangler secret put`.

Bindings: `AI`, `MEDIA`, `BUCKET` (R2 `strix`), `DB` (D1 `strix`), `GAME` (DO), `SLICER`
(container DO, `max_instances` 6, `instance_type` `standard-2`), `CLASSIFY` queue producer and
consumer (batch size 1, max retries 3, dead-letter queue `strix-classify-dlq`).

CI: `ci.yml` on pull requests and pushes to `main`: install, lint, typecheck, test, coverage,
build, e2e. `deploy.yml` on a green `main`: `wrangler deploy`, which builds and pushes the
container image on the runner's Docker. D1 migrations run in the same job.

## Testing

- Domain: unit tests with vitest and fast-check for period inference, overlap merge,
  thresholds, penalty expiry across periods, assist selection, box-score aggregation.
- Worker: `@cloudflare/vitest-plugin` tests for the DO (clip arrival, event creation in both
  modes, verdicts, needs flags), the queue consumer with a fake AI binding that returns recorded
  Clef answers, upload multipart handling, Access rejection.
- Contracts: decode and encode round trips for every schema.
- E2E: Playwright against `vite dev` in a `local` environment where the container is replaced
  by a fixture that emits pre-cut clips and the AI binding replays recorded answers, so a whole
  game "processes" in seconds. Specs cover upload, crop, auto mode, review accept and reject,
  the needs queue, keyboard shortcuts, box score, export.
- A `scripts/record-answers.ts` script calls real Clef-omni on a real clip set once and saves
  the answers as fixtures.

## Left to the builder

- Exact ffmpeg filter graph and encoder settings that hit the rendition targets.
- The Effect layer and service layout inside the Worker; how the queue consumer and DO share
  the AI client.
- Component breakdown, shadcn components used, Tailwind tokens, dark mode.
- Retry and backoff for Workers AI errors and container failures; what a failed clip looks like
  in the UI.
- Thumbnail cache eviction, if any.
- How the probe frame offset behaves on footage shorter than five minutes.
- Whether running score in `state` helps Clef; the field exists either way.

## Build order

The demo should show everything, so the plan builds in the order that produces a working
end-to-end path soonest and adds the slower pieces after:

1. Repo, tooling, CI, Access, empty dashboard deployed to `strix.andamonium.dev`.
2. URL ingest, container slicing, pass 1, auto mode, event list and player. First demo-able.
3. Passes 2 and 3, period inference, needs queue.
4. File upload with the crop step.
5. Review mode, verdicts, manual picker, keyboard.
6. Box score, settings, export.

## Footage

Andrew has plenty of recorded games, from youth to near-professional level, with scoreboard
overlays. Source and format vary; the builder picks a few representative games with Andrew for
fixtures and records Clef answers from short clips of them. Clips committed to the repo as test
fixtures are at most a few seconds each and contain no overlay.

## Decisions Andrew made, in order

1. Live feed is the destination; pre-taped games prove the concept.
2. No CLI in the demo path; slicing runs in Cloudflare Containers.
3. Event vocabulary follows GameSheet's play-by-play; no shot type.
4. Clock time is always human-entered; the model attempts period only; unsure means blank and
   flagged, in auto mode too.
5. The model must not see the scoreboard overlay; the container crops it out. Period is
   inferred by the app from intermission gaps, not asked of Clef.
6. Two-pass placement to about 10 s.
7. Durable Object per game, D1 as the index.
8. Access with an email allowlist on `strix.andamonium.dev`.
9. Inline review (layout A), keyboard-driven.
10. File upload and URL ingest both supported.
11. Rosters are jersey numbers only; scorer and assists are in; shootouts and Firebase are out.
12. The PM demo shows the whole thing; footage spans youth to near-pro.

## Calls I made (Claude), for Andrew to check

- Audio stays in the model clips.
- 30 s windows, 5 s overlap, 480p for pass 1, 720p for passes 2 and 3, uncropped 480p for humans.
- Thresholds 80 / 40 / 85 / 70 / 50.
- Browser uploads go through the Worker in 50 MB parts rather than presigned browser-to-R2
  uploads, so no R2 credentials reach the browser and Access covers every byte.
- Container input and output via presigned S3 URLs, six parallel `standard-2` instances.
- Sub-windows for passes 2 and 3 are cut with the MEDIA binding, not by the container.
- Sub-threshold answers are kept as `discarded` events, hidden by default.
- Period inference thresholds: 8 minutes clean, 3 to 8 minutes ambiguous, 20-minute periods,
  all per-game settings.
- Shot counts are clip facts, never reviewed, asked for the first 25 s of each clip.
- The `local` environment replaces the container, the AI binding and the MEDIA binding with
  fixtures, since MEDIA has no local mode and presigned R2 URLs do not exist against local R2.
  A `dev:real` environment runs against the real account for ffmpeg tuning and answer recording.
- Deploy is `wrangler deploy` on a green `main`, not the clone's versions-upload release
  script. D1 migrations run in the deploy job.
- GitHub under ItsAndrewM.
