# Client-list field value scope

Generated client-list form fields previously consumed row tokens against server variables before a row existed. A supported `Edit {name}` default or `Find {name}` placeholder therefore displayed First/First instead of Canvas First/Second when a server variable `name` existed. Literal braces in resolved data could be expanded a second time.

The generator now retains original string/reference parts for template field values, placeholders, options, labels and constraints. Only referenced scalar fallbacks are transported. Own row keys/roots win, including null, empty strings, missing nested children and literal dotted keys. Live references remain live at execution/refresh time, and edited values are not overwritten. Non-client fields retain their original generation path.

Native values and defaults are applied after constraints and option text. Select live option text refreshes before value selection so a following script step immediately reads the new selection. Static/absent range defaults are reapplied after variable bounds, allowing the browser to normalize them using the row's bounds. No custom range-normalization algorithm was added.

## Verification

- Seven focused generated-SSR/production-runtime tests pass. Original production files fail six regressions and pass the no-collision/static/server-only control.
- The tests cover plain/component lists, repeated loading, navigation, value/placeholder/textarea/select/radio/checkbox/submit text, escapes and literal data braces, scalar fallback privacy, live references, user edits, absent select defaults and immediate same-script select reads.
- An independent review reproduced the select ordering bug in the first implementation and raised the static range-default risk. Both were corrected and re-reviewed.
- Full local suite: 1,120 passing tests. Typecheck, i18n and production webpack build pass.
- Three native CI tests use actual SettingsPanel default edits, undo/redo, saved-document reload, Canvas preview and generated output; additionally cover textarea form reset, range bounds/static defaults/midpoints and trusted typed-value preservation. They are registered and typechecked but have not run locally.

The DOM test helper models a limited form API; it is not evidence of native normalization, selection dirtiness or browser event behavior. Native CI must pass for the final remote head before merging. The work does not change link URLs or script expression compilation.
