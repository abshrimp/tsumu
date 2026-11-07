import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { createElement as createElement_2 } from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { pageArrays, pagePlan as pagePlan_2, pageVariableIndex, previewDataVars, pagePlan as pagePlan_3, filterItems, type ListOp, pagePlan as pagePlan_4, findItemsCandidates, pagePlan as pagePlan_5, scopeAt, pagePlan as pagePlan_6 } from "../lib/data";
import { makeBox as makeBox_2, makeText } from "../lib/presets";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { useEditor } from "../lib/store";
import { Ctx, type EdCtx } from "../components/script-editor/context";
import { clientNestedDoc, clientNestedCanvas, loadNestedUi, publishedClientNested } from "./helpers/client-nested-lists";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
import { nestedScopeItems, nestedScopeDoc, publishedNestedScope } from "./helpers/nested-script-scope";
import { stripMarkup } from "./helpers/strip-markup";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "./helpers/bundle";
import { emptyListDoc, publishedEmptyList } from "./helpers/empty-list-preview";
import { runInNewContext } from "node:vm";
import { type SiteDoc } from "../lib/types";
import { ArraySelect } from "../components/script-editor/arrays";
import { nestedOperationsDoc, publishedNestedOperations } from "./helpers/nested-list-operations";
import { generateProject } from "../lib/generator";
import { nestedListProducts, nestedListSourcesDoc } from "./helpers/nested-list-sources";

describe("client-nested-lists", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
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
    doc, pageId: 'p', samples: previewDataVars(doc, 'p'), arrays: pageArrays(doc, 'p'), variableIndex: pageVariableIndex(doc, 'p'), transformSources: {}, targetLookup: { firstByAttr: new Map(), firstNodeIds: new Set() }, updateStep() {}, renameVar() {},
  } as unknown as EdCtx }, React.createElement(StepBody, { step })));
  assert.equal(parse(control).querySelector(".se-value-choice input")?.getAttribute("value"), "{response}");
  assert.equal((step as { value: string }).value, "{response}");
  assert.match(control, /value="items"/);
  assert.ok(pagePlan_2(doc, 'p').clientVars.has('items'));
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
  doc.nodes.values = { ...makeBox_2(), id: 'values', type: 'list', list: { from: 'values' }, children: ['value'] };
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
  doc.nodes.detail.scripts = [{ id: 'hide-load', trigger: 'load', steps: [{ id: 'hide-load-step', kind: 'hide', target: '@self' }] }];
  doc.nodes.count = { ...makeText('count'), id: 'count', attrId: 'count', semantic: 'button', scripts: [{
    id: 'count-script', trigger: 'click', steps: [{ id: 'count-step', kind: 'transform', source: 'tags', into: 'total', transform: { kind: 'length' } }],
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
      id: `${id}-script`, trigger: 'click', steps: [{ id: `${id}-raw`, kind: 'set-var', value, into: 'labels' }, { id: `${id}-step`, kind: 'transform', source: 'labels', into: 'labels', transform: { kind: 'split', separator: ',' } }],
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
});

describe("empty-list-preview", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function load(filename: string, hooks = false) {
  const require = createRequire(resolve(filename)), mod = { exports: {} as any };
  const code = transformSync(readFileSync(filename, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) =>
    id.endsWith("/lib/store") ? { ...require(id), useEditor: (select: any) => select(state()) } :
    id === "react" && hooks ? { ...React, useState: () => [false, () => {}] } : require(id), mod, mod.exports);
  return mod.exports;
}
const plain = stripMarkup;
function fixture(sample: readonly unknown[]) {
  const doc = emptyListDoc(sample);
  state().replaceDoc(doc); state().setActivePage("p"); state().select("tag");
  const { default: SettingsPanel } = load("components/SettingsPanel.tsx", true);
  const panel = () => SettingsPanel({ nodeId: state().selection });
  nodes(panel()).find(n => n.type === "button" && Array.isArray(n.props.children) && n.props.children.includes("Turn into list display"))!.props.onClick();
  const row = nodes(panel()).find(n => n.props?.className === "row" && nodes(n).some(x => x.type === "span" && x.props.className === "lbl" && x.props.children === "List to display"));
  const dropdown = nodes(row).find(n => n.props?.options && n.props?.placeholder === "Select…").props;
  assert.ok(dropdown.options.some((o: any) => o.value === "tags"));
  dropdown.onChange("tags");
  const { NodeView } = load("components/canvas/NodeView.tsx");
  const require = createRequire(resolve("components/canvas/NodeView.tsx"));
  const { VarsCtx } = require("./render");
  const render = (preview = true) => {
    const plan = pagePlan_3(state().doc, "p");
    return renderToStaticMarkup(React.createElement(VarsCtx.Provider, { value: {
      pageVars: previewDataVars(state().doc, "p"), preview, fieldValues: {},
      clientVars: plan.clientVars, listOps: plan.listOps, setFieldValue() {}, refresh() {}, navigate() {},
    } }, React.createElement(NodeView, { id: "products", isTop: true })));
  };
  return { render };
}
for (const [name, sample, expected] of [
  ["first row empty", [{ name: "First", tags: [] }, { name: "Second", tags: ["green"] }], "FirstSecondTag: green"],
  ["later row empty", [{ name: "First", tags: ["red"] }, { name: "Second", tags: [] }], "FirstTag: redSecond"],
  ["all rows empty", [{ name: "First", tags: [] }, { name: "Second", tags: [] }], "FirstSecond"],
  ["later row missing source", [{ name: "First", tags: ["red"] }, { name: "Second" }], "FirstTag: redSecond"],
] as const) test(`preview omits empty nested rows after settings selects their source: ${name}`, async () => {
  const f = fixture(structuredClone(sample));
  const saved = structuredClone(state().doc), past = state().past.length;
  assert.equal(plain(f.render()), expected);
  assert.doesNotMatch(f.render(), /cv-placeholder/);
  assert.equal(plain(await publishedEmptyList(state().doc, structuredClone(sample))), expected + "Unchanged");
  state().undo(); state().redo();
  assert.deepEqual(state().doc, saved); assert.equal(state().past.length, past);
  assert.equal(plain(f.render()), expected);
  state().replaceDoc(JSON.parse(JSON.stringify(saved)));
  assert.equal(plain(f.render()), expected);
});
test("design retains empty-list guidance and templates without saving a preview change", () => {
  const f = fixture([{ name: "First", tags: [] }, { name: "Second", tags: [] }]);
  const before = structuredClone({ doc: state().doc, past: state().past });
  assert.match(f.render(false), /cv-placeholder/);
  assert.match(plain(f.render(false)), /Tag: /);
  assert.equal(plain(f.render(true)), "FirstSecond");
  assert.deepEqual({ doc: state().doc, past: state().past }, before);
});

test("an empty outer array adds no preview row and recovers when data returns", async () => {
  const sample = [{ name: "First", tags: ["red"] }, { name: "Second", tags: [] }];
  const f = fixture(sample), saved = structuredClone(state().doc);
  state().updateDoc((doc) => { (doc.pages.p.pageScripts![0].steps[0] as any).preview.sample = []; });
  assert.equal(plain(f.render()), "");
  assert.doesNotMatch(f.render(), /cv-placeholder/);
  assert.match(f.render(false), /cv-placeholder/);
  assert.equal(plain(await publishedEmptyList(state().doc, [])), "Unchanged");
  state().undo(); assert.deepEqual(state().doc, saved);
  assert.equal(plain(f.render()), "FirstTag: redSecond");
});
});

describe("list-filter-preparation", () => {
test("list filters prepare literals once per evaluation, not once per item", () => {
  let reads = 0;
  const ops: ListOp[] = [{ kind: "filter", conds: [{
    field: "category", op: "in", get value() { reads++; return '["a","c"]'; },
  }] }];
  const items = Array.from({ length: 200 }, (_, i) => ({ category: i % 2 ? "a" : "b" }));
  const result = filterItems(items, ops);
  assert.deepEqual(result, items.filter((item) => item.category === "a"));
  assert.equal(reads, 1);
  assert.equal(result[0], items[1]);
});

test("prepared filters preserve mixed condition groups, sequential joins and negation", () => {
  const items = [
    { name: "a", score: 1, enabled: true },
    { name: "b", score: 2, enabled: true },
    { name: "c", score: 3, enabled: false },
    { name: "d", score: 4, enabled: false },
  ];
  const ops: ListOp[] = [
    { kind: "filter", conds: [
      { field: "name", op: "eq", value: "a" },
      { field: "score", op: "gte", value: "2" },
      { field: "enabled", op: "eq", value: "true", and: true },
    ] },
    { kind: "sort", field: "name", dir: "desc" },
    { kind: "filter", join: "or", conds: [{ field: "name", op: "eq", value: "d" }] },
    { kind: "filter", join: "and", conds: [{ field: "name", op: "eq", value: "b", not: true }] },
  ];
  assert.deepEqual(filterItems(items, ops), [items[0], items[3]]);
});

test("filter preparation does not cache edited literals or resolved values between calls", () => {
  const condition = { field: "value", op: "eq" as const, value: '{"name":"a"}' };
  const filter: Extract<ListOp, { kind: "filter" }> = { kind: "filter", conds: [condition] };
  const items = [{ value: { name: "a" } }, { value: { name: "b" } }, { value: undefined }, { value: null }];
  assert.deepEqual(filterItems(items, [filter]), [items[0]]);
  condition.value = '{"name":"b"}';
  assert.deepEqual(filterItems(items, [filter]), [items[1]]);
  filter.conds[0].resolvedValue = { value: undefined };
  assert.deepEqual(filterItems(items, [filter]), [items[2]]);
  filter.conds[0].resolvedValue.value = null;
  assert.deepEqual(filterItems(items, [filter]), [items[3]]);
  assert.equal(condition.value, '{"name":"b"}');
});

test("empty filters, invalid JSON and no-filter identity keep their existing behavior", () => {
  const items = [{ value: "[invalid" }, { value: "other" }];
  assert.equal(filterItems(items, []), items);
  assert.equal(filterItems(items, [{ kind: "sort", field: "value", dir: "asc" }]), items);
  assert.deepEqual(filterItems(items, [{ kind: "filter", conds: [] }]), []);
  assert.deepEqual(filterItems(items, [{ kind: "filter", conds: [{ field: "value", value: "[invalid", op: "eq" }] }]), [items[0]]);
  assert.deepEqual(filterItems([], [{ kind: "filter", conds: [] }]), []);
});

test("prepared list filters still short-circuit row field access", () => {
  const item = { first: true, get skipped(): unknown { throw new Error("unreachable field"); } };
  assert.deepEqual(filterItems([item], [
    { kind: "filter", conds: [
      { field: "first", op: "eq", value: "true" },
      { field: "skipped", op: "eq", value: "true" },
    ] },
    { kind: "filter", join: "or", conds: [{ field: "skipped", op: "eq", value: "true" }] },
  ]), [item]);
});


test("unused operands remain lazy, including empty input and short-circuited filters", () => {
  const skipped = { field: "value", op: "eq" as const, get value(): string { throw new Error("unused operand"); } };
  assert.deepEqual(filterItems([], [{ kind: "filter", conds: [skipped] }]), []);
  const items = [{ value: true }];
  assert.deepEqual(filterItems(items, [
    { kind: "filter", conds: [{ field: "value", op: "eq", value: "true" }, skipped] },
    { kind: "filter", join: "or", conds: [skipped] },
  ]), items);
  assert.deepEqual(filterItems(items, [
    { kind: "filter", conds: [{ field: "value", op: "eq", value: "false" }, { field: "value", op: "eq", and: true, get value(): string { throw new Error("unused operand"); } }] },
  ]), []);
});

test("listFilterFields and pagePlan retain list-display filter steps whose primary field is blank but secondary or-conditions are populated", async () => {
  const { pagePlan } = await import("../lib/data");
  const { listFilterFields } = await import("../lib/script");
  const { makeBox } = await import("../lib/presets");
  const doc = {
    siteName: "Filter Or",
    pageOrder: ["home"],
    assets: {},
    nodes: { box: { ...makeBox(), id: "box" } },
    pages: {
      home: {
        id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["box"],
        pageScripts: [{
          id: "load", trigger: "load" as const,
          steps: [
            { id: "f1", kind: "fetch" as const, url: "https://api.example.com/tasks", as: "tasks" },
            {
              id: "flt", kind: "list-display" as const, mode: "filter" as const,
              array: "tasks", field: "", op: "eq" as const, value: "", dir: "asc" as const,
              or: [{ field: "status", op: "eq" as const, value: "open" }],
            },
          ],
        }],
      },
    },
  };
  assert.deepEqual([...(listFilterFields(doc).get("tasks") ?? [])], ["status"]);
  const plan = pagePlan(doc, "home");
  assert.ok(plan.serverIds.has("flt"));
  assert.deepEqual(plan.listOps.get("tasks"), [{
    kind: "filter",
    conds: [{ field: "status", op: "eq", value: "open" }],
    no: undefined,
    join: undefined,
  }]);
});
});

describe("nested-list-operations", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const require = createRequire(import.meta.url);
const { parse } = require("next/dist/compiled/node-html-parser");

function canvasMarkup(doc: SiteDoc, preview = true) {
  useEditor.getState().replaceDoc(doc);
  const file = resolve("components/canvas/NodeView.tsx"), local = createRequire(file), mod = { exports: {} as any };
  const code = transformSync(readFileSync(file, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => id.endsWith("/lib/store")
    ? { ...local(id), useEditor: (select: any) => select(useEditor.getState()) } : local(id), mod, mod.exports);
  const { VarsCtx } = local("./render"), plan = pagePlan_4(doc, "p");
  return renderToStaticMarkup(createElement_2(VarsCtx.Provider, { value: {
    pageVars: previewDataVars(doc, "p"), preview, fieldValues: {}, clientVars: plan.clientVars, listOps: plan.listOps,
    setFieldValue() {}, refresh() {}, navigate() {},
  } }, doc.pages.p.children.map(id => createElement_2(mod.exports.NodeView, { id, key: id, isTop: true }))));
}

// 実際の React の出力を読み、ランタイムが使う DOM の操作だけを再現する。
// 実際のブラウザでのキャンバス・スクリプトの画面・イベントは、e2e/ で確かめる。
class Element {
  attrs: Record<string, string>;
  children: Element[];
  nodeType = 1;
  style: { display: string };
  handlers = new Map<string, Function[]>();
  constructor(node: any, public parentElement: Element | null = null) {
    this.attrs = node.attributes;
    this.style = { display: /display:([^;]+)/.exec(this.attrs.style ?? "")?.[1] ?? "" };
    this.children = node.childNodes.filter((n: any) => n.nodeType === 1).map((n: any) => new Element(n, this));
  }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  hasAttribute(name: string) { return name in this.attrs; }
  matches(selector: string): boolean {
    return selector.split(",").some(s => {
      if (s.startsWith("#")) return this.attrs.id === s.slice(1);
      const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s);
      return !!attr && (attr[2] === undefined ? this.hasAttribute(attr[1]) : this.attrs[attr[1]] === attr[2]);
    });
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): Element | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(el: Element): boolean { return el === this || this.children.some(c => c.contains(el)); }
  appendChild(el: Element) {
    if (el.parentElement) el.parentElement.children = el.parentElement.children.filter(c => c !== el);
    this.children.push(el); el.parentElement = this;
  }
  addEventListener(type: string, fn: Function, capture = false) {
    if (!capture) this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  removeEventListener() {}
}

function runtime(html: string, source: string) {
  const root = new Element(parse(html));
  const dispose = runInNewContext(source, {
    document: root, CSS: { escape: (v: string) => v }, Event,
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
  });
  return {
    rows: () => root.querySelectorAll('[id="tags-list"]').map(list => list.children
      .filter(row => row.hasAttribute("data-item") && row.style.display !== "none")
      .map(row => JSON.parse(row.getAttribute("data-item")!).label)),
    async click(id: string) {
      const target = root.querySelector(`#${id}`); assert.ok(target, id);
      for (const handler of root.handlers.get("click") ?? []) handler({ target, preventDefault() {} });
      await new Promise<void>(done => setImmediate(done));
    },
    dispose,
  };
}

test("the nested source is a real named page array offered by ScriptEditor's ArraySelect", () => {
  const doc = nestedOperationsDoc();
  const html = renderToStaticMarkup(createElement_2(Ctx.Provider, { value: { arrays: pageArrays(doc, "p") } as EdCtx },
    createElement_2(ArraySelect, { value: "", onChange() {} })));
  assert.match(html, /class="[^"]*se-list-choice/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.doesNotMatch(html, /見つかりません/);
});

test("list candidates expand only the first sampled array item, including nested arrays", () => {
  const doc = nestedOperationsDoc();
  const fetch = doc.pages.p.pageScripts![0].steps[0];
  assert.equal(fetch.kind, "fetch");
  if (fetch.kind !== "fetch") return;
  fetch.preview = {
    sample: Array.from({ length: 20 }, (_, index) => ({
      name: "Row " + index,
      tags: [{ label: "Tag " + index }],
      details: { labels: ["Label " + index] },
    })),
  };
  const candidates = pageArrays(doc, "p").map(({ name }) => name);
  for (const name of ["response", "response.0", "response.0.tags", "response.0.tags.0",
    "response.0.details", "response.0.details.labels"]) {
    assert.ok(candidates.includes(name), name);
  }
  assert.ok(!candidates.some((name) => /^response\.[1-9]\d*(?:\.|$)/.test(name)),
    "only the first list record should be expanded into candidate paths");
});

for (const component of [false, true]) test(`${component ? "component" : "nested"} lists: runtime sort, filter and clear affect every rendered list`, async () => {
  const doc = nestedOperationsDoc(component), before = structuredClone(doc);
  const exported = runtime(await publishedNestedOperations(doc), scriptsFile(doc));
  const canvas = runtime(canvasMarkup(doc), `(${SCRIPT_RUNTIME})({}).install(document)`);
  const expected: Array<[string, string[][]]> = [
    ["descending", [["red", "blue"], ["yellow", "green"]]],
    ["descending", [["red", "blue"], ["yellow", "green"]]],
    ["filter", [["red"], ["green"]]],
    ["filter", [["red"], ["green"]]],
    ["empty", [[], []]],
    ["clear", [["red", "blue"], ["yellow", "green"]]],
    ["ascending", [["blue", "red"], ["green", "yellow"]]],
    ["filter", [["red"], ["green"]]],
    ["clear", [["blue", "red"], ["green", "yellow"]]],
  ];
  assert.deepEqual(canvas.rows(), [["red", "blue"], ["green", "yellow"]]);
  assert.deepEqual(canvas.rows(), exported.rows());
  for (const [action, rows] of expected) {
    await exported.click(action); assert.deepEqual(exported.rows(), rows, `generated ${action}`);
    await canvas.click(action);
    assert.deepEqual(canvas.rows(), rows, `Canvas ${action}`);
  }
  canvas.dispose();
  const restarted = runtime(canvasMarkup(doc), `(${SCRIPT_RUNTIME})({}).install(document)`);
  assert.deepEqual(restarted.rows(), [["red", "blue"], ["green", "yellow"]], "new preview resets temporary list operations");
  restarted.dispose();
  assert.doesNotMatch(canvasMarkup(doc, false), /data-array=|data-item=|data-scripts=/);
  assert.deepEqual(doc, before, "runtime operations never change the saved document");
});
});

describe("nested-list-sources", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function load(filename: string, hooks = false) {
  const require = createRequire(resolve(filename));
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(filename, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) =>
    id.endsWith("/lib/store") ? { ...require(id), useEditor: (select: any) => select(state()) } :
    id === "react" && hooks ? { ...React, useState: () => [false, () => {}] } : require(id), mod, mod.exports);
  return mod.exports;
}
function fixture() {
  state().replaceDoc(nestedListSourcesDoc()); state().setActivePage("p"); state().select("tag");
  const { default: SettingsPanel } = load("components/SettingsPanel.tsx", true);
  const render = () => SettingsPanel({ nodeId: state().selection });
  nodes(render()).find(n => n.type === "button" && Array.isArray(n.props.children) && n.props.children.includes("Turn into list display"))!.props.onClick();
  const id = state().selection!;
  const dropdown = () => {
    const row = nodes(render()).find(n => n.props?.className === "row" && nodes(n).some(x => x.type === "span" && x.props.className === "lbl" && x.props.children === "List to display"));
    return nodes(row).find(n => n.props?.options && n.props?.placeholder === "Select…").props;
  };
  const { NodeView } = load("components/canvas/NodeView.tsx");
  const require = createRequire(resolve("components/canvas/NodeView.tsx"));
  const { VarsCtx } = require("./render");
  const preview = () => {
    const plan = pagePlan_5(state().doc, "p");
    const html = renderToStaticMarkup(React.createElement(VarsCtx.Provider, { value: {
      pageVars: previewDataVars(state().doc, "p"), preview: true, fieldValues: {},
      clientVars: plan.clientVars, listOps: plan.listOps, setFieldValue() {}, refresh() {}, navigate() {},
    } }, React.createElement(NodeView, { id: "products", isTop: true })));
    return stripMarkup(html);
  };
  return { id, dropdown, preview };
}

test("nested source candidates include renderable primitive arrays and empty arrays", () => {
  const input = { strings: ["red", "blue"], numbers: [0, 2], flags: [false, true], records: [{ name: "A" }],
    empty: [], mixed: [null, "x", false, 3], nulls: [null], arrays: [["nested"]], text: "plain", object: { tags: ["deep"] } };
  const before = structuredClone(input);
  assert.deepEqual(findItemsCandidates(input), [
    { path: "strings", count: 2 }, { path: "numbers", count: 2 }, { path: "flags", count: 2 },
    { path: "records", count: 1 }, { path: "empty", count: 0 }, { path: "mixed", count: 4 },
    { path: "nulls", count: 1 }, { path: "arrays", count: 1 }, { path: "object.tags", count: 1 },
  ]);
  assert.deepEqual(input, before);
  const large = Array.from({ length: 10_000 }, (_, i) => i);
  let reads = 0;
  Object.defineProperty(large, 0, { get() { reads++; return 0; } });
  assert.deepEqual(findItemsCandidates({ large }), [{ path: "large", count: 10_000 }]);
  assert.equal(reads, 0, "counting a list does not read its entries");
  assert.deepEqual(findItemsCandidates({ a: { b: { c: { tags: ["deep"] } } } }), [], "the existing depth bound remains");
});

for (const [from, expected] of [
  ["tags", "First productredblueSecond productgreen"],
  ["scores", "First product03Second product2"],
  ["flags", "First productfalsetrueSecond producttrue"],
  ["info.tags", "First productdeepSecond productother"],
  ["empty", "First productSecond product"],
]) test(`settings can select ${from}, render each outer item, persist and undo/redo without changing other nodes`, () => {
  const f = fixture();
  const options = f.dropdown().options;
  assert.ok(options.some((o: any) => o.value === from), `${from} must be offered by the actual settings panel`);
  assert.ok(options.some((o: any) => o.value === "details"), "object list choices remain");
  const before = structuredClone(state().doc), past = state().past.length;
  f.dropdown().onChange(from);
  assert.equal(state().doc.nodes[f.id].list?.from, from);
  assert.equal(f.preview(), expected);
  assert.equal(state().past.length, past + 1);
  assert.deepEqual(state().doc.nodes.other, before.nodes.other);
  assert.deepEqual(state().doc.nodes.products, before.nodes.products);
  const saved = JSON.parse(JSON.stringify(state().doc));
  state().undo(); assert.deepEqual(state().doc, before);
  state().redo(); assert.equal(f.preview(), expected);
  state().replaceDoc(saved); assert.equal(f.preview(), expected);
});

test("outer item paths remain distinct from page arrays and changing the source is one undo step", () => {
  const f = fixture();
  f.dropdown().onChange("tags");
  const before = structuredClone(state().doc);
  const scope = scopeAt(before, "p", f.id, { inside: false });
  assert.deepEqual(scope.item?.tags, ["red", "blue"]);
  f.dropdown().onChange("scores"); assert.equal(f.preview(), "First product03Second product2");
  state().undo(); assert.deepEqual(state().doc, before); assert.equal(f.preview(), "First productredblueSecond productgreen");
});

async function publishedText() {
  const { files } = generateProject(state().doc);
  const require = createRequire(import.meta.url);
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as any };
    const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "@/lib/safe-fetch") return {
        fetchPublic: async () => Response.json(nestedListProducts), readTextLimited: (res: Response) => res.text(),
      };
      if (id.startsWith("@/lib/")) return load(id.replace("@/", "") + ".ts");
      return require(id);
    }, mod, mod.exports);
    cache.set(file, mod.exports); return mod.exports;
  };
  return stripMarkup(renderToStaticMarkup(await load("app/page.tsx").default()));
}

for (const [from, expected] of [
  ["tags", "First productredblueSecond productgreenUnchanged"],
  ["scores", "First product03Second product2Unchanged"],
  ["flags", "First productfalsetrueSecond producttrueUnchanged"],
  ["empty", "First productSecond productUnchanged"],
]) test(`the saved ${from} binding renders the same items in generated Next.js output`, async () => {
  const f = fixture(); f.dropdown().onChange(from);
  state().replaceDoc(JSON.parse(JSON.stringify(state().doc)));
  assert.equal(await publishedText(), expected);
});
});

describe("nested-script-scope", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function render(preview = true) {
  const doc = nestedScopeDoc(); useEditor.getState().replaceDoc(doc);
  const file = resolve("components/canvas/NodeView.tsx"), require = createRequire(file), mod = { exports: {} as any };
  const code = transformSync(readFileSync(file, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => id.endsWith("/lib/store")
    ? { ...require(id), useEditor: (select: any) => select(useEditor.getState()) } : require(id), mod, mod.exports);
  const { VarsCtx } = require("./render"), plan = pagePlan_6(doc, "p");
  return renderToStaticMarkup(React.createElement(VarsCtx.Provider, { value: {
    pageVars: previewDataVars(doc, "p"), preview, fieldValues: {}, clientVars: plan.clientVars, listOps: plan.listOps,
    setFieldValue() {}, refresh() {}, navigate() {},
  } }, React.createElement(mod.exports.NodeView, { id: "products", isTop: true })));
}

test("each inner row has its own script scope, including ghost-rendered outer rows", () => {
  const html = render();
  assert.equal((html.match(/data-item=/g) ?? []).length, 6, "two outer scopes and four inner scopes");
  for (const label of ["red", "blue", "green", "yellow"]) {
    assert.ok(html.includes(`data-item="{&quot;label&quot;:&quot;${label}&quot;}"`), label);
  }
  assert.equal((html.match(/id="detail"/g) ?? []).length, 4);
  assert.equal((html.match(/data-scripts=/g) ?? []).length, 8);
});

test("design retains the same unwrapped editable list contents", () => {
  const html = render(false);
  assert.doesNotMatch(html, /data-item=|data-scripts=/);
  assert.equal((stripMarkup(html).match(/Detail \{name\}:\{label\}/g) ?? []).length, 4);
  assert.equal((html.match(/id="detail"/g) ?? []).length, 4);
});

test("generated nested scripts already scope every repeated row", async () => {
  const html = await publishedNestedScope();
  assert.equal((html.match(/data-row=/g) ?? []).length, 6);
  for (const label of ["red", "blue", "green", "yellow"]) assert.match(html, new RegExp(`hide ${label}`));
  assert.equal((html.match(/id="detail"/g) ?? []).length, 4);
});
});
