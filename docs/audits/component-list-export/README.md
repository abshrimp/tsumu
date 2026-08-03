# Component list export regression

Baseline: `da6ceb3c90f3f95cba1013de1416f310522125bd`.

## Reproduction and cause

A page repeats two product records, each containing two tags. In the real SettingsPanel,
selecting the ordinary `card` box offers **コンポーネント化**. Its actual click handler
calls the production `createComponent` store action. The action preserves the subtree,
replaces its placement with an instance, and is undoable.

Before conversion, Canvas and the executed generated page both render four tag rows.
On the baseline, after conversion Canvas still renders four, but the generated page
renders zero. Component files reset the variable scope to `{}` and clear the list
plan, so the list renderer has no descriptor and emits nothing.

The corrected export renders four rows both before and after conversion. The fixture
also resolves the surrounding product name and row scripts, rather than merely
matching source strings. `reproduction.json` records the row counts. The tests execute
generated page and component modules, substituting only the fetch response.

## Scope of the correction

- Discover configured lists through component references, with cycle guards.
- Expand only list-bearing component trees in their calling page's existing render
  context. Reuse its variables, list operations, client-template state and helpers.
- Keep component root semantics, form boundaries, visibility and anchor rules. Do not
  add DOM wrappers, copy nodes, rename IDs or mutate the saved document.
- Preserve row-local script targeting by traversing expanded component masters when
  deciding whether a list row needs its existing scope wrapper.
- Continue emitting ordinary static components on the existing standalone path.
  A static component nested inside an expanded component also stays standalone.

Interpolation in the affected master, including sibling text and script values, now
uses the caller's data, matching Canvas. This is not a general component-data props
API. Standalone component files and the loading-screen path retain their existing
behavior. They have no page list plan and do not expand components.

Independent review compared complete generated output with the baseline for an
ordinary static anchor fixture and a static instance carrying its own script inside
a list. Both were byte-identical, including the latter's original row wrapper.

## Regression coverage

`tests/component-list-export.test.mts` exercises the actual SettingsPanel handler and
store workflow, undo/redo, saved-document reload, Canvas/export parity, nested component
references, aliases, repeated placements, multiple page data scopes, server filtering,
sorting and limits, client template text/scripts/raw content, visibility, escaped
anchors, static nested components, form boundaries, cycles and generated TypeScript.

The existing nested-list operations tests now execute component-contained generated
output too, checking repeated sort/filter/empty/clear operations against Canvas.

`e2e/component-list-export.spec.ts` covers the real SettingsPanel/Canvas conversion,
undo/redo/reload, inner- and outer-row script targeting, and a converted client list
loaded in the browser. The existing native operations test now checks generated
component lists as well. Four relevant native tests enumerate successfully.

## Validation

- Four targeted baseline regressions fail with omitted rows/templates.
- Final full unit suite: **1,059 passed**.
- Typecheck and English translation coverage: passed.
- Editor production webpack build: passed.
- Separate generated Next.js project webpack build: passed, including TypeScript.
  Its data revalidation is disabled so compilation does not need a remote data fetch.
- `git diff --check`: passed.
- Native Chromium execution: **not run locally**. An earlier environment-level socket
  permission denial was respected. The committed native regressions must execute in CI.

`validation.log` contains the focused baseline failures and the final check outputs
(or clearly labeled completion excerpts). An initial broad baseline run included an
artificial recursive-component fixture and exhausted that test process's heap. It was
not retried; baseline failure evidence was then collected using the four non-recursive
regressions. The fixed page-expansion cycle test passes.

## Existing limitation, not claimed fixed

A client-rendered outer list whose item contains a nested array can still have the
inner list classified as server-rendered. Its template then contains no inner rows.
The same valid pre-conversion document and converted document each produce one outer
client template and zero inner rows. This predates the component-conversion issue and
requires separate client-list planning/runtime work. Ordinary client lists inside a
converted component retain their templates and have dedicated native coverage here.

Portable focused checks:

```sh
node --import tsx --test tests/component-list-export.test.mts tests/nested-list-operations.test.mts
npm run test:e2e -- --list e2e/component-list-export.spec.ts e2e/nested-list-operations.spec.ts
```
