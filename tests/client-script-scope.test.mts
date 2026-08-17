import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeText } from '../lib/presets';
import { SCRIPT_RUNTIME, scriptsFile } from '../lib/script-runtime';
import { publishedClientNested } from './helpers/client-nested-lists';
import { clientScriptBundle, clientScriptFixture as fixture } from './helpers/client-script-scope';
import { listRuntimeDom } from './helpers/list-runtime-dom';


for (const component of [false, true]) test(`${component ? 'component' : 'plain'} script references use the clicked row without reinterpreting data`, async () => {
  const { doc, items } = fixture(component);
  const html = await publishedClientNested(doc, 'app/page.tsx', items);
  assert.ok(!html.includes('UNUSED_SERVER_PRIVATE'));
  const runtime = listRuntimeDom(html, scriptsFile(doc));
  for (let pass = 0; pass < 2; pass++) {
    await runtime.click('reload');
    for (const i of [1, 0]) {
      await runtime.click('act', i);
      assert.equal(runtime.active('#result')[0].textContent, `Selected ${items[i].name}`);
      assert.equal(runtime.active('#raw-result')[0].textContent, items[i].tags[0].label);
    }
  }
  runtime.navigate('<div data-page-body="other"></div>'); runtime.navigate(html);
  await runtime.click('reload'); await runtime.click('act', 1);
  assert.equal(runtime.active('#raw-result')[0].textContent, 'green');
  runtime.dispose();
});

test('script values read live browser variables and fields at execution and encode URL data once', async () => {
  const { doc, items } = fixture();
  doc.nodes.act.scripts![0].steps.push(
    { id: 'live', kind: 'set-var', value: '{name}|{counter}|{entry}|\\{name}', into: 'chosen' },
    { id: 'url', kind: 'open-url', url: '/products/{name}?q={entry}', newTab: true },
    { id: 'calc', kind: 'calc', expr: '{counter}+2', into: 'computed' },
  );
  doc.nodes.change = { ...makeText('Change'), id: 'change', attrId: 'change', semantic: 'button', scripts: [{
    id: 'change-script', trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: 'change-step', kind: 'set-var', value: '7', into: 'counter' }],
  }] };
  doc.nodes.entry = { ...makeText(''), id: 'entry', attrId: 'entry', type: 'field', field: { kind: 'input', inputType: 'text' } };
  doc.nodes.computed = { ...makeText('{computed}'), id: 'computed', attrId: 'computed' };
  doc.pages.p.children.push('change', 'computed');
  doc.nodes.row.children.push('entry');
  const html = await publishedClientNested(doc, 'app/page.tsx', items), urls: string[] = [];
  const runtime = listRuntimeDom(html, scriptsFile(doc), { window: { open: (url: string) => urls.push(url) } });
  await runtime.click('reload');
  await runtime.click('change');
  (runtime.active('#entry')[0] as any).value = 'a/{name}';
  await runtime.click('act');
  assert.equal(runtime.active('#result')[0].textContent, 'Data {label}|7|a/{name}|{name}');
  assert.equal(runtime.active('#computed')[0].textContent, '9');
  assert.deepEqual(urls, ['/products/Data%20%7Blabel%7D?q=a%2F%7Bname%7D']);
  (runtime.active('#entry')[1] as any).value = 'Changed';
  await runtime.click('act', 1);
  assert.equal(runtime.active('#result')[0].textContent, 'Second|7|Changed|{name}');
  runtime.dispose();
});

test('references preserve own null roots, literal dotted keys and only the referenced typed fallback', async () => {
  const items = [
    { name: 'Server', profile: { label: 'Fallback', secret: 'UNREFERENCED_MEMBER' }, tags: [{ label: 'red' }] },
    { name: null, profile: null, tags: [{ label: 'null' }] },
    { name: '', profile: {}, tags: [{ label: 'empty' }] },
    { 'profile.label': 'Literal {name}', tags: [{ label: 'dotted' }] },
  ];
  const { doc } = fixture(false, items);
  doc.pages.p.pageScripts![0].steps.push({ id: 'profile', kind: 'set-var', value: '{response.0.profile}', into: 'profile' });
  doc.nodes.act.scripts![0].steps = [
    { id: 'value', kind: 'set-var', value: '{name}|{profile.label}', into: 'chosen' },
    { id: 'raw', kind: 'set-var', value: '{profile.label}', into: 'rawChosen' },
  ];
  doc.nodes['raw-result'].text!.content = '{rawChosen}';
  const html = await publishedClientNested(doc, 'app/page.tsx', items);
  // 入力配列自体は明示的にブラウザで使う。参照の代替値には兄弟の秘密の値を含めない。
  const runtime = listRuntimeDom(html, scriptsFile(doc));
  await runtime.click('reload');
  const serialized = runtime.active('#act').map(n => n.getAttribute('data-scripts')).join('');
  assert.ok(!serialized.includes('UNREFERENCED_MEMBER'));
  assert.ok(!serialized.includes('UNUSED_SERVER_PRIVATE'));
  const expected = [['Server|Fallback', 'Fallback'], ['|', ''], ['|', ''], ['Server|Literal {name}', 'Literal {name}']];
  for (let i = 0; i < items.length; i++) {
    await runtime.click('act', i);
    assert.equal(runtime.active('#result')[0].textContent, expected[i][0]);
    assert.equal(runtime.active('#raw-result')[0].textContent, expected[i][1]);
  }
  runtime.dispose();
});

test('a loop scope overrides the clicked row while non-loop references keep the row scope', async () => {
  const { doc, items } = fixture();
  items[1].tags[0].loopItems = [{ label: 'Loop' }] as any;
  doc.nodes.act.scripts![0].steps.push({ id: 'loop-input', kind: 'set-var', value: '{loopItems}', into: 'loopItems' });
  doc.nodes.act.scripts![0].steps.push({ id: 'loop', kind: 'for-each', array: 'loopItems', then: [
    { id: 'loop-value', kind: 'set-var', value: '{name}|{label}', into: 'chosen' },
  ] });
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await runtime.click('reload'); await runtime.click('act', 1);
  assert.equal(runtime.active('#result')[0].textContent, 'Second|Loop');
  runtime.dispose();
});


test('raw number, boolean, null, object and array values survive assignments without interpreting their contents', async () => {
  const values = [42, false, null, { scriptParts: ['not an expression'], rawRef: { name: 'not a reference' }, label: 'Object {name}' }, ['Array {name}']];
  const items = values.map((payload, i) => ({ name: `Row ${i}`, payload, tags: [{ label: `Tag ${i}` }] }));
  items.push({ name: 'Fallback', tags: [{ label: 'Fallback' }] } as any);
  values.push(values[3]);
  const { doc } = fixture(false, items);
  doc.pages.p.pageScripts![0].steps.push({ id: 'payload', kind: 'set-var', value: '{response.3.payload}', into: 'payload' });
  doc.nodes.act.scripts![0].steps = [
    { id: 'raw', kind: 'set-var', value: '{payload}', into: 'rawChosen' },
    { id: 'copy', kind: 'set-var', value: '{rawChosen}', into: 'copied' },
    { id: 'next', kind: 'set-var', value: '{copied.label}|{copied.0}', into: 'chosen' },
  ];
  const html = await publishedClientNested(doc, 'app/page.tsx', items);
  for (const source of [scriptsFile(doc), `(${SCRIPT_RUNTIME})(env).install(document);`]) {
    const runtime = listRuntimeDom(html, source);
    await runtime.click('reload');
    for (let i = 0; i < items.length; i++) {
      await runtime.click('act', i);
      assert.equal(runtime.active('#result')[0].textContent, i === 3 || i === 5 ? 'Object {name}|' : i === 4 ? '|Array {name}' : '|');
      if (source.includes('(env).install')) {
        const steps = JSON.parse(runtime.active('#act')[i].getAttribute('data-scripts')!)[0].steps;
        for (const step of steps.slice(0, 2)) {
          const actual = runtime.vars[step.into];
          assert.equal(typeof actual, typeof values[i]);
          assert.equal(Array.isArray(actual), Array.isArray(values[i]));
          assert.equal(JSON.stringify(actual), JSON.stringify(values[i]));
        }
      }
    }
    runtime.dispose();
  }
});


test('native regression bundles the real ScriptEditor and Canvas', async () => {
  const bundle = await clientScriptBundle(fixture().doc);
  assert.ok(bundle.includes('Edit action'));
  assert.ok(bundle.includes('Reload saved'));
});

test('script execution preserves neighboring text, image, link and initialized field carriers', async () => {
  const { doc, items } = fixture();
  doc.nodes.entry = { ...makeText(''), id: 'entry', attrId: 'entry', type: 'field', field: { kind: 'input', inputType: 'text', defaultValue: '{name}', placeholder: 'Find {name}' } };
  doc.nodes.link = { ...makeText('Open {name}'), id: 'link', attrId: 'link', link: { kind: 'url', url: '/rows/{name}' } };
  doc.nodes.picture = { ...makeText(''), id: 'picture', attrId: 'picture', type: 'image', image: { src: '/images/{name}.png', alt: 'Row', width: 20, height: 20 } };
  doc.nodes.row.children.push('entry', 'link', 'picture');
  doc.nodes.act.scripts![0].steps.push({ id: 'field-read', kind: 'set-var', value: '{name}|{entry}', into: 'chosen' });
  const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
  await runtime.click('reload');
  for (let i = 0; i < items.length; i++) {
    assert.equal(runtime.active('#entry')[i].value, items[i].name);
    assert.equal(runtime.active('#entry')[i].getAttribute('placeholder'), `Find ${items[i].name}`);
    assert.equal(runtime.active('#link')[i].getAttribute('href'), `/rows/${encodeURIComponent(items[i].name)}`);
    assert.equal(runtime.active('#picture')[i].getAttribute('src'), `/images/${items[i].name}.png`);
    assert.equal(runtime.active('#link')[i].textContent, `Open ${items[i].name}`);
  }
  runtime.active('#entry')[1].value = 'Edited {name}';
  await runtime.click('act', 1);
  assert.equal(runtime.active('#result')[0].textContent, 'Second|Edited {name}');
  assert.equal(runtime.active('#raw-result')[0].textContent, 'green');
  assert.equal(runtime.active('#entry')[0].value, 'Data {label}');
  assert.equal(runtime.active('#picture')[0].getAttribute('src'), '/images/Data {label}.png');
  assert.equal(runtime.active('#link')[0].getAttribute('href'), '/rows/Data%20%7Blabel%7D');
  runtime.dispose();
});
