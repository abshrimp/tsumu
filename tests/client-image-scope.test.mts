import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { scriptsFile } from '../lib/script-runtime';
import { EMPTY_GIF } from '../lib/generator/templates';
import { useEditor } from '../lib/store';
import { clientNestedCanvas, loadNestedUi, publishedClientNested } from './helpers/client-nested-lists';
import { clientImageDoc, imageItems } from './helpers/client-image-scope';
import { listRuntimeDom } from './helpers/list-runtime-dom';
const require = createRequire(import.meta.url);
const { parse } = require('next/dist/compiled/node-html-parser');
const nodes = (t: any): any[] => t && typeof t === 'object' ? Array.isArray(t) ? t.flatMap(nodes) : [t, ...nodes(t.props?.children)] : [];
const sources = (runtime: ReturnType<typeof listRuntimeDom>) => runtime.active('#picture').map(n => n.getAttribute('src'));

for (const component of [false, true]) test(`${component ? 'component' : 'plain'} image URL control keeps each client row source across reload/navigation`, async () => {
  let doc = clientImageDoc(component, '/before.png');
  useEditor.getState().replaceDoc(doc); useEditor.getState().setActivePage('p');
  const panel = loadNestedUi('components/SettingsPanel.tsx', true).default({ nodeId: 'picture' });
  const row = nodes(panel).find(n => n.props?.className === 'row' && nodes(n).some(x => x.type === 'label' && x.props.children === 'URL'));
  const input = nodes(row).find(n => n.props?.onCommit);
  assert.equal(input.props.value, '/before.png'); input.props.onCommit('/images/{name}.png');
  doc = structuredClone(useEditor.getState().doc);
  const saved = JSON.stringify(doc), config = JSON.stringify(require('next/dist/shared/lib/image-config').imageConfigDefault);
  const html = await publishedClientNested(doc, 'app/page.tsx', imageItems);
  assert.equal(JSON.stringify(require('next/dist/shared/lib/image-config').imageConfigDefault), config);
  assert.ok(!html.includes('srcSet=') && !html.includes('srcset=') && !html.includes('/_next/image'));
  const canvas = parse(clientNestedCanvas(doc, imageItems)).querySelectorAll('#picture').map((n: any) => n.getAttribute('src'));
  assert.deepEqual(canvas, ['/images/First.png', '/images/Second.png']);
  const runtime = listRuntimeDom(html, scriptsFile(doc));
  const template = { ...runtime.root.querySelector('[data-image-src-parts]')?.attrs };
  for (let i = 0; i < 2; i++) { await runtime.click('reload'); assert.deepEqual(sources(runtime), canvas); }
  assert.deepEqual(runtime.root.querySelector('[data-image-src-parts]')!.attrs, template);
  for (const n of runtime.active('#picture')) { assert.equal(n.getAttribute('width'), '20'); assert.equal(n.getAttribute('height'), '30'); }
  runtime.navigate('<span data-page-body="other"></span>'); runtime.navigate(html);
  await runtime.click('reload'); assert.deepEqual(sources(runtime), canvas); runtime.dispose();
  assert.equal(JSON.stringify(doc), saved);
  const reloaded = listRuntimeDom(await publishedClientNested(JSON.parse(saved), 'app/page.tsx', imageItems), scriptsFile(doc));
  await reloaded.click('reload'); assert.deepEqual(sources(reloaded), canvas); reloaded.dispose();
});

test('image tokens preserve fallback data braces, own null/empty/root/dotted keys, escapes and slug', async () => {
  const doc = clientImageDoc(false, '/{name}/{profile.label}/[slug]/\\{name}/{fallback}.png');
  const items = [
    { name: 'Data {label}', profile: { label: 'Global' }, slug: 'global', tags: [{ label: 'red' }] },
    { name: null, profile: null, slug: '', tags: [{ label: 'null' }] },
    { name: '', profile: {}, tags: [{ label: 'missing' }] },
    { 'profile.label': 'Literal {name}', tags: [{ label: 'dotted' }] },
    { name: 'Own {slug}', profile: { label: 'Own' }, slug: 'own', tags: [{ label: 'data' }] },
  ];
  (doc.pages.p.pageScripts![0].steps[0] as any).sample = items;
  for (const key of ['profile', 'slug']) doc.pages.p.pageScripts![0].steps.push({ id: key, kind: 'set-var', value: `{response.0.${key}}`, into: key });
  doc.pages.p.pageScripts![0].steps.push(
    { id: 'fallback', kind: 'set-var', value: 'Server \\{name}', into: 'fallback' },
    { id: 'private', kind: 'set-var', value: 'UNUSED_SERVER_PRIVATE', into: 'private' },
  );
  const html = await publishedClientNested(doc, 'app/page.tsx', items);
  assert.ok(!html.includes('UNUSED_SERVER_PRIVATE'));
  const runtime = listRuntimeDom(html, scriptsFile(doc)); await runtime.click('reload');
  assert.deepEqual(sources(runtime), [
    '/Data {label}/Global/global/{name}/Server {name}.png',
    '////{name}/Server {name}.png',
    '///global/{name}/Server {name}.png',
    '/Data {label}/Literal {name}/global/{name}/Server {name}.png',
    '/Own {slug}/Own/own/{name}/Server {name}.png',
  ]);
  const parts = runtime.root.querySelectorAll('[data-image-src-parts]').map(n => JSON.parse(n.getAttribute('data-image-src-parts')!));
  assert.ok(parts.flat().every((p: any) => typeof p === 'string' || (typeof p.name === 'string' && (!Object.hasOwn(p, 'fallback') || typeof p.fallback === 'string'))));
  runtime.dispose();
});

test('no global collision remains correct and empty row image uses the existing transparent fallback', async () => {
  const doc = clientImageDoc(false, '{name}');
  doc.pages.p.pageScripts![0].steps.pop();
  const items = [{ name: '/first.png', tags: [{}] }, { name: '/second.png', tags: [{}] }, { name: null, tags: [{}] }, { name: '', tags: [{}] }];
  (doc.pages.p.pageScripts![0].steps[0] as any).sample = items;
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await runtime.click('reload'); assert.deepEqual(sources(runtime), ['/first.png', '/second.png', EMPTY_GIF, EMPTY_GIF]); runtime.dispose();
});

test('static assets, crisp SVGs, raw content and server image preload keep their output', async () => {
  const doc = clientImageDoc(false, '/static.png');
  doc.nodes.picture.image!.priority = true;
  doc.assets.svg = { id: 'svg', name: 'shadow.svg', path: 'assets/shadow.svg', mimeType: 'image/svg+xml', width: 120, height: 40, svgFilter: true };
  doc.nodes.svg = { ...structuredClone(doc.nodes.picture), id: 'svg', attrId: 'svg', image: { ...doc.nodes.picture.image!, assetId: 'svg', width: 120, height: 40 } };
  doc.nodes.raw = { ...structuredClone(doc.nodes.picture), id: 'raw', attrId: 'raw', type: 'code', image: undefined, code: { html: '<img src="/{name}.png" />' } } as any;
  doc.nodes.row.children.push('svg', 'raw');
  const html = await publishedClientNested(doc, 'app/page.tsx', imageItems);
  assert.ok(!html.includes('data-image-src-parts'));
  const parsed = parse(html);
  assert.equal(parsed.querySelector('link[rel="preload"][href="/static.png"]')?.getAttribute('as'), 'image');
  const runtime = listRuntimeDom(html, scriptsFile(doc)); await runtime.click('reload');
  assert.deepEqual(sources(runtime), ['/static.png', '/static.png']);
  assert.equal(runtime.active('#svg').length, 2);
  assert.equal(runtime.active('#raw').length, 2);
  for (const span of runtime.active('#svg')) {
    const img = span.querySelector('img')!;
    assert.match(img.getAttribute('src')!, /^\/assets\/.*\.svg$/);
    assert.equal(img.getAttribute('width'), '240'); assert.equal(img.getAttribute('height'), '80');
    assert.equal(span.querySelector('svg')!.getAttribute('width'), '120');
  }
  for (const raw of runtime.active('#raw')) assert.equal(raw.querySelector('img')!.getAttribute('src'), '/{name}.png');
  runtime.dispose();
});
