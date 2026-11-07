import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeText } from '../lib/presets';
import { SCRIPT_RUNTIME, scriptsFile } from '../lib/script-runtime';
import { clientNestedCanvas, publishedClientNested } from './helpers/client-nested-lists';
import { listRuntimeDom } from './helpers/list-runtime-dom';

import { serverArrayJoinDoc as fixture, serverArrayJoinItems as items } from './helpers/server-array-join';

test('click join uses fetched source without exposing unused response fields in Canvas and export', async () => {
 const doc = fixture();
 for (const preview of [true, false]) {
  const html = preview ? clientNestedCanvas(doc, items) : await publishedClientNested(doc, 'app/page.tsx', items);
  assert.doesNotMatch(html, /SECRET|private/);
  const r = listRuntimeDom(html, preview ? `(${SCRIPT_RUNTIME})(env).install(document)` : scriptsFile(doc));
  await r.click('reload');
  assert.equal(preview ? r.vars.joined : r.active('#result')[0].textContent, 'Alpha,Beta');
  r.dispose();
 }
});

async function runtimes(doc: ReturnType<typeof fixture>, data: unknown[] = items) {
 return [
  listRuntimeDom(clientNestedCanvas(doc, data), `(${SCRIPT_RUNTIME})(env).install(document)`),
  listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc)),
 ];
}
const output = (r: ReturnType<typeof listRuntimeDom>) => r.vars.joined ?? r.active('#result')[0].textContent;

test('repeated joins, save/reload and navigation retain literal results and no full response', async () => {
 const doc = fixture(), data = [{ name: '{secret}', private: 'SECRET' }, { name: 'Beta' }];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 for (const r of await runtimes(JSON.parse(JSON.stringify(doc)), data)) {
  for (let i = 0; i < 2; i++) { await r.click('reload'); assert.equal(output(r), '{secret},Beta'); }
  r.dispose();
 }
 const html = await publishedClientNested(doc, 'app/page.tsx', data);
 const r = listRuntimeDom(html, scriptsFile(doc));
 await r.click('reload'); r.navigate('<span data-page-body="other"></span>');
 r.navigate(html); await r.click('reload'); assert.equal(output(r), '{secret},Beta'); r.dispose();
});

test('literal field/separator and scalar, nested-path, primitive and empty sources match both renderers', async () => {
 for (const [array, field, sep, expected] of [
  ['response', 'info.name', '|', 'Nested'],
  ['response.0.tags', '', ',', 'a,0,false'],
  ['response.0.empty', '', ',', ''],
  ['response.0.nil', '', ',', ''],
  ['response.0.missing', '', ',', ''],
  ['missing', '', ',', ''],
  ['response.0.name', '', ',', 'Alpha'],
  ['response', '{field}', '{separator}', 'Literal{separator}Other'],
  ['response', ' spaced ', ',', 'Exact'],
 ] as const) {
  const doc = fixture(), data = [
   { name: 'Alpha', ' spaced ': 'Exact', info: { name: 'Nested' }, tags: ['a', 0, false, null, {}], empty: [], nil: null, '{field}': 'Literal', private: 'SECRET' },
   { '{field}': 'Other' },
  ];
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
  Object.assign(doc.nodes.reload.scripts![0].steps[0], { array, field, sep });
  for (const r of await runtimes(doc, data)) { await r.click('reload'); assert.equal(output(r), expected); r.dispose(); }
 }
});

test('client-owned sources are never snapshotted and repeated writes stay authoritative', async () => {
 const doc = fixture();
 doc.nodes.reload.scripts![0].steps.unshift({ id: 'write', kind: 'split', source: 'Client,New', sep: ',', into: 'response' });
 Object.assign(doc.nodes.reload.scripts![0].steps[1], { field: '' });
 const html = await publishedClientNested(doc, 'app/page.tsx', items);
 assert.doesNotMatch(html, /Alpha|Beta|SECRET|joinFallback/);
 for (const r of await runtimes(doc)) {
  for (let i = 0; i < 2; i++) { await r.click('reload'); assert.equal(output(r), 'Client,New'); }
  r.dispose();
 }
});

test('operation fallback never replaces an explicit client empty value or owned missing leaf', async () => {
 for (const [name, into, raw] of [
  ['response', 'response', []], ['response', 'response', null], ['response', 'response', ''],
  ['response.tags', 'response', {}], ['response.tags', 'response', null],
  ['response.tags', 'response.tags', []],
 ] as const) {
  const scripts = [{ trigger: 'click', steps: [
   { kind: 'set-var', into, raw },
   { kind: 'join', array: name, field: '', sep: ',', into: 'joined', joinFallback: { value: 'STALE' } },
  ] }];
  const html = `<button id="reload" data-scripts='${JSON.stringify(scripts)}'></button>`;
  const r = listRuntimeDom(html, `(${SCRIPT_RUNTIME})(env).install(document)`);
  await r.click('reload'); assert.equal(r.vars.joined, ''); r.dispose();
 }
});

test('server row sources use exact dotted keys and inherited values without transporting unused fields', async () => {
 const doc = fixture(), data = [
  { name: 'First', 'info.tags': [{ label: 'Literal', private: 'SECRET' }], info: { tags: [{ label: 'Wrong' }] } },
  { name: 'Second', info: { tags: [{ label: 'Nested', private: 'SECRET' }] } },
  { name: 'Empty', 'info.tags': null, info: { tags: [{ label: 'Wrong' }] } },
 ];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.children = ['products', 'result'];
 doc.nodes.products.list = { from: 'response' };
 doc.nodes.products.children = ['reload'];
 Object.assign(doc.nodes.reload.scripts![0].steps[0], { array: 'info.tags', field: 'label' });
 const html = await publishedClientNested(doc, 'app/page.tsx', data);
 assert.doesNotMatch(html, /SECRET|Wrong/);
 for (const r of await runtimes(doc, data)) {
  for (const [i, expected] of ['Literal', 'Nested', ''].entries()) { await r.click('reload', i); assert.equal(output(r), expected); }
  r.dispose();
 }
});

test('row-owned arrays beat global client arrays, including null and inherited row values', async () => {
 const doc = fixture(), data = [
  { name: 'First', tags: ['Local'], children: [{ child: 'one' }], private: 'SECRET' },
  { name: 'Empty', tags: null, children: [{ child: 'two' }] },
 ];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.children = ['products', 'result'];
 doc.nodes.products.list = { from: 'response' };
 doc.nodes.products.children = ['tags'];
 doc.nodes.tags.list = { from: 'children' };
 doc.nodes.tags.children = ['reload'];
 doc.nodes.reload.scripts![0].steps = [
  { id: 'write', kind: 'split', source: 'Global', sep: ',', into: 'tags' },
  { id: 'join', kind: 'join', array: 'tags', sep: ',', into: 'joined' },
 ];
 const html = await publishedClientNested(doc, 'app/page.tsx', data); assert.doesNotMatch(html, /SECRET/);
 for (const r of await runtimes(doc, data)) {
  for (const [i, expected] of ['Local', ''].entries()) { await r.click('reload', i); assert.equal(output(r), expected); }
  r.dispose();
 }
});

test('client row and loop sources beat a server fallback and keep braces literal', async () => {
 const doc = fixture(), data = [
  { tags: ['{secret}', 'Local'] }, { tags: null }, { other: true },
 ];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.pageScripts![0].steps.push({ id: 'alias', kind: 'split', source: 'Server', sep: ',', into: 'tags' });
 doc.pages.p.children = ['load', 'products', 'result'];
 doc.nodes.load = { ...makeText('Load'), id: 'load', attrId: 'load', scripts: [{ id: 'load', trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: 'copy', kind: 'set-var', value: '{response}', into: 'clients' }] }] };
 doc.nodes.products.list = { from: 'clients' }; doc.nodes.products.children = ['reload'];
 Object.assign(doc.nodes.reload.scripts![0].steps[0], { array: 'tags', field: '' });
 // The explicit copy intentionally transports response; the join fallback contains only Server.
 const r = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc));
 for (let repeat = 0; repeat < 2; repeat++) {
  await r.click('load');
  for (const [i, expected] of ['{secret},Local', '', 'Server'].entries()) { await r.click('reload', i); assert.equal(output(r), expected); }
 }
 r.dispose();
 doc.pages.p.children = ['load', 'result'];
 doc.nodes.load.scripts![0].steps.push({ id: 'each', kind: 'for-each', array: 'clients', then: [
  { id: 'join', kind: 'join', array: 'tags', sep: ',', into: 'joined' },
 ] });
 for (const [index, expected] of ['{secret},Local', '', 'Server'].entries()) {
  const one = [data[index]];
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = one;
  for (const run of await runtimes(doc, one)) { await run.click('load'); assert.equal(output(run), expected); run.dispose(); }
 }
});

test('server ancestor join remains local inside a browser-created child row', async () => {
 const doc = fixture(), data = [{ tags: ['Ancestor'], private: 'SECRET' }];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.children = ['load', 'products', 'result'];
 doc.nodes.load = { ...makeText('Load'), id: 'load', attrId: 'load', scripts: [{ id: 'load', trigger: 'click', pos: { x: 0, y: 0 }, steps: [
  { id: 'children', kind: 'split', source: 'one,two', sep: ',', into: 'clients' },
  { id: 'global', kind: 'split', source: 'Global', sep: ',', into: 'tags' },
 ] }] };
 doc.nodes.products.list = { from: 'response' }; doc.nodes.products.children = ['tags'];
 doc.nodes.tags.list = { from: 'clients' }; doc.nodes.tags.children = ['reload'];
 Object.assign(doc.nodes.reload.scripts![0].steps[0], { array: 'tags', field: '' });
 const html = await publishedClientNested(doc, 'app/page.tsx', data); assert.doesNotMatch(html, /SECRET/);
 const r = listRuntimeDom(html, scriptsFile(doc));
 for (let i = 0; i < 2; i++) { await r.click('load'); await r.click('reload', 1); assert.equal(output(r), 'Ancestor'); }
 r.dispose();
});

test('join finds client ancestors through cloned server-fallback rows', async () => {
 for (const [array, data, expected] of [
  ['tags', [{ tags: ['Local'] }, { tags: null }, {}], ['Local', '', 'Server']],
  ['info.tags', [{ info: { tags: ['Local'] } }, { info: null }, { info: {} }, {}], ['Local', '', '', 'Local']],
 ] as const) {
  const doc = fixture();
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
  doc.pages.p.pageScripts![0].steps.push(
   array === 'info.tags'
    ? { id: 'alias', kind: 'set-var', value: '{response.0.info}', into: 'info' }
    : { id: 'alias', kind: 'split', source: 'Server', sep: ',', into: array },
   { id: 'inner', kind: 'split', source: 'one', sep: ',', into: 'inner' },
  );
  doc.pages.p.children = ['load', 'products', 'result'];
  doc.nodes.load = { ...makeText('Load'), id: 'load', attrId: 'load', scripts: [{ id: 'load', trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: 'copy', kind: 'set-var', value: '{response}', into: 'clients' }] }] };
  doc.nodes.products.list = { from: 'clients' }; doc.nodes.products.children = ['tags'];
  doc.nodes.tags.list = { from: 'inner' }; doc.nodes.tags.children = ['reload'];
  Object.assign(doc.nodes.reload.scripts![0].steps[0], { array, field: '' });
  const r = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc));
  for (let repeat = 0; repeat < 2; repeat++) {
   await r.click('load');
   for (const [i, value] of expected.entries()) { await r.click('reload', i); assert.equal(output(r), value, `${array}:${i}`); }
  }
  r.dispose();
 }
});

test('join resolves an owned row root before a page-level exact dotted key', async () => {
 const doc = fixture(), data = [
  { info: { tags: ['Row'] }, private: 'SECRET' },
  { info: null }, { info: {} }, {},
 ];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.pageScripts![0].steps.push({ id: 'global', kind: 'split', source: 'Global', sep: ',', into: 'info.tags' });
 doc.pages.p.children = ['products', 'result'];
 doc.nodes.products.list = { from: 'response' }; doc.nodes.products.children = ['reload'];
 Object.assign(doc.nodes.reload.scripts![0].steps[0], { array: 'info.tags', field: '' });
 const html = await publishedClientNested(doc, 'app/page.tsx', data); assert.doesNotMatch(html, /SECRET|Wrong/);
 for (const r of await runtimes(doc, data)) {
  for (const [i, expected] of ['Row', '', '', 'Global'].entries()) { await r.click('reload', i); assert.equal(output(r), expected); }
  r.dispose();
 }
});

function obfuscatedJoinFixture(nested: boolean, client = true) {
 const doc = fixture(), data = [{ info: { tags: ['Local'] } }, { info: null }, { info: {} }, {}];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.pageScripts![0].steps.push(
  { id: 'alias', kind: 'split', source: 'Server', sep: ',', into: 'info.tags' },
  { id: 'inner', kind: 'split', source: 'one', sep: ',', into: 'inner' },
 );
 doc.pages.p.children = ['load', 'products', 'result'];
 doc.nodes.load = { ...makeText('Load'), id: 'load', attrId: 'load', scripts: [{ id: 'load', trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: 'copy', kind: 'set-var', value: '{response}', into: 'clients' }] }] };
 doc.nodes.products.list = { from: client ? 'clients' : 'response' }; doc.nodes.products.children = nested ? ['tags'] : ['reload'];
 doc.nodes.tags.list = { from: 'inner' }; doc.nodes.tags.children = ['reload'];
 doc.nodes.reload.scripts![0].steps = [{ id: 'join', kind: 'join', array: 'info.tags', field: '', sep: ',', into: 'joined' }];
 return { doc, data };
}

for (const nested of [false, true]) test(`${nested ? 'nested' : 'direct'} join keeps item paths across export obfuscation without an exact dotted sample key`, async () => {
 for (const client of [true, false]) {
  const { doc, data } = obfuscatedJoinFixture(nested, client), saved = structuredClone(doc);
  // Ordinary JSON save/reload and a second generation must not retain transient metadata.
  for (let generation = 0; generation < 2; generation++) {
   const copy = JSON.parse(JSON.stringify(doc));
   const html = await publishedClientNested(copy, 'app/page.tsx', data);
   assert.match(html, /itemArray/);
   const r = listRuntimeDom(html, scriptsFile(copy));
   for (let repeat = 0; repeat < 2; repeat++) {
    if (client) await r.click('load');
    for (const [i, value] of ['Local', '', '', 'Server'].entries()) { await r.click('reload', i); assert.equal(output(r), value); }
   }
   r.dispose(); assert.deepEqual(copy, saved);
  }
  assert.deepEqual(doc, saved);
 }
});

test('obfuscated join uses generated names for client writes and original names for nested loop items', async () => {
 const { doc, data } = obfuscatedJoinFixture(false);
 doc.pages.p.children = ['load', 'result'];
 const join = doc.nodes.reload.scripts![0].steps[0];
 doc.nodes.load.scripts![0].steps.push(
  { id: 'global', kind: 'split', source: 'Browser', sep: ',', into: 'info.tags' },
  { id: 'loop', kind: 'for-each', array: 'clients', then: [{ id: 'repeat', kind: 'repeat', times: 1, then: [join] }] },
 );
 for (const [i, expected] of ['Local', '', '', 'Browser'].entries()) {
  const one = [data[i]];
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = one;
  for (const r of await runtimes(doc, one)) { await r.click('load'); assert.equal(output(r), expected); r.dispose(); }
 }
 // No row owner: an explicit empty browser write must override the server result.
 doc.nodes.load.scripts![0].steps = [
  { id: 'empty', kind: 'set-var', value: '', into: 'info.tags' }, join,
 ];
 for (const r of await runtimes(doc, data)) { await r.click('load'); assert.equal(output(r), ''); r.dispose(); }
});

test('obfuscated join metadata is per-document and does not expose private row fields', async () => {
 const { doc, data } = obfuscatedJoinFixture(false, false);
 doc.pages.p.children = ['products', 'result']; // No explicit response copy is authorized.
 const privateData = data.map(row => ({ ...row, private: 'UNUSED_PRIVATE' }));
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = privateData;
 const html = await publishedClientNested(doc, 'app/page.tsx', privateData);
 assert.doesNotMatch(html, /UNUSED_PRIVATE|private/);
 const other = fixture();
 const otherHtml = await publishedClientNested(other, 'app/page.tsx', items);
 assert.doesNotMatch(otherHtml, /info.tags|UNUSED_PRIVATE/);
 const r = listRuntimeDom(otherHtml, scriptsFile(other)); await r.click('reload'); assert.equal(output(r), 'Alpha,Beta'); r.dispose();
 const again = await publishedClientNested(doc, 'app/page.tsx', privateData);
 assert.equal(again, html);
 assert.doesNotMatch(JSON.stringify(doc), /itemArray|joinFallback/);
});

function orderedScopeFixture(layers: string[]) {
 const doc = fixture(), data = [{
  info: { tags: ['Outer'] },
  children: [{ info: { tags: ['Inner'] } }, { info: null }, { info: {} }],
  closer: [{ info: { tags: ['Client'] } }, { info: null }, { info: {} }, {}],
  leaf: [{ info: { tags: ['Leaf'] } }, { info: null }, { info: {} }, {}],
 }];
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.pages.p.pageScripts![0].steps.push(
  { id: 'page', kind: 'split', source: 'Page', sep: ',', into: 'info.tags' },
  { id: 'inner', kind: 'set-var', value: '{response.0.children}', into: 'inner' },
  { id: 'leaf', kind: 'set-var', value: '{response.0.leaf}', into: 'leaf' },
 );
 doc.pages.p.children = ['load', 'products', 'result'];
 doc.nodes.load = { ...makeText('Load'), id: 'load', attrId: 'load', scripts: [{ id: 'load', trigger: 'click', pos: { x: 0, y: 0 }, steps: [
  { id: 'outer', kind: 'set-var', value: '{response}', into: 'clients' },
  { id: 'closer', kind: 'set-var', value: '{response.0.closer}', into: 'closerClients' },
 ] }] };
 layers.forEach((from, index) => {
  const id = index ? `layer-${index}` : 'products';
  doc.nodes[id] = { ...doc.nodes.products, id, list: { from }, children: [index + 1 === layers.length ? 'reload' : `layer-${index + 1}`] };
 });
 Object.assign(doc.nodes.reload.scripts![0].steps[0], { array: 'info.tags', field: '' });
 return { doc, data };
}

test('closer server-owned rows beat an outer client owner including null and missing leaves', async () => {
 const { doc, data } = orderedScopeFixture(['clients', 'inner']);
 const r = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc));
 for (let pass = 0; pass < 2; pass++) {
  await r.click('load');
  for (const [i, expected] of ['Inner', '', ''].entries()) { await r.click('reload', i); assert.equal(output(r), expected); }
 }
 r.dispose();
});

test('closer client owners beat server fallbacks but absent client roots retain nearest server ownership', async () => {
 const { doc, data } = orderedScopeFixture(['clients', 'inner', 'closerClients']);
 const r = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc));
 await r.click('load');
 for (const [i, expected] of ['Client', '', '', 'Inner', 'Client', '', '', '', 'Client', '', '', ''].entries()) {
  await r.click('reload', i); assert.equal(output(r), expected, `row ${i}`);
 }
 r.dispose();
});

test('interleaved client/server rows preserve nearest ownership and loops retain priority', async () => {
 const { doc, data } = orderedScopeFixture(['clients', 'inner', 'closerClients', 'leaf']);
 const html = await publishedClientNested(doc, 'app/page.tsx', data);
 const r = listRuntimeDom(html, scriptsFile(doc)); await r.click('load');
 const expected = ['Leaf', '', '', 'Client', 'Leaf', '', '', '', 'Leaf', '', '', '', 'Leaf', '', '', 'Inner'];
 for (const [i, value] of expected.entries()) { await r.click('reload', i); assert.equal(output(r), value, `row ${i}`); }
 r.dispose();
 const join = doc.nodes.reload.scripts![0].steps[0];
 doc.nodes.reload.scripts![0].steps = [{ id: 'loop', kind: 'for-each', array: 'closerClients', then: [join] }];
 // Last loop item has a missing leaf but owns the root, overriding all row fallbacks.
 data[0].closer.pop();
 const loop = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc));
 await loop.click('load'); await loop.click('reload'); assert.equal(output(loop), ''); loop.dispose();
});

test('server-client-server boundaries reflect actual wrappers and let nearer client owners shadow older server rows', async () => {
 const { doc, data } = orderedScopeFixture(['response', 'closerClients', 'leaf']);
 const r = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', data), scriptsFile(doc)); await r.click('load');
 const expected = ['Leaf', '', '', 'Client', 'Leaf', '', '', '', 'Leaf', '', '', '', 'Leaf', '', '', 'Outer'];
 for (const [i, value] of expected.entries()) {
  const action = JSON.parse(r.active('#reload')[i].getAttribute('data-scripts')!)[0].steps[0];
  assert.equal(action.joinFallback.rowOffset, i % 4 === 3 ? 2 : 0);
  let row = r.active('#reload')[i].closest('[data-row]');
  for (let n = 0; n < action.joinFallback.rowOffset; n++) row = row!.parentElement!.closest('[data-row]');
  assert.ok(row); assert.equal(row!.getAttribute('data-item'), null, 'boundary identifies a rendered server row');
  await r.click('reload', i); assert.equal(output(r), value, `row ${i}`);
 }
 r.dispose();
});
