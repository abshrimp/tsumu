# P3-06 — round 2, investigation 2/3 (adversarial)

Investigated 2026-11-10 against `fb5bd0477d1eb7a58658ed55fff63260470075b9`.
HEAD and local origin/main matched; the GitHub connector independently resolved
remote main to that SHA. Shell `git ls-remote` failed DNS resolution. This is an
audit baseline, not release approval: open PRs remained. No tasks.json was
present, so the supplied P3-06 assignment defined the work.

## Inventory and overlap checks

- `ScriptEditor.tsx`: selection, blur before dragging, context-menu copy/delete,
  current-document step updates, and store commits.
- `script-editor/blocks.tsx`: step/list locations, trigger and step drop slots,
  chunk/stack virtualization, focus retention through `visibility.ts`.
- `useScriptDrag.ts`: pointer ownership, cancellation, current-state subscription,
  spatial hit tests, and atomic remove/insert/drop commits.
- `step-tree.ts`: lookup, remove, insert, copy-on-write updates, filter numbering,
  and the internal location serialization used by hit testing.
- Neighboring contracts: `lib/document-validation.ts` accepts nonempty string
  script/step IDs; `lib/doc-tree.ts` uses it for imported document validation.
  `lib/script.ts` produces workspace views, clones steps, partitions saved
  scripts, and supplies generated output. Store history retains document snapshots.
- Existing #107 focus-retention and #134 picker-shortcut fixes were present and
  were not reimplemented. Checked prior script-editor review commits and local
  worktree inventory. Open PRs #138–143 did not overlap this fix; inspected changed
  filenames for the neighboring keyboard, editor, AI, and roundtrip reviews.

## Confirmed P2: delimiter-containing IDs redirect editor operations

The document accepts these IDs, but editor location strings used unescaped
`scriptId|list|index` and split nested `stepId:branch` at the first colon.

Reproduction:

1. Have a source script `script` and a detached target `script|root|0`.
   Drop an existing block or a palette block onto the target's first slot.
   Before the fix the slot decodes as script `script`, root index 0, so the
   operation changes the source instead of the target.
2. Target `script|head|0` with a trigger drop. The prefix script's trigger is
   changed instead of attaching a trigger to the intended detached stack.
3. Put `if` blocks with IDs `branch` and `branch:else` in the same script.
   Looking up, moving, or duplicating children in the latter resolves the former's
   else branch. Copy can insert into the wrong branch, and dragging to the trash
   can remove that wrong branch's children via the same `takeAt` operation.

The fix serializes temporary DOM slot addresses as JSON tuples, makes trigger
slots use the same serializer, and separates a branch from its owner at the final
colon. Saved IDs, SiteDoc/schemaVersion, export formats, and authorization are
unchanged. No migration or legacy format path was added.

Regression evidence, recorded before editing production code:

- `script-slot-identity.test.mts`: 8 failed, 3 passed. Failures cover address
  roundtrips/collisions, rendered trigger/root slots, and nested move/copy.
- `script-drag-lifecycle.test.mts` with `--test-name-pattern='delimiter IDs'`:
  all 3 new tests failed. These execute the real hook and store, with fixed DOM
  geometry. After the fix they verify the destination and one-step Undo/Redo.
- Both files after the fix: **50 passed**. Quoted, backslash, newline, Unicode,
  percent-encoded-looking, and lone-surrogate IDs also retain their exact values.

Completion criteria: retain the regressions, verify ordinary and adversarial
addresses reach the intended script/branch, preserve source snapshots and IDs,
and keep drop operations reversible with one history entry. These automated
criteria passed; real-browser verification remains outstanding below.

## Other hypotheses exercised

- Late pointerup after cancellation, wrong-pointer reentrancy, external edits,
  Undo/Redo, page/component changes, and dropping into a removed subtree:
  existing real-hook/store regressions were rerun and passed. No additional
  defensible failure was established.
- Focus leaving an offscreen chunk/stack before a draft can commit:
  viewport/focus effect tests passed, including delayed blur and cleanup.
  This does not establish browser input preservation for every concurrent edit.
- High block counts and boundaries: spatial index versus brute-force hits,
  4,000-block structural sharing/numbering, chunk insertion indices, and exported
  4,000-block fixtures in one or 160 stacks passed. No browser p95, memory, or
  mounted-DOM performance result is claimed for this investigation.

## Commands and limitations

Used Node 26.12.1 via
`PATH=/Users/riku/.nvm/versions/node/v26.12.1/bin:$PATH` and the existing installed
dependencies from `/Users/riku/tsumu/node_modules`, temporarily linked into this
worktree. That dependency source's lockfile differs from this checkout; observed
Next/React/Playwright versions were 16.4.5/19.3.1/1.65.0. No clean npm ci or full
dependency audit was performed, so exact-lock CI remains necessary.

Passed:

```sh
node --import tsx --test tests/script-slot-identity.test.mts tests/script-drag-lifecycle.test.mts
# 50 passed
node --import tsx --test tests/script-slot-identity.test.mts tests/script-drag-lifecycle.test.mts tests/script-editor-performance.test.mts tests/script-step-tree-purity.test.mts tests/script-step-chunks.test.mts tests/script-viewport.test.mts tests/script-viewport-focus.test.mts tests/script-keyboard-scope.test.mts tests/script-escape-routing.test.mts tests/script-workspace-benchmark.test.mts
# 126 passed
npm run typecheck
npm run build -- --webpack
# passed; middleware-convention and jose Edge Runtime warnings
git diff --check
```

Browser attempt:
`npx --no-install playwright test --config benchmarks/playwright.config.ts --grep 'real mouse drop'`
could not launch because expected Chromium headless shell 1254 was absent.
A temporary config selecting installed shell 1248 also failed before running
the test: macOS sandbox denied `bootstrap_check_in` for Chromium's Mach port.
No browser failure is attributed to application code. Browser E2E, real input
focus/copy/drop interaction, Firefox/WebKit, and browser performance need a host
where Playwright can launch. No CI configuration was changed.

The production webpack build passed compilation, TypeScript, page generation,
and finalization. Warnings referenced the middleware convention and jose's
CompressionStream/DecompressionStream use in the Edge Runtime, outside the
touched code. The default Turbopack build was not tested. Full unit suite,
Workers, Docker, deployment, and live collaboration were not run for this scoped
change. No commit, push, PR, merge, or live external mutation was performed.
