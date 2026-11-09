# D: Visual editor audit record

- Repository: `abshrimp/tsumu`
- Baseline `main`: `1ba32974d4b5ecf441e36428e765d0542207c421`
- Working branch: `audit/D-editor`
- Owner: audit stream D (canvas, editing controls, styles, motion, layout)
- Other open work checked at baseline:
  - PR #19 touches `components/canvas/css.ts` (HTML import preview); leave this file to import owner.
  - PR #22 touches `components/style-panel/BackgroundSec.tsx` and `PositionSec.tsx` (explicit style choices); do not duplicate those fixes.
- Scope boundary: site persistence/sync is B; script engine is C; import is E; generated project auditing is F. Cross-stream findings will be handed off rather than silently edited.

## Finding register

| ID | Severity | Observation | Reproduction / expected outcome | State |
| --- | --- | --- | --- | --- |
| AUD-D-001 | Medium | Selecting `custom` keyframes in `MotionSec` immediately saves `keyframes: "custom"` *before* the modal is applied. | Open a motion using a preset, choose Custom, then cancel or press Escape. Expect the preset and document/history to remain unchanged. | Fix and callback regression pending. |
| AUD-D-002 | Under evaluation | Resize and drag gestures need lifecycle review (other pointer, cancellation, unmount, external edits). | Test pointer interruption without stale updates or unintended undo entries. | Investigating. |

## Audit matrix

| Requirement | Existing evidence identified | Additional checks |
| --- | --- | --- |
| D-1 create, remove, copy, group, move, component, IDs | `tests/canvas-move-lifecycle.test.mts`, `tests/clipboard-history.test.mts`, `tests/component-clone.test.mts`, `tests/editor-tree-depth.test.mts` | Locked subtree, mixed selection, invalid drop, undo/redo, ID preservation |
| D-2 style/breakpoints/states/CSS | `tests/breakpoint-confirmation.test.mts`, `tests/effect-hover-clear.test.mts`, `e2e/text-style-confirmation.spec.ts` | Nested state overrides, invalid CSS values, narrow/large widths; coordinate with #22 |
| D-3 keyframes and easing | `e2e/motion-pointer-drag.spec.ts`, `e2e/keyframe-css-fidelity.spec.ts`, `tests/easing-pointer-lifecycle.test.mts` | Modal cancel/apply atomicity, pointer cancel, save/restore, CSS preview fidelity |
| D-4 editor UI and keyboard | `e2e/editor.spec.ts`, `e2e/frame-resize.spec.ts` | Narrow viewport, focus and shortcuts, modal layering, interruption |

## Verification status

All items remain open until regression tests and independent CI/review have been checked against the final branch HEAD. CI success alone does not constitute the full D audit.
