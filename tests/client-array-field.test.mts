import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withItemField } from '../lib/data';
import { compileScripts } from '../lib/script';
import { SCRIPT_RUNTIME, scriptsFile } from '../lib/script-runtime';
import { clientArrayFieldFixture } from './helpers/client-array-field';
import { clientScriptBundle } from './helpers/client-script-scope';
import { publishedClientNested } from './helpers/client-nested-lists';
import { listRuntimeDom } from './helpers/list-runtime-dom';

for (const component of [false, true]) test(`${component ? 'component' : 'plain'} array-field resolves target items before the clicked row and preserves typed values`, async () => {
  const { doc, items } = clientArrayFieldFixture(component);
  const html = await publishedClientNested(doc, 'app/page.tsx', items);
  assert.ok(!html.includes('UNUSED_SERVER_PRIVATE'));
  for (const source of [scriptsFile(doc), `(${SCRIPT_RUNTIME})(env).install(document);`]) {
    const rt = listRuntimeDom(html, source);
    for (let pass = 0; pass < 2; pass++) {
      await rt.click('reload');
      for (const row of [1, 0]) {
        await rt.click('act', row);
        assert.equal(rt.active('#result')[0].textContent, 'First {label}|Second');
        assert.equal(rt.active('#raw-result')[0].textContent, 'Raw {name}|false');
        if (source.includes('(env).install')) {
          const step = JSON.parse(rt.active('#act')[row].getAttribute('data-scripts')!)[0].steps[0];
          const targets = rt.vars[step.array] as any[];
          assert.deepEqual(JSON.parse(JSON.stringify(targets.map(x => x.raw))), items.map(x => x.payload));
        }
      }
    }
    rt.navigate('<div data-page-body="other"></div>'); rt.navigate(html);
    await rt.click('reload'); await rt.click('act', 1);
    assert.equal(rt.active('#result')[0].textContent, 'First {label}|Second');
    rt.dispose();
  }
});

test('array-field reads live fields/globals at execution and preserves escaped and data braces', async () => {
  const { doc, items } = clientArrayFieldFixture();
  (doc.nodes.act.scripts![0].steps[0] as any).value = '{name}|{counter}|{entry}|\\{name}';
  const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await rt.click('reload'); await rt.click('change');
  rt.active('#entry')[1].value = 'Edited {name}'; await rt.click('act', 1);
  assert.equal(rt.active('#result')[0].textContent, 'First {label}|7|Edited {name}|{name}|Second|7|Edited {name}|{name}');
  rt.active('#entry')[1].value = 'Changed'; await rt.click('act', 1);
  assert.equal(rt.active('#result')[0].textContent, 'First {label}|7|Changed|{name}|Second|7|Changed|{name}');
  rt.dispose();
});

test('array-field inside a matching loop updates the current target item, not the clicked row', async () => {
  const { doc, items } = clientArrayFieldFixture();
  const steps = doc.nodes.act.scripts![0].steps;
  steps.splice(0, 2, { id: 'loop', kind: 'for-each', array: 'targets', then: steps.slice(0, 2) });
  const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await rt.click('reload'); await rt.click('act', 1);
  assert.equal(rt.active('#result')[0].textContent, 'First {label}|Second');
  assert.equal(rt.active('#raw-result')[0].textContent, 'Raw {name}|false');
  rt.dispose();
});

test('array-field typed fallbacks contain only referenced leaves and own null roots win', async () => {
  const { doc, items } = clientArrayFieldFixture();
  Object.assign(items[0], { profile: { value: { label: 'Fallback {name}' }, secret: 'UNREFERENCED_MEMBER' } });
  Object.assign(items[1], { profile: null });
  items.push({ name: 'Third', payload: null, tags: [{ label: 'third' }] } as any);
  items.push({ name: 'Fourth', payload: null, 'profile.value': { label: 'Dotted {name}' }, tags: [{ label: 'fourth' }] } as any);
  doc.pages.p.pageScripts![0].steps.push({ id: 'profile', kind: 'set-var', value: '{response.0.profile}', into: 'profile' });
  (doc.nodes.act.scripts![0].steps[0] as any).value = '{profile.value}';
  const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), `(${SCRIPT_RUNTIME})(env).install(document);`);
  await rt.click('reload'); await rt.click('act', 2);
  const scripts = rt.active('#act')[2].getAttribute('data-scripts')!;
  assert.ok(!scripts.includes('UNREFERENCED_MEMBER')); assert.ok(!scripts.includes('UNUSED_SERVER_PRIVATE'));
  const step = JSON.parse(scripts)[0].steps[0], targets = rt.vars[step.array] as any[];
  assert.equal(targets[0].copied.label, 'Fallback {name}');
  assert.equal(targets[1].copied, undefined);
  assert.equal(targets[2].copied.label, 'Fallback {name}');
  assert.equal(targets[3].copied.label, 'Dotted {name}');
  rt.dispose();
});

test('server-only array-field still resolves each item without client expression metadata', async () => {
  const { doc, items } = clientArrayFieldFixture();
  doc.pages.p.pageScripts![0].steps.push({ id: 'server-field', kind: 'array-field', array: 'response', field: 'copied', value: '{name}' });
  doc.nodes.result.text!.content = '{response.0.copied}|{response.1.copied}';
  const html = await publishedClientNested(doc, 'app/page.tsx', items);
  assert.ok(html.includes('First {label}|Second'));
  assert.equal((withItemField(items, 'copied', '{payload}', {}) as any[])[1].copied, false);
  // キャンバスや通常の呼び出しは対象項目の値を先に焼き込まない。
  const compiled = compileScripts(doc.nodes.act, () => '');
  assert.equal(compiled[0].steps[0].value, '{name}');
});

test('native array-field regression bundles the actual ScriptEditor and ArrayFieldBody', async () => {
  const bundle = await clientScriptBundle(clientArrayFieldFixture().doc);
  assert.ok(bundle.includes('ArrayFieldBody')); assert.ok(bundle.includes('Reload saved'));
});

test('array-field preserves number, null, object and array single-token values', async () => {
  const { doc, items } = clientArrayFieldFixture();
  const values = [42, false, null, { scriptParts: ['literal'], label: 'Object {name}' }, ['Array {name}']];
  items.splice(0, items.length, ...values.map((payload, i) => ({ name: `Row ${i}`, payload, tags: [{ label: `Tag ${i}` }] })) as any);
  const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), `(${SCRIPT_RUNTIME})(env).install(document);`);
  await rt.click('reload'); await rt.click('act', 1);
  const step = JSON.parse(rt.active('#act')[1].getAttribute('data-scripts')!)[0].steps[0];
  const actual = (rt.vars[step.array] as any[]).map(x => x.raw);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), values);
  rt.dispose();
});

test('a matching loop array-field writes only the selected iteration', async () => {
  const { doc, items } = clientArrayFieldFixture();
  const steps = doc.nodes.act.scripts![0].steps;
  steps.splice(0, 2, { id: 'loop', kind: 'for-each', array: 'targets', then: [{
    id: 'condition', kind: 'if', cond: { subject: 'var', target: '', left: '{name}', op: 'eq', value: 'Second' }, then: steps.slice(0, 2),
  }] } as any);
  const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await rt.click('reload'); await rt.click('act', 0);
  assert.equal(rt.active('#result')[0].textContent, '|Second');
  assert.equal(rt.active('#raw-result')[0].textContent, '|false');
  rt.dispose();
});

test('non-template array-field item references do not turn an ISR page into a query reader', async () => {
  const { generateProject } = await import('../lib/generator');
  const { doc } = clientArrayFieldFixture();
  doc.pages.p.children = ['act'];
  doc.pages.p.pageScripts![0].steps = doc.pages.p.pageScripts![0].steps.slice(0, 1);
  doc.nodes = { act: doc.nodes.act };
  for (const value of ['{unsampledTargetField}', 'Copy {unsampledTargetField}']) {
    doc.nodes.act.scripts![0].steps = [{ id: 'field', kind: 'array-field', array: 'response', field: 'copied', value }];
    const source = generateProject(doc).files['app/page.tsx'];
    assert.match(source, /export const revalidate = 60;/);
    assert.ok(!source.includes('scriptParts')); assert.ok(!source.includes('rawRef'));
  }
});
