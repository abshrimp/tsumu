import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import { parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5';
import { renderToStaticMarkup } from 'react-dom/server';
import { headHtmlToJsx } from '../lib/generator/head';
const require = createRequire(import.meta.url);
function renderHead(html: string) {
  const source = headHtmlToJsx(html, '');
  const mod = { exports: {} as any };
  new Function('require', 'module', 'exports', transformSync('export default <>' + source + '</>', { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(require, mod, mod.exports);
  return { source, tree: mod.exports.default, html: renderToStaticMarkup(mod.exports.default) };
}
const emitted = (html: string) => renderHead(html).html;
function content(html: string) {
  return parseFragment(html).childNodes.filter((n): n is Html.Element => 'tagName' in n).map(n => ({
    tag: n.tagName, attrs: n.attrs,
    text: n.childNodes.filter((c): c is Html.TextNode => c.nodeName === '#text').map(c => c.value).join(''),
  })).sort((a, b) => a.tag.localeCompare(b.tag));
}
function attributes(html: string) {
  const node = parseFragment(html).childNodes[0] as Html.Element;
  return Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
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
for (const value of ['&copy; &NotEqualTilde; &Alpha;', '&#0; &#x80; &#xD800; &#1114112;', '&copy no-semicolon &#65 &#x42', '&copy=literal &notit; &amp;amp;', 'line\r\nnext\rtab\tend', '&constructor; &unknown; &AMP;']) test(`head attributes preserve HTML entity semantics: ${JSON.stringify(value)}`, () => {
  for (const attr of ['content', 'scheme', 'data-value']) {
    const input = `<meta ${attr}="${value}">`;
    assert.deepEqual(attributes(emitted(input)), attributes(input), attr);
  }
});
test('head unquoted slash and empty attributes follow HTML parsing', () => {
  for (const input of ['<meta name=x content=a/>', '<link rel=stylesheet href=/style.css />', '<meta name content="" scheme>'])
    assert.deepEqual(attributes(emitted(input)), attributes(input));
});
test('custom head prototype-named attributes cannot become executable JSX attribute names', () => {
  const { source, tree, html } = renderHead('<meta name="example" constructor="metadata" CONSTRUCTOR="ignored">');
  assert.equal(tree.props.children.props.constructor, 'metadata');
  assert.match(html, /constructor="metadata"/);
  assert.doesNotMatch(source, /function Object|native code/);
});
test('unknown named references in custom attributes remain literal rather than reading Object.prototype', () => {
  const { tree, html } = renderHead('<meta scheme="&constructor; &amp; &#65;" content="plain">');
  assert.equal(tree.props.children.props.scheme, '&constructor; & A');
  assert.match(html, /scheme="&amp;constructor; &amp; A"/);
});
test('ordinary mapped, boolean and unknown head attributes retain their output', () => {
  const { tree } = renderHead('<script charset="utf-8" async="false" language="javascript" src="/app.js"></script>');
  assert.deepEqual(tree.props.children.props, { charSet: 'utf-8', async: true, language: 'javascript', src: '/app.js' });
});
