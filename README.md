<h1 align="center">Tsumu</h1>

<p align="center">
  <strong>Design freely. Build openly.</strong><br>
  An open-source no-code website editor.
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

Tsumu lets you create websites with intuitive actions such as dragging and dropping, without writing code. You can export or publish them as standard projects, so you can host them anywhere and edit the code **without depending on Tsumu**.

## Features

- **Visual editing:** Edit styles, hover states, other state changes, and animations without prior web development knowledge.
- **No-code scripts:** Build JavaScript just by listing what to do, top to bottom, under a "when".
- **External data:** Fetch and use JSON from APIs.
- **Import:** Drop a Tsumu project ZIP on the home screen to restore the design and its packaged assets. You can also import a `doc.json` or convert HTML files and website ZIPs into editable pages.
- **Flexible output:** Download a Next.js, React, Vue, Nuxt, SvelteKit, or static HTML project as a ZIP. To share one page as a single file, choose **Single HTML**.
- **GitHub publishing:** Publish to GitHub with one click, including support for production and preview branches.
- **Real-time collaboration:** Edit together with others and leave comments.
- **Optional AI editing:** Describe the changes you want in plain language to edit pages.
- **Self-hosting:** Run on Cloudflare Workers, Node.js, or Docker.
- **Help and languages:** Built-in tutorials, illustrated Q&A, and on-screen guides.

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
    <td width="50%"><img src="docs/screenshots/en/scripts.png" alt="Script editor listing actions under a trigger"><br><sub><b>No-code scripts</b></sub></td>
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

To keep an editable copy with its assets, open **⋯ → Export as zip**, select **Entire project**, and download the ZIP. See the [export options](docs/user-guide.md#output-formats) for page and component exports.

## Publishing and deployment

To push a site from Tsumu, create a GitHub repository, give a fine-grained token **Contents: Read and write** access to that repository, and set it as `GITHUB_TOKEN`. Select the repository in the site's settings. You can also export a ZIP without a token.

For persistent storage, configure D1, Durable Objects and KV on **Cloudflare Workers**, set `TSUMU_DATA_DIR` on **Node.js**, or mount a volume at `/data` in **Docker**. With browser-only storage, sites stay in the browser that created them. Asset deletion and recovery depend on the [storage backend](docs/user-guide.md#deploying-the-editor).

> [!IMPORTANT]
> Configure [Google sign-in](docs/user-guide.md#google-sign-in) before exposing the editor publicly. With sign-in unconfigured, `npm run dev` accepts anonymous requests addressed to loopback hosts by default. Setting `ALLOW_ANONYMOUS=true` also permits other hostnames. Anyone who can reach that instance can then edit and, with a GitHub publish target configured, publish.

See the [detailed guide](docs/user-guide.md) for deployment commands, authentication, publishing formats, environment variables, backups and limitations.

## Documentation

- [Detailed guide](docs/user-guide.md) · [日本語](docs/user-guide.ja.md)
- [Architecture](ARCHITECTURE.md) · [Environment variables](.env.example)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

## License

[MIT](LICENSE) © abshrimp
