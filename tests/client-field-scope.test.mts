import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { scriptsFile } from '../lib/script-runtime';
import { clientNestedCanvas, publishedClientNested } from './helpers/client-nested-lists';
import { clientFieldDoc, fieldItems } from './helpers/client-field-scope';
import { listRuntimeDom } from './helpers/list-runtime-dom';
import { makeText } from '../lib/presets';
const { parse } = createRequire(import.meta.url)('next/dist/compiled/node-html-parser');
const values = (rt: ReturnType<typeof listRuntimeDom>, id: string) => rt.active('#' + id).map(n => n.value);
for (const component of [false, true]) test(`${component ? 'component' : 'plain'} fields keep client row values, labels and options through repeated load and navigation`, async () => {
  const doc = clientFieldDoc(component), saved = JSON.stringify(doc);
  const html = await publishedClientNested(doc, 'app/page.tsx', fieldItems);
  const canvas = parse(clientNestedCanvas(doc, fieldItems));
  const expected = canvas.querySelectorAll('#entry').map((n: any) => n.getAttribute('value'));
  assert.deepEqual(expected, ['Edit First', 'Edit Second']);
  const rt = listRuntimeDom(html, scriptsFile(doc));
  const templateNodes = rt.root.querySelectorAll('[data-field-value-parts]');
  const templates = templateNodes.map(n => ({ ...n.attrs }));
  for (let i = 0; i < 2; i++) {
    await rt.click('reload');
    for (const id of ['entry', 'memo', 'choice']) assert.deepEqual(values(rt, id), expected, id);
    for (const id of ['entry', 'memo']) assert.deepEqual(rt.active('#' + id).map(n => n.getAttribute('placeholder')), ['Find First', 'Find Second']);
    assert.deepEqual(rt.active('#radio').map(n => n.querySelector('input')!.value), expected);
    for (const id of ['radio', 'box', 'submit']) assert.deepEqual(rt.active('#' + id).map(n => n.textContent.trim()), expected, id);
  }
  assert.deepEqual(templateNodes.map(n => ({ ...n.attrs })), templates);
  rt.navigate('<span data-page-body="other"></span>'); rt.navigate(html); await rt.click('reload');
  assert.deepEqual(values(rt, 'entry'), expected); rt.dispose(); assert.equal(JSON.stringify(doc), saved);
});
test('field parts preserve own roots, scalar fallbacks, escapes, literal data braces and privacy', async () => {
  const doc = clientFieldDoc();
  const items = [
    { name: 'Data {label}', profile: { name: 'Global' }, tags: [{ label: 'red' }] },
    { name: null, profile: null, tags: [{ label: 'null' }] },
    { name: '', profile: {}, tags: [{ label: 'empty' }] },
    { 'profile.name': 'Dotted {name}', tags: [{ label: 'dotted' }] },
  ];
  (doc.pages.p.pageScripts![0].steps[0] as any).preview = { sample: items };
  doc.pages.p.pageScripts![0].steps.push(
    { id: 'profile', kind: 'set-var', value: '{response.0.profile}', into: 'profile' },
    { id: 'fallback', kind: 'set-var', value: 'Server \\{name}', into: 'fallback' },
    { id: 'private', kind: 'set-var', value: 'UNUSED_FIELD_PRIVATE', into: 'private' },
  );
  const expression = '{name}|{profile.name}|{fallback}|\\{name}';
  for (const id of ['entry', 'memo']) doc.nodes[id].field!.defaultValue = expression;
  const html = await publishedClientNested(doc, 'app/page.tsx', items); assert.ok(!html.includes('UNUSED_FIELD_PRIVATE'));
  const rt = listRuntimeDom(html, scriptsFile(doc)); await rt.click('reload');
  for (const id of ['entry', 'memo']) assert.deepEqual(values(rt, id), [
    'Data {label}|Global|Server {name}|{name}', '||Server {name}|{name}', '||Server {name}|{name}', 'Data {label}|Dotted {name}|Server {name}|{name}',
  ]);
  rt.dispose();
});
test('live field tokens continue reading current values without reparsing data or overwriting user edits', async () => {
  const doc = clientFieldDoc();
  for (const id of ['entry', 'memo']) {
    doc.nodes[id].field!.defaultValue = '{name}: {live}';
    doc.nodes[id].field!.placeholder = '{name}: {live}';
  }
  doc.nodes.change = { ...makeText('Change live'), id: 'change', attrId: 'change', scripts: [{ id: 'change-script', trigger: 'click', pos: { x: 0, y: 0 }, steps: [
    { id: 'change-live', kind: 'set-var', into: 'live', value: 'Later \\{name}' },
  ] }] };
  doc.pages.p.children.unshift('change');
  const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', fieldItems), scriptsFile(doc)); await rt.click('reload');
  assert.deepEqual(values(rt, 'entry'), ['First: ', 'Second: ']);
  rt.active('#entry')[1].value = 'Typed'; rt.active('#entry')[1].setAttribute('data-edited', '');
  await rt.click('change');
  assert.deepEqual(values(rt, 'entry'), ['First: Later {name}', 'Typed']);
  assert.deepEqual(values(rt, 'memo'), ['First: Later {name}', 'Second: Later {name}']);
  assert.deepEqual(rt.active('#entry').map(n => n.getAttribute('placeholder')), ['First: Later {name}', 'Second: Later {name}']);
  rt.dispose();
});
test('select static defaults and absent defaults are reapplied after resolving dynamic options', async () => {
  const doc = clientFieldDoc();
  doc.nodes.choice.field!.options = ['{name}', 'Static'].map(value => ({label:value,value})); doc.nodes.choice.field!.defaultValue = 'Static';
  const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', fieldItems), scriptsFile(doc)); await rt.click('reload');
  assert.deepEqual(values(rt, 'choice'), ['Static', 'Static']); rt.dispose();
  doc.nodes.choice.field!.defaultValue = undefined; doc.nodes.choice.field!.options!.push({label:'',value:''});
  const empty = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', fieldItems), scriptsFile(doc)); await empty.click('reload');
  assert.deepEqual(values(empty, 'choice'), ['First', 'Second']); empty.dispose();
});
test('no-collision input, static controls and server-only rendering retain their values', async () => {
  const doc = clientFieldDoc(); doc.pages.p.pageScripts![0].steps.pop();
  doc.nodes.memo.field!.defaultValue = 'Static';
  const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', fieldItems), scriptsFile(doc)); await rt.click('reload');
  assert.deepEqual(values(rt, 'entry'), ['Edit First', 'Edit Second']);
  assert.deepEqual(values(rt, 'memo'), ['Static', 'Static']); rt.dispose();
  doc.nodes.products.list!.from = 'response'; doc.pages.p.children = ['products']; delete doc.nodes.reload;
  const html = await publishedClientNested(doc, 'app/page.tsx', fieldItems);
  assert.ok(!html.includes('data-field-'));
  assert.deepEqual(parse(html).querySelectorAll('#entry').map((n: any) => n.getAttribute('value')), ['Edit First', 'Edit Second']);
});
test('live select options refresh before default values and same-script reads', async () => {
  const doc = clientFieldDoc();
  doc.nodes.choice.field!.options = ['Other', '{name}: {live}'].map(value => ({label:value,value})); doc.nodes.choice.field!.defaultValue = '{name}: {live}';
  doc.nodes.change = { ...makeText('Change'), id: 'change', attrId: 'change', scripts: [{ id: 'change-script', trigger: 'click', pos: { x: 0, y: 0 }, steps: [
    { id: 'change-live', kind: 'set-var', into: 'live', value: 'Later' },
    { id: 'read-choice', kind: 'set-var', into: 'observed', value: '{choice}' },
  ] }] };
  doc.nodes.observed = { ...makeText('{observed}'), id: 'observed', attrId: 'observed' };
  doc.pages.p.children.push('change', 'observed');
  const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', fieldItems), scriptsFile(doc)); await rt.click('reload'); await rt.click('change');
  assert.deepEqual(values(rt, 'choice'), ['First: Later', 'Second: Later']);
  assert.equal(rt.active('#observed')[0].textContent, 'First: Later'); rt.dispose();
});
