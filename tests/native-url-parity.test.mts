import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { nativeDataModule } from "../lib/generator/native-data";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { interpolate, interpolateUrl, lookupVar, varText } from "../lib/vars";
import { safeNavigationUrl, safeResourceUrl } from "../lib/url-policy";
const module = { exports: {} as any };
runInNewContext(transformSync(nativeDataModule(), { format: "cjs" }).code, { module });
const native = module.exports;
const start = PAGE_DATA_RUNTIME.indexOf("  function interpolate(");
const end = PAGE_DATA_RUNTIME.indexOf("  function jsonBody(", start);
assert.ok(start >= 0 && end > start);
const browserInterpolate = runInNewContext(PAGE_DATA_RUNTIME.slice(start,end) + "\ninterpolate", { read: lookupVar, text: varText });

test("native links encode variable query/path components like Canvas and Next", () => {
  for (const value of ["a&admin=true#x", "my photo?.png", "日本/旅", "100%", '"quoted"', ""]) {
    for (const template of ["/search?q={value}", "/files/{value}", "{value}", "/[slug]", "\\{value}/{value}"]) {
      const vars = { value, slug: value };
      assert.equal(native.resolveUrl(template, vars), safeNavigationUrl(interpolateUrl(template,vars)), JSON.stringify({template,value}));
    }
  }
});
test("whole URL handling matches editor, including inline image URLs for fetch interpolation", () => {
  for (const value of ["https://example.com/a?x=1&y=2", "/a?x=1", "#section", "mailto:a@example.com", "tel:+123", "//evil.test", "javascript:alert(1)", "https:evil", "data:image/png;base64,AAAA", "data:image/svg+xml;base64,AAAA", "data:audio/wav;base64,AAAA", "blob:https://example.com/id"]) {
    const vars = { value };
    assert.equal(browserInterpolate("{value}",vars,true),interpolateUrl("{value}",vars),value);
    assert.equal(native.resolveUrl("{value}",vars),safeNavigationUrl(interpolateUrl("{value}",vars)),value);
  }
});
test("resource URL helpers retain inline media and block executable protocols", () => {
  for (const value of ["data:image/png;base64,AAAA", "data:image/svg+xml;base64,AAAA", "data:audio/wav;base64,AAAA", "data:video/mp4;base64,AAAA", "blob:https://example.com/id", "javascript:alert(1)", "data:text/html;base64,AAAA", "//evil.test", "/\\evil.test", "https://example.com/image?a=1&b=2"]) {
    assert.equal(native.resolveResourceUrl("{value}", {value}),safeResourceUrl(interpolate("{value}",{value})),value);
  }
});
test("nested native scopes shadow outer values without mutating them", () => {
  const outer = { value: "outer", nested: {value:"outer"} };
  const row = { value:"a/b?c", nested:{value:"inner"} };
  assert.equal(native.resolveUrl("/x/{value}",outer,row),"/x/a%2Fb%3Fc");
  assert.equal(native.resolveText("{nested.value}",outer,row),"inner");
  assert.equal(native.resolveText("{value}",outer,row,{value:undefined}),"");
  assert.equal(outer.value,"outer");
});
test("text token recognition matches editor for backticks and literal escapes", () => {
  for (const template of ["{bad`name}", "\\{value}", "{value}{missing}", "[slug]"]) {
    const vars = {value:"hello", slug:"s", "bad`name":"wrong"};
    assert.equal(native.resolveText(template,vars),interpolate(template,vars));
  }
});
