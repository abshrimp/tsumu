# Tsumu detailed guide

[README](../README.md) · [日本語](user-guide.ja.md)

## How it works

The following diagram describes `PUBLISH_PROVIDER=github` (which commits to GitHub or GitLab.com). With `netlify` or `cloudflare`, Tsumu instead sends prebuilt static HTML/CSS/JS directly to a provider project for each site, without using a Git repository or publishing editable data.

```
Tsumu (this repository)
│  Runs on Cloudflare Workers, Node.js or Docker
│  Home (list of sites) · Editor /sites/<id> · Google sign-in (optional)
│
│  Publish → main  /  Test publish → preview
▼
One repository per site (GitHub or GitLab.com)
│  Site A, Site B, … (each with main = production, preview = test)
│
│  Each branch is built automatically
▼
Hosting (your choice)
   Vercel / Netlify / Cloudflare Workers / Node.js
```

There are three moving parts:

- **The editor** is a Next.js app. It runs on Cloudflare Workers, Node.js or Docker (see [Deploying the editor](#deploying-the-editor)). It stores the list of sites, editing data, comments, the edit and publish activity log, the sign-in allowlist, and uploaded assets (images, video, audio, custom fonts, and imported HTML ZIP files). Uploaded assets are authorized per site, while pages or elements copied between sites share the underlying stored file. Where all of this is stored depends on where the editor runs.
- **The published site** is either an ordinary app committed to the site's GitHub or GitLab.com repository or a generated static HTML site uploaded to Netlify/Cloudflare Pages. It does **not** have to run where the editor runs.
- **Test publishing** commits to a second branch of the same repository (`preview` by default). Vercel, Netlify and Cloudflare Workers Builds can build non-production branches as previews, so one hosting project covers both the live and the test site (on Netlify and Workers Builds, turn this on first; see [Hosting the published site](#hosting-the-published-site)). The test build is kept out of search engines with robots.txt, `noindex`, the `X-Robots-Tag` header and crawler blocking.

## What you need

Local development works with no environment variables. In production, configure Google sign-in or explicitly allow anonymous access. Storage, publishing and AI each have their own settings.

| Setting | Without it | With it |
|---|---|---|
| Server storage (D1, Durable Objects and KV on Cloudflare; `TSUMU_DATA_DIR` on Node.js and Docker) | Sites, editing data, comments and uploaded files are saved in the browser. Only that browser can see them, and each file is limited to 2 MB. | Everything is saved on the server. You can edit and comment from other devices and with other people. You also get daily backups and a record of who edited and published. Each file can be up to 25 MB. |
| Google sign-in (`AUTH_*`) | Local development accepts anonymous requests addressed to loopback hosts. Production requires sign-in unless you explicitly set `ALLOW_ANONYMOUS=true`. | Only the Google accounts you allow can sign in (with **Editor** or **View only** access). |
| `GITHUB_TOKEN` / `GITLAB_TOKEN` | **Publish** explains what to set up. Exporting code as a zip still works. | Publishes to the GitHub or GitLab.com repository set in each site's settings. |
| `AI_*` | No **Ask AI** button. | **Ask AI** is available. |

> [!IMPORTANT]
> If the editor can be reached from the internet, always set up Google sign-in. Run it without sign-in only on your own machine, or as a demo that has no publish target (neither `GITHUB_TOKEN` nor `GITLAB_TOKEN`).

## Quick start (local)

You need Node.js 26.12.1+ and npm 12.2.1+. If you use nvm, run `nvm use` after cloning.

```bash
git clone https://github.com/abshrimp/tsumu.git
cd tsumu
npm ci
npm run dev
```

Open http://localhost:3000 to see the home screen, which lists your sites. Click **New site** to create one; its editor opens at `/sites/<id>`.

A few things to know about `npm run dev`:

- It emulates Cloudflare's D1 and KV locally, based on `wrangler.jsonc`. Data goes to `.wrangler/state`, even if `TSUMU_DATA_DIR` is set.
- With Google sign-in unconfigured, the default development server checks the request hostname. It accepts `localhost`, names ending in `.localhost`, IPv4 loopback addresses in `127.0.0.0/8`, and `[::1]`, with or without a port.
- For anonymous LAN testing, set `ALLOW_ANONYMOUS=true` in `.env.local` and restart the development server. For a local Worker preview, put the flag in `.dev.vars`. The explicit flag permits other hostnames, so anyone who can reach the instance can edit and use its configured publish target.
- Collaborators' changes arrive through Server-Sent Events (SSE), because WebSocket is not available. If SSE is also unavailable, the editor falls back to polling every 10 seconds. To try the real-time WebSocket connection, use `npm run preview`.

## Deploying the editor

Before updating an existing instance, follow the [release-safety checklist](releasing.md) for staging checks, backup/restore validation, rollback and monitoring.

Choose where to run the editor based on how you want to store files, recover deleted assets and collaborate.

| | Cloudflare Workers | Node.js | Docker |
|---|---|---|---|
| Storage | D1 (site metadata), SQLite-backed Durable Objects (document rows), Workers KV (images and files) | The `TSUMU_DATA_DIR` folder (SQLite and files) | `/data` in the container (mount a volume) |
| Removing an uploaded asset | Appears in **Assets → Trash** for recovery or permanent deletion | Deletes the file immediately if no other site uses it | Same as Node.js |
| Collaborators' changes | Immediately (WebSocket via a Durable Object) | Immediately (Server-Sent Events) | Immediately (Server-Sent Events) |
| Cost | Runs on the free plan (see [Limits](#limits)) | Your server | Your server |
| Good for | Running without a server of your own | Running on your machine or an existing server | Managing it as a container |

D1 and local SQLite tables are created on first access. To store editing data on Cloudflare, `wrangler.jsonc` must declare the `DOC_STORE` binding and the SQLite-backed `exports.DocumentRoom`. For the storage model and deployment checks, see [Document storage](durable-object-storage.md). Without server storage, data stays in the browser (see [What you need](#what-you-need)).

On Cloudflare, files in Trash count toward storage usage. Automatic deletion is off by default. With `ASSET_GC_ENABLED=true`, the daily job at 03:00 JST checks files whose grace period has elapsed (seven days by default, configurable with `ASSET_GC_GRACE_DAYS`). It keeps files still used by a live site. **Delete permanently** is available even when automatic deletion is off. See [KV asset garbage collection](asset-gc.md) for shared references and the weekly orphan check.

### Common setup

#### Google sign-in

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type "Web application".
2. Add these authorized redirect URIs:
   - `https://<editor-domain>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (only if you want to try sign-in locally)
3. You can leave the OAuth consent screen in testing mode. Add yourself as a test user.

Sign-in turns on once `AUTH_SECRET`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are all set. Also set `AUTH_URL` to the editor's URL.

Accounts listed in `ALLOWED_EMAILS` are instance administrators with full recovery access. To allow more accounts (either as **Editors** or **View only**), go to the home screen and open **Settings → Accounts that can sign in** (this needs server storage).

**Per-site membership:** A login alone grants no access to individual server-stored sites. The creator is the first **Owner**. From the site's **… → Members and permissions** menu, an owner can grant an allowed account **Owner**, **Editor**, or **View only** rights, or remove its access. Editors can change and publish that site; viewers can only inspect it; users not in the site membership cannot see it in the home list or open its URL. Account-wide **View only** access remains a ceiling, so those accounts cannot edit a site even if listed as a site editor. Each site must retain at least one owner.

#### GitHub and GitLab tokens

For GitHub, create a **fine-grained personal access token** with **Contents: Read and write** on every repository you publish to. For GitLab.com, set `GITLAB_TOKEN` to an access token with the **api** scope and write access to its projects. Each provider has a server-wide token shared by its publishing sites; grant access only to the intended repositories.

You choose each site's repository on the home screen, under the site's **… → Settings** (see [Publish targets](#publish-targets)).

### Cloudflare Workers

**1. Create the storage (optional)**

```bash
npx wrangler login
cp wrangler.jsonc wrangler.local.jsonc
npx wrangler d1 create tsumu                  # put the printed database_id in wrangler.local.jsonc
npx wrangler kv namespace create ASSETS_KV    # put the printed id in wrangler.local.jsonc
```

Git ignores `wrangler.local.jsonc`, so your resource IDs never end up in the repository. When the file exists, `npm run dev`, `npm run preview` and `npm run deploy` use it automatically. (To use a different file, name it in `WRANGLER_CONFIG`.)

The deploy wrapper validates the selected configuration and rejects command-line overrides such as `--config` or `--env`, which could bypass that validation. For a separate production config, point `WRANGLER_CONFIG` at a file that declares its bindings at the top level.

If D1, KV or the DocumentRoom binding and export are incomplete, a production deployment falls back to browser-only storage. Before that, the deploy wrapper inspects the active Worker versions and refuses to remove existing server-storage bindings. If it can't inspect an existing deployment, it stops rather than risk losing access to data. New Workers may deploy without server storage, and local builds and hosted Worker Previews need no storage IDs.

**2. Set the secrets and deploy**

Set each variable you need with `npx wrangler secret put <NAME>` (see [Environment variables](#environment-variables)). If you use `wrangler.local.jsonc`, add `--config wrangler.local.jsonc`. Then deploy:

```bash
npm run deploy
```

#### Deploying on every push (Workers Builds)

To deploy automatically with Cloudflare Workers Builds, connect the repository and set:

- Build command: `node scripts/cloudflare.mjs build`
- Deploy command: `node scripts/cloudflare.mjs deploy`
- Preview command: `node scripts/cloudflare-preview.mjs` (see below)
- Build variables (optional; under Settings → Build → Variables and secrets): `D1_DATABASE_ID` and `KV_NAMESPACE_ID`

At build time, the script reads `wrangler.jsonc` and writes a deploy config, `wrangler.generated.jsonc`. It fills in the IDs from the build variables and drops bindings that have none, so you never need to commit your IDs. Workers Builds passes the connected Worker's name in `WRANGLER_CI_OVERRIDE_NAME`, and the generated config uses it, so you don't need to change the name in the repository.

#### Previewing pull requests (Worker Previews)

With the Preview command above, Workers Builds deploys each pull request as a **Worker Preview** and posts its URL on the pull request. The repository's default Preview configuration is a public demo that needs no sign-in and keeps its data in the browser. The wrapper supplies empty D1/KV bindings and uses `--ignore-base-config`; it does not remove secrets already configured on an existing Preview. Check those secrets before reusing a Preview as a public demo.

See [Previewing pull requests of the editor](worker-previews.md) for setup and for giving Previews test storage. For server storage, adding D1 and KV IDs isn't enough: the Preview also needs an explicit `DOC_STORE` binding to `DocumentRoom`, alongside `COLLAB_ROOM`. Configure sign-in before using shared test storage.

### Node.js

You need Node.js 26.12.1+ and npm 12.2.1+. If you use nvm, run `nvm use` after cloning.

Set `TSUMU_DATA_DIR` to a folder. The editor keeps its data in `<folder>/tsumu.db` (SQLite) and uploads in `<folder>/assets/`. It uses Node's built-in `node:sqlite`, so there's nothing extra to install.

```bash
npm ci
npm run build
TSUMU_DATA_DIR=./data npm start
```

To try it on your own machine without sign-in, add `ALLOW_ANONYMOUS=true`:

```bash
ALLOW_ANONYMOUS=true TSUMU_DATA_DIR=./data npm start
```

Set the other variables in `.env.local` or in the server's environment (see [Environment variables](#environment-variables)). `PORT` changes the port (default 3000).

Things to keep in mind:

- **Backups:** stop every process writing to `TSUMU_DATA_DIR` and disable automatic restarts before copying the whole folder. Keep writers stopped until the copy finishes. Copying a live SQLite database and its WAL files one at a time is not a consistent snapshot. Include `assets/` and any `tsumu.db-wal` / `tsumu.db-shm` files still present; do not delete them. Use a fresh backup destination outside the data folder, and [validate a disposable restore](releasing.md#backup-and-restore-validation) before relying on it.
- **One editor per folder:** run only one editor per `TSUMU_DATA_DIR`. Collaborators' changes are relayed only within a single process.
- **Reverse proxy (nginx and similar):**
  - Set `AUTH_URL` to the public URL, and have the proxy forward `X-Forwarded-Host` and `X-Forwarded-Proto`. Otherwise Google sign-in won't redirect back to the right address.
  - Make sure the proxy streams `/api/collab/events` without buffering. nginx does this automatically, because the response carries an `X-Accel-Buffering: no` header.

### Docker

The image contains the Node.js editor and stores its data in `/data` inside the container.

```bash
docker build -t tsumu .
docker run -d --name tsumu -p 3000:3000 -v tsumu-data:/data --env-file .env.local tsumu
```

To try it on your own machine without sign-in, add `-e ALLOW_ANONYMOUS=true`.

Pass environment variables with `--env-file` (or `-e`); see [Environment variables](#environment-variables). Leave `TSUMU_DATA_DIR` out of that file, or the data will be written outside the volume.

**Where the data lives**

```
/data/
  tsumu.db, tsumu.db-wal, tsumu.db-shm   Sites, editing data, comments, backups and so on (SQLite)
  assets/data/                            Uploaded images, video and other files
  assets/meta/                            Each file's Content-Type
```

- `-v tsumu-data:/data` stores the data in a Docker named volume called `tsumu-data`. If you recreate the container with the same volume, the data is still there.
- To keep the data in a folder on the host instead, use `-v "$(pwd)/data:/data"`. The container runs as the `node` user (UID 1000), so on Linux hand the folder to that user first: `sudo chown 1000:1000 data`.
- **Don't start the container without `-v`.** The data would go to an anonymous volume, and a recreated container wouldn't see it.

To back up the named volume from the example above, first disable any external
supervisor that could restart the editor, and stop anything else that writes to
this volume. Then run the entire block from a backup directory outside the data
volume:

```bash
(
  set -eu
  data_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' tsumu)"
  test "$data_volume" = 'tsumu-data'
  docker stop tsumu
  running="$(docker inspect --format '{{.State.Running}}' tsumu)"
  test "$running" = 'false'
  backup_dir="$(mktemp -d "$PWD/tsumu-backup.XXXXXX")"
  docker run --rm \
    --mount type=volume,src=tsumu-data,dst=/data,readonly \
    --mount "type=bind,src=$backup_dir,dst=/backup" \
    busybox sh -ec 'test -s /data/tsumu.db; tar czf /backup/tsumu-data.tgz -C /data .; tar tzf /backup/tsumu-data.tgz >/dev/null'
  printf 'Backup archive (restore validation pending): %s/tsumu-data.tgz\n' "$backup_dir"
  docker start tsumu
)
```

The block checks that it has the expected volume and that the container has
stopped, mounts the source read-only, and creates a new directory for each
attempt. If any step fails, it exits without restarting the container; inspect
the error and the container's state, then restart the editor yourself once it
is safe. Do not use a partial archive.
Archive readability alone does not prove recovery: follow the
[isolated restore drill](releasing.md#backup-and-restore-validation).

Reverse proxy setup is the same as for [Node.js](#nodejs).

## Publish targets

The publishing provider is selected for the entire Tsumu instance by `PUBLISH_PROVIDER` (`github`, `netlify`, `cloudflare`). Server credentials are not stored in site settings. For **Netlify**, configure a Netlify OAuth application. The editor can run without sign-in and without server-backed site storage: each browser owns its local sites and its Netlify login. For **Cloudflare Pages**, configure server API credentials and storage. Each site gets a separate provider project on first publish (Netlify test publishing uses a separate project; Cloudflare Pages uses a preview branch). Only built static HTML/CSS/JS and assets are uploaded; editor data is never included. Static publishing has no build step and does not support server-only Next.js features.

For **Git repositories**, set `PUBLISH_PROVIDER=github`, then open a site's **… → Settings** to configure the fields below. Each site can use GitHub or GitLab.com. You can fill them in when you create the site or later.

| Field | Description |
|---|---|
| Git service | GitHub or GitLab.com |
| Repository | GitHub: `owner/name`. GitLab: `group/project` or `group/subgroup/project`. You can edit without one, but you can't publish. |
| Production branch | Default: `main` |
| Test branch | Default: `preview`. Leave it empty to turn test publishing off. |
| Live site URL / test site URL | Optional. The Publish dialog links to them. |

Create the site's repository before the first publish. It can be empty or initialized with a README.

### Browser-local Netlify publishing without a Tsumu login

For a public instance such as `tsumu.ebii.net`:

1. Set `PUBLISH_PROVIDER=netlify`, `TSUMU_STORAGE_MODE=local`, `ALLOW_ANONYMOUS=true`. Do not set `AUTH_SECRET`, `AUTH_GOOGLE_ID` or `AUTH_GOOGLE_SECRET`. Each visitor's sites and editable documents then stay in that browser even if D1 is bound to the Worker. Server-side KV uploads are also disabled; inline browser assets are limited to 2 MiB per file.
2. Create an OAuth application in Netlify **User settings → Applications** with callback `https://tsumu.ebii.net/netlify/callback`. Set `NETLIFY_OAUTH_CLIENT_ID` and the exact `NETLIFY_OAUTH_REDIRECT_URI`. No shared Netlify API token, Google login, OAuth Client Secret or `NETLIFY_TOKEN_ENCRYPTION_KEY` is needed.
3. The visitor clicks **Publish**. The first time, Netlify signs them in. The callback verifies the one-use state and returns to the same site's Publish dialog. If their Netlify account has one team, it is used automatically; otherwise they choose the team. Production and test use distinct Netlify projects.
4. The browser stores the Netlify OAuth access token and the per-site project IDs in localStorage. For deployment, Tsumu's server acts as a temporary API proxy; it validates the ZIP and the project's Netlify team, and **does not persist credentials or editable documents**. All Netlify usage is charged to the visitor's chosen team.

**Security and recovery:** localStorage tokens are accessible to scripts running on the same origin, so avoid untrusted browser extensions and scripts, and disconnect from Netlify when no longer needed. An editor opened from a different browser cannot read local sites or publishing credentials. Clearing browser data removes the editable sites and Netlify bindings (but does not delete the websites hosted by Netlify). Export a full backup ZIP regularly and re-import to recover editing data. To retain a stable publishing project on another browser, keep its Netlify project ID safely; re-linking existing projects is not automatic.

## Output formats

With **GitHub or GitLab**, **Publish** and **⋯ → Export as zip** both let you pick a framework, a language and a style. With server storage configured, Publish remembers the framework, language and style from the site's last successful Git push, whether to its test or production branch. The first publish and each ZIP export start with Next.js, TypeScript and CSS.

| Framework | What you get | Running it |
|---|---|---|
| **Next.js** (default) | Every feature: dynamic paths such as `/news/[slug]`, redirects and reverse proxies, server-side data with ISR, HTML pages | Any Next.js host (see [below](#hosting-the-published-site)) |
| **React + Vite** | A single-page app. Data is fetched in the browser. | `npm run build`, then serve `dist/` |
| **Vue 3 + Vite** | Rendered on the server by a small Node.js server, then hydrated | `npm run build && npm start` |
| **Nuxt** | A server-rendered Nuxt app | `npm run build`, then `node .output/server/index.mjs` |
| **SvelteKit** | Server-rendered with `@sveltejs/adapter-node` | `npm run build`, then `node build` |
| **HTML / CSS / JavaScript** | Static files. No npm, no build. | Serve the repository root, or open `index.html` from the zip |
| **Single HTML** | One page as one HTML file, with CSS, JavaScript, images and fonts embedded | Open or serve the file |

- **Language:** TypeScript or JavaScript. **Style:** CSS, CSS Modules or Tailwind CSS. Tailwind output keeps Tsumu's generated CSS too, so the design doesn't change. The two HTML formats always use JavaScript and CSS.
- With the HTML formats, external APIs must allow CORS. Opening the files over `file://` has restrictions, so check them on `localhost` or a real host.

Formats other than Next.js can't express everything. The dialog lists what the site uses that the chosen format can't output, and won't export or publish until you change it:

- dynamic paths (`[slug]`) and redirect or reverse-proxy pages;
- HTML pages (pages written as raw HTML), except in the two HTML formats;
- a custom `<script>` at the end of the body, in React, Vue, Nuxt and SvelteKit;
- CSS Modules or Tailwind CSS with the HTML formats;
- more than one page with Single HTML.

Data fetches that carry credentials (an `Authorization` header, an API key in the URL or body, and so on) can't be exported or published in any format, Next.js included, because the values would end up in the generated source and in the zip's editing data. Keep credentials in server environment variables or behind an API proxy.

**Publishing** always covers the whole project. Publishing a format other than Next.js to the live site asks for confirmation first, because the repository layout changes and the host's build and output settings must match.

In a production publish, **Search & sharing (SEO) → Hide from search results** sets `noindex` for the selected page. React applies this tag in the browser. Static HTML also applies it in the browser when pages sharing a path have different settings for different query strings. The published page remains accessible by link. Test publishes apply `noindex` to the whole site.

**Exporting a zip** can also cover just the **current page** or the **selected component** (the selected element and its children, as a page of their own). The zip includes `_tsumu/doc.json` and `_tsumu/assets.json` — the editing data for what you exported — so you can [import](#importing) it again. Deploy only the generated website files to your web server.

**Single HTML** downloads a standalone `.html` file for the current page or selected component. To preserve the original editing data and assets for later import, choose a ZIP format. External APIs and embedded videos still need a network connection.

> [!NOTE]
> Publishing to GitHub or GitLab.com also commits the site's full editing data to `_tsumu/doc.json`, including unpublished pages and settings. In a public repository, anyone can read it.

## Importing

On the home screen, click **Import** or drop a file onto the page to create a new site:

| File | Result |
|---|---|
| A zip exported from Tsumu (it contains both `_tsumu/doc.json` and `_tsumu/assets.json`) | The site is restored, with its images and other assets. |
| A `doc.json` | The site is restored. Assets embedded as data URLs are uploaded. |
| An HTML file, or a zip of a website | Every HTML page is converted into editable elements. Links between those pages follow the source HTML’s base URL, including query strings and fragments. The zip's other files are uploaded as assets and the HTML's paths are rewritten. |

If you drop a ZIP without editing data onto the home screen, Tsumu alerts you before converting its HTML. Warnings about assets that could not be restored appear once the new site opens. If the connection drops during a server import and Tsumu cannot confirm the save, check the home screen for the new site before importing again.

In the editor, a page's settings can also load an HTML file or a zip into that page. A normal page converts the HTML into editable elements, asking before it replaces the page's current elements. An HTML page uses the HTML as is. From a zip, `index.html` is loaded first.

If a restored HTML page reports missing assets, open that page's settings, choose **Load HTML and assets from ZIP without converting**, and select the original website ZIP. This reloads the page's HTML and uploads the missing files from the ZIP.

Editable forms retain their submission method, action URL, field names and submit-button overrides. Serve the exported site with the endpoint that handles the form. Number and date fields retain their limits, and file fields retain their allowed file types and multiple-file setting.

When converted to an editable image, a plain `<img>` keeps its `src` and drops `srcset` and `sizes`. Use an HTML page to preserve its responsive image candidates. A `<picture>` is retained as a custom code element.

Limits: a zip can be up to 100 MB and a `doc.json` or HTML file up to 12 MB. A zip of a website can hold up to 200 files and 2 MB of CSS. Save HTML and CSS files in the zip as UTF-8.

> [!TIP]
> `skills/tsumu-site/` is an agent skill that describes the `doc.json` format, so an AI agent can generate a site you then import and keep editing.

## Duplicating and copying pages

In **Pages**, right-click a page to copy it on its own. For a group, click **Select pages** and check the pages you want. The current page starts checked. You can also ⌘-click (Ctrl-click on Windows or Linux) to toggle individual pages, or Shift-click to select a range. Right-click one of the checked pages to act on the group.

| Where you want the copies | What to choose |
| --- | --- |
| The same site | Choose **Duplicate** (for example, **Duplicate 2 pages** for a pair). Each copy appears immediately after its original. One Undo removes the whole group of copies. |
| Another site | Choose **Copy to another site…** (for example, **Copy 2 pages to another site…**), then click the destination site to start the copy. The pages are appended in their original order with their elements, scripts, referenced assets, components, custom and uploaded fonts, and Adobe Fonts Web Project settings. Click **Open in a new tab** to view the result. |

For a link made with the editor’s page picker, select the source and target together to link the copies to each other. This also works with **Open a page or link** in page and element scripts, including inside a condition or loop. Within the same site, links to unselected pages still point to the originals, and component instances keep using their shared component.

When copying to another site, a link to an unselected page can use an existing destination page with the same path and query conditions. If there is no match, check the link in the destination editor and select the intended page. For example, `/blog?tab=news` and `/blog?tab=archive` are distinct targets. If a copied page's path and query conditions are already in use, Tsumu gives the copy a path such as `/blog-copy`. Update any paths you typed directly into URL fields or custom HTML if they should lead to the copy.

For individual elements, select them and press ⌘C, then open the destination site's editor and press ⌘V (Ctrl+C and Ctrl+V on Windows or Linux). The paste also carries their referenced assets, components and font settings, including uploaded fonts and Adobe Fonts Web Projects. The elements and newly added font settings form one Undo/Redo step.

## Hosting the published site

After the first publish, connect the site's repository to a hosting service. The table below is for the Next.js format; for the other formats, set the host's build and output settings as shown in [Output formats](#output-formats).

| Host | Setup | Test publishes |
|---|---|---|
| **Vercel** | Import the repository. No configuration needed. | Every non-production branch gets a preview URL. |
| **Netlify** | Import the repository. | Turn on branch deploys. |
| **Cloudflare Workers Builds** | Build: `npx opennextjs-cloudflare build`<br>Deploy: `npx opennextjs-cloudflare deploy` | Turn on [builds for non-production branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/). The published site has no storage or Durable Objects, so the editor's preview setup doesn't apply. |
| **Node.js** | `npm install && npm run build && npm start` | Build the test branch separately. |

### Data refresh interval and Cloudflare

In the Next.js format, pages that fetch external JSON are rebuilt at the **Data refresh interval** you set in the editor's **Site** tab. How that happens depends on the host:

- **Standard hosting** (Vercel, Netlify, Node.js) uses Next.js ISR: pages are built ahead of time and regenerated in the background.
- **Cloudflare Workers** needs an extra incremental cache (R2) and a queue for ISR. Without them, prebuilt pages are never regenerated. To avoid this, go to the editor's **Site** tab and choose **Hosting → Cloudflare Workers**. The editor then exports those pages so they render on every request, and caches the fetched JSON at Cloudflare's edge for the refresh interval instead.

On any host, an interval of `0` fetches the data on every request.

### Rollback

With **GitHub or GitLab**, **Publish → Publish history & rollback** (or **⋯ → History & rollback**) lists the commits on each branch. For any version you can:

- **Restore site** — commits the selected version's files again on top of the branch. History is kept, so the rollback itself can be undone.
- **Restore edits** — loads the editor content that was saved with that publish (`_tsumu/doc.json`). This counts as a normal edit, so ⌘Z reverts it.

With Netlify/Cloudflare Pages, the publish dialog shows provider deployment history and restore actions instead. It cannot restore the editor document from a deployment; use the separate editor backups for that.

The separate **History & rollback** menu also lists the server's daily backups of the editor content: one per weekday, seven in total.

Use **Export backup ZIP** in **History & rollback** to download a self-contained copy of the entire site, including every asset in the library (images, videos, fonts and even unused files). **Load backup file** restores that ZIP into the current editor and uploads its assets to the current storage. If an asset cannot be fetched or restored, the operation fails rather than silently producing an incomplete backup. Standalone `doc.json` files matching the current schema can also be loaded, though server-stored asset files are not bundled in JSON.

## Ask AI (optional)

Set `AI_ENABLED=true` and an API key, and the **Ask AI** button appears. Requests go through `/api/ai` on the editor's server, so the API key never reaches the browser.

### How it works

1. The browser sends a compact outline of the page you're editing: the element tree, text and styles. Other pages are sent by name only.
2. The server adds a fixed description of the editor's data model and an `edit_site` tool, and passes everything to the model.
3. The model answers with edit operations — set a style, insert or move an element, change some text, and so on.
4. The server tries those operations on a copy of the page. If any fail, it sends the errors back so the model can fix them.
5. The operations that apply cleanly go back to the browser, which applies them as one change you can undo.

Ask AI doesn't edit scripts, data sources or assets.

### Choosing a provider

| `AI_PROVIDER` | API key | Default `AI_MODEL` | Notes |
|---|---|---|---|
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | `claude-sonnet-5-5` or `claude-haiku-5-5` cost less |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.8-flash` | Uses Gemini's OpenAI-compatible endpoint. `gemini-2.5-flash-lite` is the cheapest, and there's a free tier |
| `openai` | `OPENAI_API_KEY` | Set `AI_MODEL` | |
| `openai-compatible` | `AI_API_KEY` | Set `AI_MODEL` | Any Chat Completions API with tool calling (OpenRouter, Ollama, …). Set `AI_BASE_URL` |

- `AI_API_KEY` works with every provider.
- `AI_EFFORT` (`low` … `max`, default `medium`) controls how much the model thinks. Lower is cheaper.
- Smaller models make more mistakes with edit operations. The server catches them and has the model fix them, so your page isn't damaged, but each request takes more round trips.
- Some free tiers, such as Gemini's, may use your requests to improve the provider's products.

### Example: using Gemini

Set these wherever the editor's environment lives — `.env.local` locally and on Node.js, the `--env-file` on Docker, or the Worker's Variables and Secrets on Cloudflare:

```dotenv
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
GEMINI_API_KEY=your-api-key
```

Store the API key as a secret. `AI_API_KEY` takes precedence over provider-specific keys, so remove any old shared key when you switch providers. To use Claude, OpenAI or a compatible API instead, follow the table above.

### Checking that it works

While signed in, open `/api/ai` to see whether AI is available and which model is selected. If `AI_ENABLED` is set but AI stays unavailable, the server log names the missing configuration. After changing settings, restart the editor (locally, on Node.js or on Docker) or apply the configuration change on Cloudflare, then return to the editor.

### What protects your work

Every AI edit is validated on a working copy before it touches your page.

- Nothing is applied if the connection drops, the request times out, a tool error goes unresolved or generation is cut off.
- If you edit the same page while waiting, the AI's result is rejected so your own work isn't overwritten.
- The chat's stop button cancels a request. A successful edit is a single undo step.
- While it works, the chat streams short public explanations, progress through preparation, validation and repair, and the elapsed time. The activity log stays available afterwards. The model's private reasoning and signatures are never shown.

### Connecting an external AI client (MCP)

You can also connect an external MCP-capable AI client (such as Claude Desktop, Cursor, or Codex) to an open Tsumu browser tab without configuring an AI API key on the Tsumu server:

- Open **⋯ → Connect external AI (MCP)** in the editor header (or on the home screen) to start a session with `tsumu-mcp` (defaults to `https://mcp.tsumu.ebii.net`; override at build time via `NEXT_PUBLIC_TSUMU_MCP_URL`).
- Choose **Read-only** or **Allow edits**, copy the generated MCP URL / configuration into your AI client, and keep the Tsumu tab open while working.
- External edits (`create_site`, `create_page`, `apply_operations`) execute inside your open browser session using the same validated `aiOps` schema, undo history, and storage backend (server or browser-only IndexedDB) as manual edits.

## Environment variables

All variables are optional (see [What you need](#what-you-need)).

| Variable | Description |
|---|---|
| `AUTH_SECRET` | Session secret. Generate one with `npx auth secret`. |
| `ALLOW_ANONYMOUS` | `true` lets the editor open without sign-in on non-loopback hosts and in production when Google sign-in isn't set up (loopback hosts under `npm run dev` open without it). Anyone with the URL can then edit and publish, so use it only locally or for a demo. |
| `AUTH_URL` | The editor's URL in production, e.g. `https://tsumu.example.com` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client |
| `ALLOWED_EMAILS` | Google accounts that always sign in as **Editors**, comma-separated. These can't be removed or downgraded in the UI. Manage additional **Editor** or **View only** accounts under **Settings** on the home screen. |
| `PUBLISH_PROVIDER` | `github` (default), `netlify` or `cloudflare`; selected for the whole Tsumu server |
| `PUBLISH_PROJECT_PREFIX` | Optional static hosting project prefix (default `tsumu`); choose a unique one per instance |
| `GITHUB_TOKEN` | GitHub: Contents: Read and write on every publishing repository |
| `GITLAB_TOKEN` | GitLab.com: API-scoped token with write permission on every selected project |
| `NETLIFY_OAUTH_CLIENT_ID` | Netlify OAuth application client ID, configured once per Tsumu installation |
| `NETLIFY_OAUTH_REDIRECT_URI` | Registered OAuth redirect, e.g. `https://tsumu.ebii.net/netlify/callback` |
| `TSUMU_STORAGE_MODE` | Optional `local`: force browser-only site and document storage even when D1 is connected |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | Cloudflare Pages only: account ID and token with Pages: Edit permission |
| `AI_ENABLED` | `true` to turn on Ask AI |
| `AI_PROVIDER` | `anthropic` (default), `gemini`, `openai` or `openai-compatible` |
| `AI_API_KEY` | API key (or `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY`) |
| `AI_MODEL` | Model ID. Defaults to `claude-opus-5-5` (`anthropic`) or `gemini-3.8-flash` (`gemini`); required for `openai` and `openai-compatible`. |
| `AI_BASE_URL` | API URL for `openai-compatible`, e.g. `https://openrouter.ai/api/v1` |
| `AI_EFFORT` | `low`, `medium` (default), `high`, `xhigh` or `max` |
| `NEXT_PUBLIC_TSUMU_MCP_URL` | Build-time base URL of the `tsumu-mcp` server used for external MCP connections (defaults to `https://mcp.tsumu.ebii.net`; rebuild after changing). |
| `TSUMU_DATA_DIR` | Storage folder on Node.js (see [Node.js](#nodejs)). Fixed to `/data` on Docker. |
| `ASSET_GC_ENABLED` | Cloudflare only. `true` lets garbage collection delete unused assets from KV; by default it only does a dry run (see [KV asset GC](asset-gc.md)). |
| `ASSET_GC_GRACE_DAYS` / `ASSET_GC_MAX_DELETES` | Cloudflare only. Days before a candidate can be deleted (default 7), and the most deletions per run (default and maximum 500). |

Where to put them:

- Local development and Node.js: `.env.local`
- Docker: the file you pass with `--env-file`
- Cloudflare: `wrangler secret put`

[`.env.example`](../.env.example) lists them all.

## Limits

### Cloudflare free plan (when the editor runs on Cloudflare Workers)

| Item | Limit | What it means |
|---|---|---|
| Workers CPU time | 10 ms per request | Publishing a site with many assets can exceed it. Workers Paid ($5/month, 30 s CPU) removes the problem. |
| SQLite-backed Durable Object row | 8 MB per value | Page, node, component and asset JSON entries are stored independently; Tsumu limits each stored entry to 7 MB. |
| KV | 1 GB total, 25 MB per file, 1,000 writes per day | All sites share the underlying KV namespace, while each site's Assets tab shows usage and Trash scoped to that site. |
| KV consistency | Eventual | A new upload can take a few seconds to appear everywhere. |
| GitHub API | 5,000 requests per hour | One publish uses anywhere from a dozen or fewer requests. |

### Sites

- Deleting a site deletes its editing data and automatic backups. The published repository remains, and the images in storage aren't deleted right away.
- Images copied between sites share a stored file. On Cloudflare, deleting an asset in the editor only removes the reference; the file stays in KV for now, because a concurrent save in another site might still use it. Unreferenced files are deleted by garbage collection when `ASSET_GC_ENABLED=true` (see [KV asset GC](asset-gc.md)).
- Without D1, sites exist only in that browser. Clearing the browser's data loses them.

### Collaboration

**Comments**

- Comments are stored separately from the editing data. They aren't published, they aren't part of undo, and only their authors can edit or delete them.
- Opening a discussion replaces the list, so both use the panel's full height. A reply or new comment you haven't sent is kept for each discussion until you send or cancel it, even if you go back to the list or change batches.
- Deleting an element or page keeps its comments. Comments on a deleted element stay in the normal list with a highlighted label; when comments are attached to deleted pages, a notice offers to switch to **All pages**. You can still open, reply to and resolve them. If you undo the deletion, the comments reconnect to the restored element, which keeps the same ID. Deleting or hiding the target doesn't discard a reply or new comment you're in the middle of writing.
- The panel header has a button that hides the comment pins on the canvas so you can see the design beneath them. Holding ⌥ (Alt) hides them too.
- The comment list loads up to 1,000 threads at a time, newest first, with controls to move to older or newer batches. Filters and canvas pins apply to the loaded batch. All replies within a discussion load together.
- If someone deletes a discussion while you're replying to it, your unsent text stays available to copy until you close it. The discussion isn't restored, and you can't submit further replies to it.

**Merging edits**

- Edits merge property by property. If two people edit different elements, or different properties of the same element (say, its text and its color), both changes are kept. If they edit the same property, the later save wins.
- A list, such as a script's steps, counts as a single property.
- While you have unsaved changes or are typing, other people's changes wait until you're done.
- If the connection drops while the tab is in the background, return to the tab to pick up edits saved during the interruption. You can keep editing without reloading the page.
- When other people's changes are applied, your undo history is rebuilt to match.

**Activity and access**

- The activity log records the latest time each person edited and published. Without Google sign-in, everyone appears as a single guest.
- Changing an account's role to **View only** or removing it from the allowlist takes effect from the next API request onward. Open collaboration connections re-check permission before reading, writing or receiving further updates.

### Editor and export

- **Publishing is a normal commit.** Files Tsumu generated are replaced with the editor's version, and files you added by hand are kept. `_tsumu/generated.json` tells the two apart.
- **Changes on GitHub or GitLab are detected.** The editor asks before overwriting a generated file that someone edited in the repository. If someone deleted the file in the repository and the next publish would recreate it, the editor also asks before restoring it. If you want to keep changing generated files by hand, do it on another branch.
- **The first publish is careful too.** It keeps existing files and asks before overwriting any file at the same path.
- **`_tsumu/` is reserved** for Tsumu's metadata. If the list of generated files there is malformed, publishing stops.
- Page-specific custom code is inserted at the start and end of the page body, not in `<head>`.
- On the canvas, custom code and icons are shown sanitized, `embed` iframes are sandboxed and reject same-origin editor URLs and credentialed URLs, and iframes in custom code run in a sandbox on a different origin from the editor. Their scripts and event handlers run only on the published site, so they can't act with your editor session's permissions.
- `next/image` is exported with `unoptimized` so it works on every host.
- HTML pages (pages written as raw HTML) don't get the shared layout, metadata or custom code. Only the Next.js and HTML formats can output them.
- After you split text into spans, each span is edited separately.
- Sign-in supports Google accounts only.

## Development

[ARCHITECTURE.md](../ARCHITECTURE.md) explains the `SiteDoc` data model and how publishing, collaboration and AI edits work.

```
app/
  page.tsx            Home (list of sites)
  sites/[id]/         Editor
  login/              Sign-in page
  api/sites/          List, create, configure, delete sites, and manage per-site members
  api/doc/            Per-site editing data and daily backups
  api/comments/       Comment threads on the canvas
  api/activity/       Who edited recently and who published last
  api/publish/        Publish to GitHub, GitLab (gitlab/), Cloudflare Pages (static/) or Netlify (netlify/), plus history and rollback
  api/assets/         Uploads, file serving and storage usage
  api/ai/             Ask AI
  api/collab/         Collaboration: sign-in check for the WebSocket, and Server-Sent Events
  api/fetch-json/     Fetch a data source for the editor through the server
  api/allowed-users/  Accounts that can sign in
  api/status/         Whether sign-in and storage are configured, and who is signed in
components/           UI (Home, Editor, Canvas, panels, ScriptEditor, HelpCenter, …)
  canvas/ left-panel/ style-panel/ script-editor/   Parts of the large components
lib/
  types.ts            The SiteDoc data model
  sites.ts            Server D1/SQLite site storage (browser-safe site types and validation live in site-model.ts)
  site-access.ts      Per-site Owner / Editor / View-only membership checks (plus site-asset-access.ts)
  site.ts             Current site, tsumu-* browser storage keys, and the browser-only site list without D1
  generator.ts        SiteDoc → Next.js project (parts in generator/)
  export-formats.ts   Output formats: options, limitations and the shared zip / publish pipeline
  exportZip.ts        The exported zip, with the editing data for re-import (built on zero-dependency zip.ts)
  site-import.ts      Restore a Tsumu zip or doc.json (import-site-file.ts creates the site)
  site-backup.ts      Self-contained site backup zip bundling editing data and assets
  html-to-site.ts     Convert HTML into editable elements (html-file-import.ts, html-zip.ts)
  script.ts           Script model; script-runtime.ts is the runtime shared by the canvas and exported sites
  site-document-service.ts  Routes each site's editing data to its Durable Object (Cloudflare) or local SQLite
  structured-document-store.ts  Row-per-page/node SQLite schema inside the DocumentRoom Durable Object
  node-storage.ts     SQLite and file storage outside Cloudflare (TSUMU_DATA_DIR)
  browser-doc-storage.ts  IndexedDB storage (tsumu-documents) for browser-only site documents and assets
  uploaded-fonts.ts   Uploaded custom font (@font-face) metadata and asset tracking
  store.ts            Editor state (zustand) and undo history (Ask AI chat state in ai-store.ts)
  clip-transfer.ts    Copy and paste between sites
  page-transfer.ts    Copy pages to another site
  comments.ts         Comment threads on the server (comment-store.ts keeps them in the browser without one)
  activity.ts         Edit and publish activity log
  aiOps.ts            AI edit operations (applied on the server and in the browser)
  external-edit/      Browser WebSocket bridge connecting an open editor tab to tsumu-mcp
  manualTopics.ts     Help articles
  locales/            Translations and generated language registry
custom-worker.ts      Cloudflare Worker entry, including the collaboration Durable Object
document-room.ts      The per-site document Durable Object (DocumentRoom)
scripts/cloudflare.mjs  Writes the deploy wrangler config and runs OpenNext
```

```bash
npm run typecheck      # tsc --noEmit
npm test               # regression tests for collaboration, undo, scripts, publishing and more
npm run i18n:check -- --all   # non-blocking translation warnings (optional strict check: -- --strict ja)
npm run build && npm run test:e2e   # end-to-end tests in real browsers (Playwright; first run: npx playwright install chromium firefox webkit)
```

To check that an output format still builds, generate a sample project and build it (CI does this for every framework, in TypeScript and JavaScript):

```bash
node --import tsx scripts/smoke-export-build.mts vue typescript   # nextjs, react, vue, nuxt or sveltekit
cd .generated-export-smoke && npm install && npm run build
```

### Translations

Tsumu uses English source strings as translation keys (`tr("Save")`). Japanese translations live in `lib/locales/ja.ts`. Untranslated entries are shown in English. Because the keys are already English, `lib/locales/en.ts` lists only the English text that should differ from its key, such as plural forms (`"{n} pages": "{n, plural, one {# page} other {# pages}}"`). When the same English needs different translations in different places, give each place its own key with a hint in parentheses (`tr("Done (tutorial step)")`) and map it back to the English text in `en.ts` (`"Done (tutorial step)": "Done"`). Other languages also fall back to these entries. Keep interpolation placeholders (e.g. `{name}`) unchanged in translated values.

#### Adding a language

1. Add `lib/locales/<BCP-47>.ts` with a default-exported `Dict` mapping English keys to translations. For instance, `fr.ts` can export `{ Save: "Enregistrer" }`. Partial dictionaries are supported. Translations can use the same plural syntax; the forms are chosen by that language's plural rules.
2. Run `npm run dev` or `npm run build`. The language picker and lazy dictionary loader are generated automatically from file names; **do not edit** `lib/lang.ts` or `lib/locales/index.ts`. Language labels are generated using the native language display name.
3. Run `npm run i18n:check -- fr` to report missing entries without failing. `npm run i18n:check -- --strict fr` makes missing translations a failing check; `npm run i18n:check -- --all` reports every registered dictionary. CI runs `npm run i18n:check -- --all` as non-blocking warnings so untranslated strings fall back to English without blocking pull requests.

The generation also runs before `typecheck`, `test` and `build:worker` (`test:e2e` relies on the `npm run build` that precedes it). If you run a tool directly rather than through npm, run `npm run locales:sync` first. English is always registered as the source language, whether or not `en.ts` exists.

The language appears under **Settings → Language** on the home screen and **⋯ → Settings** in the editor. The browser's language preferences select supported languages automatically. Existing Japanese/English E2E assertions are not expanded to newly added languages.

### Help articles

Help articles live in `lib/manualTopics.ts`. Each one has a question, a one-line answer and a body made of blocks: paragraphs, lists, tables, tips and diagrams.

- Inline text supports `**bold**`, `` `code` `` and `[[article-id|link text]]`.
- Diagrams are React components in `components/HelpFigures.tsx`. They're drawn with the same CSS they explain.
- A guided-tour step's `target` matches a `data-tutorial` attribute in the UI.
