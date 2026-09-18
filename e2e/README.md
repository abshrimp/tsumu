# Browser smoke tests

The default Playwright config keeps the entire existing suite on Chromium and
runs tests tagged `@core-editing` or `@form-values` on Firefox and WebKit as
well. No smoke case is skipped or marked as an expected failure for a
particular engine.

The nine shared `@core-editing` cases cover site creation, reload and IndexedDB
persistence, deletion and undo, inspector/script panels, canvas reorder, script
block drag, multiline text, variable suggestions, and pasted text with
undo/redo. The two `@form-values` cases in `search-form-values.spec.ts`
(Next.js and React exports) check that search forms keep empty and repeated
fields.

```sh
npx playwright install chromium firefox webkit
npm run build
npm run test:e2e -- --grep "@core-editing|@form-values"
# Select one engine when investigating a failure:
npm run test:e2e -- --project=firefox
```

The discovery regression check needs dependencies but no server or browsers. It
checks Playwright's actual test list, including nonempty smoke coverage in all
three projects and retention of the full Chromium suite:

```sh
node --import tsx --test e2e/browser-projects.check.mts
```

CI runs this check in the `check` job. The four `e2e-shard` jobs
(`scripts/run-e2e-shard.mjs`) execute the full suite on Chromium, plus only
the tagged smoke tests on Firefox and WebKit. Each test file is assigned to
exactly one shard; the durations file only influences load balancing.

## Choosing the right test layer

- Use `tests/*.test.mts` for deterministic state transitions, validation,
  data transformations, and exhaustive input/operation combinations. These
  checks run in the `check` job without launching a browser.
- Use `e2e/*.spec.ts` when real browser behavior matters: pointer ownership,
  focus and IME, DOM layout and CSS, browser storage, Service Workers, or the
  editor's actual create/save/export/navigation flow. API-only cases in
  Playwright still validate the built server, even if they do not open a tab.
- For behavior covered at both layers, keep a small set of browser scenarios
  demonstrating the integration and place the full combinatorial matrix in
  Node tests. For example, `page-kind-confirmation` retains representative
  dialog, navigation, and collaboration cases in `e2e/`, while `tests/`
  verifies every mode and cancellation path. Likewise, input defaults, script
  assignments, image drop gesture endings, and committed field states sample
  the native browser paths rather than repeating their full Cartesian product.
- Do not delete a browser test merely because its filename also exists in
  `tests/`. Compare its assertions and unique browser behavior first.
  Preserve the multi-engine smoke tags when changing test selection.
- Run preview navigation and script lifecycle cases once when they only inspect
  document state. Exercise both Japanese and English when checking translated
  labels, accessible names and palette search.

The four shards use `scripts/e2e-shard-durations.json` as an estimate, not
as a test manifest. It records the sum of Playwright-reported case durations
from a successful CI run. Every run still discovers all tests dynamically,
including tests added after the last timing snapshot. Refresh the hint data
only from a successful full CI run, using each file's case count and summed
Playwright case durations. Check the discovered test list after reducing a
matrix. A failing E2E should be investigated rather than removed to make CI green.

## Coverage limits

- Chromium runs the full suite, including CDP-based multitouch tests. Those CDP
  tests cannot run through Firefox or WebKit's Playwright transports. They stay
  outside the shared smoke selection; real multitouch is not verified there.
- Firefox and WebKit run only the shared smoke cases above. The other
  regression suites have not been certified on those engines. In particular,
  some pointer cancellation fixtures assume a Chromium mouse pointer ID.
- The text paste case dispatches a `ClipboardEvent` with `DataTransfer`; it
  verifies editor handling, not OS clipboard permissions or native paste UI.
  The fixture explicitly attaches the data store because Firefox's event
  constructor can discard it. It checks the event payload before dispatch and
  in the receiving listener, then requires the editor to cancel the event and
  preserve the full text, variable chip, Undo/Redo history, and saved document.
- Playwright WebKit coverage does not establish support for every shipping
  Safari version or for iOS devices.
