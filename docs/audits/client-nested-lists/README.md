# Client-parent nested list correction

Baseline: `cedcae2bfdb47235b48548940bcc348904be3275` (the component-list export fix).

## The problem

Take a product list that loads in the browser. Inside each product row is an ordinary inner list bound to that product's `tags`.

- **Canvas** correctly uses each product's own `tags` array.
- **The baseline export** went wrong in two ways:
  - If `tags` exists only on the items, the inner list rendered **zero** rows.
  - If the page also happens to have an array called `tags`, every product repeated that page array instead of its own.

## The fix

Inner lists now stay as templates. They're resolved only after their parent row exists, with item scopes layered from the outermost list inward.

With the demonstration fixture (where `tags` exists only on items), the export now renders **four** rows — each with the product's own values and its own row-local scripts. This also works inside a component that was converted from a list-bearing subtree.

## How it was tested in the real editor

The native regression drives the real editor controls:

1. It uses the real SettingsPanel to select `tags`.
2. It uses the real ScriptEditor value field to configure a click action that assigns `{response}` to `items`.
3. It runs the same saved document in Canvas and in the generated HTML, with the production script runtime.

Along the way it covers undo/redo, reloading the saved document, repeated preview, inner-row scripts, sort/filter/clear, repeated data loading and page navigation.

In the browser-loaded fixture, a named page alias is what makes `tags` selectable. A separate item-only regression removes that alias and covers the original zero-row case. No new document fields or editor controls were introduced.

## Scope and safeguards

- **Row scopes hold item values only.** Live page variables are read fresh each time.
- **Shadowing.** Empty, `null`, non-array and missing dotted children still shadow the outer value through the item's root.
- **Static list operations** are resolved per parent, before dynamic operations and limits. Literal braces in resolved filter values are not interpolated a second time.
- **Templates stay inert.** Template and detached nodes are excluded from active rendering and from script targets.
- **Server fallback is preserved.** When an item has no source, the existing server-rendered fallback is kept. Raw server arrays and unused fields are not newly serialized: a private-sentinel regression checks that they don't appear in the generated HTML, and hidden fallback scripts stay idle.
- **No effect elsewhere.** The output of plain and component-containing pages that are server-only is byte-identical to the baseline. Previewing and exporting don't change the saved document or its history.

## Limitations left as they are

This change is limited to client outer lists and their item-local descendants. These broader mixed-scope cases are unchanged:

- Existing transport of scope from a server parent to a client child — including a client list below a server fallback row.
- Existing templates can still resolve known server or global text values before an item with the same field name is available. In particular, server fallback text doesn't gain unknown fields from an outer client item.

They need a separate design. Meanwhile, the fallback keeps producing the same output as before.

## Validation

- **Baseline comparison.** The focused regressions fail on the baseline. Item-only rows went from **0 → 4**.
- **Unit tests.** **1,072 passed**, including thirteen new focused tests. Ten focused regressions fail on the baseline.
- **Static checks.** Typecheck, English translation coverage and `git diff --check` passed.
- **Builds.** The editor's production webpack build passed. So did a separate generated Next.js project's typecheck and webpack build; that project includes dynamic operations and a separate page that exercises static filters, literal tokens and `[slug]`.
- **Independent review.** The reviewer found the literal-token and `[slug]` problems, rechecked the fixes, and then reported no remaining blocking findings within this scope.
- **Native Chromium.** **Not run locally**, out of respect for an earlier socket permission denial. Official CI collects the two new native regressions.
- DOM-model unit results are not evidence of native browser behavior.

Commands:

```sh
node --import tsx --test tests/client-nested-lists.test.mts
npm run test:e2e -- --list e2e/client-nested-lists.spec.ts
```

## Follow-up: scope of static filters

### The problem

A review found that a known server token inside a nested static filter was frozen before its client parent row existed. With the server value `wanted = red` and parent values `blue` and `red`, Canvas selected blue and red, while the export selected red and red.

### The fix

- Filter parts now keep the token name and a resolved string fallback.
- Parent item values take precedence, including `null`, empty strings, missing dotted children and literal dotted keys.
- Server fallbacks stay strings, never raw arrays or objects, and literal braces are never interpreted a second time.
- `[slug]` follows the same rule.
- The fallback is resolved against ordinary server properties rather than the placeholder Proxy, so dotted server fields still work when the parent doesn't have the root.

### Browser-written filter tokens

If a real browser-write instruction targets the filter token, `pagePlan` moves that dependent filter out of the static `listOps` and into browser operations. Those dynamic filters keep their existing behavior of reading the value when the action runs. This change doesn't add reactive dependencies or alter general text interpolation.

### Validation

- The focused regression fails on the previous head and passes after the fix. It compares the executed export with Canvas for both conflicting and missing values.
- A native CI regression checks repeated loading, and asserts that the fixture has a server-only fallback and a static list operation. Native browser execution is left to CI.
- All **1,073 unit tests** passed. Typecheck, English translation coverage and `git diff --check` passed.
- The editor's production webpack build and a separate generated project's webpack and TypeScript build passed.
- Three native client-nested-list tests are enumerated, including the added regression. Native execution was not attempted.
