# Audit B — document, persistence and collaboration

Scope: `abshrimp/tsumu`, `lib/types.ts`, `lib/store.ts`, `lib/doc-tree.ts`,
`lib/doc-storage.ts`, `lib/doc-patch.ts`, `lib/merge.ts`,
`lib/cloud-save.ts`, `lib/local-save.ts`, `lib/db.ts`,
`lib/node-storage.ts`, `lib/kv.ts`, `lib/collab*.ts`, document APIs
and persistence / history UI.

Base: `4cd04c23137e11afce7d7c43f0e06a52815de38e` (main after the merged
import and UI PRs). All fixes are under `audit/B-data-sync`, PR #31.

## Verified invariants and checks

| Invariant | Enforcement / evidence |
| --- | --- |
| SiteDoc has a nonempty `pageOrder` referring only to distinct, existing pages | `validSiteDoc`, SQL `pageGuard`, `tests/doc-patch.test.mts` |
| Node IDs match their entries, children exist, have one owner, form an acyclic forest, and stay within 256 levels | `validNodeForest`, SQL `treeGuard`, `tests/merge-structural-limits.test.mts` |
| Component master IDs are distinct, non-nested and existent; component instances resolve; component expansion is acyclic | `validNodeForest`, `tests/data-integrity.test.mts` |
| Node types, semantics, styles, and node/page field shapes are safe for rendering | `validDocNodeShape` / `validDocPageShape` in `lib/doc-tree.ts`, `tests/data-integrity-patch.test.mts` |
| Moving or inserting component instances cannot introduce reference cycles; long component graphs use iterative traversal | `canPlaceComponentNodes` / `componentsReachable`, `tests/component-cycle-placement.test.mts` |
| A page's folder exists; folder IDs are unique | `validSiteDoc`, `tests/data-integrity-patch.test.mts` |
| Asset IDs used by images, media, icons and OGP references exist | `validSiteDoc`, `tests/data-integrity-patch.test.mts` |
| Structural collections cannot use inherited JS object-property IDs | `safeCollectionId`, `tests/data-integrity.test.mts` |
| A rejected full snapshot or patch does not advance the saved revision | `app/api/doc/route.ts`, `saveDocPatch`, `tests/doc-patch.test.mts` |
| Component, folder and asset structural patches are checked against their optimistic-lock base | `saveDocPatch`; it still uses `UPDATE ... WHERE rev = ?` |
| Concurrently changed / deleted documents are not blindly recreated | `saveCurrentDoc`, `tests/node-storage.test.mts`, `tests/collab-security.test.mts` |
| A stale tab cannot silently overwrite a browser snapshot that changed since load | `persistDoc`, `tests/deleted-local-site-autosave.test.mts` |
| Corrupt browser JSON stays available for recovery rather than being overwritten by a blank initial document | `loadDoc` / `persistDoc`, same test |
| Three-way merge distinguishes missing values from explicit null and preserves safe object ownership | `mergeDocs`, `tests/merge-nullish.test.mts` |

For component-sensitive patches, the server reads and validates the exact
`base` snapshot before writing. The subsequent conditional UPDATE remains the
serialization point, so a concurrent write after preflight fails as a revision
conflict. Ordinary leaf/style patches continue using the database-side fast
path. The SQL tree and page guards are retained for the other structural paths.

## Persistence state transitions

### Cloud (D1/SQLite)

```text
checking --snapshot--> synced
checking --missing--> initial CAS create --success--> synced
checking --unavailable--> local/error or explicit conflict

synced --edit--> saving (debounce / dirty flag)
saving --CAS success--> synced, revision advances
saving --409--> merge(base, local, remote) --> saving
saving --network/server error--> error, dirty remains, retry
saving --missing site--> error, never recreate deleted site
saving --new edits while in flight--> queued save using acknowledged revision
```

### Browser-only cache

```text
open --valid snapshot--> editable with per-tab raw baseline
open --invalid snapshot--> editable scratch document, writes BLOCKED
edit --> pending --same baseline & write succeeds--> saved
edit --> pending --quota/security failure--> error, in-memory edits preserved
edit --> pending --different raw in another tab--> error, newer stored bytes preserved
edit --> pending --site deletion marker--> deleted, never recreated
```

A local conflict deliberately blocks saving rather than silently choosing one
tab's edits. Browser storage has no native atomic compare-and-swap: the
read/write race between two truly simultaneous tab saves remains a residual
risk, and users must resolve a detected stale-tab error rather than assume
automatic local collaborative editing.

## Reproductions / regression paths

| ID | Before | Expected after |
| --- | --- | --- |
| AUD-B-001 (high) | Save a page component that references itself or two masters that reference one another; expansion can recurse | Reject full snapshot and matching PATCH, keep prior revision |
| AUD-B-002 (medium) | Use `__proto__` / inherited keys as structural IDs | Reject instead of letting map operations misinterpret the ID |
| AUD-B-003 (high) | Apply a node/definition PATCH that creates an invalid component graph even though the normal child tree is acyclic | Reject before the optimistic update; ordinary leaf changes retain fast path |
| AUD-B-004 (medium) | Concurrently add explicit `null` and edit a sibling field | Preserve both; similarly preserve an intentional removal of an existing `null` |
| AUD-B-005 (high) | Tab B loads an old snapshot, Tab A saves a new snapshot, then Tab B autosaves | Refuse B's stale write and keep B's in-memory draft |
| AUD-B-006 (high) | Open malformed browser JSON; initial doc fallback autosaves | Preserve the original malformed bytes instead of replacing them |
| AUD-B-007 (medium) | Remove a page folder while leaving a page assigned to it | Reject until the page assignment is also updated |
| AUD-B-008 (medium) | Remove an asset that remains referenced by nodes/site/page metadata | Reject until references are cleared in the same revision |
| AUD-J-015 (medium, resolved by B) | Persist `styles: null`, an unknown node kind, or a page with malformed required fields | Reject both full snapshots and individual node/page PATCHes; do not advance revision |
| AUD-B-009 (high) | Move or insert an A instance inside B's master when A already depends on B | Leave document and Undo/Redo history unchanged, while permitting legal placements |

## Persistence and history test inventory

- `tests/doc-patch.test.mts`: optimistic revisions, SQL patch limits,
  multi-operation writes, old revision conflicts, invalid forests, seven-day
  backup slots, large stored docs.
- `tests/data-integrity-patch.test.mts`: component cycles, missing refs,
  invalid node/page type and style shapes, stale base, fast-path writes, folder/asset consistency.
- `tests/component-cycle-placement.test.mts`: legal and cyclic instance placement,
  rejection without history changes, iterative traversal across long component chains.
- `tests/data-integrity.test.mts`: snapshot invariants, forbidden IDs,
  long valid component chains without stack overflow.
- `tests/merge-structural-limits.test.mts`, `tests/merge-deletion.test.mts`,
  `tests/page-folder-merge.test.mts`: concurrent moves, cycle repair,
  deletions and folder ownership.
- `tests/merge-nullish.test.mts`: explicit null versus absent keys,
  arbitrary JSON property names.
- `tests/autosave.test.mts`: inflight revisions, queued writes, offline
  retry, conflicting snapshots.
- `tests/history-conflicts.test.mts`, `tests/history-restore-safety.test.mts`:
  Undo/Redo rebasing and stale restore cancellation.
- `tests/deleted-local-site-autosave.test.mts`:
  deletion marker, write failure, quota, stale tab and corruption recovery.
- `tests/node-storage.test.mts`: Node SQLite transaction rollback and
  local assets, deletion versus stale saves.
- `tests/collab-events.test.mts`, `tests/collab-security.test.mts`:
  collaborative events, authorization and patch safety.
- Existing Playwright cases: `e2e/local-save-status.spec.ts`,
  `e2e/page-folder-collaboration.spec.ts`,
  `e2e/page-folder-merge.spec.ts`,
  `e2e/asset-library-history.spec.ts`.

## Additional limits and residual risks

- A browser-only site has no server-enforced revision token, and the safety
  check is not a cross-tab transaction. An explicit Web Locks based protocol
  and a conflict-resolution UI would be needed for full offline multi-tab
  collaborative editing; silent overwrite is prevented on detected staleness.
- D1/SQLite document writes and KV asset bytes are distinct stores. There is
  no cross-store distributed transaction; failed uploads and deleted asset
  bytes still require the asset-layer's existing compensation and retention
  checks.
- Seven rotating daily backups are best effort and are not a point-in-time,
  externally replicated disaster-recovery system.
- Actual multi-region Cloudflare D1/KV race tests and long-running browser
  fault injection have not been run independently of the existing CI. Do not
  interpret test presence as proof of the absence of data loss.
- Read-only collaboration clients should still resynchronize after missed
  WebSocket/SSE notifications. The normal fallback is version polling.

## Merge gate / validation log

The PR must remain a draft until all checks on its **final head SHA** are
green, an independent reviewer has inspected the patch and the integrator has
confirmed no conflict with other workstreams. Relevant CI: TypeScript,
unit/integration tests, i18n, framework generation, browser shards,
CodeQL, Cloudflare Workers build. The merge and final audit decision belongs
to the integration owner.

## Independent cross-area handoff (J and D)

The independent J audit reported `AUD-J-015`: malformed node/page shapes were accepted by the document save boundary even though the import validator rejected them. This is resolved in B by reusable node/page shape checks; E should align the separate import route once PRs are integrated. The D reviewer flagged component instance moves/inserts, which could compose new cycles without changing a component definition. These paths now reject cyclic placements before an edit is committed.

E/J also flagged `AUD-J-014`: imports can contain absent asset IDs while B's save boundary rejects them. This is **assigned to E**, not fixed by changing B's stricter storage invariant, and remains an integration gate. No assertion is made that all B/E/J cross-route verification has completed until merged main is independently checked.
