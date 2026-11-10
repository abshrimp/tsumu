# Browser smoke tests (P5-04)

The default Playwright config keeps the entire existing suite on Chromium and
runs tests tagged `@core-editing` on Firefox and WebKit as well. No smoke case is
skipped or marked as an expected failure for a particular engine.

The nine shared cases cover site creation, reload and IndexedDB persistence,
deletion and undo, inspector/script panels, canvas reorder, script block drag,
multiline text, variable suggestions, and pasted text with undo/redo.

```sh
npx playwright install chromium firefox webkit
npm run build
npm run test:e2e -- --grep @core-editing
# Select one engine when investigating a failure:
npm run test:e2e -- --project=firefox
```

The discovery regression check needs dependencies but no server or browsers. It
checks Playwright's actual test list, including nonempty smoke coverage in all
three projects and retention of the full Chromium suite:

```sh
node --import tsx --test e2e/browser-projects.check.mts
```

## Coverage limits

- Chromium runs the full suite, including CDP-based multitouch tests. Those CDP
  tests cannot run through Firefox or WebKit's Playwright transports. They stay
  outside the shared smoke selection; real multitouch is not verified there.
- Firefox and WebKit currently run only the nine shared smoke cases. The other
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

## Validation in this maintenance checkout

The discovery regression failed against the original Chromium-only config and
passed after adding the matrix. Production build and TypeScript checks passed.
Browser execution could not complete: starting the local test server failed
with `listen EPERM`, and Chromium, Firefox, and WebKit downloads failed with DNS
`ENOTFOUND`. No runtime pass is claimed for any browser. Run the commands above
in an environment that permits the server and browser downloads before treating
the matrix as browser certification.

`MAINTENANCE_PLAN.md` was absent from this checkout, so the available task scope
and acceptance criteria were taken from the P5-04 request.
