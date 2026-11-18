# Contributing to Tsumu

English · [日本語](CONTRIBUTING.ja.md)

Thanks for your interest in Tsumu! The project lives at [abshrimp/tsumu](https://github.com/abshrimp/tsumu). Bug reports, documentation improvements, translations and pull requests are all welcome, in English or Japanese.

## Getting started

Fork the repository, clone your fork, then run:

```sh
npm ci
npm run dev
```

- The [detailed guide](docs/user-guide.md) lists the runtime requirements and the optional services.
- [ARCHITECTURE.md](ARCHITECTURE.md) is a map of the code.

Local development needs no API keys. Keep your environment variables in `.env.local` and your Cloudflare resource IDs in `wrangler.local.jsonc`; Git ignores both.

## Making a change

- **Keep each pull request focused** on one problem, and explain the behavior that results.
- **Add a regression test** when you change behavior. Unit tests go in `tests/`, browser tests in `e2e/` (see [`e2e/README.md`](e2e/README.md)).
- **Use English source strings in `tr()`. Code comments may be in English or Japanese.** Japanese translations in `lib/locales/ja.ts` are welcome but **not required for a PR**. Missing translations fall back to English and are reported as CI warnings. New languages only need a dictionary file.
- **Keep the types, the editor, the generated code and the tests in agreement** about Tsumu's data model and runtime behavior.
- **Preserve user-authored files when publishing a site.** `_tsumu/` is reserved for Tsumu's document and publish manifests.

Before opening a pull request, run:

```sh
npm run typecheck
npm test
npm run i18n:check -- --all   # non-blocking warnings for incomplete translations
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
```

If you want to verify full Japanese translation coverage separately, run `npm run i18n:check -- --strict ja` (optional).

If you change the Cloudflare integration, also run `npm run build:worker`. None of these checks deploy anything; deployment is a separate step.

### Checking a generated project

After running `npm ci` in the repository root, run this example from the same directory to generate a Vue project with TypeScript and plain CSS, build it, and check its server-rendered HTML.

```sh
node --import tsx scripts/smoke-export-build.mts vue typescript css
(cd .generated-export-smoke && npm install --no-audit --no-fund && npm run build)
node --import tsx scripts/check-generated-ssr.mts vue
```

The generator replaces `.generated-export-smoke/` each time. For Vue, the build writes `dist/client/` and `dist/server/` inside that directory. The final command starts the generated server on `127.0.0.1:48730`, checks that its HTTP response contains the sample heading, list rows and reusable component, then stops it.

To build another configuration, change the three generator arguments. Frameworks are `nextjs`, `react`, `vue`, `nuxt` and `sveltekit`. Languages are `typescript` and `javascript`. Styles are `css`, `css-modules` and `tailwind`. The SSR check supports Vue, Nuxt and SvelteKit. Pass it the framework you just built.

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
