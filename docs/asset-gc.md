# Cloudflare KV asset GC: safe inventory stage

## Status

The daily GC task is **non-destructive**. No code path added here calls
`ASSETS_KV.delete()`. Setting `ASSET_GC_ENABLED=true` does **not** enable
physical deletion in this implementation. This is intentional, not a rollout
switch awaiting activation.

The existing `DELETE /api/assets` behavior on Cloudflare D1 remains
`{ ok: true, kept: true }`.

## Why sweep is disabled

- Restorable editor documents exist in each site's Durable Object: the current
  snapshot plus seven UTC-weekday backup slots. The inventory scans all of
  these. A weekday backup can survive longer than seven days.
- `components/PublishModal.tsx` can restore `doc.json` from an arbitrary
  retained GitHub publish commit. The published files are copied to GitHub,
  but a restored editor document can refer to the original KV keys. This
  first-stage inventory does **not** traverse those Git histories.
- A reference recheck immediately before `KV.delete()` still has a TOCTOU
  window with new document writes (including WebSocket edits, imports/copies
  and restore). Neither D1 nor Durable Objects can atomically commit a KV
  delete. A real sweep needs a shared, generation-aware write/delete fence
  across **every** document mutation path, plus a restoration policy for
  GitHub history.
- Browser-only drafts and offline tabs cannot be enumerated centrally.
  Any eventual deletion policy also needs an explicit staleness assumption
  or a client-side asset rehydration mechanism.

For these reasons, **do not implement a `KV.delete` call merely by turning
on a feature flag or adding another reference scan**.

## Inventory behavior

- Cron runs daily at **18:00 UTC / 03:00 JST** in deployments using
  `wrangler.jsonc` or a generated configuration copied from it.
- Every invocation reads every live site's current document and all
  restorable daily backups through `DocumentRoom.gcAssetReferences()`.
  Any failed RPC, corrupt document/backup, missing document room, or site
  generation change aborts the run before candidate writes.
- Every string field is searched for raw and percent-encoded `assets/...`
  references, not only `assets[].path`. False positives retain data.
- Workers KV is listed with `prefix: "assets/"` and a persisted cursor,
  at most two 500-key pages per run. Candidate insert/update/delete and
  scan cursor advancement are in one D1 batch. Completed scans remove
  candidate records no longer present in KV.
- `first_unreferenced_at` starts when inventory first sees an unreferenced
  key; it is cleared when a key becomes referenced. Candidate age and
  the upload timestamp in the key must both exceed the configured grace
  period before a key is *listed as potentially deletable*.
- A D1 lease prevents overlapping inventory runs. `asset_gc_runs`
  stores counts and fixed-category errors; candidate records reside in
  `asset_gc_candidates`; scan state resides in `asset_gc_state`.
- Inventory can be incomplete across invocations. Only after the KV
  cursor reaches the final page will the API return tentative candidate
  paths. A complete KV scan does **not** mean GitHub history has been scanned.
- `bytes` was added to new upload KV metadata. Historical keys lack that
  metadata, so `candidateBytesKnown` and
  `potentialDeleteBytesKnown` are lower bounds, not authoritative usage.

## Admin API and configuration

`POST /api/admin/asset-gc?dryRun=1` invokes inventory. It requires all
of the following: configured Google authentication, a valid authenticated
session, and the user's email explicitly present in
`ASSET_GC_ADMIN_EMAILS` (comma-separated; case-insensitive). Tsumu's
ordinary `ALLOWED_EMAILS` setting is **not** an administrator permission.
Anonymous installations cannot invoke this endpoint.

`dryRun=0` and omitted `dryRun` return HTTP 409. No API enables deletion.

| Environment setting | Default | Use |
| --- | --- | --- |
| `ASSET_GC_ADMIN_EMAILS` | unset | Authorized operators for the manual endpoint |
| `ASSET_GC_GRACE_DAYS` | `30` | Minimum observation and upload age for tentative candidates |
| `ASSET_GC_MAX_DELETES` | `500` | Maximum number of tentative paths returned |
| `ASSET_GC_ENABLED` | `false` | Reserved for a later, safely fenced sweep; ignored by this stage |

An invalid numeric setting causes the run to abort. Local Node/Docker
storage is unaffected.

## Conditions before implementing the physical sweep

1. Define and test a complete policy for restoreable GitHub publish history
   (protect old refs or rehydrate KV objects on restore).
2. Install a global write/delete barrier covering HTTP saves, WebSocket saves,
   copy/import/restore and any other writers, including crash recovery.
3. Prevent old client drafts from silently recreating references to deleted
   keys, or rehydrate them before saving.
4. Add final recheck under that barrier, a bounded deletion budget,
   interruption recovery, and integration tests for races with save/copy.
5. Review several days of non-destructive logs before separately approving
   any irreversible deletion change.
