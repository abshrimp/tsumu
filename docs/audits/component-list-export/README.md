# Component list export regression

Baseline: `da6ceb3c90f3f95cba1013de1416f310522125bd`.

## The problem

A page repeats two product records, and each product has two tags.

In the real SettingsPanel, selecting the ordinary `card` box offers **コンポーネント化** (turn into a component). Its actual click handler calls the production `createComponent` store action, which preserves the subtree, puts an instance in its place, and can be undone.

| | Canvas | Generated page (baseline) |
|---|---|---|
| Before conversion | 4 tag rows | 4 tag rows |
| After conversion | 4 tag rows | **0** tag rows |

**Cause.** Component files reset the variable scope to `{}` and cleared the list plan. With no descriptor, the list renderer emitted nothing.

## The result

The corrected export renders four rows both before and after conversion. The fixture also checks that the surrounding product name and the row scripts resolve correctly, rather than merely matching source strings.

`reproduction.json` records the row counts. The tests run the generated page and component modules for real, substituting only the fetch response.

## What the fix does

- **Finds lists through components.** Configured lists are discovered through component references, with guards against cycles.
- **Expands only what's needed.** Only component trees that contain a list are expanded, inside their calling page's existing render context. They reuse the page's variables, list operations, client-template state and helpers.
- **Keeps structure intact.** Component root semantics, form boundaries, visibility and anchor rules are preserved. No DOM wrappers are added, no nodes are copied, no IDs are renamed and the saved document isn't modified.
- **Keeps row-local scripts working.** When deciding whether a list row needs its existing scope wrapper, the generator walks through expanded component masters, so row-local script targeting is preserved.
- **Leaves static components alone.** Ordinary static components are still emitted on the existing standalone path — including a static component nested inside an expanded one.

### What this is not

Inside an affected component master, interpolation — including sibling text and script values — now uses the caller's data, matching Canvas. This is **not** a general API for passing data props to components.

Standalone component files and the loading-screen path keep their existing behavior. They have no page list plan and don't expand components.

An independent review compared the complete generated output with the baseline for two fixtures: an ordinary static anchor, and a static instance with its own script inside a list. Both were byte-identical, including the latter's original row wrapper.

## Regression coverage

**`tests/component-list-export.test.mts`** exercises the actual SettingsPanel handler and store workflow. It covers:

- undo/redo, reloading the saved document, and Canvas/export parity;
- nested component references, aliases and repeated placements;
- multiple page data scopes, and server filtering, sorting and limits;
- client-template text, scripts and raw content;
- visibility, escaped anchors, static nested components, form boundaries, cycles and the generated TypeScript.

The existing nested-list operation tests now also run component-contained generated output, checking repeated sort, filter, empty and clear operations against Canvas.

**`e2e/component-list-export.spec.ts`** covers the real SettingsPanel/Canvas conversion; undo, redo and reload; script targeting in inner and outer rows; and a converted client list loaded in the browser. The existing native operations test now checks generated component lists as well. Four relevant native tests are enumerated successfully.

## Validation

- **Baseline.** Four targeted regressions fail on the baseline, with rows and templates missing.
- **Final full unit suite.** **1,059 passed**.
- **Static checks.** Typecheck and English translation coverage passed. `git diff --check` passed.
- **Builds.** The editor's production webpack build passed. A separate generated Next.js project's webpack build passed too, including TypeScript. That project's data revalidation is disabled so compiling it doesn't need a remote data fetch.
- **Native Chromium.** **Not run locally**, out of respect for an earlier environment-level socket permission denial. The committed native regressions must run in CI.

`validation.log` contains the focused baseline failures and the final check outputs (or clearly labeled excerpts of them).

An initial broad baseline run included an artificial recursive-component fixture, and that test process ran out of heap. It was not retried. Instead, baseline failures were collected with the four non-recursive regressions. The cycle test for the fixed page expansion passes.

## Original baseline limitation

The original fixture with a client-rendered outer list produced zero item-local inner rows, both before and after conversion to a component. That is a separate issue, now covered by [the client-parent nested list correction](../client-nested-lists/README.md).

Two areas remain outside these focused corrections, and the linked audit records them: transporting scope from a server parent to a client child, and known server/global text shadowing an item's fields.

Portable focused checks:

```sh
node --import tsx --test tests/component-list-export.test.mts tests/nested-list-operations.test.mts
npm run test:e2e -- --list e2e/component-list-export.spec.ts e2e/nested-list-operations.spec.ts
```
