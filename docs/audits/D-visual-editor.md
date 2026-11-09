# D: Visual editor audit record

- Repository: `abshrimp/tsumu`
- Baseline `main`: `1ba32974d4b5ecf441e36428e765d0542207c421`
- Working branch: `audit/D-editor`
- Owner: audit stream D (canvas, editing controls, styles, motion, layout)
- Mainline tracking: PR #22 (explicit style modes) and PR #19 (import / HTML CSS preview) merged after the baseline. Their changes are incorporated in merge commit `6c6de820182ba6eafe75917da1f4460a0bb57de5` (main `4cd04c23137e11afce7d7c43f0e06a52815de38e`); overlapping files were preserved from main.
- Parallel audit streams C/E/H/I have independent PRs; avoid cross-stream edits.
- Scope boundary: site persistence/sync is B; script engine is C; import is E; generated project auditing is F. Cross-stream findings will be handed off rather than silently edited.

## Finding register

| ID | Severity | Observation | Reproduction / expected outcome | State |
| --- | --- | --- | --- | --- |
| AUD-D-001 | Medium | Selecting `custom` keyframes in `MotionSec` immediately saved `keyframes: "custom"` *before* the modal was applied. | Open a preset motion, choose Custom and cancel; the original CSS/preset and undo history must remain unchanged. On Apply, preset and CSS must be one undoable change. | Fixed in `MotionSec.tsx`; regression: `tests/motion-modal-atomicity.test.mts` (CI pending). |
| AUD-D-002 | Medium | `PanelResizer` accepted every pointer's move/up events. Capture loss, window blur and component unmount could leave resize cursor and stale listeners active. | Start pointer 1, send pointer 2 updates/cancel, lose capture, hide tab, or unmount; pointer 1 owns the operation, and cleanup must leave controls usable. | Fixed with `lib/panel-resize.ts`, `Editor.tsx`; regression: `tests/panel-resize.test.mts` (CI pending). |
| AUD-D-003 | Medium | Canvas element resize called the previous gesture's cleanup when another pointer started; it did not detect remote document replacement and had no Escape/visibility cancellation. | Resize node A with pointer 1 while pointer 2 starts; then apply a collaborator's edit to node B. The old drag must not overwrite any new document or accept late move events. | Fixed in `components/canvas/useCanvasDrag.ts`; regression: `tests/canvas-node-resize-lifecycle.test.mts` (CI pending). |

## Audit matrix

| Requirement | Existing evidence identified | Additional checks |
| --- | --- | --- |
| D-1 create, remove, copy, group, move, component, IDs | `tests/canvas-move-lifecycle.test.mts`, `tests/clipboard-history.test.mts`, `tests/component-clone.test.mts`, `tests/editor-tree-depth.test.mts` | Locked subtree, mixed selection, invalid drop, undo/redo, ID preservation |
| D-2 style/breakpoints/states/CSS | `tests/breakpoint-confirmation.test.mts`, `tests/effect-hover-clear.test.mts`, `e2e/text-style-confirmation.spec.ts` | Nested state overrides, invalid CSS values, narrow/large widths; coordinate with #22 |
| D-3 keyframes and easing | `e2e/motion-pointer-drag.spec.ts`, `e2e/keyframe-css-fidelity.spec.ts`, `tests/easing-pointer-lifecycle.test.mts` | Modal cancel/apply atomicity, pointer cancel, save/restore, CSS preview fidelity |
| D-4 editor UI and keyboard | `e2e/editor.spec.ts`, `e2e/frame-resize.spec.ts` | Narrow viewport, focus and shortcuts, modal layering, interruption |

## Verification status

### Pushed changes

- Atomic keyframe editor: Custom selection does not mutate the SiteDoc until Apply; Cancel/Escape discard edits.
- Panel resize pointer ownership, blur/visibility/capture-loss/unmount cleanup and concurrent left/right resize cursor reference-counting.
- Canvas node resize pointer ownership; stale document / remote edit detection; Escape/visibility abort handlers.
- Callback-level and store-level regressions for all three findings, including single-step Undo/Redo and invalidated gestures.

### Pending evidence

- GitHub CI on the final branch HEAD: unit/integration, typecheck, translations, build, generated format builds, CodeQL, Playwright shards.
- Dedicated real-browser tests for new panel/Canvas behavior and representative viewport widths.
- Independent reviewer and integration check after other audit streams merge.

No claim is made that all D behaviors are verified or that there are no remaining defects. CI success alone does not constitute the full D audit.
