# Client-list field value scope

## The problem

Form fields inside a list that renders in the browser (a client list) were filled in too early. The generator resolved row tokens against server variables before any row existed.

For example, take a field with the default `Edit {name}` or the placeholder `Find {name}`, inside a list whose rows are "First" and "Second". If the page also had a server variable called `name`, every row showed "First" — while the canvas correctly showed "First" and "Second". In addition, literal braces inside resolved data could be expanded a second time.

## The fix

For template fields, the generator now keeps the original parts — literal strings and references — of:

- values and placeholders,
- options and labels, and
- constraints.

The row's own data is used whenever it is present:

- **Only referenced scalar fallbacks are sent to the browser.** Nothing else from the server is transported.
- **A row's own keys and roots always win**, even when the value is `null`, an empty string, a missing nested child, or a literal key that contains dots.
- **Live references stay live.** They're read when the script runs or the field refreshes, and values the user has edited are never overwritten.
- **Fields outside client lists are unaffected** and keep their original generation path.

### Order of application

- Native values and defaults are applied after constraints and option text.
- For a select, live option text refreshes before a value is selected, so a script step that runs right afterward reads the new selection immediately.
- Range defaults that are static or absent are applied again after the variable bounds, so the browser can normalize them using that row's bounds. No custom range-normalization algorithm was added.

## Verification

- **Focused tests.** Seven tests of generated SSR and the production runtime pass. Against the original production files, six of them fail (the regressions); the remaining control — no collision, static, server-only — passes.
- **Coverage.** The tests cover:
  - plain and component lists, repeated loading and navigation;
  - value, placeholder, textarea, select, radio, checkbox and submit text;
  - escapes and literal braces in data;
  - privacy of scalar fallbacks, live references and user edits;
  - absent select defaults, and a select read immediately by the same script.
- **Independent review.** A reviewer reproduced the select-ordering bug in the first implementation and raised the risk around static range defaults. Both were fixed and reviewed again.
- **Full local suite.** 1,120 tests pass. Typecheck, i18n and the production webpack build also pass.
- **Native CI tests.** Three tests drive the real SettingsPanel default edits, undo/redo, reloading the saved document, the Canvas preview and the generated output. They also cover resetting a textarea form; range bounds, static defaults and midpoints; and keeping trusted typed values. They are registered and type-checked, but **have not been run locally**.

## Limits of this evidence

- The DOM test helper models only part of the form API. It is not evidence about native normalization, selection dirtiness or real browser event behavior.
- Native CI must pass on the final remote head before merging.
- This change doesn't touch link URLs or the compilation of script expressions.
