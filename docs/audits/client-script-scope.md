# Client-list script expression scope

Generated list-template scripts previously resolved row references against server values before the clicked row existed. A `Selected {name}` assignment could therefore choose the first row's name for the second row. Whole-value `{tags}` assignments could copy the first row's array, and literal braces in data could be interpolated again. Clone-time replacement also froze live variables and fields before execution.

Template expression leaves now carry literal/reference parts; raw `set-var` leaves carry a separate typed reference. Execution checks the current loop scope, retained clicked-row scope, and then the referenced fallback or live lookup. Own row roots include null, empty values and missing nested children. The clone filler preserves these structured leaves rather than interpolating their serialized JSON. The ordinary lookup and template Proxy are unchanged.

Only explicitly referenced fallback values are transported. Scalar expressions use string fallbacks; raw assignments retain the referenced value's type. A referenced nested property does not transport its siblings, and unrelated server sentinel values remain absent. Data objects containing `scriptParts` or `rawRef` properties are not interpreted as expressions when copied through raw assignments.

## Scope and verification

- The change covers existing `compileScripts` string-expression callbacks and raw `set-var`. `array-field` bypasses those callbacks and retains its existing behavior; this is not a fix for every legacy script parameter.
- All six new behavior regressions fail on unchanged main `0e2e911`; the real ScriptEditor/Canvas bundle control and 26 existing regression/text tests pass there.
- Generated-SSR/shared-runtime tests cover plain/component rows, reload/navigation, loop precedence, live variables and row-local fields, URL encoding, calculation, own null/dotted roots, narrow fallback privacy, and raw numbers/booleans/null/objects/arrays through subsequent assignments. Pruned production runtime verifies resulting output, while the shared runtime's existing observation hook verifies exact raw types.
- A combined-carrier test checks script execution alongside initialized fields, links, images and text, including braces in data.
- New helpers are pruned from non-client runtimes. A server-only fixture's generated TSX, including the runtime content hash, is byte-identical to the original baseline.
- Two native CI cases edit a real ScriptEditor value, exercise undo/redo and saved-document reload, then execute the generated page. Fixture bundling and test discovery pass locally; native browser execution remains pending. The DOM model is not a substitute for native event/selection behavior.
