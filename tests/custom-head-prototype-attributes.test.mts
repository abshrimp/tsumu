import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { headHtmlToJsx } from "../lib/generator/head";
const require=createRequire(import.meta.url);
function render(html:string) {
  const source=headHtmlToJsx(html,"");
  const module={exports:{} as any};
  new Function("require","module","exports",transformSync(`export default <>${source}</>`,{loader:"tsx",format:"cjs",jsx:"automatic"}).code)(require,module,module.exports);
  return { source, tree:module.exports.default, html:renderToStaticMarkup(module.exports.default) };
}
test("custom head prototype-named attributes cannot become executable JSX attribute names", () => {
  const {source,tree,html}=render('<meta name="example" constructor="metadata" CONSTRUCTOR="ignored">');
  assert.equal(tree.props.children.props.constructor,"metadata");
  assert.match(html,/constructor="metadata"/);
  assert.doesNotMatch(source,/function Object|native code/);
});
test("unknown named references in custom attributes remain literal rather than reading Object.prototype", () => {
  const {tree,html}=render('<meta scheme="&constructor; &amp; &#65;" content="plain">');
  assert.equal(tree.props.children.props.scheme,"&constructor; & A");
  assert.match(html,/scheme="&amp;constructor; &amp; A"/);
});
test("ordinary mapped, boolean and unknown head attributes retain their output", () => {
  const {tree}=render('<script charset="utf-8" async="false" language="javascript" src="/app.js"></script>');
  assert.deepEqual(tree.props.children.props,{charSet:"utf-8",async:true,language:"javascript",src:"/app.js"});
});
