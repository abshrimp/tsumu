# Client-list script expression scope

## The problem

Scripts inside a list template resolved row references against server values before the row that was clicked even existed. This caused three kinds of wrong results:

- An assignment like `Selected {name}` could pick up the **first** row's name when the **second** row was clicked.
- A whole-value assignment like `{tags}` could copy the first row's array.
- Literal braces inside data could be interpolated a second time.

On top of that, values were replaced when the template was cloned, which froze live variables and fields before the script ever ran.

## The fix

### How expressions are stored

- Each leaf of a template expression now carries its parts: literals and references.
- A raw `set-var` leaf carries a separate, typed reference.
- When cloning, the filler keeps these structured leaves as they are, instead of interpolating their serialized JSON.

### How a reference is looked up at run time

When the script runs, a reference is resolved in this order:

1. the current loop scope,
2. the retained scope of the row that was clicked,
3. the referenced fallback, or a live lookup.

A row's own roots count even when they are `null`, empty, or have missing nested children. The ordinary lookup and the template Proxy are unchanged.

### What is sent to the browser

- Only fallback values that a script explicitly references are transported.
- Scalar expressions use string fallbacks. Raw assignments keep the referenced value's original type.
- Referencing a nested property doesn't transport its siblings, and unrelated server sentinel values stay absent.
- Data objects that happen to contain `scriptParts` or `rawRef` properties are not treated as expressions when copied through raw assignments.

## Scope

- The change covers the existing string-expression callbacks in `compileScripts`, and raw `set-var`.
- `array-field` bypasses those callbacks and keeps its existing behavior. This is **not** a fix for every legacy script parameter.

## Verification

- **Baseline.** All six new behavior regressions fail on unchanged main `0e2e911`. On that same commit, the control using the real ScriptEditor/Canvas bundle and the 26 existing regression and text tests pass.
- **Generated SSR and shared runtime.** Tests cover:
  - plain and component rows, reload and navigation;
  - loop precedence, live variables and row-local fields;
  - URL encoding and calculation;
  - a row's own `null` and dotted roots, and narrow fallback privacy;
  - raw numbers, booleans, `null`, objects and arrays passing through later assignments.

  The pruned production runtime checks the resulting output. The shared runtime's existing observation hook checks the exact raw types.
- **Combined carriers.** One test runs a script alongside initialized fields, links, images and text, including braces in data.
- **No effect on other sites.** The new helpers are pruned from runtimes that don't use client lists. For a server-only fixture, the generated TSX — including the runtime content hash — is byte-identical to the original baseline.
- **Native CI.** Two cases edit a real ScriptEditor value, exercise undo/redo and reloading the saved document, then run the generated page. Fixture bundling and test discovery pass locally; native browser execution is **still pending**. The DOM model is not a substitute for real event and selection behavior.
