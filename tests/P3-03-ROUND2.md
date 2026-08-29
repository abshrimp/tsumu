# P3-03 — round 2, architecture investigation

Audited 2026-11-10. Local HEAD and origin/main were
`d6f17ae54ae41aafb80ba5a969cbac35b73447f2`; the GitHub connector independently
confirmed remote main at that SHA. Fetching was blocked by the shared Git
directory's sandbox permissions, and shell network access could not resolve
github.com. This records the inspected SHA, not approval of a release baseline:
open PRs remained, and the connector returned no workflow runs for this commit.
No tasks.json was present; the supplied P3-03 assignment defined this work.

## Entry points and contracts

- `components/PublishModal.tsx`: runs checks/limitations, snapshots the document,
  and calls `prepareExportProject(target, options, site)` where `site` distinguishes
  production from preview. The generated file maps then go to the publish API.
- `lib/exportZip.ts`: scopes the document and calls the same preparation pipeline
  for the production target, then packages editable data and exported assets.
- `lib/export-formats.ts`: scope/prune, validate limitations, generate the Next.js
  base, adapt framework, apply CSS Modules/Tailwind, validate paths, convert
  Next/React TS to JS, apply preview guards, and inline single-HTML resources.
- `lib/generator.ts`: normalizes a cloned SiteDoc, emits routes/components/CSS and
  assets. `GeneratedProject` separates text files, base64 binaries, and remote
  asset references; every downstream adapter must preserve their paths.
- React adapts generated JSX or uses the browser data renderer. HTML shares the
  browser data runtime; single HTML closes over its resource dependencies.
- Vue/Nuxt/SvelteKit regenerate native node templates and route/data modules.
  Vue installs SSR/client entry points; Nuxt uses app head configuration and
  index/catch-all pages; SvelteKit uses app.html, server loads, and reactive pages.
- Style conversion runs after framework creation. JavaScript conversion runs
  after styles. Preview protection must survive both transformations, and must
  enter the actual framework head rather than only an unused output file.

## Confirmed finding and fix

**P2: Nuxt preview exports omit the document-level noindex directive.**

Reproduce with `prepareExportProject(doc, { framework: "nuxt", language:
"typescript", style: "css", scope: "project" }, "test")`. Evaluate the emitted
nuxt.config.ts: before the fix, `app.head.meta` contains only description. Nuxt
does not emit index.html or src/app.html, the two entry paths patched by the
shared preview postprocessor. Native page useHead calls add description/title/
language but no robots directive. Generated robots.txt and _headers do not
establish a document-level meta directive. The README promises noindex for test
publishes.

The publish target was lost at `buildAdditionalFramework`. Pass it through and
emit robots in Nuxt's global head for the test target. The production head keeps
its existing semantics. No SiteDoc/schema/node-ID changes are involved.

`tests/nuxt-preview-robots.test.mts` evaluates the emitted configuration after
style conversion across both languages, all three styles, and both targets.
Before the source fix: **6 failed / 6 passed** (every preview case failed).
After the source fix: **12 passed**. Root and catch-all page output plus existing
robots.txt/_headers are checked. This is a generated-config contract test, not
an installed Nuxt SSR integration test.

Completion gate: retain these tests and confirm a built Nuxt preview's root and
nested HTTP responses contain the robots meta, while production does not.

## Other hypotheses and overlap checks

- CSS Modules could lose escaped declarations or animation/keyframe names:
  existing compiler-based regression tests passed; no new failure established.
- React runtime script lists and query variants: current fixes #126 and #125
  are already present, and the relevant export regressions passed. No duplicate
  change was made.
- Empty native route tables: the publish caller rejects documents with no
  published pages via runChecks. Direct ZIP/API generation of such documents
  was not compiled with Vue/Svelte, so it is not claimed correct here.
- Native client navigation updates the selected page/data while runtime startup
  is mount-based. Browser navigation/lifecycle parity needs a framework runtime
  test; read-only tracing alone did not establish a new reproducible defect.
- Open PRs #129–#133 and local worktree changes were checked. #131 modifies the
  generated safe fetch source; #132 modifies editable ZIP handling. Neither
  overlaps this preview-head change. No competing fix was implemented.

## Validation and limits

Commands executed:

- `node --import tsx --test tests/nuxt-preview-robots.test.mts`: 12 passed after
  the failing-before run above.
- `node --import tsx --test tests/*export*.test.mts tests/css-module*.test.mts tests/native-*.test.mts tests/javascript-entry-rewrite.test.mts tests/pwa-retirement.test.mts`:
  340 passed, 1 environment failure. The Vue HTTP server test in
  export-recursive-ssr.test.mts cannot bind 127.0.0.1 (`listen EPERM`).
- `npm run typecheck`: passed.
- `npm run i18n:check`: passed.
- In-memory `prepareExportProject` smoke: 68 combinations generated successfully
  (seven formats, two languages, valid style choices, both targets). This checks
  generation, not framework builds.
- `npm run build`: blocked. Turbopack cannot resolve Next through node_modules
  linked outside its worktree root. Dependencies were temporarily reused from
  /Users/riku/tsumu/node_modules; that symlink was removed after validation.
- `git diff --check`: passed.

Runtime was Node 22.22.2, below the repository's declared Node >=26.12.1.
No clean npm ci, generated framework dependency installation/build matrix,
Nuxt HTTP integration, E2E/browser navigation, Worker build, Docker, or dependency
audit was completed in this sandbox. Full acceptance (all generated projects
build and behave correctly) remains subject to those checks in CI. No commit,
push, PR creation, merge, deployment, or infrastructure mutation was performed.
