# Hosted previews of the editor / エディタのプレビュー

This guide explains how to get working hosted previews of the Tsumu editor on Cloudflare — for example, one per pull request — without touching production. A [summary in Japanese](#日本語の要点) follows the English text.

## Why a successful build can still return 404

The editor exports a Durable Object called `CollaborationRoom`. That has one important consequence:

- OpenNext 1.20.14's `upload` command calls `wrangler versions upload`.
- Cloudflare doesn't generate the older **Version URLs** for Workers that implement Durable Objects.

So a successful build, or a successfully uploaded version, tells you nothing about whether its URL actually serves the editor.

The fix is to use **Worker Previews**, which the installed Wrangler 4.154.0 supports.

### Which command does what

| Command | What it does |
|---|---|
| `npm run preview` | Builds and starts OpenNext's **local** Wrangler development server. |
| `npm run preview:deploy -- --name pr-116` | Builds, then creates or updates a **hosted** Worker Preview. |
| `node scripts/cloudflare-preview.mjs --name pr-116` | Deploys an already-built hosted Preview. |
| `node scripts/cloudflare.mjs deploy` | Deploys production. Unchanged. |
| `node scripts/cloudflare.mjs upload` | The old version upload, kept as is. It is **not** a working way to preview this editor. |

### What committing these files does not do

Committing the preview setup to the repository does **not**:

- change any setting in the Cloudflare dashboard,
- create D1 or KV resources,
- migrate any data, or
- deploy production.

The existing `upload` command is intentionally left alone rather than silently redirected, because Workers Builds may run it automatically on a pull request branch.

## Setup and isolation

1. **Inspect the current setup first.** Look at the current Worker and its Workers Builds configuration. An existing legacy project must go through **Settings → Builds → Set up Worker Previews**. This switch is **irreversible**, so review it before accepting. New projects may already use Worker Previews.

2. **Set the commands.** Keep the build command `node scripts/cloudflare.mjs build` and the production deploy command as they are. After reviewing the switch, set the Preview command to `node scripts/cloudflare-preview.mjs`. Don't leave the default `npx wrangler preview`: the helper script generates the isolated configuration and runs extra checks.

3. **Know what the default configuration does.** The checked-in configuration opts into anonymous, browser-only review builds. It sets `previews.vars.ALLOW_ANONYMOUS="true"` and explicitly empty D1 and KV arrays.
   - The helper binds only the Preview's own `COLLAB_ROOM` Durable Object, and leaves D1 and KV absent.
   - The editor therefore stores data in the browser.
   - Cloudflare creates separate Durable Object storage for each Preview. No production Durable Object is removed or rebound.

4. **Shared test data is off by default.** If you want it:
   1. Review authentication and storage first.
   2. Create **separate test resources**.
   3. Remove or replace the explicitly empty Preview arrays.
   4. Provide `PREVIEW_D1_DATABASE_ID` and/or `PREVIEW_KV_NAMESPACE_ID` as build variables.
   5. Apply the required schema to the test D1 database yourself.

   The helper doesn't provision resources or migrate data. Note that all branches using the same Preview resource ID share that test data with each other.

5. **Or use a private config.** Instead of build variables, you can add explicit `previews.d1_databases`, `previews.kv_namespaces` and `previews.vars` to a private JSON or JSONC config, selected by `WRANGLER_CONFIG` or `wrangler.local.jsonc`.
   - Explicit Preview arrays win over build-variable defaults — including an explicitly empty array.
   - Don't put secrets in a config file.
   - The helper doesn't support TOML.

6. **Review authentication and access before entering any data.**
   - The helper does **not** infer anonymous access from build variables, copy production variables or secrets, or configure OAuth.
   - This repository opts into anonymous access in its Preview configuration only. Production has no such opt-in.
   - The helper passes `--ignore-base-config`, so a new Preview doesn't silently inherit bindings from the dashboard's Base.
   - Configure any secrets a Preview needs directly on that Preview, using Cloudflare's supported secure tooling. Use a Preview-specific OAuth callback URL and a narrow allowlist. This command doesn't erase secrets a Preview already has.
   - For an existing Preview, also check its script-level settings. Earlier tail consumers, observability and logpush settings can persist, because ignoring the Base only applies when a Preview is created. If you don't know a Preview's history, prefer a fresh, reviewed Preview name.
   - For a private Preview, remove the explicit anonymous opt-in and set up separate authentication before using it. Never add private test storage to an anonymous demo.

### What the helper checks

The helper refuses to deploy if it finds:

- configured D1 or KV IDs that equal production IDs (including `D1_DATABASE_ID` and `KV_NAMESPACE_ID`),
- missing placeholders, or
- Durable Object bindings to another Worker, or class transfers.

It also compares IDs found in every named environment block, pins the top-level Worker, and rejects a Workers Builds target name that doesn't match. Any other resource type needs its own isolation review.

> [!WARNING]
> These checks only cover the configuration you give the helper. They are **not proof about a dashboard nobody has inspected**. Confirm the actual resource IDs and Preview bindings in the dashboard before use. In particular, Cloudflare does not isolate D1 or KV automatically.

### Generated files and command-line options

- The generated `wrangler.preview.generated.jsonc` is written next to its source config, so relative asset and entry paths keep their meaning. Inside this repository it's ignored by Git. If your config lives in an external directory, that directory needs its own ignore rules and access protection.
- The helper passes through only `--name`, `--tag`, `--message` and `--json`. It can't be used to override the config, environment, entry point or secrets.

## OpenNext and verification

The editor currently uses OpenNext's default dummy caches and no skew protection, so there's no remote cache to populate. Before deploying, the helper checks the compiled OpenNext configuration. If a future change adds a custom cache, queue or skew protection, the helper refuses to deploy — rather than silently skipping adapter work or writing into production caches.

After deploying, verify the Preview:

- **Use the right URL.** Open the URL returned by the **Worker Preview deployment**, not a guessed version-prefix URL.
- **Check the page itself.** Look at the HTTP status and the editor UI; a successful build is a separate thing.
- **Check the basics.** Confirm anonymous access works, and that a new throwaway local site saves and survives a reload.
- **Know the limits of a browser-only Preview.** It doesn't offer cross-device storage, server uploads or collaboration. Test isolated server uploads and two-client collaboration only on a separately authenticated Preview with its own test D1 and KV.
- **Confirm production is untouched.** Production bindings and data should not have changed. Don't copy production documents into a test Preview just to test it.
- **Reviewing an exact revision?** Check both the stable Preview URL and the unique deployment URL.

These hosted, runtime checks need an authorized Cloudflare setup. Unit tests and a successful local build alone can't establish them.

## 日本語の要点

**ビルドの成功と、URLで表示できることは別の話です。** Tsumu のエディタは Durable Object を持っているため、従来の Version URL では表示できません。代わりに新しい Worker Previews を使います。既存の Workers Builds での切り替えは元に戻せないので、実際の設定を確認し、プレビュー専用の認証と保存先を決めてから切り替えてください。

**本番には影響しません。** 新しいスクリプトは本番の設定を変更せず、既定では D1・KV なし、プレビュー専用の Durable Object で動きます。

- D1・KV を使う場合は、本番とは別に用意したIDを指定してください。同じテスト用のIDを使うプレビュー同士は、データを共有します。
- このリポジトリでは、プレビューに限って匿名アクセスを明示的に許可しています。本番の認証は変えず、本番のシークレットも複製しません。

**コマンドの違い**: `npm run preview` は手元で動かすもの、`npm run preview:deploy` はクラウド上のプレビューを作成・更新するものです。既存の `upload` は自動では置き換えていないので、この変更をプルリクエストに含めただけでは新方式への切り替えは起きません。

**切り替えたあとの確認**: 新しいコマンドが返したURLを開き、表示されること、匿名でアクセスできること、ブラウザ内のテストデータを保存できること、本番のデータと分かれていることを確かめます。ブラウザに保存するだけのプレビューでは、端末をまたいだ共有や同時編集はできません。

## Workers Builds cutover checklist

1. **Record the starting point.** Note the current production deployment, the production command, the connected repository and branch, and the identities of any existing Previews. Check the account and plan. A successful old version upload does not mean you have a working Preview.

2. **Review the Preview settings.** Go through all build variables and secrets, and the Preview Base. Don't put any of these into Preview settings: production D1 or KV IDs, OAuth or GitHub secrets, Durable Object bindings to other Workers, tail consumers, or any other production resource. The helper's `--ignore-base-config` avoids copying the Base when a Preview is created, but it doesn't erase secrets or settings that an existing Preview already has.

3. **Make the switch.** In **Workers & Pages → tsumu → Settings → Builds → Set up Worker Previews**, inspect the isolated settings and select **Switch to Worker Previews**. This is a one-time switch and can't be reversed. The public Builds API fields `previews_enabled` and `previews_base_config` are not a substitute for this legacy-to-new switch in the dashboard.

4. **Set the commands.**
   - Keep Build as `node scripts/cloudflare.mjs build` and the production Deploy as `node scripts/cloudflare.mjs deploy`.
   - Set the Preview command to `node scripts/cloudflare-preview.mjs` — not the old upload command, and not the unreviewed default.
   - Every branch you test must contain both the helper and the checked-in browser-only configuration.
   - Enable preview builds only for the branches you intend.

5. **Leave existing Previews alone.** Existing standalone Previews don't need to be rewritten.
   - Don't choose an apply-to-existing option, or use `patch_existing_previews=true`, just to configure the Base.
   - If you reuse a Preview, inspect its actual settings. If you don't know its history, pick a fresh name.
   - At the service's Preview limit, creating a new Preview can evict an old one, so check the current count before creating more.
   - Never delete a review environment as an unannounced side effect.

6. **Test end to end.** Push an authorized test change to a non-production branch, then verify:
   - the exact commit, the actual Build and Preview commands that ran, and the URL they returned. (The GitHub integration may post the link as a pull request comment; look for it rather than assuming it appears in a particular check field.)
   - that the home screen and editor assets load, anonymous access works, and a throwaway local site saves and survives a reload;
   - that `/api/doc` and `/api/sites` have no server database, and the actual bindings include no production storage or secrets;
   - that the production deployment and its settings are unchanged.

### Things to keep in mind

- **Browser data is per origin.** Data stored in the browser belongs to the Preview URL's origin. A different stable Preview URL, or a unique deployment URL, has separate browser storage.
- **Nothing is migrated.** CI updates don't migrate production data or copy local data between URLs. No production data migration is part of this setup.
- **Plan limits apply.** Builds and Worker Preview traffic count against the account's limits. Check the Free plan limits and your current usage before enabling a broad branch pattern. Don't upgrade the plan or add paid resources implicitly.
- **Logging out doesn't disconnect builds.** Logging out of a temporary setup session doesn't remove the existing Cloudflare Git integration used for builds.

## Official references (checked 2026-11-06)

- [Version URLs limitations](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
- [Worker Previews setup](https://developers.cloudflare.com/workers/previews/get-started/)
- [Existing Workers Builds and irreversible switch](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [Preview configuration and secrets](https://developers.cloudflare.com/workers/previews/configuration/)
- [Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/)
- [Builds API and legacy switch requirements](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)
- [GitHub integration and PR comments](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
