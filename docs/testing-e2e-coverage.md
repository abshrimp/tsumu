# E2E coverage audit (2026-11-07)

## Decision

The 90 Playwright spec files cover distinct features and regression histories. Deleting whole
specs or disabling the suite on pull requests would lose valuable browser coverage. The
avoidable cost is the **cross-product of cases already checked in Node tests**, not the
existence of the E2E suite.

Keep a Chromium case when it verifies something Node cannot faithfully reproduce:
native input normalization, focus/IME/pointer interactions, React commit/hydration,
real browser navigation, client-side runtime execution, uploads/downloads, storage,
async network races, or collaboration. Prefer the more demanding **component** path
when a Node test already checks both plain nodes and component instances. Keep the
complementary less expensive case matrix in `tests/*.test.mts`.

## Cases removed, not coverage

| Playwright spec(s) | E2E kept | Complementary Node coverage |
| --- | --- | --- |
| `client-array-field`, `client-field-scope`, `client-image-scope`, `client-literal-attributes`, `client-script-scope` | Component editing through the real UI, save/undo, generated browser runtime and navigation | Same-named Node suites exercise both plain and component scopes |
| `client-nested-lists` | Component variants of three browser scenarios, including nested operations, scalar overrides and links | `client-nested-lists`, `client-text-scope`, `client-link-scope` run both variants |
| `default-audio-height` | Component with real audio element sizing and edited/exported CSS | Same-named Node suite covers both page and component across design/preview/export |
| `nested-list-operations` | Nested component scripts and the full preview/export sequence | Same-named Node suite runs nested and component variants |
| `server-parent-list-source` | Mixed server/client ownership inside a component | Same-named Node suite runs plain and component variants |
| `server-array-count` | All six ownership/filter/count modes are still represented, including both Canvas and export. The basic server mode runs in both. | Same-named Node suite tests both surfaces for all modes and additional edge cases |
| `preview-dynamic-radio` | Both query/data label sources still run browser preview and exported radio scripts; the ordered-assignment sequence uses one source | Same-named Node suite checks query/data resolution; `radio-clear-bindings` checks literal assignments |
| `array-find-fields` | Real editor field selection and save/export, plus encoded positive and missing-key browser runtime | Same-named Node suite tests literal, raw, encoded, nested, null, numeric and no-match cases in both runtimes |

This removes **19 generated Playwright test cases** from 12 specs without removing a
feature suite or changing any production code. Full unit tests, all remaining E2E
specs, the Playwright config, CI triggers, and CI assertions remain unchanged.

## Explicitly retained

- Native field defaults, validation, IME and keyboard handling: the browser's actual
  value/event behavior is not equivalent to a mock DOM.
- Save/bootstrap/offline and cache recovery, cross-tab collaboration, comment races,
  asynchronous imports, canvas/script pointer cancellation, AI history and undo isolation.
- Preview versus exported code for runtime-specific behavior, including representative
  query navigation, dynamic radio labels and scoped list operations.
- Security, publishing, generated assets and ZIP/HTML import checks, even when related
  Node tests exist: browser/runtime boundaries are the regression target.

Do not remove tests solely because a similarly named Node file exists. If a future
regression demonstrates a plain-node browser-only failure not covered by Node,
reintroduce that Playwright variant rather than expanding every cross-product by default.

## Verification

Static review of the complete 90-spec inventory and matching Node coverage completed.
The expected generated-case reduction is 19. Run `npm test`, `npm run typecheck`,
`npm run build` and `npm run test:e2e` in the repository CI; this change cannot
claim successful local Chromium execution without that run.
