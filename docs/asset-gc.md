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

- Monday 04:00 JST (Sunday 19:00 UTC) scans up to **250** keys using
  `ASSETS_KV.list({ prefix: "assets/" })`.
- It reads current site references first. Unreferenced, recognizable KV keys
  are added as D1 candidates without resetting any existing candidate's
  observation timestamp.
- The KV cursor is stored in `asset_gc_state` to resume on the following
  week. Once the last page is reached, candidates for keys absent from the
  completed inventory can be cleaned up.
- The ordinary nightly task does **not** enumerate KV. Weekly reconciliation
  is intentionally lower priority than normal delete-event cleanup.
- Administrators can explicitly advance a reconciliation page using
  `POST /api/admin/asset-gc?dryRun=1&discover=1`.

## Limits, storage and recovery

- D1 tables: `asset_gc_candidates` (path, first-unreferenced time,
  last-seen time, optional size), `asset_gc_runs` (audit), and
  `asset_gc_state` (KV cursor and exclusive run lease).
- `ASSET_GC_MAX_DELETES` defaults to 500 and caps eligible paths considered.
  On Workers Free, the physical deletion budget is **10 KV keys per
  invocation**, leaving headroom for D1 and per-site Durable Object checks.
- A failed KV delete stops the run and logs the count of completed deletions.
  Deleting a missing KV key again is idempotent.
- The `bytes` metadata is written for new uploads and recovered during
  weekly reconciliation. Older keys may have no known size, so byte totals
  are lower bounds.
- A deleted site's D1 record is removed and its old Durable Object is
  sealed. Node.js and Docker retain their immediate-delete behavior.

## Configuration and administration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSET_GC_ENABLED` | `false` | Set to `true` to permit physical deletes; default is dry-run |
| `ASSET_GC_GRACE_DAYS` | `7` | Time from last explicit removal or first orphan discovery |
| `ASSET_GC_MAX_DELETES` | `500` | Selection cap; maximum 10 KV deletes per execution |
| `ASSET_GC_ADMIN_EMAILS` | unset | Comma-separated Google email allowlist for the manual API |

The admin endpoint requires Google sign-in plus an explicit admin email;
ordinary `ALLOWED_EMAILS` grants no administrative privileges.

- `POST /api/admin/asset-gc?dryRun=1`: inspect expired candidates and
  report potential deletion without changing KV bytes.
- `POST /api/admin/asset-gc?dryRun=0`: physically delete eligible
  candidates, only when `ASSET_GC_ENABLED=true`.
- Add `&discover=1` to run **one** weekly-style reconciliation page
  along with the requested candidate sweep.

**First deployment:** leave deletion disabled and inspect candidate reports.
Enable the flag only after reviewing live references and accepting the
seven-day retention policy. Preexisting orphans discovered during weekly
reconciliation start their grace period when first observed; merging this
code does not trigger immediate mass deletion.
