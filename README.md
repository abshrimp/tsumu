<h1 align="center">Tsumu</h1>

<p align="center">
  <strong>Design freely. Build openly.</strong><br>
  An open-source visual website builder.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0b57d0" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs" alt="Next.js 16">
  <img src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white" alt="TypeScript 7">
  <img src="https://img.shields.io/badge/deploy-Cloudflare%20%7C%20Node.js%20%7C%20Docker-555" alt="Runs on Cloudflare, Node.js and Docker">
  <img src="https://img.shields.io/badge/i18n-English%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E-555" alt="English and Japanese">
  <a href="#contributing"><img src="https://img.shields.io/badge/PRs-welcome-2ea44f" alt="PRs welcome"></a>
</p>

<p align="center">
  <a href="https://tsumu.ebii.net"><strong>Try the demo</strong></a> · English · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="docs/screenshots/en/editor.png" alt="The Tsumu editor: layers on the left, the page on the canvas, and the style inspector on the right">
</p>

Tsumu is a visual editor for building websites. You lay out and style pages on a canvas, and Tsumu publishes them to your GitHub repository as a **plain project** in the format you choose: Next.js (the default), React, Vue, Nuxt, SvelteKit or build-free HTML (see [Output formats](#output-formats)).

The published site doesn't depend on Tsumu at runtime, so you're never locked in. Host it on Vercel, Netlify, Cloudflare Workers or any Node.js server. You can also add your own code to the site's repository — API routes, components, config — and Tsumu keeps those files the next time you publish.

One editor can manage as many sites as you like. Each site has its own editing data and its own repository. You create, duplicate and switch between sites on the home screen.

## Features

- **Code you own.** By default the published site is readable Next.js that depends only on `next`, `react` and `react-dom`. You can also publish or export React + Vite, Vue 3 + Vite, Nuxt, SvelteKit, plain HTML/CSS/JavaScript or a single HTML file, in TypeScript or JavaScript, with plain CSS, CSS Modules or Tailwind CSS.
- **Visual editing.** Flexbox and grid layouts, styles per screen width, hover, active and focus states plus states you name yourself, motion, components and lists.
- **Scripts without code.** Build interactions from "when → do" blocks: clicks, menus, scrolling, form input, switching an element's named state, filtering, sorting and storage.
- **Import.** Restore a Tsumu ZIP or `doc.json` as a new site, or turn an existing HTML file or website ZIP into editable elements.
- **External data.** Fetch JSON from any API, show it in a list, and generate a detail page for each item (such as `/news/[slug]`).
- **Real-time collaboration.** Several people can edit at once. Changes merge property by property, you can leave comments on the canvas, and you can see who edited and published.
- **Publishing through GitHub.** One click commits the generated project. Test publishes go to a separate preview branch that search engines ignore.
- **Pre-publish checks.** Before a page goes live, Tsumu catches broken links, missing alt text, skipped heading levels, text too small to read on a phone and layouts that overflow on a phone.
- **History and rollback.** Return the live site to any version you published. You can also restore the editor's content from a published version or from a daily server backup.
- **Ask AI (optional).** Describe a change in plain language and AI makes the edit; a single undo reverts it. Works with Claude, Gemini, OpenAI or any OpenAI-compatible API.
- **Built-in help.** A tutorial, a searchable Q&A manual with diagrams, and guided tours that point at the screen.
- **Multiple sites.** Create, duplicate and delete sites. Copy elements or whole pages between sites, together with the images and components they use.
- **Runs anywhere.** The editor runs on Cloudflare Workers (the free plan is enough), Node.js or Docker. Every external service is optional.
- **English and Japanese UI**, with room for more languages.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/en/ai.png" alt="Asking AI to edit the page"><br><sub><b>Ask AI</b></sub></td>
    <td width="50%"><img src="docs/screenshots/en/publish.png" alt="Publish dialog with test and live sites"><br><sub><b>Publish</b>: checks, then a test site or the live site</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/en/comments.png" alt="Comment thread pinned to a heading"><br><sub><b>Comments</b></sub></td>
    <td width="50%"><img src="docs/screenshots/en/help.png" alt="Help article with a diagram"><br><sub><b>Built-in help</b></sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/en/responsive.png" alt="Editing the phone layout"><br><sub><b>Responsive editing</b></sub></td>
    <td width="50%"><img src="docs/screenshots/en/scripts.png" alt="Script editor with click and page-open blocks"><br><sub><b>Scripts without code</b>: "when → do" blocks</sub></td>
  </tr>
</table>

## How it works

```
Tsumu (this repository)
│  Runs on Cloudflare Workers, Node.js or Docker
│  Home (list of sites) · Editor /sites/<id> · Google sign-in (optional)
│
│  Publish → main  /  Test publish → preview
▼
One repository per site (GitHub)
│  Site A, Site B, … (each with main = production, preview = test)
│
│  Each branch is built automatically
▼
Hosting (your choice)
   Vercel / Netlify / Cloudflare Workers / Node.js
```

There are three moving parts:

- **The editor** is a Next.js app. It runs on Cloudflare Workers, Node.js or Docker (see [Deploying the editor](#deploying-the-editor)). It stores the list of sites, editing data, comments, the edit and publish activity log, the sign-in allowlist, and uploaded images, video and audio. Uploads are shared by all sites. Where all of this is stored depends on where the editor runs.
- **The published site** is an ordinary Next.js app (or one of the other [output formats](#output-formats)), committed to that site's own repository. It does **not** have to run where the editor runs.
- **Test publishing** commits to a second branch of the same repository (`preview` by default). Vercel, Cloudflare Workers Builds and Netlify automatically build non-production branches as previews, so one hosting project covers both the live and the test site. The test build is kept out of search engines with robots.txt, `noindex`, the `X-Robots-Tag` header and crawler blocking.

## What you need

Every setting below is **optional**. The editor opens and lets you edit even when something is missing; you just lose the feature that depends on it.

| Setting | Without it | With it |
|---|---|---|
| Server storage (D1, Durable Objects and KV on Cloudflare; `TSUMU_DATA_DIR` on Node.js and Docker) | Sites, editing data, comments and images are saved in the browser. Only that browser can see them, and each image is limited to 2 MB. | Everything is saved on the server. You can edit and comment from other devices and with other people. You also get daily backups and a record of who edited and published. Each image can be up to 25 MB. |
| Google sign-in (`AUTH_*`) | The editor doesn't open; it shows how to set sign-in up instead. With `ALLOW_ANONYMOUS=true`, or under `npm run dev`, it opens without sign-in — and then **anyone with the URL can edit and publish**. | Only the Google accounts you allow can use the editor. |
| `GITHUB_TOKEN` | **Publish** explains what to set up. Exporting code as a zip still works. | Publishes to the repository set in each site's settings. |
| `AI_*` | No **Ask AI** button. | **Ask AI** is available. |

> [!IMPORTANT]
> If the editor can be reached from the internet, always set up Google sign-in. Run it without sign-in only on your own machine, or as a demo that has no publish target (no `GITHUB_TOKEN`).

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

- It emulates Cloudflare's D1 and KV locally, based on `wrangler.jsonc`. Data goes to `.wrangler/state`, and this takes precedence over `TSUMU_DATA_DIR`.
- It needs no environment variables, and it skips sign-in. This applies to `npm run dev` only. To skip sign-in under `npm run preview`, put `ALLOW_ANONYMOUS=true` in `.dev.vars`.
- Collaborators' changes arrive by polling. To try the real-time WebSocket connection, use `npm run preview`.

## Deploying the editor

Before updating an existing instance, follow the [release-safety checklist](docs/releasing.md) for staging checks, backup/restore validation, rollback and monitoring.

The editor runs in any of three environments. The features are identical; what differs is where data is stored and how collaborators' changes reach you.

| | Cloudflare Workers | Node.js | Docker |
|---|---|---|---|
| Storage | D1 (site metadata), SQLite-backed Durable Objects (document rows), Workers KV (images and files) | The `TSUMU_DATA_DIR` folder (SQLite and files) | `/data` in the container (mount a volume) |
| Collaborators' changes | Immediately (WebSocket via a Durable Object) | Immediately (Server-Sent Events) | Immediately (Server-Sent Events) |
| Cost | Runs on the free plan (see [Limits](#limits)) | Your server | Your server |
| Good for | Running without a server of your own | Running on your machine or an existing server | Managing it as a container |

D1 and local SQLite tables are created on first access. Cloudflare's SQLite-backed DocumentRoom requires the `DOC_STORE` binding and the live SQLite-backed `exports.DocumentRoom` declaration in `wrangler.jsonc`. For the storage model and deployment checks, see [Document storage](docs/durable-object-storage.md). Without server storage, data stays in the browser (see [What you need](#what-you-need)).

### Common setup

#### Google sign-in

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type "Web application".
2. Add these authorized redirect URIs:
   - `https://<editor-domain>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (only if you want to try sign-in locally)
3. You can leave the OAuth consent screen in testing mode. Add yourself as a test user.

Sign-in turns on once `AUTH_SECRET`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are all set. Also set `AUTH_URL` to the editor's URL.

Accounts listed in `ALLOWED_EMAILS` can always sign in. To allow more accounts, go to the home screen and open **Settings → Accounts that can sign in** (this needs server storage).

#### GitHub token

Create a **fine-grained personal access token** with **Contents: Read and write** on every repository you publish to. All sites share this one token, so when you add a site, give the token access to its repository too — or give the token access to "All repositories" up front.

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

The deploy wrapper validates the selected configuration and refuses command-line overrides such as `--config` or `--env` that could bypass these checks. Use `WRANGLER_CONFIG` with top-level bindings for a custom production config.

Production deployments automatically use browser-only storage if D1, KV, or the DocumentRoom binding/export is incomplete. The deploy wrapper first inspects the active Worker versions and refuses to remove existing server-storage bindings. If it cannot inspect an existing deployment, it stops instead of risking data access. New Workers may deploy without server storage; local builds and hosted Worker Previews also require no storage IDs.

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

At build time, the script reads `wrangler.jsonc` and writes a deploy config, `wrangler.generated.jsonc`. It fills in the IDs from the build variables and drops bindings that have none, so you never need to commit your IDs. Workers Builds selects its connected Worker name through `WRANGLER_CI_OVERRIDE_NAME`, so this generated config targets the correct Worker without changing the repository default.

#### Previewing pull requests (Worker Previews)

With the Preview command above, Workers Builds deploys each pull request as a **Worker Preview** and posts its URL on the pull request. The repository's default Preview configuration is a public demo that needs no sign-in and keeps its data in the browser. The wrapper supplies empty D1/KV bindings and uses `--ignore-base-config`; it does not remove secrets already configured on an existing Preview. Check those secrets before reusing a Preview as a public demo.

See [Previewing pull requests of the editor](docs/worker-previews.md) for setup and for giving Previews test storage. Server storage also needs an explicit Preview `DOC_STORE` binding to `DocumentRoom`, alongside `COLLAB_ROOM`; adding only D1 and KV IDs is incomplete. Configure sign-in before using shared test storage.

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

- **Backups:** stop every process writing to `TSUMU_DATA_DIR` and disable automatic restarts before copying the whole folder. Keep writers stopped until the copy finishes. Copying a live SQLite database and its WAL files one at a time is not a consistent snapshot. Include `assets/` and any `tsumu.db-wal` / `tsumu.db-shm` files still present; do not delete them. Use a fresh backup destination outside the data folder, and [validate a disposable restore](docs/releasing.md#backup-and-restore-validation) before relying on it.
- **One editor per folder:** run only one editor per `TSUMU_DATA_DIR`. Collaborators' changes are relayed inside a single process.
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
supervisor that could restart the editor and stop any other writers to this
volume. Run the entire block from a backup directory outside the data volume:

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

The block checks the expected volume and stopped state, mounts the source
read-only, and creates a separate directory for each attempt. On failure it
exits without continuing to restart; inspect the error and container state,
then restart the editor deliberately when safe. Do not use a partial archive.
Archive readability alone does not prove recovery: follow the
[isolated restore drill](docs/releasing.md#backup-and-restore-validation).

Reverse proxy setup is the same as for [Node.js](#nodejs).

## Publish targets

On the home screen, open a site's **… → Settings** to set the fields below. You can fill them in when you create the site or at any time later.

| Field | Description |
|---|---|
| GitHub repository | `owner/name`. You can edit without one, but you can't publish. |
| Production branch | Default: `main` |
| Test branch | Default: `preview`. Leave it empty to turn test publishing off. |
| Live site URL / test site URL | Optional. The Publish dialog links to them. |

Create the site's repository before the first publish. It can be empty or initialized with a README.

## Output formats

**Publish** and **⋯ → Export as zip** both let you pick a framework, a language and a style. Next.js is selected each time the dialog opens.

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
- data fetches that carry credentials (an `Authorization` header, an API key in the URL or body, and so on), because visitors could read them;
- a custom `<script>` at the end of the body, in React, Vue, Nuxt and SvelteKit;
- CSS Modules or Tailwind CSS with the HTML formats;
- more than one page with Single HTML.

**Publishing** always covers the whole project. Publishing a format other than Next.js to the live site asks for confirmation first, because the repository layout changes and the host's build and output settings must match. Test publishes in every format are kept out of search engines.

**Exporting a zip** can also cover just the **current page** or the **selected component** (the selected element and its children, as a page of their own). Single HTML always exports one page. The zip includes `_tsumu/doc.json` and `_tsumu/assets.json` — the editing data for what you exported — so you can [import](#importing) it again. Don't upload `_tsumu/` to your web server.

> [!NOTE]
> Publishing also commits the site's full editing data to `_tsumu/doc.json`, including unpublished pages and settings. In a public repository, anyone can read it.

## Importing

On the home screen, click **Import** or drop a file onto the page to create a new site:

| File | Result |
|---|---|
| A zip exported from Tsumu (it contains `_tsumu/doc.json`) | The site is restored, with its images and other assets. |
| A `doc.json` | The site is restored. Assets embedded as data URLs are uploaded. |
| An HTML file, or a zip of a website | Every HTML page is converted into editable elements. The zip's other files are uploaded as assets and the HTML's paths are rewritten. |

Any warnings, such as assets that couldn't be restored, appear once the new site opens.

In the editor, a page's settings can also load an HTML file or a zip into that page. A normal page converts it into editable elements (after asking before it replaces the page's current elements). An HTML page keeps the HTML as is, using `index.html` from the zip.

Limits: a zip can be up to 100 MB and a `doc.json` or HTML file up to 12 MB. A zip of a website can hold up to 200 files and 2 MB of CSS, which must be UTF-8.

> [!TIP]
> `skills/tsumu-site/` is an agent skill that describes the `doc.json` format, so an AI agent can generate a site you then import and keep editing.

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

**Publish → Publish history & rollback** (or **⋯ → History & rollback**) lists the commits on each branch. For any version you can:

- **Restore site** — commits the selected version's files again on top of the branch. History is kept, so the rollback itself can be undone.
- **Restore edits** — loads the editor content that was saved with that publish (`_tsumu/doc.json`). This counts as a normal edit, so ⌘Z reverts it.

The same dialog also lists the server's daily backups of the editor content: one per weekday, seven in total.

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
- Smaller models make more mistakes with edit operations. The server catches them, but each request then takes more round trips.
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

## Environment variables

All variables are optional (see [What you need](#what-you-need)).

| Variable | Description |
|---|---|
| `AUTH_SECRET` | Session secret. Generate one with `npx auth secret`. |
| `ALLOW_ANONYMOUS` | `true` lets the editor open without sign-in when Google sign-in isn't set up (not needed under `npm run dev`). Anyone with the URL can then edit and publish, so use it only locally or for a demo. |
| `AUTH_URL` | The editor's URL in production, e.g. `https://tsumu.example.com` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client |
| `ALLOWED_EMAILS` | Google accounts that can always sign in, comma-separated. These can't be removed in the UI. Manage additional accounts under **Settings** on the home screen. |
| `GITHUB_TOKEN` | Token with Contents: Read and write on every repository you publish to (shared by all sites) |
| `AI_ENABLED` | `true` to turn on Ask AI |
| `AI_PROVIDER` | `anthropic` (default), `gemini`, `openai` or `openai-compatible` |
| `AI_API_KEY` | API key (or `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY`) |
| `AI_MODEL` | Model ID. Defaults to `claude-opus-5-5` (anthropic) or `gemini-3.8-flash` (gemini). |
| `AI_BASE_URL` | API URL for `openai-compatible`, e.g. `https://openrouter.ai/api/v1` |
| `AI_EFFORT` | `low`, `medium` (default), `high`, `xhigh` or `max` |
| `TSUMU_DATA_DIR` | Storage folder on Node.js (see [Node.js](#nodejs)). Fixed to `/data` on Docker. |

Where to put them:

- Local development and Node.js: `.env.local`
- Docker: the file you pass with `--env-file`
- Cloudflare: `wrangler secret put`

[`.env.example`](.env.example) lists them all.

## Limits

### Cloudflare free plan (when the editor runs on Cloudflare Workers)

| Item | Limit | What it means |
|---|---|---|
| Workers CPU time | 10 ms per request | Publishing a site with many assets can exceed it. Workers Paid ($5/month, 30 s CPU) removes the problem. |
| SQLite-backed Durable Object row | 8 MB per value | Page, node, component and asset JSON entries are stored independently; Tsumu limits each stored entry to 7 MB. |
| KV | 1 GB total, 25 MB per file, 1,000 writes per day | All sites share this storage. The Assets tab shows the total for all sites. |
| KV consistency | Eventual | A new upload can take a few seconds to appear everywhere. |
| GitHub API | 5,000 requests per hour | One publish uses anywhere from a few to a dozen or so. |

### Sites

- Deleting a site deletes its editing data and automatic backups. The published repository and the images in storage remain.
- Images copied between sites share a stored file. On Cloudflare, an asset is not physically deleted immediately, because a concurrent save in another site might still reference it. Unreferenced files require an explicit garbage-collection process; deletion in the editor only removes the reference.
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
- When other people's changes are applied, your undo history is rebuilt to match.

**Activity and access**

- The activity log records the latest time each person edited and published. Without Google sign-in, everyone appears as a single guest.
- Removing an account from the allowlist blocks its existing sessions from the next API request onward. Open collaboration connections check permission again before reading, writing or receiving further updates.

### Editor and export

- **Publishing is a normal commit.** Files Tsumu generated are replaced with the editor's version, and files you added by hand are kept. `_tsumu/generated.json` tells the two apart.
- **Edits on GitHub are detected.** If someone edited a generated file on GitHub, the editor asks before overwriting it. If you want to keep changing generated files by hand, do it on another branch.
- **The first publish is careful too.** It keeps existing files and asks before overwriting any file at the same path.
- **`_tsumu/` is reserved** for Tsumu's metadata. If the list of generated files there is malformed, publishing stops.
- Page-specific custom code is inserted at the start and end of the page body, not in `<head>`.
- On the canvas, custom code and icons are shown sanitized, and iframes in custom code run in a sandbox without the editor's origin. Their scripts and event handlers run only on the published site, so they can't act with your editor session's permissions.
- `next/image` is exported with `unoptimized` so it works on every host.
- HTML pages (pages written as raw HTML) don't get the shared layout, metadata or custom code. Only the Next.js and HTML formats can output them.
- After you split text into spans, each span is edited separately.
- Sign-in supports Google accounts only.

## Development

[ARCHITECTURE.md](ARCHITECTURE.md) explains the `SiteDoc` data model and how publishing, collaboration and AI edits work.

```
app/
  page.tsx            Home (list of sites)
  sites/[id]/         Editor
  login/              Sign-in page
  api/sites/          List, create, configure and delete sites
  api/doc/            Per-site editing data and daily backups
  api/comments/       Comment threads on the canvas
  api/activity/       Who edited recently and who published last
  api/publish/        Commit generated files to GitHub, history and rollback
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
  sites.ts            Site types, input validation and D1 storage
  site.ts             Current site, browser storage keys, and the browser-only site list without D1
  generator.ts        SiteDoc → Next.js project (parts in generator/)
  export-formats.ts   Output formats: options, limitations and the shared zip / publish pipeline
  exportZip.ts        The exported zip, with the editing data for re-import
  site-import.ts      Restore a Tsumu zip or doc.json (import-site-file.ts creates the site)
  html-to-site.ts     Convert HTML into editable elements (html-file-import.ts, html-zip.ts)
  script.ts           Script model; script-runtime.ts is the runtime shared by the canvas and exported sites
  node-storage.ts     SQLite and file storage outside Cloudflare (TSUMU_DATA_DIR)
  store.ts            Editor state (zustand) and undo history
  clip-transfer.ts    Copy and paste between sites
  page-transfer.ts    Copy pages to another site
  comments.ts         Comment threads (D1 and browser storage)
  activity.ts         Edit and publish activity log
  aiOps.ts            AI edit operations (applied on the server and in the browser)
  manualTopics.ts     Help articles
  locales/            English translations
custom-worker.ts      Cloudflare Worker entry, including the collaboration Durable Object
scripts/cloudflare.mjs  Writes the deploy wrangler config and runs OpenNext
```

```bash
npm run typecheck      # tsc --noEmit
npm test               # regression tests for collaboration, undo, scripts, publishing and more
npm run i18n:check     # missing English translations (other languages: npm run i18n:check -- <code>)
npm run build && npm run test:e2e   # end-to-end tests in a real browser (Playwright; first run: npx playwright install chromium)
```

To check that an output format still builds, generate a sample project and build it (CI does this for every framework, in TypeScript and JavaScript):

```bash
node --import tsx scripts/smoke-export-build.mts vue typescript   # nextjs, react, vue, nuxt or sveltekit
cd .generated-export-smoke && npm install && npm run build
```

### Translations

UI strings are written in Japanese and wrapped in `tr("…")` (see `lib/i18n.ts`). Every other language has a dictionary, `lib/locales/<lang>.ts`, that maps each Japanese source string to its translation. English help and tutorial strings live separately in `en-help.ts`.

If a translation is missing, Tsumu falls back to English, and then to the Japanese source. For placeholders, write `tr("{name}を削除", { name })`.

#### Adding a language

1. Add the language to `LANGUAGES` in `lib/lang.ts`. The key is a BCP 47 code such as `zh`, `ko` or `fr`.
2. Create `lib/locales/<code>.ts` that exports a `Dict`. The quickest start is to copy `en.ts` and translate the values; you can simply leave out entries you haven't translated yet.
3. Register the dictionary in `LOCALES` in `lib/locales/index.ts`.
4. Run `npm run i18n:check -- <code>` to see what's left.

The language then appears under **Settings → Language** on the home screen (and under **⋯ → Settings** in the editor). It's also picked automatically from the browser's language.

### Help articles

Help articles live in `lib/manualTopics.ts`. Each one has a question, a one-line answer and a body made of blocks: paragraphs, lists, tables, tips and diagrams.

- Inline text supports `**bold**`, `` `code` `` and `[[article-id|link text]]`.
- Diagrams are React components in `components/HelpFigures.tsx`. They're drawn with the same CSS they explain.
- A guided-tour step's `target` matches a `data-tutorial` attribute in the UI.

## Contributing

Issues and pull requests are welcome, in English or Japanese. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and the checks to run, [SECURITY.md](SECURITY.md) for reporting a vulnerability privately, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © abshrimp
