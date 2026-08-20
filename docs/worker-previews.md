# Previewing pull requests of the editor

English · [日本語](worker-previews.ja.md)

Cloudflare Workers Builds can deploy every non-production branch of the editor as a **Worker Preview** with its own URL, and post that URL as a comment on the pull request. This repository is already set up this way. This page explains how to set it up on your own Workers Builds project, and what a Preview contains.

This page is about the editor only. A published site has no storage bindings or Durable Objects, so none of this applies to it; just turn on preview builds for non-production branches in its own hosting project.

## Setup

1. **Set the Preview command** to `node scripts/cloudflare-preview.mjs`. Leave the Build command (`node scripts/cloudflare.mjs build`) and the production Deploy command (`node scripts/cloudflare.mjs deploy`) as they are. Don't use the default `npx wrangler preview`: the script is what keeps the Preview away from production storage and secrets.
2. **Check it.** Push a branch and open the URL the bot posts on the pull request. Create a throwaway site and reload the page. A successful build alone doesn't prove the Preview works.

To create or update a Preview from your own machine, run `npm run preview:deploy -- --name <name>`. `npm run preview` only runs the editor locally.

## What a Preview contains

The `previews` block in `wrangler.jsonc` makes every Preview a **public, anonymous demo**:

- **No sign-in.** `ALLOW_ANONYMOUS=true` applies to Previews only; production's sign-in is unchanged. Anyone with the URL can edit.
- **No server storage.** D1 and KV are explicitly empty, so sites and images are stored in the browser, separately for each Preview URL. Cross-device editing, server uploads and collaboration aren't available. Use throwaway data.
- **Nothing from production.** Each Preview gets its own Durable Object storage. Production variables and secrets aren't copied, and the dashboard's Preview Base settings aren't inherited when a Preview is created. Secrets already set on an existing Preview are left as they are.

## Using test storage (optional)

To give Previews shared server storage:

1. Create a D1 database and a KV namespace **separate from production**.
2. Remove the empty `previews.d1_databases` and `previews.kv_namespaces` arrays from the config. As long as they are there, they take precedence and Previews stay browser-only.
3. Pass the IDs as the build variables `PREVIEW_D1_DATABASE_ID` and `PREVIEW_KV_NAMESPACE_ID`, or write the bindings into `previews` in a private config (`wrangler.local.jsonc` or the file named in `WRANGLER_CONFIG`). Database tables are created on first access.

Every branch that uses the same IDs shares that data. Once Previews have server storage, don't leave them anonymous: remove `ALLOW_ANONYMOUS` from `previews.vars`, and set up sign-in with secrets on the Preview itself, a Preview-specific OAuth callback URL and a narrow allowlist.

## What the script refuses

`scripts/cloudflare-preview.mjs` writes `wrangler.preview.generated.jsonc` next to the source config (ignored by Git in this repository) and runs `wrangler preview` with it. It stops with an error, without deploying, if:

- a Preview D1 or KV ID is missing, still a placeholder, or the same as a production ID;
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
