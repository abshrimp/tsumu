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
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-2ea44f" alt="PRs welcome"></a>
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
