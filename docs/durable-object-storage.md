# Tsumu: Cloudflare editing-data storage

## Storage model

Cloudflare persists each site's editor data in a separate SQLite-backed Durable Object (`DocumentRoom`). The HTTP API and WebSocket protocol continue to exchange ordinary `SiteDoc` JSON.

| Store | Responsibility |
|---|---|
| D1 `sites` | Site listing, deployment destinations and timestamps |
| D1 `site_document_rooms` | Public site ID to random, per-creation `room_key`, and `saved_at` |
| D1 `document_room_cleanup` | Pending deletion of retired document rooms |
| `DocumentRoom` SQLite `document_meta` | Single `rev`, timestamp and top-level properties |
| `DocumentRoom` SQLite `document_entries` | One JSON row per page, node, asset or component |
| `DocumentRoom` SQLite backup tables | Seven rotating UTC weekday snapshots in small text chunks |
| `CollaborationRoom` | WebSocket clients isolated by site creation key |
| Workers KV | Uploaded file bytes; shared across sites |

Node.js and Docker store the equivalent SiteDoc in their own local SQLite `docs` table, without gzip. In the absence of server storage, browser-only local persistence is unchanged.

## Writes and consistency

- A normal node edit validates that node, checks its existing tree edges and referenced asset IDs, and writes only that node's row plus the site revision.
- A page tree, component graph, deletion or other structural edit reconstructs and validates the complete SiteDoc before writing the changed rows.
- The SQLite `transactionSync()` callback executes revision checks, backup capture and all affected row writes atomically.
- A full PUT recreates rows only for an initial import or a client-requested full snapshot.
- On the first successful edit after the UTC day boundary, the previous document is saved into one of seven rotating backup slots, split into at most 250,001 UTF-16 code units per row without splitting surrogate pairs.
- `GET /api/doc/backups` exposes the daily backup list and a selected day's JSON. The same Durable Object supports Cloudflare's point-in-time recovery facilities independently.

## Site identity and deletion

A `room_key` is generated on each site creation and stored with the site metadata in a D1 transaction. It is **not** the public site ID. Both document storage and collaboration rooms are addressed by this generation-specific key.

Deletion removes the D1 site and its exact generation map in a transaction, enqueues the retired room key, and seals the Durable Object. Sealing is permanent for that room and rejects delayed writes, so deleting and later recreating a site with the same public ID never reconnects to the old document.

The D1 deletion and DO sealing are not a distributed transaction. A failed cleanup stays in `document_room_cleanup` and is retried on later site listing requests. The storage key is not reused, even before cleanup succeeds. After an awaited DO write, the D1 metadata update is fenced by the same key so a deleted or replaced generation is not acknowledged as a successful save.

## Files and garbage collection

A file path may be referenced by more than one site's editor document, including newly imported or copied documents. Removing a reference from one site therefore does **not** immediately remove the Workers KV object. In particular, Cloudflare's asset DELETE endpoint returns `kept: true` and does not issue `KV.delete()`: a reference scan and a delete across DO and KV cannot be one atomic transaction. This intentionally favors avoiding permanent data loss over immediate storage reclamation.

The non-destructive inventory is implemented in `lib/asset-gc.ts` with a daily Cron and an administrator-only dry-run endpoint. It tracks possible orphan candidates without deleting KV objects. **Cloudflare asset storage usage will not automatically shrink as documents remove assets.** Automatic physical deletion remains disabled until restorable GitHub history and concurrent document writes can be fenced safely. See [asset GC operations and safety requirements](asset-gc.md). The local-Node deletion path continues to check other-site references and may remove unused files.

## Deployment

1. Configure the `DB` (D1), `ASSETS_KV` (Workers KV), `COLLAB_ROOM` and `DOC_STORE` bindings. `DOC_STORE` must point to the SQLite-backed `DocumentRoom` class declared in `exports` alongside `CollaborationRoom`. Keep both class names and `storage: "sqlite"` unchanged to reuse the already provisioned namespaces and their data. Keep the same bindings in any separately maintained `wrangler.local.jsonc`.
2. Deploy the Worker and confirm that the configured D1 database and KV namespace are the intended production resources. Workers Builds can supply their IDs through `D1_DATABASE_ID` and `KV_NAMESPACE_ID` and the selected Worker name through `WRANGLER_CI_OVERRIDE_NAME`. The generated deployment config uses that Worker name, while local deployments keep the repository default.
3. Verify site creation, opening, duplication, editing, saving, collaboration, deletion, exports and daily backups in a controlled Cloudflare environment.
4. Measure initial load on a large site and p50/p95 patch latency, CPU and row usage before production rollout. Local SQLite tests and a successful Worker build do not establish production latency.

The document room's schema is in `lib/structured-document-store.ts`. Routing is in `lib/site-document-service.ts`, and the RPC facade is in `document-room.ts`.

## Hosted Preview storage

Hosted Worker Previews have a separate `previews` configuration. The helper in `scripts/cloudflare-preview.mjs` defaults its Durable Object bindings to `COLLAB_ROOM` only; it does not copy the top-level `DOC_STORE` binding. This is sufficient for the default browser-only demo, whose D1/KV binding arrays are empty.

A Preview with server storage needs `DB`, `ASSETS_KV`, and an explicit `previews.durable_objects.bindings` list containing both `COLLAB_ROOM` → `CollaborationRoom` and `DOC_STORE` → `DocumentRoom`. The top-level SQLite class exports must remain present. With D1 but no `DOC_STORE`, `lib/site-document-service.ts` throws `DOC_STORE binding is required`; it does not store Cloudflare documents in D1 or fall back to browser persistence.

Use the [complete Preview setup](worker-previews.md#using-test-storage-optional). The hosted Preview helper does not run the production storage-completeness check on the `previews` block, so successful config generation alone does not verify document saving. D1 contains site metadata and room keys, while document content lives in the Preview's DocumentRoom storage; sharing D1/KV IDs between Previews is not a way to share a complete editor store.
