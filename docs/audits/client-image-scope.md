# Client-list image source scope

The image URL control in `components/SettingsPanel.tsx` uses `VarInput` and commits a trimmed source through `updateNode`. A row image `/images/{name}.png` is supported editor input. A server scalar `name = {response.0.name}` previously consumed this token before the client row existed, producing First/First instead of Canvas First/Second. Literal braces in fallback data could also be interpolated again.

The generator now attaches original string/token parts and only referenced scalar fallbacks to variable image sources inside client templates. The runtime fills `src` once, using the existing text carrier's own-key/root precedence and transparent GIF fallback. Both metadata and the resolved source bypass generic interpolation. No changes were made to templateVars, links, forms, scripts, or image optimization.

## Evidence

- `tests/client-image-scope.test.mts`: five cases cover plain/component real SettingsPanel callback, source collisions, repeat loading, serialization/reload, navigation, null/empty/missing nested leaf/dotted key precedence, escaped braces, slug, literal fallback data, and unused private values not appearing in HTML.
- Generated SSR is rendered through a local `ImageConfigContext.Provider` with the generated `next.config.mjs` images settings. Shared `imageConfigDefault` remains unchanged. Output is asserted to contain neither srcSet nor `/_next/image`. This matches exported projects' `images.unoptimized: true`; host optimization artifacts are not evidence of a production bug.
- No-collision control passes before and after the fix. No new no-collision image bug is claimed.
- Static sources keep `/static.png`; static preload retains `rel=preload`, `as=image`, and `/static.png`. Crisp SVG assets retain `/assets/*.svg`, a 120-wide SVG placeholder, and a 240×80 image for the 120×40 source. Raw HTML keeps literal `/{name}.png`. Ordinary row dimensions remain 20×30. Template attributes remain unchanged after row loading.
- Running the new tests against baseline production files fails exactly the three collision/data-brace cases. Baseline no-collision and static/SVG guards pass.
- Final focused image+text run: eight passing tests. An earlier image+text+nested run passed 22 tests, including one preexisting small fixture-bundle check. No production build, install, full suite, or browser was run.

## Native validation pending

`e2e/client-image-scope.spec.ts` uses the actual SettingsPanel image URL input, fills `/images/{name}.png`, commits via Tab, checks undo/redo and saved document reload, then checks repeated Canvas preview loading, config-faithful generated output, and page navigation away/back. Plain and component fixtures are covered. The existing official CI runs all `e2e/*.spec.ts` through `npm run test:e2e`; no separate workflow is necessary.

These native tests are authored but not executed during the resource pause. Full typecheck, full test suite, i18n check, production build, and browser validation remain pending. Dynamic-image priority/preload network behavior has not been validated; the guard above covers only static preload markup.
