# Hosted previews of the editor / エディタのプレビュー

## Why a successful build can still return 404

The editor exports `CollaborationRoom`, a Durable Object. OpenNext 1.20.14's `upload` command calls `wrangler versions upload`. Cloudflare does not generate legacy **Version URLs** for Workers implementing Durable Objects. A successful build or uploaded version therefore does not establish that its URL serves the editor.

Use **Worker Previews**, supported by the installed Wrangler 4.154.0. Keep these commands distinct:

- `npm run preview`: builds and starts OpenNext's **local** Wrangler development server.
- `npm run preview:deploy -- --name pr-116`: builds and creates/updates a **hosted** Worker Preview.
- `node scripts/cloudflare-preview.mjs --name pr-116`: deploys an already-built hosted Preview.
- `node scripts/cloudflare.mjs deploy`: deploys production, unchanged.
- `node scripts/cloudflare.mjs upload`: retained as the old version upload, unchanged. It is not a working preview route for this editor.

This change does not switch dashboard settings, create D1/KV resources, migrate data, or deploy production. The existing upload command is intentionally not silently redirected, since Workers Builds may execute it automatically on a PR branch.

## Setup and isolation

1. Inspect the current Worker and Workers Builds configuration first. For an existing legacy project, Cloudflare requires **Settings → Builds → Set up Worker Previews**. The switch is **irreversible**. Review it before accepting it. New projects may already use Worker Previews.
2. Keep the build command `node scripts/cloudflare.mjs build`, the production deploy command unchanged, and set the Preview command to `node scripts/cloudflare-preview.mjs` after reviewing the switch. Do not leave the default `npx wrangler preview`: the helper generates the isolated configuration and performs additional checks.
3. By default, the helper binds only the Preview's own `COLLAB_ROOM` Durable Object and leaves D1/KV absent. The editor uses browser-local storage. Cloudflare creates separate DO storage for each Preview; no production DO is removed or rebound.
4. For shared test data, create **separate test resources** first, then provide `PREVIEW_D1_DATABASE_ID` and/or `PREVIEW_KV_NAMESPACE_ID` as build variables. Apply the required schema to that test D1 separately. There is no resource provisioning or automatic data migration in this helper. Branches using the same Preview ID share that test resource with one another.
5. Alternatively, add explicit `previews.d1_databases`, `previews.kv_namespaces` and `previews.vars` to a private JSON/JSONC config selected by `WRANGLER_CONFIG` or `wrangler.local.jsonc`. Explicit Preview arrays win over build-variable defaults, including an explicit empty array. Do not put secrets into a config file. TOML is not supported by this helper.
6. Review Preview-specific authentication and access before entering data. The helper does **not** enable anonymous editing, copy production variables/secrets, or configure OAuth. It passes `--ignore-base-config` to avoid silently inheriting dashboard Base bindings on creation. Configure required secrets directly for the Preview, using Cloudflare's supported secure tooling, and use a Preview callback URL and a narrow allowlist. Existing Preview secrets are not erased by this command. For an existing Preview, also inspect its script-level settings: earlier tail consumers, observability and logpush can persist because ignoring Base only applies at creation. Prefer a fresh reviewed Preview name when that history is unknown. Until authentication is configured, the editor should remain locked, not automatically become an anonymous demo.

The helper rejects configured D1/KV IDs that equal production IDs (including `D1_DATABASE_ID` and `KV_NAMESPACE_ID`), missing placeholders, and cross-Worker DO bindings or class transfers. It compares IDs from all named environment blocks too, pins the top-level Worker, and rejects a mismatched Workers Builds target name. Additional resource types require a separate isolation review. This is a check against the supplied configuration, **not proof about an uninspected dashboard**. Confirm the actual resource IDs and Preview bindings there before use. In particular, Cloudflare does not isolate D1/KV automatically.

The generated `wrangler.preview.generated.jsonc` stays beside its source config so relative asset/entry paths keep their meaning. It is Git-ignored inside this repository; an external config directory must provide its own ignore rules and access protection. CLI passthrough accepts only `--name`, `--tag`, `--message` and `--json`; it cannot override config, environment, entrypoint or secrets.

## OpenNext and verification

The editor currently uses OpenNext's default dummy caches and no skew protection. Those settings need no remote cache population. The helper checks the compiled OpenNext configuration before deploying and refuses a future custom cache, queue or skew-protection setup, rather than silently skipping adapter work or writing into production caches.

After deployment:

- Use the URL returned by the **Worker Preview deployment**, not a guessed version-prefix URL.
- Check HTTP status and the editor UI separately from build success.
- Verify login/access, a new disposable site's save/reload, isolated uploads if enabled, and collaboration between two clients.
- Confirm that production bindings/data did not change. Do not copy production documents into a test Preview merely to test it.
- Check both the stable Preview URL and the unique deployment URL if reviewing an exact revision.

These hosted/runtime checks require an authorized Cloudflare setup. Unit tests and a successful local build alone cannot establish them.

## 日本語の要点

ビルド成功とURL表示は別です。tsumuエディタの Durable Object は従来の Version URLs に非対応なので、新しい Worker Previews を使います。既存 Workers Builds の切替は元に戻せません。実設定を確認し、プレビュー専用の認証と保存先を決めてから切り替えてください。

新しいスクリプトは本番設定を変更せず、既定ではD1/KVなし・プレビュー固有のDOで動かします。D1/KVを使う場合は本番とは別に用意したIDを指定します。同じテストIDを使う複数のプレビュー同士はデータを共有します。認証を自動で緩めたり、本番のシークレットを複製したりはしません。

`npm run preview` はローカル、`npm run preview:deploy` はクラウドへの作成/更新です。既存の `upload` を自動置換していないため、この変更をPRに載せただけで新方式への切替は実行されません。切替後は新コマンドが返したURLで、表示・認証・テストデータの保存・共同編集と本番データの分離を確認します。

## Official references (checked 2026-11-06)

- [Version URLs limitations](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
- [Worker Previews setup](https://developers.cloudflare.com/workers/previews/get-started/)
- [Existing Workers Builds and irreversible switch](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [Preview configuration and secrets](https://developers.cloudflare.com/workers/previews/configuration/)
- [Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/)
