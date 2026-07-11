import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { scriptsFile } from '../lib/script-runtime';
import { interpolateUrl } from '../lib/vars';
import { safeNavigationUrl } from '../lib/url-policy';
import { clientNestedCanvas, publishedClientNested } from './helpers/client-nested-lists';
import { clientLinkDoc, linkItems } from './helpers/client-link-scope';
import { listRuntimeDom } from './helpers/list-runtime-dom';
const { parse } = createRequire(import.meta.url)('next/dist/compiled/node-html-parser');
const hrefs = (runtime: ReturnType<typeof listRuntimeDom>) => runtime.active('#detail').map(n => n.getAttribute('href'));

for (const component of [false, true]) test(`${component ? 'component' : 'plain'} client links match Canvas with colliding server names and survive reload/navigation`, async () => {
  const doc = clientLinkDoc(component), saved = JSON.stringify(doc);
  const expected = parse(clientNestedCanvas(doc, linkItems)).querySelectorAll('#detail').map((n: any) => n.getAttribute('href'));
  assert.deepEqual(expected, ['/products/First', '/products/Second%20%26%20space', '/products/', '/products/', '/products/First', '/products/Data%20%7Blabel%7D%257Bname%257D']);
  const html = await publishedClientNested(doc, 'app/page.tsx', linkItems);
  assert.ok(!html.includes('UNUSED_SERVER_PRIVATE'));
  const runtime = listRuntimeDom(html, scriptsFile(doc));
  for (let i = 0; i < 2; i++) { await runtime.click('reload'); assert.deepEqual(hrefs(runtime), expected); }
  runtime.navigate('<span data-page-body="other"></span>'); runtime.navigate(html);
  await runtime.click('reload'); assert.deepEqual(hrefs(runtime), expected); runtime.dispose();
  assert.equal(JSON.stringify(doc), saved);
  const reloaded = listRuntimeDom(await publishedClientNested(JSON.parse(saved), 'app/page.tsx', linkItems), scriptsFile(doc));
  await reloaded.click('reload'); assert.deepEqual(hrefs(reloaded), expected); reloaded.dispose();
});

test('link parts retain only referenced scalar fallbacks and preserve roots, escapes and original positions', async () => {
  const url = '/profile/{profile.label}/[slug]/\\{name}/{fallback}';
  const doc = clientLinkDoc(false, url), html = await publishedClientNested(doc, 'app/page.tsx', linkItems);
  assert.ok(!html.includes('UNUSED_SERVER_PRIVATE'));
  const runtime = listRuntimeDom(html, scriptsFile(doc)); await runtime.click('reload');
  assert.deepEqual(hrefs(runtime), ['Global/global', 'Own/second', '/', '/global', 'Literal%20%7Bname%7D/global', 'Global/global'].map(v => `/profile/${v}/{name}/Server%20%7Bname%7D`));
  for (const n of runtime.root.querySelectorAll('[data-href-parts]')) {
    for (const p of JSON.parse(n.getAttribute('data-href-parts')!)) {
      assert.ok(typeof p === 'string' || (typeof p.name === 'string' && typeof p.at === 'number' && (!Object.hasOwn(p, 'fallback') || typeof p.fallback === 'string')));
    }
  }
  runtime.dispose();
});

for (const url of ['{url}', '{scheme}:alert(1)', '/{url}', '{empty}{url}', '/literal/%7Bname%7D', '/static']) test(`URL encoding and complete navigation policy: ${url}`, async () => {
  const values = ['https://example.com/a?x={name}', '/safe/{name}', 'mailto:a@example.com', '#section', 'javascript:alert(1)', '//evil.example', '/\\evil.example', '/a\nb', 'https:\\evil.example', 'data:image/png;base64,x'];
  const items = values.map(url => ({ url, empty: '', scheme: 'javascript', tags: [{ label: 'row' }] }));
  const doc = clientLinkDoc(false, url, items);
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc)); await runtime.click('reload');
  assert.deepEqual(hrefs(runtime), items.map(item => safeNavigationUrl(interpolateUrl(url, item)))); runtime.dispose();
});

test('new-tab links use the same row parts while server-rendered links need no client metadata', async () => {
  const doc = clientLinkDoc(); doc.nodes.detail.link!.newTab = true;
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', linkItems), scriptsFile(doc));
  await runtime.click('reload');
  assert.equal(hrefs(runtime)[1], '/products/Second%20%26%20space');
  assert.ok(runtime.active('#detail').every(n => n.getAttribute('target') === '_blank' && n.getAttribute('rel') === 'noopener noreferrer'));
  runtime.dispose();
  doc.nodes.products.list!.from = 'response';
  const html = await publishedClientNested(doc, 'app/page.tsx', linkItems);
  assert.ok(!html.includes('data-href-parts'));
  assert.deepEqual(parse(html).querySelectorAll('#detail').map((n: any) => n.getAttribute('href')), linkItems.map(item => safeNavigationUrl(interpolateUrl('/products/{name}', { name: 'First', ...item }))));
});
