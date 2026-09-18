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
  <a href="https://tsumu.ebii.net"><strong>Try the demo</strong></a> · English · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="docs/screenshots/en/editor.png" alt="Tsumu's visual website editor">
</p>

Tsumu lets you design websites on a canvas and export or publish them as standard projects. The generated sites run **without Tsumu**, so you can host them anywhere and continue editing the code yourself.

## Features

- **Visual editing:** Flexbox and grid layouts, responsive styles, hover and custom states, animations, and reusable components.
- **No-code scripts:** Combine “when → do” blocks for clicks, input, visibility changes, conditions, and list operations.
- **External data:** Fetch JSON from APIs, display lists, and generate detail pages such as `/news/[slug]`.
- **Import:** Restore Tsumu ZIP files or `doc.json`, or convert existing HTML and website ZIPs into editable elements.
- **Flexible output:** Export Next.js, React, Vue, Nuxt, SvelteKit, HTML, or single-file HTML, with TypeScript or JavaScript and a choice of CSS, CSS Modules, or Tailwind CSS.
- **GitHub publishing:** Push generated code to a repository for each site, keep production and preview branches separate, and preserve files added by hand.
- **Pre-publish checks and rollback:** Detect broken links, missing image alt text, heading-order issues, and mobile layout problems. Restore earlier published versions.
- **Real-time collaboration:** Merge changes property by property, leave comments on the canvas, and view edit and publish activity.
- **Optional AI editing:** Describe page changes in plain language and undo the result in one step. Supports Claude, Gemini, OpenAI, and compatible APIs.
- **Multiple sites:** Keep each site's editing data and publishing repository separate, and copy pages or elements between sites.
- **Self-hosting:** Run on Cloudflare Workers, Node.js, or Docker, configuring external services only as needed.
- **Help and languages:** Built-in tutorials, illustrated Q&A, guided tours, and English/Japanese UI.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/en/ai.png" alt="Asking AI to edit the page"><br><sub><b>Ask AI</b></sub></td>
    <td width="50%"><img src="docs/screenshots/en/publish.png" alt="Publish dialog with test and live sites"><br><sub><b>Publish</b>: Push to GitHub</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/en/comments.png" alt="Comment thread pinned to a heading"><br><sub><b>Comments</b></sub></td>
    <td width="50%"><img src="docs/screenshots/en/help.png" alt="Help article with a diagram"><br><sub><b>Built-in help</b></sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/en/responsive.png" alt="Editing the phone layout"><br><sub><b>Responsive editing</b></sub></td>
    <td width="50%"><img src="docs/screenshots/en/scripts.png" alt="Script editor with click and page-open blocks"><br><sub><b>No-code scripts</b></sub></td>
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
