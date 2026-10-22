# One-time Cloudflare setup

Strix runs as one Worker, `strix`, on `strix.andamonium.dev` in account `6624f09210327baade61004af0d9be84`.
These steps create what that Worker binds to, protect it with Access, deploy it once by hand, and then let GitHub
deploy it. Run them once, in order. Every code block starts with its own `cd`, so it runs from anywhere inside the
repository. After step 12 every green `CI` run on `main` deploys on its own.

You need Node 24 (`nvm use`), pnpm 10, `pnpm install` done, and Docker running (the first deploy builds the slicer
container image).

## 1. Log wrangler in

```bash
cd "$(git rev-parse --show-toplevel)/apps/worker"
pnpm exec wrangler login
pnpm exec wrangler whoami
```

`whoami` must list account `6624f09210327baade61004af0d9be84`.

## 2. R2 bucket

```bash
cd "$(git rev-parse --show-toplevel)/apps/worker"
pnpm exec wrangler r2 bucket create strix
```

## 3. D1 database

```bash
cd "$(git rev-parse --show-toplevel)/apps/worker"
pnpm exec wrangler d1 create strix
```

Copy the `database_id` it prints into `apps/worker/wrangler.jsonc`, in the top-level `d1_databases[0].database_id`
(currently `""`). Leave the `env.local` copy empty.

## 4. D1 migrations

```bash
cd "$(git rev-parse --show-toplevel)/apps/worker"
pnpm exec wrangler d1 migrations apply strix --remote
```

This needs the id from step 3 saved first.

## 5. Queues

```bash
cd "$(git rev-parse --show-toplevel)/apps/worker"
pnpm exec wrangler queues create strix-classify
pnpm exec wrangler queues create strix-classify-dlq
```

## 6. R2 API token and Worker secrets

In the dashboard, open **R2 Object Storage > Manage API tokens > Create API token**. Choose **Object Read & Write**,
apply it to the `strix` bucket only, and create it. Keep the page open: it shows the access key id and secret once.

```bash
cd "$(git rev-parse --show-toplevel)/apps/worker"
pnpm exec wrangler secret put R2_ACCESS_KEY_ID
pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
```

Paste the **Access Key ID** at the first prompt and the **Secret Access Key** at the second. If wrangler says there is
no Worker called `strix` yet and offers to create one, answer yes.

## 7. Access application

In **Zero Trust** (team domain `https://misty-wildflower-0505.cloudflareaccess.com`), first check
**Settings > Authentication > Login methods**. If **One-time PIN** is not listed, add it there.

Then open **Access > Applications > Add an application > Self-hosted**:

- Application name: `Strix`
- Domain: `strix.andamonium.dev`
- Identity provider: **One-time PIN** (email code)
- Policy: action **Allow**, include **Emails** `andrew@gamesheetinc.com` and `mcmillan.r.andrew@gmail.com`

Save it, open the application again, and copy its **Application Audience (AUD) Tag** into
`apps/worker/wrangler.jsonc`, in the top-level `vars.ACCESS_AUD` (currently `""`). Leave the `env.local` copy empty.

## 8. Workers AI and Media Transformations

Strix binds Workers AI (`AI`) and Media Transformations (`MEDIA`). If the dashboard asks you to enable either product
(**AI > Workers AI**, **Media > Transformations**), enable it. Nothing to paste.

## 9. Commit the ids, without pushing

```bash
cd "$(git rev-parse --show-toplevel)"
git switch main
git add apps/worker/wrangler.jsonc
git commit -m "chore: cloudflare resource ids"
```

Neither `database_id` nor `ACCESS_AUD` is a secret. Do not push yet: pushing `main` starts CI and then the Deploy
workflow, and that must wait until the manual deploy in step 10 has created the Custom Domain and the container
application.

## 10. First deploy, by hand

The first deploy creates the `strix.andamonium.dev` Custom Domain and the `strix-slicercontainer` container
application, so run it yourself with Docker running. It uses your `wrangler login` session from step 1, not the API
token.

```bash
cd "$(git rev-parse --show-toplevel)"
pnpm build
pnpm --filter @strix/web exec wrangler deploy
```

`pnpm build` writes the deployable Worker and its assets to `apps/web/dist`; `wrangler deploy` from `apps/web` reads
that build (not `apps/worker/wrangler.jsonc` directly), uploads it, and builds and pushes the container image.

## 11. GitHub repository secret

Create a Cloudflare API token at **My Profile > API Tokens > Create Token > Custom token** with these permissions:

- Account `6624f09210327baade61004af0d9be84`, **Edit** on:
  - Workers Scripts
  - D1
  - Workers R2 Storage
  - Queues
  - Containers
  - Durable Objects
- Zone `andamonium.dev`:
  - **Zone: Read**
  - **Workers Routes: Edit**

Every `wrangler deploy` re-syncs the `strix.andamonium.dev` Custom Domain, which reads the zone and attaches the
domain, so the two zone permissions are required even though the domain already exists.

Add the token to the GitHub repository at **Settings > Secrets and variables > Actions > New repository secret** as
`CLOUDFLARE_API_TOKEN`. Only the Deploy workflow reads it.

## 12. Push `main`

```bash
cd "$(git rev-parse --show-toplevel)"
git push origin main
```

CI runs, and on green `.github/workflows/deploy.yml` builds, applies the remote D1 migrations and deploys the same
commit you deployed in step 10. From now on that happens after every green `CI` run on `main`.

## Verify

1. Open `https://strix.andamonium.dev/`. Access asks for an email; enter one of the two allowed addresses and the code
   it sends. The games page loads.
2. Create a game: any name, teams and rosters, and the video URL
   `https://pub-8613b7f94d6146408add8fefb52c52e8.r2.dev/aus-mobile-demo.mp4`. It opens the game page with a probe
   frame. The sample is 15 seconds long, so the frame comes from its middle (a source shorter than 10 minutes is
   framed at half its length instead of at 5 minutes).
3. Switch on **No overlay** and press **Start**. The sample is shorter than one 30-second window, so the timeline
   strip shows exactly one clip; it turns from hatched (pending) to a game-state colour once classified, and the game
   reaches **ready**. The sample is not hockey, so the event list is most likely empty. A red-striped cell or a
   "could not be sliced" notice means a window failed: the notice says how many, and **no slicer capacity** means
   another game held every slicer container (try again in a few minutes).
4. In the dashboard, **Storage & Databases > Queues > strix-classify** drains to zero with nothing on
   `strix-classify-dlq`, and **Workers & Pages > Containers** lists `strix-slicercontainer`.
5. In GitHub **Actions**, the `Deploy` run for the step 12 push is green.
