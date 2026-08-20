# P1-02 — Phase 1 test baseline

Recorded 2026-11-10 (Asia/Tokyo), starting at commit
`5e6539a196928673529009d021139be66fd6f44d` with a clean tracked tree.
`MAINTENANCE_PLAN.md` was not present in this checkout or the main checkout;
this audit follows the supplied P1-02 objective and constraints.

## Environment and reproduction

- Platform: macOS, Darwin arm64, restricted filesystem/network sandbox.
- Runtime used: Node **26.12.1**, npm **12.2.1**, matching `.nvmrc` and
  `package.json`. The shell initially selected Node 22.22.2/npm 10.9.7;
  all checks below explicitly used the matching installation on `PATH`.
- An offline `npm ci --ignore-scripts` attempt with a fresh temporary cache
  failed with `ENOTCACHED`. Checks used a private copy of the main checkout's
  existing `node_modules`, not a successful clean install. Its installed-lockfile
  package versions/integrities matched this lockfile wherever present in both.
  `npm ls --depth=0` reported the declared direct dependencies, plus two
  extraneous packages: `@emnapi/runtime` and `@img/sharp-wasm32`.
  This limits what the run establishes about fresh dependency installation.
- No local credential files were copied. The worker build reported incomplete
  server storage and selected browser-only storage; it did not deploy anything.

On a machine with registry access and permission to open local sockets, run
each command independently from the repository root and retain its exit code
and output (do not stop collecting evidence after the first failed command):

```sh
nvm use
node --version
npm --version
npm ci
npm run typecheck
npm test
npm run i18n:check
npm run build
npm run test:e2e -- --list
npm run test:e2e
npm run build:worker
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
```

Install Chromium with `npx --no-install playwright install chromium` if needed
before E2E execution. Run the application and worker builds sequentially because
they both write `.next`. The E2E command expects a completed application build.
This audit used `--fetch-retries=0` and a writable temporary npm cache for the
audit commands, so unavailable DNS was reported promptly.

## Observed baseline

| Check | Exit | Result / classification |
| --- | --- | --- |
| `npm run typecheck` | 0 | Passed before and after the checker fix. |
| `npm test` before changes | 1 | 2,805 tests: 2,804 passed, one failed, zero skipped. Environment blocker described below. |
| `npm test` after changes | 1 | 2,814 tests: 2,813 passed, the same one failed, zero skipped. All nine added regressions passed. |
| `npm run i18n:check` | 0 | English dictionary passes before and after the fix; the original success did not establish that the checker handled all static literal forms correctly. |
| `npm run build` | 0 | Production build completed. Nonfatal middleware-to-proxy deprecation warning. |
| `npm run build:worker` | 0 | OpenNext completed and generated `.open-next/worker.js`; same nonfatal Next.js warning. |
| `npm run test:e2e -- --list` | 0 | Discovered 806 tests in 109 files. Discovery is not execution. |
| `npm run test:e2e` | 1 | Web server could not bind `0.0.0.0:3210`: `listen EPERM`. No browser test results established. |
| Production npm audit | 1 | Registry advisory request failed with `getaddrinfo ENOTFOUND registry.npmjs.org`. Vulnerability status unknown. |
| All-dependencies npm audit | 1 | Same registry DNS blocker; vulnerability status unknown. |

The single unit failure is in `tests/export-recursive-ssr.test.mts`:
**generated Vue HTTP server rejects invalid request targets before rendering**.
It fails while binding an ephemeral HTTP server to `127.0.0.1`, with
`listen EPERM`, before its request assertions. The failure recurred in the
post-change run. It is not evidence of a product assertion failure, and the
test was not skipped or altered. E2E server startup independently encounters
the same socket restriction. Both need rerunning in a socket-capable environment;
the audits need registry access. These blocked checks must not be marked green.

## Fixed issue group: i18n baseline gate accuracy

The checker searched raw source with regular expressions and decoded JavaScript
strings using `JSON.parse`. It missed single-quoted and static template literals,
missed comments between call tokens, matched examples inside comments/strings/JSX
text, and crashed on valid JavaScript-only escapes. Its dictionary check also
accepted empty values and treated a generic translation as a fallback for `trc`,
although the runtime only looks up the context-specific key.

The checker now traverses TS/TSX syntax using the existing
`@typescript/typescript6` dependency, checks both direct and member calls (such as
the server's `r.tr(...)`), and requires a nonempty translation for the actual
runtime key. No dependency or application-runtime changes were needed.

Regression tests execute the real CLI in disposable source trees. Of the initial
eight regression cases, six failed against the original checker and all eight
passed with the fix. A ninth case preserves coverage of server member calls.
The focused command includes the existing test for dynamically selected export
format labels:

```sh
node --import tsx --test tests/i18n-check.test.mts tests/export-format-labels.test.mts
```

Result: **10 passed, zero failed, zero skipped**. Existing tests and assertions
remain unchanged. Static inspection still does not resolve dynamic keys, aliases,
or computed calls; those require explicit tests such as the export-label test.

The change is confined to this checker, its regression tests, and this baseline.
CI workflows, authentication source, secrets, and tracked deployment configuration
were not modified. No commits, pushes, PRs, or merges were performed.
