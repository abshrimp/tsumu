import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import { parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5';
import { renderToStaticMarkup } from 'react-dom/server';
import { headHtmlToJsx } from '../lib/generator/head';
const require = createRequire(import.meta.url);
function emitted(html: string) {
  const mod = { exports: {} as any };
  new Function('require', 'module', 'exports', transformSync('export default <>' + headHtmlToJsx(html, '') + '</>', { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(require, mod, mod.exports);
  return renderToStaticMarkup(mod.exports.default);
}
function content(html: string) {
  return parseFragment(html).childNodes.filter((n): n is Html.Element => 'tagName' in n).map(n => ({
    tag: n.tagName, attrs: n.attrs,
    text: n.childNodes.filter((c): c is Html.TextNode => c.nodeName === '#text').map(c => c.value).join(''),
  })).sort((a, b) => a.tag.localeCompare(b.tag));
}
test('custom head preserves complete double-escaped script body in executable output', () => {
  const body = '<!--\nconst tag="<script>";\nconst end="</script>";\nconst marker=42;\n// -->';
  const input = `<script>${body}</script><meta name="after" content="kept">`;
  const result = emitted(input);
  assert.deepEqual(content(result), content(input));
  const script = content(result).find(n => n.tag === 'script')!.text;
  assert.equal(new Function(script + '\nreturn marker')(), 42);
});
for (const [name, input] of [
  ['raw text with entities and quoted markup', '<style>.x:after{content:"&copy; <meta>"}</style><title>A &amp;amp; &copy; &lt;meta&gt;</title><noscript><link href="/fallback.css" rel="stylesheet"></noscript>'],
  ['HTML comment boundaries', '<!-- empty --!><meta name="kept" content="yes"><!-- <meta name="hidden"> -->'],
  ['unfinished title consumes apparent markup', '<title>Title &amp; <meta name="not-an-element">'],
  ['unclosed script body remains code', '<script>const value=42;'],
]) test(`custom head matches HTML body semantics: ${name}`, () => {
  assert.deepEqual(content(emitted(input)), content(input));
});
test('custom head does not promote tags inside body-only elements', () => {
  assert.equal(headHtmlToJsx('<div><meta name="nested"></div>', ''), '');
});
