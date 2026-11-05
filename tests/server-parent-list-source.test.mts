import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { Ctx, type EdCtx } from '../components/script-editor/context';
import { pagePlan, pageArrays, previewDataVars } from '../lib/data';
import { generateProject } from '../lib/generator';
import { makeBox, makeText } from '../lib/presets';
import { SCRIPT_RUNTIME, scriptsFile } from '../lib/script-runtime';
import { useEditor } from '../lib/store';
import { clientNestedCanvas, loadNestedUi, publishedClientNested } from './helpers/client-nested-lists';
import { listRuntimeDom } from './helpers/list-runtime-dom';
import { serverSourceDoc, serverSourceItems, serverSourceBundle } from './helpers/server-parent-list-source';
const { parse } = createRequire(import.meta.url)('next/dist/compiled/node-html-parser');
const details = (r: ReturnType<typeof listRuntimeDom>) => r.active('#detail').map(n => n.textContent);
const canvas = (doc: ReturnType<typeof serverSourceDoc>, items: unknown[] = serverSourceItems) => parse(clientNestedCanvas(doc, items)).querySelectorAll('#detail').map((n: any) => n.textContent);
const treeNodes = (tree: any): any[] => tree && typeof tree === 'object' ? Array.isArray(tree) ? tree.flatMap(treeNodes) : [tree, ...treeNodes(tree.props?.children)] : [];

test('ordinary SettingsPanel and ScriptEditor controls configure the mixed source', () => {
 const doc = serverSourceDoc(); doc.nodes.tags.list!.from = '';
 useEditor.getState().replaceDoc(doc); useEditor.getState().setActivePage('p');
 const settings = loadNestedUi('components/SettingsPanel.tsx', true).default({ nodeId: 'tags' });
 const row = treeNodes(settings).find(n => n.props?.className === 'row' && treeNodes(n).some(x => x.type === 'label' && x.props.children === '並べる配列'));
 const dropdown = treeNodes(row).find(n => n.props?.options).props;
 assert.ok(dropdown.options.some((o: any) => o.value === 'tags')); dropdown.onChange('tags');
 assert.equal(useEditor.getState().doc.nodes.tags.list!.from, 'tags');
 const { StepBody } = loadNestedUi('components/script-editor/StepBody.tsx');
 const control = renderToStaticMarkup(React.createElement(Ctx.Provider, { value: { doc, pageId: 'p', samples: previewDataVars(doc, 'p'), arrays: pageArrays(doc, 'p'), updateStep() {}, renameVar() {} } as unknown as EdCtx }, React.createElement(StepBody, { step: doc.nodes.reload.scripts![0].steps[0] })));
 assert.match(control, /value="global,other"/); assert.match(control, /value="tags"/);
 assert.ok(pagePlan(doc, 'p').clientVars.has('tags')); assert.ok(!pagePlan(doc, 'p').clientVars.has('items'));
});

for (const component of [false, true]) test(`${component ? 'component' : 'plain'} server-owned arrays remain local across loading, row scripts, operations and navigation`, async () => {
 const doc = serverSourceDoc(component), saved = structuredClone(doc);
 const html = await publishedClientNested(doc, 'app/page.tsx', serverSourceItems);
 assert.doesNotMatch(html, /PRIVATE_SERVER_SENTINEL|unused/);
 const runtime = listRuntimeDom(html, scriptsFile(doc));
 assert.deepEqual(details(runtime), canvas(doc));
 for (let i = 0; i < 2; i++) {
  await runtime.click('reload'); assert.deepEqual(details(runtime), canvas(doc));
  await runtime.click('hide', 1); assert.deepEqual(runtime.active('#detail').map(n => n.style.display === 'none'), [false, true, false, false]);
  await runtime.click('show', 1); assert.ok(runtime.active('#detail').every(n => n.style.display !== 'none'));
 }
 const cv = listRuntimeDom(clientNestedCanvas(doc, serverSourceItems), `(${SCRIPT_RUNTIME})({}).install(document)`);
 const visible = (r: typeof runtime) => r.active('#tags-list').map(l => l.children.filter(n => n.hasAttribute('data-item') && n.style.display !== 'none').map(n => JSON.parse(n.getAttribute('data-item')!).label));
 for (const action of ['descending', 'filter', 'filter', 'empty', 'clear', 'ascending', 'clear']) {
  await runtime.click(action); await cv.click(action); assert.deepEqual(visible(runtime), visible(cv), action);
 }
 runtime.navigate('<span data-page-body="other"></span>'); assert.deepEqual(details(runtime), []);
 runtime.navigate(html); await runtime.click('reload'); assert.deepEqual(details(runtime), canvas(doc));
 assert.deepEqual(doc, saved); cv.dispose(); runtime.dispose();
 const loaded = listRuntimeDom(await publishedClientNested(JSON.parse(JSON.stringify(doc)), 'app/page.tsx', serverSourceItems), scriptsFile(doc));
 assert.deepEqual(details(loaded), canvas(doc)); loaded.dispose();
});

test('source ownership preserves empty/null/non-array roots and missing dotted leaves, while absent roots use the global client list', async () => {
 for (const from of ['tags', 'info.tags']) {
  const doc = serverSourceDoc(); doc.nodes.tags.list!.from = from; doc.nodes.detail.text!.content = '{name}:{label}{値}';
  const field = from === 'tags' ? 'tags' : 'info';
  const own = (v: unknown) => from === 'tags' ? v : { tags: v };
  const items = [{ name: 'Own', [field]: own([{ label: 'local' }]) }, { name: 'Empty', [field]: own([]) }, { name: 'Null', [field]: null }, { name: 'Scalar', [field]: 'x' }, { name: 'Missing leaf', [field]: {} }, { name: 'Literal', [from]: null }, { name: 'Absent' }];
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
  // ブラウザ側の代替値も通常の変数代入で用意する。
  doc.nodes.reload.scripts![0].steps = from === 'tags' ? [{ id: 'reload-step', kind: 'split', source: 'global,other', sep: ',', into: 'tags' }] : [{ id: 'reload-step', kind: 'set-var', value: '{response.0.info}', into: 'info' }];
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  assert.deepEqual(details(runtime), ['Own:local']);
  await runtime.click('reload');
  assert.deepEqual(details(runtime), from === 'tags' ? ['Own:local', 'Absent:global', 'Absent:other'] : ['Own:local', 'Absent:local']);
  runtime.dispose();
 }
});

test('owned lists retain existing client-operation and limit order with primitive rows', async () => {
 const doc = serverSourceDoc();
 for (const action of ['descending', 'ascending', 'filter', 'empty', 'clear']) { doc.pages.p.children = doc.pages.p.children.filter(id => id !== action); delete doc.nodes[action]; }
 const items = [{ name: 'First', tags: ['c', 'b', 'a'] }, { name: 'Second', tags: ['f', 'e', 'd'] }];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
 doc.nodes.detail.text!.content = '{name}:{値}'; doc.nodes.tags.list!.limit = 1;
 doc.pages.p.pageScripts![0].steps.push({ id: 'sort', kind: 'sort-array', array: 'tags', field: '値', dir: 'asc' });
 const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
 assert.deepEqual(details(runtime), ['First:c', 'Second:f']); assert.deepEqual(details(runtime), canvas(doc, items));
 await runtime.click('reload'); assert.deepEqual(details(runtime), ['First:c', 'Second:f']); runtime.dispose();
});

test('three server-owned levels and client descendants preserve row ownership without transporting private fields', async () => {
 const doc = serverSourceDoc();
 const items = [{ name: 'First', tags: [{ label: 'red', values: ['local'], unused: 'PRIVATE_SERVER_SENTINEL' }] }, { name: 'Second', tags: [{ label: 'blue' }] }];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
 doc.nodes.row.children.push('values');
 doc.nodes.values = { ...makeBox(), id: 'values', type: 'list', list: { from: 'values' }, children: ['value'] };
 doc.nodes.value = { ...makeText('{name}:{label}:{値}'), id: 'value', attrId: 'value' };
 doc.nodes.reload.scripts![0].steps.push({ id: 'values', kind: 'split', source: 'global', sep: ',', into: 'values' });
 const html = await publishedClientNested(doc, 'app/page.tsx', items); assert.doesNotMatch(html, /PRIVATE_SERVER_SENTINEL|unused/);
 const runtime = listRuntimeDom(html, scriptsFile(doc)); await runtime.click('reload');
 assert.deepEqual(runtime.active('#value').map(n => n.textContent), ['First:red:local', 'Second:blue:global']);
 runtime.dispose();
});

test('inert templates retain idle scripts and ordinary server-only output has no added item scopes', async () => {
 const doc = serverSourceDoc(); const items = [{ name: 'Absent' }];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
 doc.nodes.detail.scripts = [{ id: 'hide-load', trigger: 'load', pos: { x: 0, y: 0 }, steps: [{ id: 'hide-load-step', kind: 'hide', target: '@self' }] }];
 const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
 const hidden = runtime.root.querySelectorAll('#detail'); assert.ok(hidden.every(n => n.closest('[data-tpl]') && n.style.display !== 'none'));
 await runtime.click('reload'); assert.ok(runtime.active('#detail').every(n => n.style.display === 'none')); assert.ok(hidden.every(n => n.style.display !== 'none')); runtime.dispose();
 delete doc.nodes.reload; doc.pages.p.children = doc.pages.p.children.filter(id => id !== 'reload');
 assert.doesNotMatch(generateProject(doc).files['app/page.tsx'], /const iv\d+Item/);
});

test('native fixture bundles the real editor and Canvas', async () => {
 const bundle = await serverSourceBundle(); for (const name of ['SettingsPanel', 'ScriptEditor', 'Canvas']) assert.match(bundle, new RegExp(`function ${name}`));
});

test('the reported fetched-array assignment keeps each server parent source authoritative', async () => {
 const doc = serverSourceDoc();
 const items = serverSourceItems.map(({ name, tags }) => ({ name, tags: tags.map(({ label }) => ({ label })), unused: 'PRIVATE_SERVER_SENTINEL' }));
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
 doc.nodes.reload.scripts![0].steps = [{ id: 'reload-step', kind: 'set-var', value: '{response.0.tags}', into: 'tags' }];
 const html = await publishedClientNested(doc, 'app/page.tsx', items);
 assert.doesNotMatch(html, /PRIVATE_SERVER_SENTINEL/);
 const runtime = listRuntimeDom(html, scriptsFile(doc));
 for (let i = 0; i < 2; i++) { await runtime.click('reload'); assert.deepEqual(details(runtime), canvas(doc, items)); }
 runtime.dispose();
});

test('ordinary server literal dotted arrays retain static filter and limit behavior', async () => {
 const doc = serverSourceDoc();
 for (const action of ['descending', 'ascending', 'filter', 'empty', 'clear']) { doc.pages.p.children = doc.pages.p.children.filter(id => id !== action); delete doc.nodes[action]; }
 const items = [
  { name: 'First', wanted: 'red', 'info.tags': [{ label: 'blue' }, { label: 'red' }] },
  { name: 'Second', wanted: 'green', 'info.tags': [{ label: 'yellow' }, { label: 'green' }] },
 ];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
 doc.nodes.tags.list = { from: 'info.tags', limit: 1 };
 doc.nodes.reload.scripts![0].steps = [{ id: 'reload-step', kind: 'split', source: 'global', sep: ',', into: 'info.tags' }];
 doc.pages.p.pageScripts![0].steps.push({ id: 'static-filter', kind: 'filter-array', array: 'info.tags', field: 'label', op: 'eq', value: '{wanted}' });
 const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
 assert.deepEqual(details(runtime), ['Detail First:red', 'Detail Second:green']);
 assert.deepEqual(details(runtime), canvas(doc, items));
 await runtime.click('reload'); assert.deepEqual(details(runtime), ['Detail First:red', 'Detail Second:green']); runtime.dispose();
});

test('a real client root retains server-owned literal dotted arrays in plain and component rows', async () => {
 for (const component of [false, true]) {
  const doc = serverSourceDoc(component);
  const items = [
   { name: 'Literal', 'info.tags': [{ label: 'literal' }], info: { tags: [{ label: 'wrong' }] }, unused: 'PRIVATE_SERVER_SENTINEL' },
   { name: 'Nested', info: { tags: [{ label: 'nested' }] }, unused: 'PRIVATE_SERVER_SENTINEL' },
   { name: 'Literal null', 'info.tags': null, info: { tags: [{ label: 'wrong' }] } },
   { name: 'Root null', info: null },
   { name: 'Missing child', info: {} },
   { name: 'Empty', info: { tags: [] } },
   { name: 'Absent' },
  ];
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
  doc.nodes.tags.list = { from: 'info.tags' };
  doc.nodes.reload.scripts![0].steps = [{ id: 'reload-step', kind: 'set-var', value: '{response.1.info}', into: 'info' }];
  assert.ok(pagePlan(doc, 'p').clientVars.has('info'));
  const html = await publishedClientNested(doc, 'app/page.tsx', items);
  assert.doesNotMatch(html, /PRIVATE_SERVER_SENTINEL/);
  const runtime = listRuntimeDom(html, scriptsFile(doc));
  assert.deepEqual(details(runtime), ['Detail Literal:literal', 'Detail Nested:nested']);
  for (let i = 0; i < 2; i++) {
   await runtime.click('reload');
   assert.deepEqual(details(runtime), ['Detail Literal:literal', 'Detail Nested:nested', 'Detail Absent:nested']);
  }
  runtime.dispose();
 }
});
