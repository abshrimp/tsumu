import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { headHtmlToJsx } from "../lib/generator/head";
const require=createRequire(import.meta.url);
function attributes(html:string) {
  const node=parseFragment(html).childNodes[0] as Html.Element;
  return Object.fromEntries(node.attrs.map(a=>[a.name,a.value]));
}
function emitted(html:string) {
  const mod={exports:{} as any};
  new Function("require","module","exports",transformSync('export default <>'+headHtmlToJsx(html,"")+'</>',{loader:"tsx",format:"cjs",jsx:"automatic"}).code)(require,mod,mod.exports);
  return renderToStaticMarkup(mod.exports.default);
}
for(const value of ['&copy; &NotEqualTilde; &Alpha;', '&#0; &#x80; &#xD800; &#1114112;', '&copy no-semicolon &#65 &#x42', '&copy=literal &notit; &amp;amp;', 'line\r\nnext\rtab\tend', '&constructor; &unknown; &AMP;']) test(`head attributes preserve HTML entity semantics: ${JSON.stringify(value)}`,()=>{
  for(const attr of ["content","scheme","data-value"]){
    const input=`<meta ${attr}="${value}">`;
    assert.deepEqual(attributes(emitted(input)),attributes(input),attr);
  }
});
test("head unquoted slash and empty attributes follow HTML parsing",()=>{
  for(const input of ['<meta name=x content=a/>','<link rel=stylesheet href=/style.css />','<meta name content="" scheme>'])
    assert.deepEqual(attributes(emitted(input)),attributes(input));
});
