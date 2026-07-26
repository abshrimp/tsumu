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

- **Set up Google sign-in and an email allowlist** for any editor reachable from the internet.
- **Every allowed account is a fully trusted editor.** It can access all sites, publish, and manage accounts. There are no per-site roles.
- **`ALLOW_ANONYMOUS=true` gives those same capabilities to everyone** who can reach the editor. Keep demos isolated from production data and from GitHub publishing tokens.

### Code inside site content

- **Custom HTML and SVG are active content** on the published site.
- **The editor protects your session.** The canvas sanitizes custom code and icons before showing them, and previews raw HTML pages in a sandboxed frame. A document's scripts therefore don't run with the signed-in editor's permissions.
- **Review before you publish.** Check imported documents and restored versions before publishing them, because their code will run on the published site.
- **Repository write access matters.** Anyone who can write to a site's repository can change `_tsumu/doc.json`, which the editor reads when you restore a published version. Give write access only to people you'd trust as editors.

### Secrets and private data

- **Limit the GitHub token** to the intended site repositories, with Contents read/write permission only.
- **AI provider keys stay on the server.** Turning AI on sends the editing context to the provider you selected.
- **Keep private files out of shared places.** Data directories, database exports, environment files and local Cloudflare configuration can contain private information. Keep them out of commits, container build contexts and release archives.
- **Editing data travels with the site.** Every publish commits the full editing data to `_tsumu/doc.json`, including unpublished pages and settings, and an exported zip contains the editing data for what it exports. In a public repository anyone can read it, and `_tsumu/` shouldn't be uploaded to a web server.
- **Credentials don't belong in the document.** Publishing refuses editing data whose data fetches contain a literal credential, such as an `Authorization` header or an API key in the URL or body. Formats other than Next.js also refuse to export such fetches, because visitors could read them.

### Exported sites

Exported sites are independent applications. Review their custom code, dependencies and deployment configuration separately.

Server-rendered output (Next.js, Vue, Nuxt and SvelteKit) fetches external data through the same SSRF protection the editor uses: only public addresses, with size limits.
