# P1-01 — Round 2, investigation 2: adversarial architecture audit

Recorded 2026-11-10. This investigation supplements `ARCHITECTURE-R2.md`; it
does not re-submit the earlier clone-condition or breakpoint-label fixes.

## Baseline and overlap

- HEAD, local `origin/main`, and GitHub's live `main` all resolved to
  `fb5bd0477d1eb7a58658ed55fff63260470075b9` at investigation start.
  Shell `git ls-remote` failed DNS resolution; the connected GitHub commit API
  independently confirmed the SHA. No fetch or Git metadata mutation was needed.
- During verification main advanced to `8c297ca1b60099f223a577c29fc8181080090fb8`
  (merging #138). GitHub compare reports only `lib/api-json.ts` and
  `tests/api-json-lifecycle.test.mts` changed. Neither is in the export pool's
  82-module runtime dependency closure. The defect and fix apply unchanged; broad checks below
  ran on the initial checkout plus the fix, not on a checkout of the later SHA.
- No applicable `AGENTS.md` or `tasks.json` was found. Work follows the supplied
  P1-01 assignment; no replacement execution queue was created.
- Open PRs #138/#143 concern request JSON stream handling; #139 DialogHost;
  #140 AiChat; #141 Canvas; #142 generator asset bytes. Their filenames and
  read-only statuses of existing worktrees showed no competing `mapLimit` fix.
  #92 and the previous P1-01 fix (#129) are already in this baseline.
  Later open PRs #146 (publish preferences) and #147 (autosave conflict recovery)
  were also checked and do not touch the pool or its regression tests.
- This is an investigation baseline, not an approved release baseline: open
  reviews remain, and successful main CI was not established here.

## Refreshed inventory and contracts

An AST pass over `lib/`, `components/`, and `app/` found **276 modules**, **1,107
local runtime import/re-export/literal dynamic-import edges**, and **no strongly
connected runtime module groups**. Type-only edges were excluded. Computed
imports, root entry points, and external package internals are outside that
cycle result. The three apparent unused scoped modules still have real root
callers: `auth.ts` → `auth-policy`, `middleware.ts` → `csrf`, and
`document-room.ts` → `structured-document-store`. No safe removal was found.

Large executable hotspots remain `script-runtime.ts` (2,052 lines), `store.ts`
(2,023), `controls.tsx` (1,875), `data.ts` (1,597), and `Editor.tsx` (1,340).
Size alone was not treated as a defect or a reason to refactor. All direct
production dependencies have source consumers, including the dynamically loaded
TypeScript 6 compiler for JavaScript export. Tooling/generated projects must be
considered before removing dev dependencies. This is not an advisory audit.

| Entry / producer | Shared contract and consumers | Adversarial check |
| --- | --- | --- |
| `Header` export dialog | Sets `busy` while awaiting `exportProjectZip`, then clears it in `finally`; retry becomes possible when that promise settles. | A failed batch stops queued work and aborts active downloads before reporting the error. |
| `exportProjectZip` → generator → JSZip | Generates the document snapshot and framework files, queues remote assets, adds fetched bytes, then downloads the archive. Missing (404) assets are tolerated; other HTTP failures abort export. | Real export with 12 remote assets, one 403, five delayed requests, and a successful retry. |
| `assets.mapLimit` | Runs at most six callbacks and stops queued work after a failure. Export owns cancellation of its active network requests. | Async/sync failure, stalled siblings, later rejection, falsy thrown values, empty input, limits 1/3/20, independent retry. |
| `detectSvgFilters` → `PublishModal.docWithSvgFilters` → Header/publish | Per-asset failures are caught inside the callback and leave metadata unresolved for later attempts. | Existing signed-asset/download tests; callback continues to absorb its own failures. |
| `withImportUploads` → site/HTML/ZIP import | Cleanup de-duplicates paths; each DELETE catches transport rejection so cleanup continues. | Existing rollback tests. No upload or live deletion was performed. |
| API/DO → `getDbFromBinding` | A WeakMap shares initialization per binding and removes rejected promises. | Two concurrent calls share one failed initialization, then two retries share one successful initialization. |
| Home/editor bootstrap → `loadLocale` | Client dictionary initialization shares work and clears its cached promise on failure. | Injected dictionary-loader rejection followed by concurrent retry and translated output. |

## Confirmed issue: P2, failed export leaves its download pool running

**Reproduction:** export a document with 12 remote assets. Hold five of the first
six responses, and return HTTP 403 for the other. The original pool rejects the
export promise immediately. Release the five delayed responses: those workers
continue requesting the six queued assets. All **12 requests** occur even though
the export has already failed. Header's `finally` resets `busy`, allowing another
export to overlap the abandoned pool. Repeated failures can defeat the intended
six-download concurrency bound, wasting requests and retaining ZIP state/bytes.

**Cause:** `Promise.all` rejects early, but does not stop other workers. Each
worker's loop only checked the queue length. No shared failure state or cancellation
boundary existed. This behavior was reproduced through the real export pipeline,
not inferred solely from a unit test of the helper.

**Fix:** keep the first rejection (including `undefined`, `null`, or `0`), stop
taking new queue entries after observing it, and report it promptly. Generic
callbacks cannot be forcibly stopped, so `mapLimit` never waits for unrelated
callbacks to settle after a failure. `exportProjectZip` owns an AbortController
and aborts active fetches and response-body reads before reporting the original
error. `fetchWithRetry` honors cancellation before issuing another request and
while waiting between attempts. Cleanup does not await a cloned response's other
reader. Failure state and cancellation are local to each export.

Independent review reproduced a regression in the initial drain-only version:
one HTTP 403 plus a stalled sibling fetch or body suppressed the export error
indefinitely. The cancellation change corrects that behavior. It does not add a
deadline to otherwise healthy exports or change authentication policy. Success
concurrency, callback arguments, asset bytes, the 404 path, SiteDoc structure,
schemaVersion, existing IDs, and import rollback ownership are unchanged.

**Acceptance:** ten tests in `asset-pool-failure.test.mts` cover prompt failure,
first-error identity, synchronous failure, empty/successful pools, actual stalled
fetch/body cancellation, abort during retry backoff, and a fresh successful
export whose asset bytes and source doc are verified. Against the initial PR
head: **4 failed / 6 passed**. After the review correction: **10 passed**.
The failed export starts only the initial six requests, aborts its five active
siblings, and creates no download.

## Other hypotheses

- **Rejected: database initialization becomes permanently poisoned after a
  transient error.** The two-caller failure/retry probe passed; cache eviction
  and single-flight behavior are already correct.
- **Rejected: concurrent client locale loading cannot recover from a failed
  chunk loader.** The injected-loader failure/retry probe passed. This tests
  application promise ownership, not browser/CDN cache behavior.
- **Not established: runtime import cycles or removable production dependency.**
  Static graph and root consumers above did not support a change.
- Invalid concurrency limits are not reachable from the three production
  callers, all of which pass the constant six. No new input policy was added.
- PublishModal has a separate uploader implementation and failure flag. It was
  read for comparison but was not changed or claimed fixed by this work.

## Initial investigation verification

The independent cancellation correction was subsequently verified on Node
26.12.1: the six-file focused command below passed **48 tests**, TypeScript
passed, and `git diff --check` passed. The four new failure cases were reproduced
against the initial PR head before applying the correction. Full CI on the
integrated head remains required. The remaining results in this section record
the initial investigation, before that correction.

Commands use Node **26.12.1**, npm **12.2.1**:

```sh
export PATH=/Users/riku/.nvm/versions/node/v26.12.1/bin:$PATH
node --import tsx --test tests/asset-pool-failure.test.mts
node --import tsx --test tests/asset-pool-failure.test.mts tests/export-editable-zip.test.mts tests/export-css-roundtrip.test.mts tests/asset-download.test.mts tests/audit-j-signed-assets.test.mts tests/import-rollback.test.mts
node --import tsx --test /tmp/tsumu-r2-adversarial-p101/hypotheses.mts
npm run typecheck
npm run i18n:check
npm test
npm run build
git diff --check
```

- New regression: original source **3 failed, 5 passed**; fixed source **8 passed**.
- Focused suite: **46 passed**, exit 0. Scratch failure/retry probes: **2 passed**.
- Typecheck and i18n: **passed**, exit 0. Diff whitespace check: passed.
- Production build: **passed**, exit 0, including TypeScript and static page
  generation. Existing middleware-to-proxy deprecation warning remains.
- Full suite: **3,222 passed, 1 failed, 1 skipped** (3,224 total), exit 1.
  Failure: `export-recursive-ssr.test.mts`, generated Vue HTTP server test,
  receives `listen EPERM 127.0.0.1` before request assertions. This is the same
  sandbox limitation recorded in the previous architecture investigation, not
  a failure in the pool regression. It was not suppressed or changed.
  Skip: existing opt-in Docker COPY context regression (`TSUMU_DOCKER_TESTS=1`).
- Tests used a private copy of the existing installation. All **350** entries
  in its installed lock manifest matched the repository lockfile's version and
  integrity; no extra entries were present. This is not a successful clean
  `npm ci`, and does not verify package payloads or security advisories.
- No Worker build, browser E2E, Docker smoke, generated-format build matrix,
  `npm audit`, live service operation, or performance benchmark was run here.
  These remain separate release gates. The ZIP regression mocks fetch and the
  download anchor while executing the real generator/archive pipeline.
- Logs and scratch probes: `/tmp/tsumu-r2-adversarial-p101/`. No commit, push,
  PR, merge, deployment, CI change, auth change, or migration was performed.
