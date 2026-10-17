# Contributing to Tsumu

Tsumu is developed at [abshrimp/tsumu](https://github.com/abshrimp/tsumu). Bug reports, documentation improvements, translations and pull requests are welcome in English or Japanese.

## Getting started

Fork the repository, clone your fork, then run:

```sh
npm ci
npm run dev
```

See the [README](README.md) for runtime requirements and optional services, and [ARCHITECTURE.md](ARCHITECTURE.md) for a map of the code. Local development does not require API keys. Keep your environment variables in `.env.local` and your Cloudflare resource IDs in `wrangler.local.jsonc`; both are ignored by Git.

## Making a change

- Keep pull requests focused on one problem and explain the resulting behavior.
- Add regression coverage for behavior changes. Unit tests are in `tests/`; browser tests are in `e2e/`.
- UI source strings and code comments are written in Japanese. Wrap UI text in `tr()` and provide its English translation in `lib/locales/`.
- Treat the current Tsumu format as the source of truth. Do not add compatibility code for unpublished predecessor formats.
- Preserve user-authored files when publishing a site. `_tsumu/` is reserved for Tsumu's document and publish manifests.

Run these checks before opening a pull request:

```sh
npm run typecheck
npm test
npm run i18n:check
npm run build
npx playwright install chromium
npm run test:e2e
```

For changes to the Cloudflare integration, also run `npm run build:worker`. Deployment is separate from these checks.

## Reporting problems

Use [Issues](https://github.com/abshrimp/tsumu/issues) for reproducible bugs and feature proposals. Include the steps, expected behavior, actual behavior, runtime version, browser and deployment environment. Remove tokens, email addresses and private site content from logs and screenshots.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of posting exploit details in a public issue.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Contributions are distributed under the repository's [MIT license](LICENSE).
