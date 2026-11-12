import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { pageArrays, pagePlan, previewDataVars } from "../lib/data";
import { makeBox, makeText } from "../lib/presets";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { useEditor } from "../lib/store";
import { Ctx, type EdCtx } from "../components/script-editor/context";
import { clientNestedDoc, clientNestedCanvas, loadNestedUi, publishedClientNested } from "./helpers/client-nested-lists";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
import { nestedScopeItems } from "./helpers/nested-script-scope";
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
const details = (runtime: ReturnType<typeof listRuntimeDom>) => runtime.active('#detail').map(n => n.textContent);
const canvasDetails = (doc: ReturnType<typeof clientNestedDoc>, items = nestedScopeItems) =>
  parse(clientNestedCanvas(doc, items)).querySelectorAll('#detail').map((n: any) => n.textContent);
const rows = (runtime: ReturnType<typeof listRuntimeDom>) => runtime.active('#tags-list').map(list => list.children
  .filter(row => row.hasAttribute('data-item') && row.style.display !== 'none')
  .map(row => JSON.parse(row.getAttribute('data-item')!).label));
const treeNodes = (tree: any): any[] => tree && typeof tree === 'object' ? Array.isArray(tree)
  ? tree.flatMap(treeNodes) : [tree, ...treeNodes(tree.props?.children)] : [];

test('the real settings and script controls configure the nested source and browser array', () => {
  const doc = clientNestedDoc();
  doc.nodes.tags.list!.from = '';
  useEditor.getState().replaceDoc(doc); useEditor.getState().setActivePage('p');
  const settings = loadNestedUi('components/SettingsPanel.tsx', true).default({ nodeId: 'tags' });
  const row = treeNodes(settings).find(n => n.props?.className === 'row' && treeNodes(n).some(x => x.type === 'span' && x.props.className === 'lbl' && x.props.children === 'List to display'));
  const dropdown = treeNodes(row).find(n => n.props?.options).props;
  assert.ok(dropdown.options.some((o: any) => o.value === 'tags'));
  dropdown.onChange('tags');
  assert.equal(useEditor.getState().doc.nodes.tags.list!.from, 'tags');
  const step = doc.nodes.reload.scripts![0].steps[0];
  const { StepBody } = loadNestedUi('components/script-editor/StepBody.tsx');
  const control = renderToStaticMarkup(React.createElement(Ctx.Provider, { value: {
    doc, pageId: 'p', samples: previewDataVars(doc, 'p'), arrays: pageArrays(doc, 'p'), updateStep() {}, renameVar() {},
  } as unknown as EdCtx }, React.createElement(StepBody, { step })));
  assert.equal(parse(control).querySelector(".se-value-choice input")?.getAttribute("value"), "{response}");
  assert.equal((step as { value: string }).value, "{response}");
  assert.match(control, /value="items"/);
  assert.ok(pagePlan(doc, 'p').clientVars.has('items'));
});

for (const component of [false, true]) test(`${component ? 'component' : 'plain'} browser-loaded parent: own nested rows, scripts, operations and repeated loading`, async () => {
  const doc = clientNestedDoc(component), saved = structuredClone(doc);
  const runtime = listRuntimeDom(await publishedClientNested(doc), scriptsFile(doc));
  assert.deepEqual(details(runtime), []);
  for (let i = 0; i < 2; i++) {
    await runtime.click('reload');
    assert.deepEqual(details(runtime), canvasDetails(doc));
    assert.deepEqual(rows(runtime), [['red', 'blue'], ['green', 'yellow']]);
    await runtime.click('hide', 1);
    assert.deepEqual(runtime.active('#detail').map(n => n.style.display === 'none'), [false, true, false, false]);
    await runtime.click('show', 1);
    assert.ok(runtime.active('#detail').every(n => n.style.display !== 'none'));
  }
  const canvas = listRuntimeDom(clientNestedCanvas(doc), `(${SCRIPT_RUNTIME})({}).install(document)`);
  for (const [action, expected] of [
    ['descending', [['red', 'blue'], ['yellow', 'green']]], ['filter', [['red'], ['green']]],
    ['filter', [['red'], ['green']]], ['empty', [[], []]], ['clear', [['red', 'blue'], ['yellow', 'green']]],
    ['ascending', [['blue', 'red'], ['green', 'yellow']]], ['clear', [['blue', 'red'], ['green', 'yellow']]],
  ] as const) {
    await runtime.click(action); await canvas.click(action);
    assert.deepEqual(rows(runtime), expected, action); assert.deepEqual(rows(runtime), rows(canvas));
  }
  assert.deepEqual(doc, saved); canvas.dispose(); runtime.dispose();
  const reload = listRuntimeDom(await publishedClientNested(JSON.parse(JSON.stringify(doc))), scriptsFile(doc));
  await reload.click('reload'); assert.deepEqual(details(reload), canvasDetails(doc)); reload.dispose();
});

test('three nested levels preserve inner names, primitive values, scripts and untouched templates', async () => {
  const doc = clientNestedDoc();
  const items = [{ name: 'Outer', tags: [{ name: 'Inner', label: 'tag', values: [0, false, 'quoted " {literal}'] }] }];
  doc.nodes.row.children.push('values');
  doc.nodes.values = { ...makeBox(), id: 'values', type: 'list', list: { from: 'values' }, children: ['value'] };
  doc.nodes.value = { ...makeText('{name}:{label}:{値}'), id: 'value', attrId: 'value' };
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  const template = runtime.root.querySelector('[data-tpl]')!.textContent;
  await runtime.click('reload');
  assert.deepEqual(details(runtime), ['Detail Inner:tag']);
  assert.deepEqual(runtime.active('#value').map(n => n.textContent), ['Inner:tag:0', 'Inner:tag:false', 'Inner:tag:quoted " {literal}']);
  assert.equal(runtime.root.querySelector('[data-tpl]')!.textContent, template);
  runtime.dispose();
});

test('client lists preserve dictionary entries, nested array values and null rows after a script refresh', async () => {
  const doc = clientNestedDoc();
  doc.nodes.detail.text!.content = '{name}:{値}{label}';
  const values = [{ label: 'record' }, null, ['a', 'b'], false];
  const items = [
    { name: 'Array', tags: values },
    { name: 'Dictionary', tags: Object.fromEntries(values.map((value, i) => [String.fromCharCode(97 + i), value])) },
  ];
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  try {
    await runtime.click('reload');
    const expectedRows = [{ label: 'record' }, { 値: null }, { 値: ['a', 'b'] }, { 値: false }];
    const actualRows = runtime.active('#tags-list').map(list => list.children
      .filter(row => row.hasAttribute('data-row'))
      .map(row => JSON.parse(row.getAttribute('data-item')!)));
    assert.deepEqual(actualRows, [expectedRows, expectedRows]);
    assert.deepEqual(details(runtime), canvasDetails(doc, items));
  } finally { runtime.dispose(); }
});

test('newly deferred global sources keep literals and item roots shadow fallback arrays', async () => {
  const doc = clientNestedDoc();
  const items: any[] = [{ name: 'Fallback' }, { name: 'Own', tags: [{ label: 'own' }] }, { name: 'Empty', tags: [] }, { name: 'Null', tags: null }, { name: 'Text', tags: 'not array' }];
  doc.pages.p.pageScripts![0].steps = [
    { id: 'fetch', kind: 'fetch', as: 'response', url: 'https://example.test/products', preview: { sample: items } },
    { id: 'fallback-value', kind: 'set-var', value: 'a"{literal},b', into: 'tags' },
    { id: 'fallback', kind: 'transform', source: 'tags', into: 'tags', transform: { kind: 'split', separator: ',' } },
  ];
  // 配信する前の分解でも、文字としての波かっこを保つ。
  (doc.pages.p.pageScripts![0].steps[1] as Extract<import('../lib/types').ScriptStep, { kind: 'set-var' }>).value = 'a"\\{literal},b';
  doc.nodes.detail.text!.content = '{name}:{値}{label}';
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await runtime.click('reload');
  assert.deepEqual(details(runtime), [':a"{literal}', ':b', 'Own:own']);
  assert.deepEqual(runtime.active('#tags-list').map(l => l.children.filter(c => c.hasAttribute('data-row')).length), [2, 1, 0, 0, 0]);
  runtime.dispose();
});

test('static per-parent filters and sorting run before the nested limit', async () => {
  const doc = clientNestedDoc();
  for (const action of ['descending', 'ascending', 'filter', 'empty', 'clear']) {
    doc.pages.p.children = doc.pages.p.children.filter(id => id !== action); delete doc.nodes[action];
  }
  const items = [{ name: 'First', wanted: 'r', tags: [{ label: 'red' }, { label: 'brown' }, { label: 'blue' }] }, { name: 'Second', wanted: 'e', tags: [{ label: 'yellow' }, { label: 'green' }, { label: 'black' }] }];
  doc.pages.p.pageScripts![0].steps.push(
    { id: 'base-filter', kind: 'list-display', mode: 'filter', array: 'tags', field: 'label', op: 'contains', value: '{wanted}', dir: 'asc' },
    { id: 'base-sort', kind: 'list-display', mode: 'sort', array: 'tags', field: 'label', dir: 'asc', op: 'eq', value: '' },
  );
  doc.nodes.tags.list!.limit = 1;
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await runtime.click('reload');
  assert.deepEqual(details(runtime), ['Detail First:brown', 'Detail Second:green']);
  assert.deepEqual(details(runtime), canvasDetails(doc, items)); runtime.dispose();
});

test('page navigation discards old rows and temporary nested operations', async () => {
  const doc = clientNestedDoc(), html = await publishedClientNested(doc);
  const runtime = listRuntimeDom(html, scriptsFile(doc));
  await runtime.click('reload'); await runtime.click('empty'); assert.deepEqual(rows(runtime), [[], []]);
  runtime.navigate('<span data-page-body="other"></span>'); assert.deepEqual(details(runtime), []);
  runtime.navigate(html); assert.deepEqual(details(runtime), []);
  await runtime.click('reload'); assert.deepEqual(details(runtime), canvasDetails(doc));
  runtime.dispose();
});

test('server fallback exposes only rendered fields and supports count without activating hidden scripts', async () => {
  const doc = clientNestedDoc();
  const items = [{ label: 'red', privateField: 'UNUSED_PRIVATE_SENTINEL' }, { label: 'blue', privateField: 'UNUSED_PRIVATE_SENTINEL' }];
  doc.pages.p.pageScripts![0].steps = [
    { id: 'fetch', kind: 'fetch', as: 'response', url: 'https://example.test/products', preview: { sample: items } },
    { id: 'alias', kind: 'set-var', value: '{response}', into: 'tags' },
  ];
  doc.nodes.reload.scripts![0].steps = [{ id: 'reload-raw', kind: 'set-var', value: 'outer', into: 'items' }, { id: 'reload-step', kind: 'transform', source: 'items', into: 'items', transform: { kind: 'split', separator: ',' } }];
  doc.nodes.detail.text!.content = '{label}';
  doc.nodes.detail.scripts = [{ id: 'hide-load', trigger: 'load', pos: { x: 0, y: 0 }, steps: [{ id: 'hide-load-step', kind: 'hide', target: '@self' }] }];
  doc.nodes.count = { ...makeText('count'), id: 'count', attrId: 'count', semantic: 'button', scripts: [{
    id: 'count-script', trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: 'count-step', kind: 'transform', source: 'tags', into: 'total', transform: { kind: 'length' } }],
  }] };
  doc.nodes.total = { ...makeText('{total}'), id: 'total', attrId: 'total' };
  doc.pages.p.children.push('count', 'total');
  const html = await publishedClientNested(doc, 'app/page.tsx', items);
  assert.doesNotMatch(html, /UNUSED_PRIVATE_SENTINEL|privateField/);
  const runtime = listRuntimeDom(html, scriptsFile(doc));
  const hiddenDetails = runtime.root.querySelectorAll('#detail');
  assert.ok(hiddenDetails.every(n => n.closest('[data-tpl]') && n.style.display !== 'none'));
  await runtime.click('reload');
  assert.deepEqual(details(runtime), ['red', 'blue']);
  assert.ok(runtime.active('#detail').every(n => n.style.display === 'none'));
  assert.ok(hiddenDetails.every(n => n.style.display !== 'none'), 'template scripts remain inactive');
  await runtime.click('count'); assert.equal(runtime.active('#total')[0].textContent, '2');
  await runtime.click('filter'); await runtime.click('count'); assert.equal(runtime.active('#total')[0].textContent, '2', 'pure length counts data independently of list display filtering');
  await runtime.click('clear'); await runtime.click('count'); assert.equal(runtime.active('#total')[0].textContent, '2');
  runtime.dispose();
});

test('dotted item roots block global fallback even when the leaf is missing', async () => {
  const doc = clientNestedDoc();
  const items = [{ name: 'Missing', info: {} }, { name: 'Null', info: null }, { name: 'Own', info: { tags: [{ label: 'own' }] } }];
  doc.nodes.tags.list!.from = 'info.tags';
  doc.pages.p.pageScripts![0].steps = [
    { id: 'fetch', kind: 'fetch', as: 'response', url: 'https://example.test/products', preview: { sample: items } },
    { id: 'info', kind: 'set-var', value: '{response.2.info}', into: 'info' },
  ];
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await runtime.click('reload'); assert.deepEqual(details(runtime), ['Detail Own:own']); runtime.dispose();
});

test('live global arrays update independently without overwriting item-local arrays', async () => {
  const doc = clientNestedDoc(), items = [{ name: 'First', labels: ['local'] }, { name: 'Second' }];
  (doc.pages.p.pageScripts![0].steps[0] as { preview?: { sample?: unknown } }).preview = { sample: items };
  doc.nodes.tags.list!.from = 'labels'; doc.nodes.detail.text!.content = '{name}:{値}';
  for (const [id, value] of [['global-a', 'one,two'], ['global-b', 'three']]) {
    doc.nodes[id] = { ...makeText(id), id, attrId: id, semantic: 'button', scripts: [{
      id: `${id}-script`, trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: `${id}-raw`, kind: 'set-var', value, into: 'labels' }, { id: `${id}-step`, kind: 'transform', source: 'labels', into: 'labels', transform: { kind: 'split', separator: ',' } }],
    }] }; doc.pages.p.children.push(id);
  }
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await runtime.click('reload'); assert.deepEqual(details(runtime), ['First:local']);
  const parents = runtime.active('#products-list')[0].children.filter(c => c.hasAttribute('data-row'));
  await runtime.click('global-a'); assert.deepEqual(details(runtime), ['First:local', 'Second:one', 'Second:two']);
  await runtime.click('global-b'); assert.deepEqual(details(runtime), ['First:local', 'Second:three']);
  assert.deepEqual(runtime.active('#products-list')[0].children.filter(c => c.hasAttribute('data-row')), parents);
  runtime.dispose();
});

test('an item-only nested array produces four rows instead of none', async () => {
  const doc = clientNestedDoc();
  doc.pages.p.pageScripts![0].steps = doc.pages.p.pageScripts![0].steps.filter(s => s.id !== 'tags-alias');
  const runtime = listRuntimeDom(await publishedClientNested(doc), scriptsFile(doc));
  await runtime.click('reload');
  assert.deepEqual(details(runtime), ['Detail First:red', 'Detail First:blue', 'Detail Second:green', 'Detail Second:yellow']);
  runtime.dispose();
});

test('static filter values resolve server and item tokens once, preserving literal braces', async () => {
  for (const value of ['{needle}', '\\{literal}', '{prefix}{wanted}', '[slug]']) {
    const doc = clientNestedDoc();
    for (const action of ['descending', 'ascending', 'filter', 'empty', 'clear']) {
      doc.pages.p.children = doc.pages.p.children.filter(id => id !== action); delete doc.nodes[action];
    }
    const items = [{ name: 'First', needle: 'red{literal}', prefix: 'red', wanted: '{literal}', slug: 'red{literal}',
      tags: [{ label: 'red{literal}' }, { label: 'red' }, { label: '{literal}' }] }];
    (doc.pages.p.pageScripts![0].steps[0] as { preview?: { sample?: unknown } }).preview = { sample: items };
    doc.pages.p.pageScripts![0].steps.push(
      { id: 'needle', kind: 'set-var', value: '{response.0.needle}', into: 'needle' },
      { id: 'prefix', kind: 'set-var', value: '{response.0.prefix}', into: 'prefix' },
      { id: 'slug', kind: 'set-var', value: '{response.0.slug}', into: 'slug' },
      { id: 'base-filter', kind: 'list-display', mode: 'filter', array: 'tags', field: 'label', op: 'eq', value, dir: 'asc' },
    );
    const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
    await runtime.click('reload');
    assert.deepEqual(details(runtime), canvasDetails(doc, items), value);
    assert.deepEqual(details(runtime), [value === '\\{literal}' ? 'Detail First:{literal}' : 'Detail First:red{literal}']);
    runtime.dispose();
  }
});

test('static nested filters prefer each parent value over a conflicting server fallback', async () => {
  for (const value of ['{wanted}', '{choice.wanted}', '[slug]']) {
    const doc = clientNestedDoc();
    for (const action of ['descending', 'ascending', 'filter', 'empty', 'clear']) {
      doc.pages.p.children = doc.pages.p.children.filter(id => id !== action); delete doc.nodes[action];
    }
    const tags = [{ label: 'red{literal}' }, { label: 'blue{literal}' }, { label: '' }];
    const items = [
      { name: 'First', wanted: 'blue{literal}', choice: { wanted: 'blue{literal}' }, slug: 'blue{literal}', tags },
      { name: 'Second', wanted: 'red{literal}', choice: { wanted: 'red{literal}' }, slug: 'red{literal}', tags },
      { name: 'Missing', tags },
      { name: 'Null', wanted: null, choice: null, slug: null, tags },
      { name: 'Empty', wanted: '', choice: {}, slug: '', tags },
      { name: 'Literal key', wanted: null, 'choice.wanted': null, choice: { wanted: 'red{literal}' }, slug: null, tags },
    ];
    (doc.pages.p.pageScripts![0].steps[0] as { preview?: { sample?: unknown } }).preview = { sample: items };
    for (const into of ['wanted', 'choice', 'slug']) doc.pages.p.pageScripts![0].steps.push({
      id: `global-${into}`, kind: 'set-var', value: `{response.1.${into}}`, into,
    });
    doc.pages.p.pageScripts![0].steps.push({ id: 'base-filter', kind: 'list-display', mode: 'filter', array: 'tags', field: 'label', op: 'eq', value, dir: 'asc' });
    const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
    await runtime.click('reload');
    assert.deepEqual(details(runtime), canvasDetails(doc, items), value);
    assert.deepEqual(details(runtime), ['Detail First:blue{literal}', 'Detail Second:red{literal}', 'Detail Missing:red{literal}', ...(value === '{choice.wanted}' ? [] : ['Detail Empty:'])]);
    runtime.dispose();
  }
});

for (const not of [false, true]) test(`nested base filters preserve typed values and negation (${not})`, async () => {
  const doc = clientNestedDoc();
  for (const action of ['descending', 'ascending', 'filter', 'empty', 'clear']) {
    doc.pages.p.children = doc.pages.p.children.filter(id => id !== action); delete doc.nodes[action];
  }
  const tags = [
    { label: 'object', match: { code: 2 } },
    { label: 'array', match: [1, 2] },
    { label: 'null', match: null },
    { label: 'empty', match: '' },
  ];
  const items = [
    { name: 'Object', wanted: { code: 2 }, tags },
    { name: 'Array', wanted: [1, 2], tags },
    { name: 'Null', wanted: null, tags },
  ];
  (doc.pages.p.pageScripts![0].steps[0] as { preview?: { sample?: unknown } }).preview = { sample: items };
  doc.pages.p.pageScripts![0].steps.push({id: 'global-wanted', kind: 'set-var', value: '{response.0.wanted}', into: 'wanted'});
  doc.pages.p.pageScripts![0].steps.push({
    id: 'typed-base-filter', kind: 'list-display', mode: 'filter', array: 'tags',
    field: 'match', op: 'eq', value: '{wanted}', not, dir: 'asc',
  });
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  for (let i = 0; i < 2; i++) {
    await runtime.click('reload');
    assert.deepEqual(details(runtime), canvasDetails(doc, items));
    assert.deepEqual(details(runtime), not ? [
      'Detail Object:array', 'Detail Object:null', 'Detail Object:empty',
      'Detail Array:object', 'Detail Array:null', 'Detail Array:empty',
      'Detail Null:object', 'Detail Null:array', 'Detail Null:empty',
    ] : ['Detail Object:object', 'Detail Array:array', 'Detail Null:null']);
  }
  runtime.dispose();
});
