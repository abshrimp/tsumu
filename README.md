<h1 align="center">Tsumu</h1>

<p align="center">
  <strong>Design freely. Build openly.</strong><br>
  An open-source visual website builder.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0b57d0" alt="MIT License"></a>
  <a href="https://tsumu.ebii.net"><strong>Live demo</strong></a> · English · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="docs/screenshots/en/editor.png" alt="Tsumu's visual website editor">
</p>

Tsumu lets you design websites on a canvas and export or publish them as standard projects. The generated sites run **without Tsumu**, so you can host them anywhere and continue editing the code yourself.

## Features

- **Visual editing:** Responsive layouts, styles, reusable components and custom states.
- **No-code interactions:** Script blocks, external JSON data, lists and dynamic pages.
- **Import and export:** Tsumu ZIP, `doc.json` and HTML import; Next.js, React, Vue, Nuxt, SvelteKit and HTML output.
- **GitHub publishing:** Production and preview branches, pre-publish checks, history and rollback.
- **Collaboration:** Real-time co-editing, comments and activity history.
- **Optional AI editing**, built-in help, and English/Japanese UI.
- **Self-hosting:** Cloudflare Workers, Node.js or Docker, with support for multiple sites.

## Quick start

Requires **Node.js 26.12.1+** and **npm 12.2.1+**.

```bash
git clone https://github.com/abshrimp/tsumu.git
cd tsumu
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and create a site. Local development needs no API keys or sign-in.

## Publishing and deployment

To publish, create a GitHub repository, set `GITHUB_TOKEN` to a fine-grained token with **Contents: Read and write** access, then select the repository in the site's settings. You can also export a ZIP without a token.

The editor runs on **Cloudflare Workers**, **Node.js** or **Docker**. For persistent storage, configure D1, Durable Objects and KV on Cloudflare, or `TSUMU_DATA_DIR` on Node.js/Docker. Without server storage, site data is stored only in the browser.

> [!IMPORTANT]
> Configure Google sign-in before exposing the editor publicly. `npm run dev` skips sign-in; `ALLOW_ANONYMOUS=true` also allows anyone with the URL to edit and publish. Use anonymous access only locally or for an isolated demo.

See the [detailed guide](docs/user-guide.md) for deployment commands, authentication, publishing formats, environment variables, backups and limitations.

## Documentation

- [Detailed guide](docs/user-guide.md) · [日本語](docs/user-guide.ja.md)
- [Architecture](ARCHITECTURE.md) · [Environment variables](.env.example)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

## License

[MIT](LICENSE) © abshrimp
