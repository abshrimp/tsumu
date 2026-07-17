# Publishing Tsumu

This is the maintainer's checklist for publishing Tsumu's source and cutting a release.

The canonical repository is [abshrimp/tsumu](https://github.com/abshrimp/tsumu). Tsumu is a self-hosted application. `private: true` in `package.json` only prevents accidental publication to npm; it doesn't affect whether the source is visible on GitHub.

## 1. Validate the source

Start from a clean checkout with Node.js 26.12.1+ and npm 12.2.1+, then run:

```sh
npm ci
npm run typecheck
npm test
npm run i18n:check
npm run build
npx playwright install chromium
npm run test:e2e
npm run build:worker
npm audit
```

Then check by hand:

- Follow the setup instructions in the [English](../README.md) and [Japanese](../README.ja.md) READMEs.
- Without any credentials, create a new site, edit it and reopen it.
- Confirm that a production instance refuses access until either sign-in or anonymous access has been explicitly configured.

### What goes into a source release

**Include** only source code, documentation, the license and the lockfile.

**Leave out** environment files, `wrangler.local.jsonc`, `.wrangler/`, build output, databases, backup archives and test artifacts.

> [!WARNING]
> Inspect every file — and the Git history — that will become public, looking for credentials and private site content. Adding a file to `.gitignore` doesn't remove it from history that already exists.

## 2. Create a release

Once CI passes on the commit you intend to release:

1. Create a version tag that matches the version in `package.json`.
2. Publish GitHub release notes that describe the included features, runtime requirements and known limitations.

Build artifacts and editor data are not part of a source release.

## Data formats

The initial public format uses:

- `tsumu-` keys for browser storage,
- `application/x-tsumu+json` for clipboard data, and
- `_tsumu/` for publish metadata.

It doesn't import or migrate formats from predecessor applications. Normal Tsumu document backups, restoring, undo and rolling back to a published version all remain supported.
