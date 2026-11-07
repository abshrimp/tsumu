# Client-list image source scope

## The problem

The image URL control in `components/SettingsPanel.tsx` uses `VarInput`, and commits the trimmed source through `updateNode`. A row image such as `/images/{name}.png` is valid editor input.

If the page also had a server scalar `name = {response.0.name}`, that server value consumed the `{name}` token before any row existed in the browser. The generated site then showed "First" for every row, while the canvas correctly showed "First" and "Second". Literal braces in fallback data could also be interpolated a second time.

## The fix

For variable image sources inside client templates, the generator now attaches:

- the original string and token parts, and
- only the scalar fallbacks that are actually referenced.

The runtime fills in `src` exactly once. It uses the same precedence as the existing text carrier (the row's own keys and roots first) and the same transparent GIF fallback. Both the metadata and the resolved source skip generic interpolation.

Nothing else was changed: `templateVars`, links, forms, scripts and image optimization are untouched.

## Evidence

- **Test file.** `tests/client-image-scope.test.mts` has five cases. They cover:
  - the real SettingsPanel callback in plain and component lists;
  - source collisions, repeated loading, serialization and reload, and navigation;
  - precedence for `null`, empty values, missing nested leaves and dotted keys;
  - escaped braces, slugs and literal fallback data;
  - that unused private values never appear in the HTML.
- **Faithful image config.** Generated SSR is rendered through a local `ImageConfigContext.Provider` that uses the image settings from the generated `next.config.mjs`. The shared `imageConfigDefault` is left unchanged. The tests assert that the output contains neither `srcSet` nor `/_next/image`, which matches the `images.unoptimized: true` setting of exported projects. Host optimization artifacts are therefore not evidence of a production bug.
- **No-collision control.** It passes both before and after the fix. No new image bug in the no-collision case is claimed.
- **Guards against side effects.**
  - Static sources keep `/static.png`, and static preload keeps `rel=preload`, `as=image` and `/static.png`.
  - Crisp SVG assets keep `/assets/*.svg`, a 120-wide SVG placeholder, and a 240×80 image for the 120×40 source.
  - Raw HTML keeps the literal `/{name}.png`.
  - Ordinary row dimensions stay 20×30, and template attributes are unchanged after rows load.
- **Baseline comparison.** Run against the baseline production files, the new tests fail on exactly the three collision and data-brace cases. The baseline no-collision and static/SVG guards pass.
- **Focused runs.** The final focused image + text run passed eight tests. An earlier image + text + nested run passed 22 tests, including one pre-existing small fixture-bundle check.
- **Not run.** No production build, install, full test suite or browser test was run.

## Native validation still pending

`e2e/client-image-scope.spec.ts` drives the real SettingsPanel image URL input:

1. It types `/images/{name}.png` and commits with Tab.
2. It checks undo/redo and reloading the saved document.
3. It checks repeated loading in the Canvas preview, generated output that is faithful to the config, and navigating away and back.

Both plain and component fixtures are covered. The existing official CI already runs every `e2e/*.spec.ts` through `npm run test:e2e`, so no separate workflow is needed.

These native tests were written but **not executed** during the resource pause. The full typecheck, full test suite, i18n check, production build and browser validation are all still pending. The priority and preload network behavior of dynamic images has not been validated; the guard above covers only the static preload markup.
