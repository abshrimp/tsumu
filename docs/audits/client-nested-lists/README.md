# Client-parent nested list correction

Baseline: `cedcae2bfdb47235b48548940bcc348904be3275` (component-list export fix).

A browser-loaded product list can contain an ordinary inner list bound to each
product's `tags`. On the baseline, an item-only source produces **zero** inner rows.
If a page array also happens to be named `tags`, the export instead repeats that
page array for every product. Canvas uses each product's own array.

The correction keeps descendant lists as templates and resolves them after their
parent row exists, layering item scopes from outer to inner. The demonstrated
item-only fixture now renders **four** rows, with each product's own values and
row-local scripts. This also works inside a converted list-bearing component.

## Existing controls and behavior

The native regression uses the real SettingsPanel to select `tags`, then the real
ScriptEditor value field to configure a click action that assigns `{response}` to
`items`. The same saved document is exercised in Canvas and generated HTML with the
production script runtime. It covers undo/redo, saved reload, repeated preview,
inner-row scripts, sort/filter/clear, repeated data loading and page navigation.

A named page alias makes `tags` selectable in the browser-loaded fixture. The
item-only regression separately covers the original zero-row case after that alias
is removed. No new document fields or editor controls were introduced.

## Scope and safeguards

- Runtime row scopes contain only item values; live page variables are read afresh.
- Empty, null, non-array and missing dotted children respect item-root shadowing.
- Static list operations resolve per parent, before dynamic operations and limits.
  Literal braces in resolved filter values are not interpolated a second time.
- Template and detached nodes are excluded from active rendering and script targets.
- When an item has no source, the existing server-rendered fallback is retained.
  Raw server arrays and unused fields are not newly serialized. A private sentinel
  regression verifies absence from generated HTML; hidden fallback scripts stay idle.
- Plain and component-containing server-only page output is byte-identical to the
  baseline. No changes are made to the saved document or its history by preview/export.

## Deliberately unchanged limitations

This is limited to client outer lists and their item-local descendants. Existing
server-parent/client-child scope transport is unchanged, including a client list
below a server fallback row. Existing templates can also resolve known server/global
text values before an item with the same field name is available. In particular,
server fallback text does not gain unknown outer client-item fields. These broader
mixed-scope cases require a separate design; the fallback preserves prior output.

## Validation

- Focused baseline regressions fail; corrected item-only rows: **0 → 4**.
- **1,072 unit tests passed**, including thirteen new focused tests. Ten focused
  regressions fail against the baseline.
- Typecheck, English translation coverage and `git diff --check`: passed.
- Editor production webpack build and a separate generated Next.js project
  typecheck/webpack build: passed. The generated project includes dynamic operations
  and a separate page exercising static filters, literal tokens and `[slug]`.
- Independent review found and rechecked the literal-token and `[slug]` fixes, then
  reported no remaining blocking findings within this scope.
- Native Chromium execution was **not run locally**: the earlier socket permission
  denial was respected. The two new native regressions are collected by official CI.
- DOM-model unit results are not native-browser evidence.

Commands: `node --import tsx --test tests/client-nested-lists.test.mts`,
`npm run test:e2e -- --list e2e/client-nested-lists.spec.ts`.
