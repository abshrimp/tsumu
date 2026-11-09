# Previewing pull requests of the editor

English · [日本語](worker-previews.ja.md)

Cloudflare Workers Builds can deploy every non-production branch of the editor as a **Worker Preview** with its own URL, and post that URL as a comment on the pull request. This repository is already set up this way. This page explains how to set it up on your own Workers Builds project, and what a Preview contains.

This page is about the editor only. A published site has no storage bindings or Durable Objects, so none of this applies to it; just turn on preview builds for non-production branches in its own hosting project.

## Setup

1. **Set the Preview command** to `node scripts/cloudflare-preview.mjs`. Leave the Build command (`node scripts/cloudflare.mjs build`) and the production Deploy command (`node scripts/cloudflare.mjs deploy`) as they are. Don't use the default `npx wrangler preview`: the script is what keeps the Preview away from production storage and secrets.
2. **Check it.** Push a branch and open the URL the bot posts on the pull request. Create a throwaway site and reload the page. A successful build alone doesn't prove the Preview works.

To create or update a Preview from your own machine, run `npm run preview:deploy -- --name <name>`. `npm run preview` only runs the editor locally.

## What a Preview contains

The default `previews` block in `wrangler.jsonc` configures a **public, anonymous demo**:

- **No sign-in.** `ALLOW_ANONYMOUS=true` applies to Previews only; production's sign-in is unchanged. Anyone with the URL can edit.
- **No server storage.** D1 and KV are explicitly empty, so sites and images are stored in the browser, separately for each Preview URL. Cross-device editing, server uploads and collaboration aren't available. Use throwaway data.
- **Separate configuration.** The helper supplies Preview-specific bindings and vars and invokes Wrangler with `--ignore-base-config`. Each Preview has its own Durable Object storage. The helper does not inspect or delete secrets already set on an existing Preview: check them before reusing it as a public demo. Browser-only storage does not disable a configured publishing token or AI provider.

## Using test storage (optional)

To give Previews shared server storage:

1. Create a D1 database and a KV namespace **separate from production and from other Previews**. D1 holds site metadata and room keys; documents live in the Preview's own DocumentRoom storage. Reusing D1/KV IDs across Previews does not share a complete editor store.
2. In a private config (`wrangler.local.jsonc` or the file named in `WRANGLER_CONFIG`), replace only the `previews` block with the block below. Keep the top-level `exports.CollaborationRoom` and `exports.DocumentRoom` declarations with `type: "durable-object"` and `storage: "sqlite"`. The explicit Preview binding list must contain both classes; the helper otherwise supplies only `COLLAB_ROOM`.

```json
{
  "previews": {
    "vars": {},
    "durable_objects": {
      "bindings": [
        { "name": "COLLAB_ROOM", "class_name": "CollaborationRoom" },
        { "name": "DOC_STORE", "class_name": "DocumentRoom" }
      ]
    }
  }
}
```

3. Pass the test IDs as build variables `PREVIEW_D1_DATABASE_ID` and `PREVIEW_KV_NAMESPACE_ID`. Alternatively, add explicit `previews.d1_databases` (`binding: "DB"`, `database_name`, `database_id`) and `previews.kv_namespaces` (`binding: "ASSETS_KV"`, `id`) entries. Explicit arrays take precedence over the build variables, including empty arrays; remove the default empty arrays when using the variables. Tables are created on first access.
4. Before using shared storage, configure sign-in on the Preview itself: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL`, a Preview-specific OAuth callback URL and a narrow `ALLOWED_EMAILS` allowlist. The example removes `ALLOW_ANONYMOUS`; without sign-in configured, access stays blocked. Keep credentials in Preview secrets, not `previews.vars`.
5. Inspect `wrangler.preview.generated.jsonc`: the `previews` block must contain the test `DB` and `ASSETS_KV` bindings and both Durable Object bindings. Verify sign-in, site creation, editing, saving and reopening from another browser. Do not use production data for this check.

Adding D1 and KV alone is insufficient: document access fails with `DOC_STORE binding is required` when D1 exists without `DOC_STORE`. The Preview helper does not check storage completeness, so a successful build or config generation does not prove server storage works. See [Document storage](durable-object-storage.md#hosted-preview-storage) for the routing model.

## What the script refuses

`scripts/cloudflare-preview.mjs` writes `wrangler.preview.generated.jsonc` next to the source config (ignored by Git in this repository) and runs `wrangler preview` with it. It stops with an error, without deploying, if:

- an explicitly configured Preview D1 or KV binding has a missing, blank, placeholder or known production ID (omitting both the array and its build variable instead produces an empty array);
- `COLLAB_ROOM` isn't bound to the Preview's own `CollaborationRoom`, points at another Worker, or the `exports` configuration changes a Durable Object class lifecycle;
- `previews` contains a setting it doesn't know how to isolate;
- `previews.vars` contains a credential-like name (such as `AUTH_SECRET` or `GITHUB_TOKEN`); put sensitive values into Preview secrets, never plain-text vars;
- the OpenNext config uses a cache, queue or skew protection other than the default dummy ones;
- the Worker name doesn't match the one Workers Builds is deploying;
- it receives arguments other than `--name`, `--tag`, `--message` and `--json`.

These checks only cover the config the script is given. They can't see settings made in the Cloudflare dashboard, so check the actual bindings there when in doubt.

## References (checked 2026-11-06)

- [Worker Previews setup](https://developers.cloudflare.com/workers/previews/get-started/)
- [Builds for non-production branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [Preview configuration and secrets](https://developers.cloudflare.com/workers/previews/configuration/)
- [Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/)
