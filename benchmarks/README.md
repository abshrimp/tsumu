# P4-05 script editor performance

The fixed datasets each contain 4,000 wait blocks: one long script exercises
chunk virtualization; 160 scripts of 25 blocks exercise stack virtualization.
Both use the real editor, CSS, store, browser document storage, and ZIP exporter.
The benchmark uses production React and a fresh browser context per sample.
All requests are intercepted locally; no application server or account is needed.

From the repository root, with the Node/npm versions in `package.json`, installed
dependencies, and the matching Playwright Chromium available:

```sh
node --import tsx benchmarks/script-editor.mts /tmp/tsumu-before.json
node --import tsx benchmarks/script-editor.mts /tmp/tsumu-after.json /tmp/tsumu-before.json
```

Run the first command against the unchanged product source and the second against
the fix, using **identical benchmark files and test helpers** in both checkouts.
Use the same physical machine, browser, display refresh rate, power settings,
and background workload. Do not run benchmarks concurrently with other checks.
The runner rejects mismatched machine, CPU, RAM, OS, Node, browser, viewport,
dependency lockfiles, harness, or data hashes. Reports include the implementation
hash, raw samples, and nearest-rank p95 values. A comparison exits nonzero if any
metric's p95 exceeds its baseline by more than 10%; a baseline-free run records
measurements only and does not establish acceptance.

Each layout discards three warmups and records 20 samples:

| Metric | Boundary |
| --- | --- |
| `firstRenderMs` | From `createRoot().render()` until the first block exists and two animation frames complete; excludes bundle loading and CSS injection. |
| `dragFrameMs` | 60 pointer moves per sample through the actual palette drag hook, measured in-browser from dispatch to the next animation frame, including hit testing; excludes Playwright transport. |
| `domElements` | Workspace descendants after four focus/scroll/blur cycles and return to the top. |
| `retainedHeapBytes` | Chromium JS heap after those cycles and forced GC, before dragging, saving, or exporting; this is retained JS memory, not peak memory or process RSS. |
| `saveMs` | JSON serialization and the real IndexedDB compare-and-write transaction, including initial database opening. Readback verification is outside the timer. Each context writes a fresh database. |
| `exportMs` | Real Next.js ZIP preparation/compression through download initiation. The runner checks download completion and deletes the temporary archive. |

The focus cycles intentionally run on both the old and fixed implementation;
the benchmark does not require the leak to be fixed in order to record a baseline.
Timing comparisons are not a substitute for the correctness regressions:

```sh
node --import tsx --test tests/script-viewport.test.mts tests/script-workspace-benchmark.test.mts tests/script-step-chunks.test.mts tests/script-editor-performance.test.mts tests/script-drag-lifecycle.test.mts
npx --no-install playwright test --config benchmarks/playwright.config.ts
npm run typecheck
```

## Audit result — 2026-11-10

`MAINTENANCE_PLAN.md` was absent from both this worktree and the main checkout.
This work follows the supplied P4-05 objective and restrictions.

Reproduced issue: a focused offscreen chunk or stack ignored the intersection
exit, preserving its draft. After focus left, no new intersection event arrived,
so the window stayed mounted indefinitely. Repeating that interaction retained
offscreen controls and increased DOM/heap and drag measurement work.

The shared viewport observer now tracks intersection state and reevaluates focus
after `focusout`. A microtask lets focus transfer and blur commits finish before
unmounting; disposal removes the listener and suppresses queued callbacks. Chunks
and stacks use the same policy. The initial regression, using the old consumer
focus guard, failed specifically at “focus departure must release an offscreen
window.” Coverage also checks internal focus transfer, viewport reentry, shared
observer cleanup, edit persistence, and repeated stack focus cycles.

Validation on macOS arm64 with Node 26.12.1/npm 12.2.1:

- **59 focused tests passed**, zero failures or skips. Both production benchmark
  bundles compile; generated exports contain all 4,000 operations in both layouts.
- **Typecheck passed.** Dependencies came from a private copy of the main
  checkout's existing `node_modules`; this was not a clean registry install.
- Browser regressions and the benchmark were attempted but could not execute:
  installed Playwright expects Chromium headless shell revision 1254, which is
  absent. A separate launch probe of available revision 1248 failed at macOS
  `bootstrap_check_in` with permission denied in the sandbox. That older browser
  was not used to produce benchmark results.
- **No timing/DOM/heap results or same-hardware baseline comparison are available.
  The ≤10% p95 acceptance criterion remains unverified.** Run the commands above
  in a browser-capable environment before accepting P4-05.

Changes are limited to script editor virtualization, its tests, and this benchmark.
No CI, authentication, secrets, deployment, or compatibility changes were made.
