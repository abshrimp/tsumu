# Cloudflare KV asset garbage collection

## Policy

The Cloudflare editor removes unused uploaded KV assets **seven days after an
asset removal event** (or after an orphan is first found by reconciliation).
Deleting an asset from one site does not immediately remove the shared KV
object. Multiple sites can reference the same immutable asset path.

- On deleting an asset from the editor's Assets panel (including unused-asset
  cleanup), `DELETE /api/assets` records a candidate in D1. There is **no
  cross-site scan or KV listing in that request**. An additional removal
  event resets the seven-day grace-period clock.
- The daily 03:00 JST task queries **only expired D1 candidates**, not all
  KV objects. If none are expired, it does not read any site documents or list
  KV keys.
- For expired candidates, the task checks the current persisted documents of
  **every live site**. If any site still references the path, the candidate
  is removed and the KV object is retained. If any current document or
  generation cannot be read, deletion is aborted.
- A second reference check immediately before the physical sweep narrows
  the risk of a concurrent save. Durable Object, D1 and Workers KV are not
  one transaction; this does **not** eliminate every possible save/delete race.
- The original upload timestamp in the asset key must **also** be at least
  seven days old. Unknown-key-format assets are not automatically deleted.
- Restorable weekday backups, GitHub publish history, and offline browser
  drafts are intentionally **not** counted as live references. Restoring one
  later may require re-uploading a missing image.

## Orphans without a deletion event

An upload can fail to reach a saved document, or an entire site can be
deleted without individual asset removal requests. A **separate weekly
reconciliation** checks one KV page per invocation:

- Monday 04:00 JST (Sunday 19:00 UTC) scans up to **1,000** keys (the KV list maximum) using
  `ASSETS_KV.list({ prefix: "assets/" })`.
- It reads current site references first. Unreferenced, recognizable KV keys
  are added as D1 candidates without resetting any existing candidate's
  observation timestamp.
- The KV cursor is stored in `asset_gc_state` to resume on the following
  week. Once the last page is reached, candidates for keys absent from the
  completed inventory can be cleaned up.
- The ordinary nightly task does **not** enumerate KV. Weekly reconciliation
  is intentionally lower priority than normal delete-event cleanup.

## Storage ledger and the usage meter

D1 table `asset_objects` lists every object in `ASSETS_KV` (path, size,
upload time, last time an inventory saw it). It is the source of the asset
tab's storage meter, so the meter matches actual KV usage, including removed
assets that are waiting for GC, failed uploads and the files of deleted sites.

- An upload adds its row after the KV write. If that D1 write fails, the next
  weekly inventory adds it.
- A GC delete removes the row in the same D1 batch as the candidate.
- The weekly inventory upserts every listed key, filling in sizes from KV
  metadata. When a full pass finishes, rows not seen in that pass (and
  uploaded before it began) are removed.
- `asset_ledger_state.complete_at` is set after the first full pass that
  started after the ledger was created. Until then, the meter falls back to
  counting the files that site documents reference. With more than 1,000
  keys in KV, this takes one week per 1,000 keys.
- Objects uploaded before sizes were recorded have no size in KV metadata.
  The meter fills these from the open site's document when it can and
  otherwise reports them as unknown.

When an asset is deleted, the confirmation dialog states what happens to the
stored file (`/api/status` → `assetDeletion`): deleted after
`ASSET_GC_GRACE_DAYS` days when `ASSET_GC_ENABLED=true`, kept otherwise, and
deleted immediately on Node.js and Docker.

## Limits, storage and recovery

- D1 tables: `asset_gc_candidates` (path, first-unreferenced time,
  last-seen time, optional size), `asset_gc_runs` (audit),
  `asset_gc_state` (KV cursor and exclusive run lease), and the storage
  ledger `asset_objects` / `asset_ledger_state`.
- `ASSET_GC_MAX_DELETES` defaults to 500 and caps eligible paths considered.
  Physical deletion continues until the run has used 900 of the 1,000
  Cloudflare-service subrequests (D1, KV, Durable Objects) that Workers Free
  allows per invocation. Each site scan costs one Durable Object call per
  site and each delete costs three calls, so a deployment with a few dozen
  sites deletes well over 200 keys per run; with ~400 sites, only a few
  dozen. Remaining eligible keys are retried on the next run.
- A failed KV delete stops the run and logs the count of completed deletions.
  Deleting a missing KV key again is idempotent.
- The `bytes` metadata is written for new uploads and recovered during
  weekly reconciliation. Older keys may have no known size, so byte totals
  are lower bounds.
- A deleted site's D1 record is removed and its old Durable Object is
  sealed. Node.js and Docker retain their immediate-delete behavior.

## Configuration and inspection

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSET_GC_ENABLED` | `false` | Set to `true` to permit physical deletes; default is dry-run |
| `ASSET_GC_GRACE_DAYS` | `7` | Time from last explicit removal or first orphan discovery |
| `ASSET_GC_MAX_DELETES` | `500` | Selection cap; deletes also stop at the per-invocation subrequest budget |

GC runs only from the Cron triggers; there is no HTTP endpoint. Inspect its
state in D1 with Wrangler:

```sh
# Candidates and when they became unreferenced (milliseconds since epoch)
npx wrangler d1 execute tsumu --remote --command \
  "SELECT path, bytes, first_unreferenced_at FROM asset_gc_candidates ORDER BY first_unreferenced_at"
# Recent runs, including dry runs
npx wrangler d1 execute tsumu --remote --command \
  "SELECT * FROM asset_gc_runs ORDER BY id DESC LIMIT 10"
```

**First deployment:** leave deletion disabled and inspect the candidates and
dry-run records above.
Enable the flag only after reviewing live references and accepting the
seven-day retention policy. Preexisting orphans discovered during weekly
reconciliation start their grace period when first observed; merging this
code does not trigger immediate mass deletion.
