# Security

English · [日本語](SECURITY.ja.md)

## Reporting a vulnerability

Please report vulnerabilities through [GitHub's private vulnerability reporting for abshrimp/tsumu](https://github.com/abshrimp/tsumu/security/advisories/new) when it's available. Include:

- the affected version or commit,
- the deployment environment,
- steps to reproduce,
- the impact, and
- a minimal proof of concept.

Don't include real credentials or other people's data.

If private reporting isn't available, open an [issue](https://github.com/abshrimp/tsumu/issues/new) asking the maintainer for a private contact channel — without describing the vulnerability. Please keep exploit details private until a fix can be coordinated.

## Supported code

Security fixes target the current `main` branch. Before checking whether an issue still reproduces, update to the latest code and lockfile.

## Deployment model

Keep these points in mind when you run Tsumu.

### Who can do what

- **Set up Google sign-in and an email allowlist** for any editor reachable from the internet. The exception is a setup that keeps editing data in the browser and holds no publishing token on the server (see the [Netlify example](../docs/user-guide.md#netlify-publishing-without-sign-in)).
- **Account login and site access are separate checks.** Login permissions grant an account the ability to sign in, not access to any particular site. Each server-stored site has explicit **Owner**, **Editor**, and **View only** memberships. Owners manage site membership; editors change and publish only their authorized sites; viewers can inspect authorized sites (including comments and member listings) without modifying them. Unlisted sites cannot be retrieved by direct URL. The account-level **View only** role still caps editing permission. Fixed `ALLOWED_EMAILS` administrators retain recovery access to every site.
- **Uploaded assets are scoped to the site using them.** Access to an unrelated site's raw files or signed preview URLs is not implied by the ability to sign in, and uploaded SVGs are validated on upload to reject active scripts, `<foreignObject>`, event handlers, and unsafe link targets. Previously opened files may remain in the recipient's browser cache even after access is removed.
- **Removing an account does not clear its browser cache.** Uploaded files are cached privately in the browser for up to a year (their paths never change), so a removed editor can still view files they already opened.
- **`ALLOW_ANONYMOUS=true` gives those same capabilities to everyone** who can reach the editor. Keep demos isolated from production data and from GitHub, GitLab or Cloudflare publishing tokens.
- **`npm run dev` without sign-in answers only loopback hosts** (`localhost`, `*.localhost`, `127.0.0.0/8`, and `[::1]`). Requests addressed to any other host name get 403, so a web page can't reach your local editor by pointing its own domain at your machine (DNS rebinding). Setting `ALLOW_ANONYMOUS=true` lifts this restriction.

### Hosted editor Previews

The default Worker Preview configuration is an anonymous, browser-only demo. The Preview wrapper supplies empty D1/KV bindings and passes `--ignore-base-config` to Wrangler, but does not inspect or delete secrets already set on an existing Preview. Review those secrets before making a Preview public; browser-only storage does not disable a configured GitHub/GitLab/Cloudflare token or AI provider.

For server-backed test editing, follow the [Preview storage setup](../docs/worker-previews.md#using-test-storage-optional): use separate test D1/KV resources, bind both `COLLAB_ROOM` and `DOC_STORE` within the Preview, remove anonymous access, and configure Google sign-in and an allowlist. The wrapper rejects configured production D1/KV IDs and cross-Worker Durable Object bindings, but does not validate that custom Preview storage is complete or inspect dashboard settings.

### Code inside site content

- **Custom HTML and SVG are active content** on the published site.
- **The editor protects your session.** Editor pages and API responses send `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` to block clickjacking. Two paths are exceptions: uploaded asset files (`/api/assets/file`) are served with a sandboxing `Content-Security-Policy` instead, and the MCP site directory (`/mcp/sites-bridge`) may be framed only by `https://mcp.tsumu.ebii.net`, and only on the hosted editor at `tsumu.ebii.net`. On every other host that page is denied framing and returns 404. The canvas sanitizes custom code and icons before showing them, previews raw HTML pages in a sandboxed frame, renders `embed` iframes in a sandboxed frame while rejecting same-origin editor URLs and credentialed URLs, and restricts media, link, and thumbnail URLs to safe schemes (stripping RFC 3986 control/whitespace characters before parsing). A document's scripts therefore don't run with the signed-in editor's permissions.
- **Review before you publish.** Check imported documents and restored versions before publishing them, because their code will run on the published site.
- **Repository write access matters.** Anyone who can write to a site's GitHub or GitLab repository can change `_tsumu/doc.json`, which the editor reads when you restore a published version. Give write access only to people you'd trust as editors.

### Secrets and private data

- **Limit repository and hosting tokens.** Scope `GITHUB_TOKEN` (Contents read/write) and `GITLAB_TOKEN` (`api` scope and project write access on GitLab.com) only to the intended site repositories, and scope `CLOUDFLARE_API_TOKEN` to Cloudflare Pages editing. Server publishing tokens and AI provider keys stay on the server; Netlify OAuth tokens stay in the user's browser storage and are relayed without server persistence.
- **AI provider keys stay on the server.** Turning AI on sends the editing context to the provider you selected.
- **Keep private files out of shared places.** Data directories, database exports, environment files and local Cloudflare configuration can contain private information. Keep them out of commits, container build contexts and release archives.
- **Editing data travels with Git publishes and ZIP exports.** Publishing to GitHub or GitLab commits the full editing data to `_tsumu/doc.json`, including unpublished pages and settings, and an exported zip contains the editing data for what it exports. Static publishing to Netlify or Cloudflare Pages uploads only generated static site files and assets, never `_tsumu/doc.json`. In a public repository anyone can read `_tsumu/doc.json`, and `_tsumu/` shouldn't be uploaded to a web server.
- **Credentials don't belong in the document.** If a data fetch contains a literal credential, such as an `Authorization` header, an API key, or an OAuth `refresh_token` or `id_token` in the URL or request body, the site can't be published or exported in any format: the value would end up in the generated source and the editing data, and formats other than Next.js would also expose it to visitors.

### Exported sites

Exported sites are independent applications. Review their custom code, dependencies and deployment configuration separately.

Framework exports require Node 26.12.1 or later and npm 12.2.1 or later. Exported Next.js and static projects emit `Content-Security-Policy: sandbox` response headers for `/assets/*.svg` (`next.config` and `_headers`) so direct navigation to a standalone SVG asset cannot run scripts on the site's origin.

Server-rendered output (Next.js, Vue, Nuxt and SvelteKit) fetches external data through the same SSRF protection the editor uses: only public addresses, stripping embedded URL credentials (`username`/`password`), with size limits.
