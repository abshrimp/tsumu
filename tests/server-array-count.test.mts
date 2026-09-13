import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCRIPT_RUNTIME, scriptsFile } from '../lib/script-runtime';
import { clientNestedCanvas, publishedClientNested } from './helpers/client-nested-lists';
import { listRuntimeDom } from './helpers/list-runtime-dom';
import { serverArrayJoinDoc, serverArrayJoinItems as items } from './helpers/server-array-join';

export function fixture() {
 const doc = serverArrayJoinDoc();
 doc.nodes.reload.scripts![0].steps = [{ id: 'count', kind: 'count', array: 'response', into: 'joined' }];
 return doc;
}
async function runtimes(doc: ReturnType<typeof fixture>, data: unknown[] = items) {
 return [listRuntimeDom(clientNestedCanvas(doc, data), `(${SCRIPT_RUNTIME})(env).install(document)`),
  listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc))];
}
const output = (r: ReturnType<typeof listRuntimeDom>) => String(r.vars.joined ?? r.active('#result')[0].textContent);

test('count of unrendered server array is scalar-only in Canvas and export after save/reload', async () => {
 const doc = JSON.parse(JSON.stringify(fixture()));
 for (const html of [clientNestedCanvas(doc, items), await publishedClientNested(doc, 'app/page.tsx', items)]) assert.doesNotMatch(html, /Alpha|Beta|SECRET|private/);
 for (const r of await runtimes(doc)) {
  for (let i = 0; i < 2; i++) { await r.click('reload'); assert.equal(output(r), '2'); }
  r.dispose();
 }
 assert.doesNotMatch(JSON.stringify(doc), /countFallback|itemArray/);
});

test('count live writes remain authoritative', async () => {
 const doc = fixture();
 doc.nodes.reload.scripts![0].steps.unshift({ id: 'write', kind: 'split', source: 'a,b,c', sep: ',', into: 'response' });
 for (const r of await runtimes(doc)) { await r.click('reload'); assert.equal(output(r), '3'); r.dispose(); }
});

test('count keeps empty/null and owned missing paths ahead of fallback', async () => {
 for (const raw of [[], null, '', {}]) {
  const html = `<button id="reload" data-scripts='${JSON.stringify([{ trigger: 'click', steps: [
   { kind: 'set-var', into: 'response', raw },
   { kind: 'count', array: 'response', into: 'joined', countFallback: { value: 99 } },
  ] }])}'></button>`;
  const r = listRuntimeDom(html, `(${SCRIPT_RUNTIME})(env).install(document)`);
  await r.click('reload'); assert.equal(output(r), '0'); r.dispose();
 }
});

test('count preserves rendered list and active filter precedence over server scalar', async () => {
 const doc = fixture();
 doc.pages.p.children = ['products', 'reload', 'result'];
 doc.nodes.products.list = { from: 'response' };
 doc.nodes.products.children = [];
 doc.nodes.reload.scripts![0].steps.unshift({ id: 'filter', kind: 'filter-array', array: 'response', field: 'name', op: 'eq', value: 'Alpha' });
 for (const r of await runtimes(doc)) { await r.click('reload'); assert.equal(output(r), '1'); r.dispose(); }
});

test('count nearest server item owns dotted source including null and missing leaf', async () => {
 const doc = fixture(), data = [{ 'info.tags': ['a', 'b'], info: { tags: ['wrong'] } }, { info: { tags: ['x'] } }, { info: null }, { info: {} }];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.children = ['products', 'result']; doc.nodes.products.list = { from: 'response' }; doc.nodes.products.children = ['reload'];
 doc.nodes.reload.scripts![0].steps = [{ id: 'global', kind: 'split', source: 'global', sep: ',', into: 'info.tags' }, { id: 'count', kind: 'count', array: 'info.tags', into: 'joined' }];
 for (const r of await runtimes(doc, data)) {
  for (const [i, expected] of ['2','1','0','0'].entries()) { await r.click('reload', i); assert.equal(output(r), expected); }
  r.dispose();
 }
});

test('count loop item beats the page fallback including explicit null', async () => {
 for (const [tags, expected] of [[['a','b','c'], '3'], [null, '0']] as const) {
  const doc = fixture(), data = [{ tags }];
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
  doc.pages.p.pageScripts![0].steps.push({ id: 'server-tags', kind: 'split', source: 'server', sep: ',', into: 'tags' });
  doc.nodes.reload.scripts![0].steps = [
   { id: 'copy', kind: 'set-var', value: '{response}', into: 'clients' },
   { id: 'each', kind: 'for-each', array: 'clients', then: [{ id: 'count', kind: 'count', array: 'tags', into: 'joined' }] },
  ];
  for (const r of await runtimes(doc, data)) { await r.click('reload'); assert.equal(output(r), expected); r.dispose(); }
 }
});

test('count client row ownership and absent roots distinguish a page scalar fallback', async () => {
 const doc = fixture(), data = [{ tags: ['a','b'] }, { tags: null }, { other: true }];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.pageScripts![0].steps.push({ id: 'server-tags', kind: 'split', source: 'server', sep: ',', into: 'tags' });
 doc.pages.p.children = ['reload', 'products', 'result'];
 doc.nodes.products.list = { from: 'clients' }; doc.nodes.products.children = ['count-row'];
 doc.nodes['count-row'] = { ...doc.nodes.reload, id: 'count-row', attrId: 'count-row', scripts: [{ ...doc.nodes.reload.scripts![0], steps: [{ id: 'count', kind: 'count', array: 'tags', into: 'joined' }] }] };
 doc.nodes.reload.scripts![0].steps = [{ id: 'copy', kind: 'set-var', value: '{response}', into: 'clients' }];
 // The explicit copy intentionally transports the array; Count itself only receives a scalar.
 const r = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc));
 await r.click('reload');
 for (const [i, expected] of ['2','0','1'].entries()) { await r.click('count-row', i); assert.equal(output(r), expected); }
 r.dispose();
});


for (const inherited of [false, true]) test(`owned server counts use the filtered list in their own row, not another row (inherited=${inherited})`, async () => {
 const doc = fixture(), data = [
  { tags: [{ name: 'Alpha' }, { name: 'Beta' }] },
  { tags: [{ name: 'Alpha' }, { name: 'Alpha' }, { name: 'Beta' }] },
  { tags: null },
 ];
 if (inherited) data.forEach(item => Object.assign(item, { children: [{ child: 'one' }, { tags: [] }, { tags: null }] }));
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.children = ['products', 'result'];
 doc.nodes.products.list = { from: 'response' }; doc.nodes.products.children = ['tags', 'reload'];
 doc.nodes.tags.list = { from: 'tags' }; doc.nodes.tags.children = [];
 if (inherited) {
  doc.nodes.products.children = ['middle'];
  doc.nodes.middle = { ...doc.nodes.products, id: 'middle', list: { from: 'children' }, children: ['tags', 'reload'] };
 }
 doc.nodes.reload.scripts![0].steps = [
  { id: 'filter', kind: 'filter-array', array: 'tags', field: 'name', op: 'eq', value: 'Alpha' },
  { id: 'count', kind: 'count', array: 'tags', into: 'joined' },
 ];
 for (const r of await runtimes(doc, data)) {
  for (const [i, expected] of (inherited ? ['1', '0', '0', '2', '0', '0', '0', '0', '0'] : ['1', '2', '0']).entries()) { await r.click('reload', i); assert.equal(output(r), expected); }
  r.dispose();
 }
});

test('interleaved client children use their values or the filtered list of the nearest server owner', async () => {
 const doc = fixture(), data = [
  { tags: [{ name: 'Alpha' }, { name: 'Beta' }] },
  { tags: [{ name: 'Alpha' }, { name: 'Alpha' }, { name: 'Beta' }] },
 ];
 const children = [{ tags: [{ name: 'Alpha' }, { name: 'Alpha' }, { name: 'Alpha' }] }, { tags: null }, { child: 'inherits' }];
 Object.assign(data[0], { children });
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.children = ['load-children', 'products', 'result'];
 doc.nodes['load-children'] = { ...doc.nodes.reload, id: 'load-children', attrId: 'load-children', scripts: [{ ...doc.nodes.reload.scripts![0], steps: [{ id: 'copy', kind: 'set-var', value: '{response.0.children}', into: 'clients' }] }] };
 doc.nodes.products.list = { from: 'response' }; doc.nodes.products.children = ['tags', 'client-children'];
 doc.nodes.tags.list = { from: 'tags' }; doc.nodes.tags.children = [];
 doc.nodes['client-children'] = { ...doc.nodes.tags, id: 'client-children', list: { from: 'clients' }, children: ['reload'] };
 doc.nodes.reload.scripts![0].steps = [
  { id: 'filter', kind: 'filter-array', array: 'tags', field: 'name', op: 'eq', value: 'Alpha' },
  { id: 'count', kind: 'count', array: 'tags', into: 'joined' },
 ];
 const r = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc));
 await r.click('load-children');
 for (const [i, expected] of ['3', '0', '1', '3', '0', '2'].entries()) { await r.click('reload', i); assert.equal(output(r), expected, `row ${i}`); }
 r.dispose();
});

for (const inherited of [false, true]) test(`count-only limited lists keep rendered counts without exposing row fields (inherited=${inherited})`, async () => {
 const doc = fixture(), data = [{ tags: [{ name: 'Alpha', private: 'SECRET' }, { name: 'Beta' }], children: [{ child: 'one' }] }];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 for (const node of Object.values(doc.nodes)) if (node.id !== 'reload') delete node.scripts;
 doc.pages.p.children = ['products', 'result'];
 doc.nodes.products.list = { from: 'response' }; doc.nodes.products.children = ['tags', 'reload'];
 doc.nodes.tags.list = { from: 'tags', limit: 1 }; doc.nodes.tags.children = [];
 if (inherited) {
  doc.nodes.products.children = ['middle'];
  doc.nodes.middle = { ...doc.nodes.products, id: 'middle', list: { from: 'children' }, children: ['tags', 'reload'] };
 }
 doc.nodes.reload.scripts![0].steps = [{ id: 'count', kind: 'count', array: 'tags', into: 'joined' }];
 const html = await publishedClientNested(doc, 'app/page.tsx', data);
 assert.doesNotMatch(html, /Alpha|Beta|SECRET|private/);
 for (const r of await runtimes(doc, data)) { await r.click('reload'); assert.equal(output(r), '1'); r.dispose(); }
});
