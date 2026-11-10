# Cloudflare KV asset garbage collection

## Policy

The Cloudflare deployment removes unused KV assets after a **seven-day grace
period**, with an operator-controlled rollout. It intentionally prioritizes
ordinary editor storage cleanup over indefinite preservation of historical
restore snapshots.

- A path is in use if it appears anywhere in a **current saved document** of
  any live site. The scanner includes direct `assets[].path`, JSON string
  values, object keys, HTML/CSS and URL-encoded paths.
- Previous editor backups, GitHub publish-history `doc.json` files and stale
  browser drafts **do not protect** a KV object from cleanup. Restoring those
  old states after deletion may yield broken images; this is an explicit
  product trade-off.
- A new unused candidate records the first time it was *observed* unused.
  Physical deletion is permitted only after **both** the observation time
  and the original upload timestamp embedded in the key exceed seven days.
  Actual deletion may be later, because checks are daily and paginated.
- If a current document is unreadable, the site list changes during an
  inspection, or a Durable Object cannot be reached, the run aborts.
- Immediately before the first deletion, all current site documents are
  read again. Any newly referenced candidate is removed from the list.
  This narrows but does **not eliminate** the small race with a concurrent
  new save after the last reference check. If this trade-off is unacceptable,
  implement a shared write/delete barrier instead of using this policy.

Deleted sites are physically removed from D1; their retired Durable Objects
are sealed and have no live references. Local Node/Docker storage is unchanged.

## Execution

- Cron: **18:00 UTC / 03:00 JST**, daily.
- Workers KV: `ASSETS_KV.list({ prefix: "assets/" })`, up to two pages
  of 500 keys per invocation. The next cursor is stored in D1.
- Only a fully completed KV scan may perform deletion. A failed or partial
  scan can record candidates but never delete KV files.
- D1 persists `asset_gc_candidates`, `asset_gc_runs` and
  `asset_gc_state` (lease and scan cursor). A single GC lease prevents
  overlapping cron/manual runs.
- The configured maximum is **500** candidate paths per run, but actual
  deletion is additionally capped at **20 files per invocation** to leave
  headroom under Workers Free's subrequest budget. Remaining candidates are
  retried on later runs. KV delete failures stop the run; successfully deleted
  paths and known bytes are retained in the D1 run log.
- The `bytes` metadata is set on new uploads. Old keys may lack size
  metadata, so known-byte totals are only lower bounds.
- Unrecognized/old-format keys cannot pass the upload-timestamp check and
  will be retained until an explicit separate decision.

The normal `DELETE /api/assets` endpoint continues to return
`{ ok: true, kept: true }` on Cloudflare D1. It never physically deletes
shared KV objects immediately.

## Rollout settings

| Environment variable | Default | Effect |
| --- | --- | --- |
| `ASSET_GC_ENABLED` | `false` | `true` enables the 7-day physical sweep for Cron and the manual API |
| `ASSET_GC_GRACE_DAYS` | `7` | Days from first unused observation **and** upload age |
| `ASSET_GC_MAX_DELETES` | `500` | Candidate upper bound; 20 physical deletes per run maximum |
| `ASSET_GC_ADMIN_EMAILS` | unset | Comma-separated Google login emails authorized to run the manual API |

The admin route is protected by Google login and the explicit admin email
allowlist; `ALLOWED_EMAILS` alone is not administrator authorization.

- `POST /api/admin/asset-gc?dryRun=1`: inventory/candidates and deletion
  preview, even while physical deletion is disabled. No KV delete.
- `POST /api/admin/asset-gc?dryRun=0`: execute eligible deletion, only
  when `ASSET_GC_ENABLED=true`. Otherwise HTTP 409.
- Both modes update D1 inventory state and run logs.
- Errors after some successful deletes return 503, and the D1 run log
  records the partial count; do not infer that a failed run changed no files.

**First deployment:** leave `ASSET_GC_ENABLED=false`. Inspect several
Cron/dry-run reports, confirm the site's current references are accurate,
and set `ASSET_GC_ENABLED=true` only when the seven-day deletion policy
is acceptable. All preexisting orphan objects are first observed at
deployment, so none are eligible for deletion immediately.

## What this policy does not guarantee

There is no cross-service transaction between Durable Object document writes
and Workers KV deletes. An editor that has remained offline more than seven
days, or a user restoring historical GitHub data, may reintroduce references
to a deleted asset. Current-doc rechecking reduces accidental deletions but
does not make concurrent saving and deletion atomic. Backups and history are
deliberately excluded from retention.
