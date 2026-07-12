import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { scriptsFile } from '../lib/script-runtime';
import { clientNestedCanvas, publishedClientNested } from './helpers/client-nested-lists';
import { clientLiteralAttributesDoc, literalItems, literalText, literalSource, literalEmbed } from './helpers/client-literal-attributes';
import { listRuntimeDom } from './helpers/list-runtime-dom';
const { parse } = createRequire(import.meta.url)('next/dist/compiled/node-html-parser');
const tree = (n: any): unknown => [n.nodeType, n.tagName, n.nodeValue, n.attrs, n.childNodes.map(tree)];
const attributes = (select: (s: string) => any[]) => ({
  image: select('#picture').map(n => n.getAttribute('alt')),
  svg: select('#svg').map(n => (n.tagName === 'IMG' ? n : n.querySelector('img')).getAttribute('alt')),
  audio: select('#audio').map(n => n.getAttribute('src')),
  video: select('#video').map(n => n.getAttribute('src')),
  embed: select('#frame').map(n => n.querySelector('iframe').getAttribute('src')),
});
for (const component of [false, true]) test(`${component ? 'component' : 'plain'} literal image/media attributes match Canvas and server lists after reload/navigation`, async () => {
  const doc = clientLiteralAttributesDoc(component), saved = JSON.stringify(doc);
  const canvas = parse(clientNestedCanvas(doc, literalItems));
  const expected = attributes(s => canvas.querySelectorAll(s));
  assert.deepEqual(expected, { image: Array(3).fill(literalText), svg: Array(3).fill(literalText),
    audio: Array(3).fill(literalSource), video: Array(3).fill(literalSource), embed: Array(3).fill(literalEmbed) });
  const serverDoc = structuredClone(doc); serverDoc.nodes.products.list!.from = 'response';
  const server = parse(await publishedClientNested(serverDoc, 'app/page.tsx', literalItems));
  assert.deepEqual(attributes(s => server.querySelectorAll(s)), expected);
  const html = await publishedClientNested(doc, 'app/page.tsx', literalItems);
  const runtime = listRuntimeDom(html, scriptsFile(doc));
  try {
    const template = JSON.stringify(tree(runtime.root.querySelector('[data-tpl]')!));
    for (let i = 0; i < 2; i++) {
      await runtime.click('reload'); assert.deepEqual(attributes(s => runtime.active(s)), expected);
      // 動的画像の URL は引き続き項目ごとに解決する。
      assert.deepEqual(runtime.active('#picture').map(n => n.getAttribute('src')), ['/images/First.png', '/images/Second.png', '/images/First.png']);
    }
    assert.equal(JSON.stringify(tree(runtime.root.querySelector('[data-tpl]')!)), template);
    runtime.navigate('<span data-page-body="other"></span>'); runtime.navigate(html);
    await runtime.click('reload'); assert.deepEqual(attributes(s => runtime.active(s)), expected);
  } finally { runtime.dispose(); }
  assert.equal(JSON.stringify(doc), saved);
  const restored = JSON.parse(saved);
  const reload = listRuntimeDom(await publishedClientNested(restored, 'app/page.tsx', literalItems), scriptsFile(restored));
  try { await reload.click('reload'); assert.deepEqual(attributes(s => reload.active(s)), expected); }
  finally { reload.dispose(); }
});
