# Contributing to Tsumu

English · [日本語](CONTRIBUTING.ja.md)

Thanks for your interest in Tsumu! The project lives at [abshrimp/tsumu](https://github.com/abshrimp/tsumu). Bug reports, documentation improvements, translations and pull requests are all welcome, in English or Japanese.

## Getting started

Fork the repository, clone your fork, then run:

```sh
npm ci
npm run dev
```

- The [README](README.md) lists the runtime requirements and the optional services.
- [ARCHITECTURE.md](ARCHITECTURE.md) is a map of the code.

Local development needs no API keys. Keep your environment variables in `.env.local` and your Cloudflare resource IDs in `wrangler.local.jsonc`; Git ignores both.

## Making a change

- **Keep each pull request focused** on one problem, and explain the behavior that results.
- **Add a regression test** when you change behavior. Unit tests go in `tests/`, browser tests in `e2e/`.
- **Use English source strings in `tr()` and write code comments in Japanese.** Add Japanese translations to `lib/locales/ja.ts`; new languages only need a dictionary file.
- **Keep the types, the editor, the generated code and the tests in agreement** about Tsumu's data model and runtime behavior.
- **Preserve user-authored files when publishing a site.** `_tsumu/` is reserved for Tsumu's document and publish manifests.

Before opening a pull request, run:

```sh
npm run typecheck
npm test
npm run i18n:check -- --strict ja
npm run i18n:check -- --all   # warnings for incomplete additional languages
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
```

If you change the Cloudflare integration, also run `npm run build:worker`. None of these checks deploy anything; deployment is a separate step.

If you change an output format (`lib/export-formats.ts` or `lib/generator/`), generate and build a sample project for the affected frameworks. CI does this for every framework in TypeScript and JavaScript.

```sh
node --import tsx scripts/smoke-export-build.mts <nextjs|react|vue|nuxt|sveltekit> [typescript|javascript]
(cd .generated-export-smoke && npm install && npm run build)
```

If you change `lib/safe-fetch.ts`, run `node --import tsx scripts/sync-fetch-runtime.mts` to regenerate the copy that exported sites embed (`lib/generator/safe-fetch-source.ts`).

## Reporting problems

Use [Issues](https://github.com/abshrimp/tsumu/issues) for reproducible bugs and feature proposals. Please include:

- the steps to reproduce,
- what you expected to happen and what actually happened, and
- the runtime version, browser and deployment environment.

Remove tokens, email addresses and private site content from logs and screenshots before posting.

To report a security vulnerability, follow [SECURITY.md](SECURITY.md) instead. Please don't post exploit details in a public issue.

## Community

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Contributions are distributed under the repository's [MIT license](LICENSE).
