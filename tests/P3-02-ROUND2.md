# P3-02 — round 2, architecture investigation

Date: 2026-11-10. Task priority: P1. Findings below use their individual severity.

## Baseline and overlap check

- HEAD, local `origin/main`, and GitHub's `main` commit endpoint agreed on
  `4007d46ffce88da4a4c9e8527454adaf65be0373`.
- Open PRs at investigation start: #125–#128, covering query variants, React
  runtime typing, and publish rollback. No competing editable-ZIP fix found.
- Reviewed merged import changes #103 and #115 and neighboring asset-copy
  changes #121/#122. Their fixes are not repeated here.
- `tasks.json` and applicable `AGENTS.md` were not present in this worktree.
  The supervisor's P3-02 assignment supplied the execution scope.
- This is an investigation baseline, not release approval: PRs remain open,
  and the combined-status connector returned no statuses for this SHA.

## Entry points and contracts traced

| Entry/consumer | Flow and invariant |
| --- | --- |
| Home picker/drop | `Home` → `createSiteFromFile` → editable-ZIP detection → `parseSiteImport`/`restoreImportAssets` or `convertHtmlFile`. Prepare and validate before creating the destination. |
| Editable ZIP/doc.json | `site-import.ts` validates the document, manifest and archive; restoration keeps asset IDs and replaces locations; `rebindImportedAssetUrls` updates stored markup/styles. |
| Website ZIP | `html-zip.ts` preflights files, uploads originals, records `asset.zip` path/CSS dependencies, and rewrites HTML. `html-file-import.ts` converts pages and internal links. |
| Page/settings import | `PagePanel` uses pending-operation guards and retains uploads when application is cancelled. `SitePanel` parses backups then restores through undo-aware store state. |
| Export | `Header` → `exportProjectZip` → export scope/asset closure → framework generator. `_tsumu/assets.json` must identify bytes suitable for restoring the original asset. |
| CSS/runtime | `zip-css.ts` retains original source/dependency metadata. `generator.ts` rewrites website CSS to flat generated names and separately emits original-path aliases for ZIP groups containing JavaScript. |
| Clone/delete | `Home` and `/api/sites` copy document references; local list mutations use a shared lock and deletion markers. `/api/assets` protects other-site references; Workers deliberately retain immutable KV objects. |

## Fixed: P2 — editable ZIP restores transformed CSS as original bytes

Reproducer: use an imported ZIP with `js/main.js` loading
`../css/main.css` via `new URL(..., import.meta.url)`. The stylesheet imports
`nested/theme.css` and references `../fonts/demo.woff2`. Export a Tsumu ZIP,
import it, then export again.

Previously, the editable manifest selected the flattened website stylesheet.
That file contained generated names such as `css-nested-theme.css`, while the
restored asset retained `zip.path = css/main.css` and its original dependency
metadata. On the second export, the script-relative alias contained those
flattened references, which resolve to nonexistent siblings. Original bytes,
including a UTF-8 BOM, were also lost.

`export-css-roundtrip.test.mts` reproduced the byte mismatch in all six ZIP
formats, with both embedded and uploaded assets: **12/12 failed on main before
the production edit**. The fixture uses custom markup only in formats that
support it; native-framework cases validate archived assets and aliases.

Fix: point the existing version-1 manifest to an original alias when one already
exists; otherwise preserve CSS under `_tsumu/assets/`. Keep generated website
CSS unchanged. Validate added paths with existing collision checks. Keep 404
warnings and fail the download on other asset-read errors. No SiteDoc fields,
IDs, schemaVersion, migration code, or persistence APIs change.

Acceptance checks cover exact bytes, BOM, nested CSS/font suffixes, generated
website URLs, actual restoration/upload/re-export, original script aliases,
source-document immutability, CSS-only archives, percent-encoded data URLs,
metadata-only CSS, missing files, and denied reads.

## Reported for coordination: P2 — body stylesheet links disappear

Input: `<html><head><title>Body stylesheet</title></head><body><p>Before</p>`
`<link rel="stylesheet" href="https://example.test/theme.css"><p>After</p></body></html>`.

Ran `convertHtmlToSite` using the parse5 DOM adapter already present in
`html-import-code-boundaries.test.mts`. Observed:
`JSON.stringify(doc).includes("theme.css") === false`; the result had only
the two paragraph roots and no retained stylesheet markup.

Cause: head handling retains stylesheet links; body collection handles only
`style` elements, and the general converter discards `link` via `SKIP_TAGS`.
The same applies to packaged CSS links after URL rewriting.

No competing implementation was made: the active
`agent/r2-xss-import-18dd657b9ee7` worktree was modifying this exact stylesheet
collection/class-retention area. Coordinate there before changing it. Required
regression: body-local and external stylesheet links survive conversion in DOM
order, with media conditions, correct asset closure, and no promotion from
inert contexts; confirm exported computed styles in a browser.

## Other hypotheses and limits

- Interrupted imports/stale completions: existing lifecycle tests exercise
  undo, replacement, deletion, unmount, gestures and superseding requests.
  No new failure found in the executed focused tests.
- ZIP ambiguity and failed uploads: existing path/corruption/preflight and
  rollback tests were inspected and exercised; no competing fix made.
- Shared dependency deletion: CSS closure and copied-script dependencies are
  already covered by merged fixes and passing tests.
- Literal zero-orphan acceptance is not established: Workers asset deletion
  intentionally defers physical reclamation to a separate fenced GC process
  (`docs/durable-object-storage.md`). This audit does not redesign storage.

## Verification

Used Node 26.12.1/npm 12.2.1 for verification. An initial offline `npm ci` using
the shell's default Node 22 failed with `ENOTCACHED` for
`@typescript/typescript6`; Git CLI networking also failed DNS resolution.
Tests used the existing dependency installation from the same-baseline
`r2-test-baseline` worktree through a temporary symlink, removed at completion.

- Red: `node --import tsx --test tests/export-css-roundtrip.test.mts` against
  main's `exportZip.ts`: all 12 original round-trip cases failed on changed CSS
  bytes. Log: `/private/tmp/tsumu-r2-p3-02-red.log`.
- Final focused command: `node --import tsx --test tests/export-css-roundtrip.test.mts tests/export-editable-zip.test.mts tests/site-import.test.mts tests/zip-css.test.mts tests/imported-asset-*.test.mts tests/html-import-media-urls.test.mts tests/html-import-lifecycle.test.mts tests/backup-import-lifecycle.test.mts tests/import-zip-canonical-paths.test.mts tests/audit-j-zip-css.test.mts tests/export-audit-f.test.mts`: **142 passed**.
- `npm run typecheck`: passed. `npm run i18n:check`: passed.
- `npm run build`: environment failure; Turbopack rejects dependencies outside
  the workspace root through the temporary symlink.
- `npm test`: **3,112 passed, 1 failed, 1 skipped**. The only failure is the
  existing `export-recursive-ssr.test.mts` HTTP-listener case: `listen EPERM`
  for `127.0.0.1`, before request assertions. The same restriction is documented
  in `tests/BASELINE.md`; no test was skipped or weakened for this audit.
  Log: `/private/tmp/tsumu-r2-p3-02-all-tests-final.log`.
- `npm run build -- --webpack`: passed (production compilation, TypeScript,
  page generation). Existing middleware deprecation and jose Edge Runtime
  warnings remain. Final log: `/private/tmp/tsumu-r2-p3-02-webpack-build-final.log`.
- `git diff --check`: passed.
- Not executed: browser E2E, Workers build/runtime, Docker smoke, remote CI,
  dependency audits, actual generated-framework installations/builds, or live
  storage operations. No commits, pushes, PRs or deployments were made.
