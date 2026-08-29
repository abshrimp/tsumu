# P3-07 — round 2, architecture investigation (2026-11-10)

One new P2 defect was reproduced and fixed: the Canvas preview runtime outlived
the page/frame that owned it. No saved-document format, ID, translations,
authentication, or deployment settings changed.

## Baseline and overlap checks

- Local HEAD and local `origin/main`: `d6f17ae54ae41aafb80ba5a969cbac35b73447f2`.
- GitHub main was checked through the GitHub connector because shell GitHub
  access fails DNS resolution. It advanced from `ced4645fdf248c00a1617b1fcf794e0a90ca7d20`
  to `9cdd51dfe571a84b07e42b7762f85e28b0b00df1` during this investigation.
- Compared local baseline against both remote revisions. Neither changes
  `components/Canvas.tsx`, `lib/script-runtime.ts`, `useCanvasData`, the page
  selector, or their preview-navigation contracts. The later `lib/store.ts`
  delta only changes `persistDoc`'s saved baseline bookkeeping. The defect is
  therefore present in the inspected current main as well as the tested checkout.
  This is not a claim that the full latest-main checkout was tested locally.
- Checked open PRs #133–137 and their file lists; #133 and #136 subsequently
  merged. Rechecked open PRs (#134, #135, #137, #138). No competing Canvas runtime
  lifecycle fix was found. The script-editor keyboard fix in #134 was left alone.
- Inspected relevant local review worktrees and recent Canvas/Editor history;
  the concurrent accessibility work changes DialogHost, not this lifecycle.
- `tasks.json` and `AGENTS.md` were not present in this checkout. Used the explicit
  P3-07 assignment; did not create a replacement execution queue. The connector
  returned no combined status entries for the last inspected SHA, so this audit
  does not certify the supervisor's all-PRs-merged/green-CI baseline gate.

## Entry points, contracts, and hypotheses

| Flow | Actual callers / consumers | Invariant and result |
| --- | --- | --- |
| Page changes | Header page dropdown and PagesTab → `setActivePage`; preview links/runtime → `useCanvasData` navigation → store → Canvas | A new visit owns its load handlers and pending work. **Failed**, as detailed below. |
| Preview activation | Header → `setMode`; Canvas → `createScriptRuntime(env).install(frameRef.current)` | Every mounted visual preview frame has listeners; disposed frames cannot act on a later page. **Failed** across HTML/redirect/rewrite views. |
| Selection and responsive gestures | Canvas capture handlers → `useCanvasDrag` → `select` / `moveNodes` / transient style writes and gesture history; FrameStage → custom width / breakpoint | Existing pointer ownership, history, selection, page, and mode cancellation guards are present. Focused movement/resize tests passed; no new fix claimed. |
| Keyboard and clipboard | Editor global key/paste listeners → store; focused native inputs/contenteditable and modal/preview guards; artwork → `startImageInsertion` | Reviewed focused-control ownership and asynchronous destination capture. Existing destination-safety regressions passed. Avoided duplicating #134. |
| Assets | AssetsTab upload/migration/deletion → asset helpers and store; image-drop producer → captured insertion destination | Existing history-aware upload retention, destructive-confirmation revalidation, and gesture waiting are covered by passing focused tests. No new defect asserted. |
| Export/runtime neighbor | Generator page/native/HTML writers emit `data-page-body`; runtime `syncPage()` consumes it | Published navigation tests supply that marker. Canvas emits an unkeyed page-script span without it and previously installed only on `[mode]`; runtime-only tests did not exercise this consumer mismatch. |

## Reproduction, root cause, and fix

P2, target `components/Canvas.tsx`:

1. Put different “when opened” scripts on visual pages A and B, enter preview,
   and select B, then A in the header. Only A's first load script runs: React
   reuses the page-script span, while the runtime's `seen` set persists.
2. Start A's click script containing Wait → Open page/URL, then select B before
   the wait finishes. A's continuation still navigates from B. Canvas provides
   no page marker to invalidate that old runtime generation.
3. While preview remains active, select an HTML/redirect/rewrite page and return
   to a visual page. The old frame is gone and the new one has no runtime.
   Entering preview on a special page first has the same missing-install result.
4. Converting the current page to HTML and undoing also replaces the frame
   without changing mode or page ID.

The effect now follows mode, active page, component-editing context, and whether
the visual frame exists. Cleanup cancels old waits/listeners; the new visit gets
a fresh runtime and load scan. Ordinary document, data, selection, and viewport
changes do not reinstall it. The production diff is eight added/two removed
lines in Canvas. Navigating in the regression retains the same document and
undo/redo arrays.

Acceptance: each visual visit executes its load scripts; old delayed work cannot
affect the new visit; replacement frames retain click handlers; same-page edits
do not replay loads; Japanese and English behavior remains unchanged.

## Validation and limits

Used Node 26.12.1 and the existing dependency installation from `/Users/riku/tsumu`.
A temporary node_modules symlink was used for local checks; no lockfile changed.

- Before production edit: `node --import tsx --test tests/canvas-preview-lifecycle.test.mts`
  — **9 failures, 1 pass**, with wrong load calls, obsolete navigation, missing
  disposal/reinstall, and same-page HTML conversion failure. The negative
  control (same-page updates do not replay loads) passed.
- After edit: same command — **10/10 passed**. These execute actual Canvas
  render/effects and the actual runtime with controlled React scheduling and a
  DOM model; they are not native-browser certification.
- Focused command — **192/192 passed**:

  ```sh
  node --import tsx --test tests/canvas-preview-lifecycle.test.mts tests/preview-refresh.test.mts tests/script-preview-change-lifecycle.test.mts tests/script-hover-cancellation.test.mts tests/component-preview.test.mts tests/canvas-move-lifecycle.test.mts tests/canvas-node-resize-lifecycle.test.mts tests/frame-resize.test.mts tests/clipboard-destination-safety.test.mts tests/asset-library-history.test.mts tests/asset-confirmation.test.mts
  ```

- `npm run typecheck` — passed.
- `npm run i18n:check` — passed, all English strings translated; no text changed.
- `npm run test:e2e -- e2e/canvas-preview-lifecycle.spec.ts --project=chromium --list`
  — passed, **12 tests discovered**, six each for Japanese and English.
- Browser execution unavailable: installed Playwright expects Chromium 1254,
  but the cache has 1248. An explicit launch of that available executable fails
  with `bootstrap_check_in ... Permission denied (1100)` in the sandbox.
  The new browser tests remain unexecuted; they cover real React reconciliation,
  click delivery, timers, page-kind undo, and both locales.
- `npm run build` — environment failure: Turbopack refuses dependency resolution
  through the shared node_modules symlink outside its filesystem root.
- `npm run build -- --webpack` — **passed**, including compilation, TypeScript
  validation, static page generation, and build tracing. No build configuration
  was changed to obtain this result.
- Full test suite, npm ci/audit, Worker build, Docker, generated-format builds,
  native clipboard, and Firefox/WebKit were not run in this scoped investigation.

The supervisor must validate on the fully updated checkout with normal local
dependencies and a working browser environment before merge. No commit, push,
PR creation, merge, or deployment was performed.
