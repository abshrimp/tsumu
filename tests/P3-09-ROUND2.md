# P3-09 — round 2, investigation 1 (architecture)

## Baseline and overlap

- Worktree and local `origin/main`: `d6f17ae54ae41aafb80ba5a969cbac35b73447f2`.
- GitHub main initially advanced to `ced4645fdf248c00a1617b1fcf794e0a90ca7d20`, then to `9cdd51dfe571a84b07e42b7762f85e28b0b00df1` during investigation. The finding is present in all three revisions; `lib/generator.ts` was unchanged between them.
- Fetch cannot update the shared Git directory in this sandbox; shell GitHub access also fails DNS resolution. Read-only GitHub connector reads supplied the intervening patches. A temporary snapshot was reconstructed from `git archive HEAD`, and all 25 intervening changed files were verified against GitHub blob hashes before testing. Merged changes are **not** included in this worktree diff.
- Reviewed open PR file lists #133–#137 and neighboring audit branches. #132 already fixes original CSS bytes in editable ZIPs; #133 covers document request bounds and large ZIP counts (merged during this audit). Neither is reimplemented here. The other reviewed PRs cover export preview robots, script keyboard scope, save recovery, and publication rollback.
- No repository `tasks.json` or applicable `AGENTS.md` was found. This investigation follows the supplied P3-09 assignment; it does not create another execution queue.
- This is an investigated source baseline, not an assertion that all PRs have merged or release CI has passed.

## Entry points, contracts, and data flow

| Entry / producer | Consumer / transition | Invariant |
| --- | --- | --- |
| `SitePanel.exportDocJson` | `serializePortableDoc` → raw JSON or gzip/Base64 envelope | UTF-8 JSON preserves schema, IDs, properties and embedded data URLs without mutating the document. |
| `SitePanel.importDocJson` | `parseSiteImport` → pending confirmation → store `restoreDoc` | Parse/validate before replacing state; undo retains the previous document. This path does not relocate uploaded files. |
| Home import / `createSiteFromFile` | editable ZIP or document parsing → `restoreImportAssets` → server/local initial save | Preserve node/asset IDs; replace storage locations, rebind actual URL fields, sanitize inline SVG; warn on unavailable bytes. |
| Header export | `exportProjectZip` → `prepareExportScopeDoc` → `prepareExportProject` | Partial exports prune unrelated data; whole-project editable metadata stays separate from generated website files. |
| `generateProject` | `files`, Base64 `binaries`, and `remoteAssets` maps → framework conversion → ZIP / publication | Base64 must represent the original asset bytes. ZIP-relative aliases must contain the same original bytes. |
| Editable ZIP | `_tsumu/doc.json` plus `_tsumu/assets.json` → validated archive entries | Explicit ID-to-file mapping must agree with the document; import must recover those bytes, independently of generated filenames. |
| `restoreImportAssets` | native `fetch(dataURL)` or archived bytes → `uploadStaticAsset` → URL rebinding | The generator must decode embedded URLs with the same byte semantics as restoration. |

Read-only tracing also covered generator CSS rewriting, imported JS dependency retention, ZIP CSS metadata, scoped asset discovery, SVG sanitization, store restoration, structural validation, README limitations, and existing import/export/runtime tests.

## Hypotheses and evidence

1. **ZIP CSS exports restore rewritten rather than original bytes:** already fixed by #132. Its 16 regression cases passed in the current-main snapshot; no duplicate fix.
2. **Large editable archives exceed import count limits:** owned by #133, now merged. Its large-import tests pass in the latest focused run; limits were not changed here.
3. **Portable JSON loses nested document data:** existing plain/compact tests passed; the new 4,000-node/160-script case also preserves the complete JSON representation. No serializer change warranted.
4. **Embedded binary decoding disagrees between import and export:** reproduced, fixed below.

## New finding: P2 — embedded asset bytes are corrupted or cannot be exported

**Target:** `lib/generator.ts`, both normal asset emission and original ZIP-relative aliases.

**Reproduction:** create an otherwise valid document containing an asset with `dataUrl: "data:application/octet-stream,%00%80%ff"`, serialize/import it, then export any of the six ZIP frameworks. Validation accepts the document and native data URL fetching returns bytes `[0, 128, 255]`, but export throws `URIError: URI malformed`. With percent-escaped Base64 (for example `%2F` / `%3D`), generated Base64 does not represent the source bytes. Uppercase data schemes are silently omitted; URL fragments are incorrectly included in file content or Base64 decoding.

**Root cause:** two generator branches independently treated non-Base64 payloads as UTF-8 text via `decodeURIComponent`, passed encoded Base64 through without URL decoding, and matched data URLs case-sensitively without excluding fragments. The importer uses byte-oriented native fetching, so accepted/restored data and exported data disagreed.

**Minimal fix:** share a synchronous byte decoder for these two branches. Parse the URL, remove its fragment, percent-decode UTF-8-encoded URL bytes, then apply Base64 decoding when indicated by the MIME header. Chunk conversion avoids argument-stack limits. No network calls, new dependencies, saved-format changes, schemaVersion changes, migrations, or ID changes.

**Regression coverage:** `asset-byte-roundtrip.test.mts` checks ten encodings across Next.js, React, Vue, Nuxt, SvelteKit and HTML, including all 256 byte values, encoded Base64, uppercase markers, literal percent signs, Unicode, fragments, empty content, and a payload crossing the chunk boundary. It compares both generated file locations to native fetch bytes. A 4,000-node forest with depth 16 and 160 scripts then traverses compact JSON → editable HTML ZIP → parse → upload restoration → second ZIP, checking the full original document, node/page/asset identities, ZIP provenance, original/second-export bytes, and source immutability.

**Acceptance:** all byte comparisons and complete round trips pass; unchanged existing import/export tests pass; no format or identity changes. The original 49-case regression ran before the fix: **43 failed / 6 passed** on both the local baseline and reconstructed current main. After the fix all 49 passed; final coverage was expanded to **61 passing cases**.

## Validation

The environment has no local dependency installation. A temporary symlink uses `/Users/riku/tsumu/node_modules`; its source lockfile differs from this checkout. `npm ci` could not be established with the unavailable shell network. Node 22.22.2 was used explicitly for the final focused and baseline-comparison runs, below the project's required Node 26.12.1. Initial temporary-directory runs used the host Node 23.10.0. Results are not a substitute for pinned CI.

| Command / check | Result |
| --- | --- |
| `node --import tsx --test tests/asset-byte-roundtrip.test.mts` | Before fix: 43/49 fail. After fix: 49/49 pass, then expanded suite 61/61 pass. |
| `node --import tsx --test tests/asset-byte-roundtrip.test.mts tests/portable-doc.test.mts tests/export-editable-zip.test.mts tests/export-css-roundtrip.test.mts tests/site-import.test.mts tests/site-import-large.test.mts tests/export-formats.test.mts tests/more-export-formats.test.mts tests/imported-asset-paths.test.mts tests/export-embedded-asset-parity.test.mts tests/import-doc-shapes.test.mts` | **188/188 pass**, reconstructed `9cdd51d` plus this fix, with explicit Node 22.22.2; also passed under host Node 23.10.0. |
| `npm run typecheck` | Pass in worktree and reconstructed current-main snapshot. |
| `npm run i18n:check` | Pass in reconstructed snapshot; no translation strings changed. |
| `npm test` | Worktree run after initial 49-case addition: 3,174 tests, 2,817 pass, 356 fail, 1 skip. Unmodified `d6f17ae` with the same explicit Node 22.22.2 and shared dependencies: 3,125 tests, 2,768 pass, 356 fail, 1 skip. **The failing test-name sets are identical; no new full-suite failures.** These are reproducible baseline/environment failures, not fixed by this task. Full-suite success is **not** claimed. |
| `npm run build` | Environment failure: Turbopack cannot resolve `next/package.json` because the dependency symlink points outside the temporary project root. |
| `git diff --check` | Pass. |

Temporary detailed logs are `/private/tmp/tsumu-p309-{red-current,green-final,focused-node22,full-test,baseline-node22,typecheck-latest,build}.log`.

Not run: pinned `npm ci`, Worker build, browser E2E, generated-framework build/install matrix, Docker, staging, audit/deployment checks, or real upload-server integration. Asset uploads in the regression are mocked while real archive generation/parsing and native data URL fetching are exercised.

## Unsupported or deliberately non-lossless combinations

- Single HTML is a website artifact, not an editable ZIP: no `_tsumu` metadata round trip is promised. Its shared generator is affected by the decoder fix, but a standalone-HTML-to-SiteDoc identity round trip is not tested or claimed.
- A standalone `doc.json` with only server asset paths cannot transport bytes to another installation. New-site import warns and clears unavailable paths; same-installation editor backup restoration has different semantics.
- HTML/Web ZIP conversion is not a structural SiteDoc round trip. Original source conversion and inline SVG sanitization may change representation by design.
- Page/component exports intentionally omit unrelated pages, nodes and assets. Full-document equality only applies to whole-project editable exports.
- Static formats retain their existing restrictions on dynamic routes, redirects/proxies and raw HTML; custom scripts and style modes have documented framework-specific restrictions. No limitation was relaxed.
- Unavailable remote files, oversized assets/archives, and malformed Base64 cannot promise lossless recovery. Existing size bounds, missing-asset warnings and failure behavior remain in force. Latest main's count-limit change belongs to #133.
