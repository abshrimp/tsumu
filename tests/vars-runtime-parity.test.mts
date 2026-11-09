import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { VARS_RUNTIME, KEEP_ESCAPES, interpolate, interpolateJson, interpolateUrl, lookupVar, varText } from "../lib/vars";

import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";

const jsonStart = PAGE_DATA_RUNTIME.indexOf("  function jsonBody(");
const jsonEnd = PAGE_DATA_RUNTIME.indexOf("  // Apply the shared", jsonStart);
assert.ok(jsonStart >= 0 && jsonEnd > jsonStart);
const browserJson = runInNewContext(PAGE_DATA_RUNTIME.slice(jsonStart, jsonEnd) + "\njsonBody", { read: lookupVar, text: varText });

const module = { exports: {} as any };
runInNewContext(transformSync(VARS_RUNTIME, { loader: "ts", format: "cjs" }).code, { module });
const generated = module.exports;
const vars = { name: 'A"\\\nB', slug: "日本 /?", list: [1, "two"], obj: { value: 3 } };

test("published JSON bodies preserve escaped literal braces exactly as editor previews", () => {
  const template = JSON.stringify({ literal: "\\{name}", actual: "{name}" });
  const expected = { literal: "{name}", actual: vars.name };
  assert.deepEqual(JSON.parse(interpolateJson(template, vars)), expected);
  assert.deepEqual(JSON.parse(generated.interpolateJson(template, vars)), expected);
  assert.deepEqual(JSON.parse(browserJson(template, vars)), expected);
});

test("JSON runtime parity covers consecutive backslashes, quotes, adjacent and raw tokens", () => {
  for (let count = 0; count <= 8; count++) {
    const prefix = "\\".repeat(count);
    const literalTemplate = JSON.stringify({ text: prefix + "{name}" });
    const expected = count ? "\\".repeat(count - 1) + "{name}" : vars.name;
    for (const replace of [interpolateJson, generated.interpolateJson, browserJson]) {
      assert.equal(JSON.parse(replace(literalTemplate, vars)).text, expected);
    }
    for (const content of [prefix + "{name}", 'quoted"' + prefix + "{name}", prefix + "{missing}{name}", prefix + "{name}\\{list}"]) {
      const template = JSON.stringify({ text: content, next: "{slug}", escapedQuote: '\\"{name}' });
      const preview = interpolateJson(template, vars);
      assert.doesNotThrow(() => JSON.parse(preview), template);
      assert.equal(generated.interpolateJson(template, vars), preview, template);
      assert.equal(browserJson(template, vars), preview, template);
    }
  }
  for (const template of ['{"list":{list},"object":{obj},"missing":{missing}}', '["\\{name}", {list}, "{name}", "[slug]"]', '{"{slug}":"{name}"}']) {
    assert.equal(generated.interpolateJson(template, vars), interpolateJson(template, vars), template);
    assert.doesNotThrow(() => JSON.parse(generated.interpolateJson(template, vars)));
  }
});

test("plain and URL interpolation retain editor/runtime escaping and KEEP_ESCAPES parity", () => {
  for (const keep of [false, true]) {
    const values = { ...vars, [KEEP_ESCAPES]: keep, url: "https://example.com/path" };
    for (const template of ['\\{name}/{name}/[slug]', '\\\\{name}{list}{missing}', '{url}?q={name}', '/{slug}/{obj.value}/{list.-1}', '{obj}/{list}']) {
      assert.equal(generated.interpolate(template, values), interpolate(template, values));
      assert.equal(generated.interpolateUrl(template, values), interpolateUrl(template, values));
    }
  }
});
