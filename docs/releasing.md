# Publishing Tsumu

The canonical repository is [abshrimp/tsumu](https://github.com/abshrimp/tsumu). Tsumu is a self-hosted application; `private: true` in `package.json` prevents accidental npm publication and does not restrict GitHub source visibility.

## Validate the source

Use a clean checkout with Node.js 26.12.1+ and npm 12.2.1+:

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

Check the [English](../README.md) and [Japanese](../README.ja.md) setup instructions. Verify a new site can be created, edited and reopened without any credentials. Verify a production instance refuses access until sign-in or anonymous access is explicitly configured.

Only include source, documentation, the license and the lockfile in a source release. Do not include environment files, `wrangler.local.jsonc`, `.wrangler/`, build output, databases, backup archives or test artifacts. Inspect the files and Git history to be made public for credentials and private site content; ignored files are not removed from existing history automatically.

## Configure the GitHub repository

- Confirm the repository name is `abshrimp/tsumu`, its description matches the README, and the MIT license is present.
- Enable private vulnerability reporting before linking users to the private reporting form in [SECURITY.md](../SECURITY.md).
- Require the CI checks for pull requests into `main` and enable dependency alerts.
- Check that the demo URL works and contains only public sample data with no production publishing credentials.

## Create a release

Once CI passes for the intended commit, create a version tag matching `package.json` and publish GitHub release notes describing the included features, runtime requirements and known limitations. Build artifacts and editor data are not part of the source release.

The initial public format uses `tsumu-` browser keys, `application/x-tsumu+json` clipboard data and `_tsumu/` publish metadata. It does not import or migrate predecessor formats. Normal Tsumu document backups, restore, undo and published-version rollback remain supported.
