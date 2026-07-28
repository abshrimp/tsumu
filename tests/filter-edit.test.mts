import assert from "node:assert/strict";
import { test } from "node:test";
import { editFilterFunction } from "../lib/filter-edit";

test("filter editing preserves order, repeated functions, and unsupported effects", () => {
  assert.equal(editFilterFunction('contrast(200%) brightness(150%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)', 'brightness', 'brightness(180%)'),
    'contrast(200%) brightness(180%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)');
});
test("nested and quoted filter text is not treated as a top-level effect", () => {
  const src = 'url("data:image/svg+xml;brightness(20%)") var(--effect, brightness(50%))';
  assert.equal(editFilterFunction(src, 'brightness', 'brightness(200%)'), src + ' brightness(200%)');
});
test("replacing nested math keeps the rest of the filter chain", () => {
  assert.equal(editFilterFunction('blur(calc(1rem + var(--extra))) saturate(2)', 'blur', 'blur(4px)'), 'blur(4px) saturate(2)');
});
test("removing blur preserves other backdrop filters", () => {
  assert.equal(editFilterFunction('saturate(2) blur(4px) opacity(.8)', 'blur', null), 'saturate(2) opacity(.8)');
});
test("adding an effect handles none and CSS wide keyword values", () => {
  for (const raw of [undefined, 'none', 'NONE', 'inherit', 'revert-layer'])
    assert.equal(editFilterFunction(raw, 'blur', 'blur(4px)'), 'blur(4px)');
});
test("matches function names case insensitively and preserves unrelated source", () => {
  assert.equal(editFilterFunction('BLUR(4px) contrast(200%)', 'blur', 'blur(6px)'), 'blur(6px) contrast(200%)');
});

test("comments containing filter names are preserved, not edited", () => {
  assert.equal(editFilterFunction('/* blur(2px) */ contrast(2)', 'blur', 'blur(4px)'), '/* blur(2px) */ contrast(2) blur(4px)');
  assert.equal(editFilterFunction('/* blur(2px) */ blur(3px) contrast(2)', 'blur', 'blur(4px)'), '/* blur(2px) */ blur(4px) contrast(2)');
});
