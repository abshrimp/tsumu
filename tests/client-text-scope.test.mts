import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ctx, type EdCtx } from '../components/script-editor/context';
import { pageArrays, previewDataVars } from '../lib/data';
import { makeText } from '../lib/presets';
import { scriptsFile } from '../lib/script-runtime';
import { useEditor } from '../lib/store';
import { clientNestedDoc, clientNestedCanvas, loadNestedUi, publishedClientNested } from './helpers/client-nested-lists';
import { listRuntimeDom } from './helpers/list-runtime-dom';
const { parse } = createRequire(import.meta.url)('next/dist/compiled/node-html-parser');
const nodes = (t: any): any[] => t && typeof t === 'object' ? Array.isArray(t) ? t.flatMap(nodes) : [t, ...nodes(t.props?.children)] : [];
const details = (r: ReturnType<typeof listRuntimeDom>) => r.active('#detail').map(n => n.textContent);

for (const component of [false, true]) test(`${component ? 'component' : 'plain'} supported UI scalar collision matches Canvas on reload and navigation`, async () => {
  let doc = clientNestedDoc(component);
  const items = [{ name: 'First', tags: [{ label: 'red' }] }, { name: 'Second', tags: [{ label: 'green' }] }];
  (doc.pages.p.pageScripts![0].steps[0] as any).preview = { sample: items };
  doc.pages.p.pageScripts![0].steps.push({ id: 'global-name', kind: 'set-var', value: '{response.0.name}', into: 'name' });
  doc.nodes.tags.list!.from = '';
  useEditor.getState().replaceDoc(doc); useEditor.getState().setActivePage('p');
  const panel = loadNestedUi('components/SettingsPanel.tsx', true).default({ nodeId: 'tags' });
  const row = nodes(panel).find(n => n.props?.className === 'row' && nodes(n).some(x => x.type === 'label' && x.props.children === '表示するリスト'));
  const drop = nodes(row).find(n => n.props?.options).props;
  assert.ok(drop.options.some((o: any) => o.value === 'tags')); drop.onChange('tags');
  doc = structuredClone(useEditor.getState().doc);
  const { StepBody } = loadNestedUi('components/script-editor/StepBody.tsx');
  for (const step of [doc.pages.p.pageScripts![0].steps.at(-1)!, doc.nodes.reload.scripts![0].steps[0]]) {
    const html = renderToStaticMarkup(React.createElement(Ctx.Provider, { value: {
      doc, pageId: 'p', samples: previewDataVars(doc, 'p'), arrays: pageArrays(doc, 'p'), updateStep() {}, renameVar() {},
    } as unknown as EdCtx }, React.createElement(StepBody, { step })));
    assert.equal(parse(html).querySelector(".se-value-choice input")?.getAttribute("value"), (step as any).value);
    assert.ok(html.includes(`value="${(step as any).into}"`));
  }
  const saved = JSON.stringify(doc), html = await publishedClientNested(doc, 'app/page.tsx', items);
  const canvas = parse(clientNestedCanvas(doc, items)).querySelectorAll('#detail').map((n: any) => n.textContent);
  assert.deepEqual(canvas, ['Detail First:red', 'Detail Second:green']);
  const runtime = listRuntimeDom(html, scriptsFile(doc));
  for (let i = 0; i < 2; i++) { await runtime.click('reload'); assert.deepEqual(details(runtime), canvas); }
  await runtime.click('hide', 1); assert.equal(runtime.active('#detail')[1].style.display, 'none');
  runtime.navigate('<span data-page-body="other"></span>'); runtime.navigate(html);
  await runtime.click('reload'); assert.deepEqual(details(runtime), canvas); runtime.dispose();
  assert.equal(JSON.stringify(doc), saved);
  const reloaded = listRuntimeDom(await publishedClientNested(JSON.parse(saved), 'app/page.tsx', items), scriptsFile(doc));
  await reloaded.click('reload'); assert.deepEqual(details(reloaded), canvas); reloaded.dispose();
});

test('text tokens preserve own roots, fallback strings, escapes, slug and child elements without second interpolation', async () => {
  const doc = clientNestedDoc();
  const items: any[] = [
    { name: 'Server', profile: { label: 'Global' }, slug: 'global', tags: [{ label: 'red' }] },
    { name: null, profile: null, slug: '', tags: [{ label: 'null' }] },
    { name: '', profile: {}, tags: [{ label: 'missing' }] },
    { 'profile.label': 'Literal {name}', tags: [{ label: 'dotted' }] },
    { name: 'Data {slug}', profile: { label: 'Own' }, slug: 'own', tags: [{ label: 'data' }] },
  ];
  (doc.pages.p.pageScripts![0].steps[0] as any).preview = { sample: items };
  for (const key of ['name', 'profile', 'slug']) doc.pages.p.pageScripts![0].steps.push({ id: key, kind: 'set-var', value: `{response.0.${key}}`, into: key });
  doc.pages.p.pageScripts![0].steps.push(
    { id: 'fallback', kind: 'set-var', value: 'Server \\{name}', into: 'fallback' },
    { id: 'private', kind: 'set-var', value: 'UNUSED_SERVER_PRIVATE', into: 'private' },
  );
  doc.nodes.detail.text!.content = '{name}|{profile.label}|[slug]|\\{name}|{fallback}';
  doc.nodes.detail.children.push('child');
  doc.nodes.child = { ...makeText(' child {label}'), id: 'child', attrId: 'child' };
  const html = await publishedClientNested(doc, 'app/page.tsx', items);
  assert.ok(!html.includes('UNUSED_SERVER_PRIVATE'));
  const runtime = listRuntimeDom(html, scriptsFile(doc)); await runtime.click('reload');
  assert.deepEqual(details(runtime), [
    'Server|Global|global|{name}|Server {name} child red',
    '|||{name}|Server {name} child null',
    '||global|{name}|Server {name} child missing',
    'Server|Literal {name}|global|{name}|Server {name} child dotted',
    'Data {slug}|Own|own|{name}|Server {name} child data',
  ]);
  assert.equal(runtime.active('#child').length, 5);
  const parts = runtime.root.querySelectorAll('[data-text-parts]').map(n => JSON.parse(n.getAttribute('data-text-parts')!));
  assert.ok(parts.flat().every((p: any) => typeof p === 'string' || (typeof p.name === 'string' && (!Object.hasOwn(p, 'fallback') || typeof p.fallback === 'string'))));
  runtime.dispose();
});
