# P1-01 — Round 2, investigation 1: architecture

Recorded 2026-11-10. Scope: entry points, dependency graph, state and data
contracts, consumers, and reproducible correctness gaps. No speculative refactor.

## Baseline and overlap

- Initial HEAD and `origin/main`: `4007d46ffce88da4a4c9e8527454adaf65be0373`.
  GitHub's live main matched at investigation start. `git fetch origin main`
  could not write the shared Git metadata outside this worktree's sandbox.
- During verification, GitHub main advanced to
  `d6f17ae54ae41aafb80ba5a969cbac35b73447f2`, merging #125, #126 and #127.
  The GitHub compare API reports 13 changed paths, all in export/query/rollback
  code and its tests. None intersects the new regression's 50-module runtime
  dependency closure, or package manifests. The demonstrated defect and fix
  therefore apply unchanged to that main. Broad checks below ran on the initial
  checkout plus this fix, not a newly checked-out later main.
- #92 is already merged as `d46d8bd`; its previous worktree was clean.
  Initial open PRs #125–128 concerned export query conditions, React export
  typing, and rollback. No competing changes were made. Read-only worktree
  status inspection found no pending clone-helper/condition-target changes.
- No `tasks.json` or applicable `AGENTS.md` was present in the checkout.
  The supervisor's P1-01 assignment defines this investigation. This is not an
  approved release baseline: open reviews remain and main CI approval was not
  established (the combined-status API returned no statuses).

## Architecture inventory

| Entry / producer | Contract and consumers | Test coverage inspected |
| --- | --- | --- |
| `app/page.tsx`, `app/sites/[id]/page.tsx` | Load locale before dynamic Home/Editor imports; site check precedes editor rendering. Store is a client singleton, with page/component selection separate from persisted data. | `site-bootstrap`, `editor-bootstrap`, `request-language` |
| Canvas, panels, ScriptEditor → `lib/store.ts` | Flat `SiteDoc.nodes`, page child IDs and component master roots; edits produce history snapshots. Fast script edits use `withPageScripts` with explicit page/node scope. Clone operations must rewrite internal references while retaining external references. | `editor-fast-node-updates`, `component-clone`, `ai-clone`, new `clone-condition-targets` |
| `lib/types.ts`, `doc-tree.ts`, `document-validation.ts` | Structural validity, finite trees, script shapes, stable document node identities. Valid shape alone cannot detect a syntactically valid target pointing at the wrong element. | `document-schema`, `editor-tree-depth`, `component-cycle-placement` |
| `components/Editor.tsx`, `cloud-save.ts` | Observe edits → debounce → serialize active saves → reconcile revision/conflict → retry. Remote application suppresses an echo save. Local browser document writes compare the expected serialized snapshot in one IndexedDB transaction. | `autosave`, `indexeddb-transactions`, `history-conflicts` |
| `/api/doc`, `site-document-service.ts`, `document-room.ts` | HTTP/WS document operations share revision contracts. Cloudflare routes by site-generation room key and rechecks generation after awaited reads; Node uses local SQLite. Metadata/asset storage is separate. | `document-room-service`, `document-storage-parity`, `site-room-generation` |
| Script editor → `script.ts` → `script-runtime.ts` | A script has a trigger and nested steps. An `if` has a primary condition plus joined conditions. Preview uses the full runtime; exports select runtime features from all conditions. | `script-block-composition`, `script-conditions-shortcircuit`, new runtime regressions |
| AI API → `aiOps.ts` → `ai/client.ts` | Server applies operations to scoped data; client replays them through the same helper after checking its baseline. Deterministic clone IDs must resolve every internal script reference identically. One store update gives one undo operation. | `ai-clone`, `ai-edit-identities`, new nested-condition replay regression |
| Export/publish → `export-formats.ts` → generators | Shared pipeline turns SiteDoc into files. `compileScripts` serializes condition targets; `scriptsFile` prunes runtime features. Neither repairs stale clone targets. Import and clipboard code are neighboring producers. | `export-formats`, `script-data-export`, `clipboard-history` |

An AST inventory of `lib/`, `components/`, and `app/` found **276 modules** and
**1,099 local import/re-export/dynamic-import edges** after excluding type-only
imports. Strongly connected component analysis found **no runtime module cycles
in this scoped graph**. String-literal imports were resolved through relative
paths, `@/`, and index modules; this does not prove the absence of computed-load
or external-package cycles.

The only non-app modules with no incoming scoped edges were `auth-policy.ts`,
`csrf.ts`, and `structured-document-store.ts`. Actual callers are respectively
root `auth.ts`, `middleware.ts`, and `document-room.ts`; they are not dead code.
No unused dependency or safe code removal was established. Dependencies span
React/Zustand, Next/Auth, Cloudflare, Anthropic, parsing/sanitization/ZIP packages,
and the TypeScript compiler used by generated-output transforms. Tooling and
generated source must be considered before declaring a dependency unused.

Largest executable modules at baseline (lines / direct scoped consumers):
`script-runtime.ts` 2,052/6, `store.ts` 2,020/47, `controls.tsx` 1,875/24,
`data.ts` 1,597/28, `Editor.tsx` 1,340/1, `Canvas.tsx` 1,197/1,
`SettingsPanel.tsx` 1,114/1, `ScriptEditor.tsx` 1,053/3.
Locales/manual content is larger but is mostly data. These are investigation
hotspots, not evidence that splitting them would improve correctness.

## Hypotheses and outcome

1. **Confirmed, P2: cloned joined conditions read original elements.**
   `refreshClonedIds` correctly renames copied element ID attributes and the
   first `if.cond.target`, but `mapSteps` omitted `if.conditions[].target`.
   The editor can author these conditions; validation accepts them; compilation
   and both runtimes preserve and use the stale target. This affects store
   duplication, paste, insertion, detachment, and deterministic AI duplication.
2. **Not reproduced: runtime import cycle / unused module.** The scoped graph
   and traced root-level consumers above did not establish either defect.
3. **Not reproduced: duplicate-page script IDs cause cross-page editing.**
   A scratch execution duplicated a page, obtained the copy's `pageNodeIds` and
   `pageScriptsOf`, then changed its script through `updatePageScripts`. The
   copied target changed while the original node remained deeply equal.
   The actual writer is scoped to the supplied page/node IDs.
4. **Rejected: missing media/embed token rewriting implies broken variable
   renames.** Settings use ordinary URL inputs, and Canvas media/embed rendering
   does not interpolate those URLs. No supported variable contract was found;
   adding interpolation would introduce behavior outside this assignment.

### Reproduction and acceptance for the confirmed issue

Create a group containing two checkboxes, a button, and a result element.
Set the button script to: if the first checkbox is checked **and** the second
checkbox is checked, hide the result. Duplicate the group. Check only the two
copied checkboxes, leaving the original second checkbox unchecked. Before the
fix, clicking the copied button does nothing. Checking the original second
checkbox instead can satisfy the copied condition incorrectly.

The minimal fix extends the existing target-rewriting loop to primary and
joined conditions. It preserves external targets, `@self`, grouping flags,
nested branch traversal, original nodes, saved shapes, schemaVersion, and
existing document IDs. No migration or persisted-data repair was added.

Acceptance is covered by seven tests in `clone-condition-targets.test.mts`:
four store paths with validation and undo/redo, AI nested branches with exact
server/client replay, and actual full/feature-pruned runtime execution with
opposite checkbox states in the original and copy. Only DOM plumbing is faked;
conditions and actions execute the real runtime. These are not browser E2E tests.

## Verification

All completed checks used Node **26.12.1** and npm **12.2.1**:

```sh
export PATH=/Users/riku/.nvm/versions/node/v26.12.1/bin:$PATH
node --import tsx --test tests/clone-condition-targets.test.mts
node --import tsx --test tests/clone-condition-targets.test.mts tests/component-clone.test.mts tests/instance-clone-anchors.test.mts tests/ai-clone.test.mts tests/script-block-composition.test.mts tests/clipboard-history.test.mts tests/detach-integrity.test.mts
npm run typecheck
npm run i18n:check
npm test
npm run build
```

- Final seven regressions against the original helper: **7 failed**, exit 1.
  With the fix: **7 passed**, exit 0. Original source was temporarily restored
  from Git for the red run, and the fixed source restored afterward.
- Focused neighboring regression suite: **74 passed**, exit 0.
- Typecheck, i18n, and production build: **passed**, exit 0. Build retained the
  existing nonfatal middleware-to-proxy deprecation warning.
- Full suite: **3,103 passed, 1 failed, 1 skipped** (3,105 total), exit 1.
  Failure: `export-recursive-ssr.test.mts`, generated Vue HTTP server test,
  fails at `listen EPERM 127.0.0.1` before its request assertions. This matches
  the environment limitation documented in `tests/BASELINE.md`; not suppressed.
  Skip: existing opt-in Docker COPY context regression.
- Clean install not established: the initial shell selected Node 22/npm 10;
  that online install was interrupted. Retrying with the required runtime and
  `npm ci --offline --ignore-scripts --no-audit --no-fund` failed `ENOTCACHED`.
  Checks used a private copy of existing `node_modules`. All common installed
  lockfile entries matched versions/integrities; this is not a successful `npm ci`.
- No Worker build, browser E2E execution, Docker smoke, generated-format build
  matrix, dependency advisory audit, live service test, or performance benchmark
  was performed in this architecture investigation. These remain separate gates.
- No commits, pushes, PR creation, merges, auth changes, CI changes, or deployment
  changes. Logs and the scratch inventory script are under
  `/tmp/tsumu-r2-architecture/` for this session.
