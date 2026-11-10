# Browser smoke tests (P5-04)

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

CI runs this check in the `check` job, and runs the whole Playwright suite on
all three engines in the `e2e-shard` jobs (`scripts/run-e2e-shard.mjs`, four
shards).

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
