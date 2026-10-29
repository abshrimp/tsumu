import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { makeText } from "../lib/presets";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { publishedClientNested, clientNestedCanvas, loadNestedUi, clientNestedDoc } from "./helpers/client-nested-lists";
import { clientScriptFixture as fixture } from "./helpers/client-script-scope";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
import { createRequire } from "node:module";
import { clientLiteralAttributesDoc, literalItems, literalText, literalSource, literalEmbed } from "./helpers/client-literal-attributes";
import { interpolateUrl } from "../lib/vars";
import { safeNavigationUrl } from "../lib/url-policy";
import { clientLinkDoc, linkItems } from "./helpers/client-link-scope";
import { clientFieldDoc, fieldItems } from "./helpers/client-field-scope";
import { EMPTY_GIF } from "../lib/generator/templates";
import { useEditor } from "../lib/store";
import { clientImageDoc, imageItems } from "./helpers/client-image-scope";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Ctx, type EdCtx } from "../components/script-editor/context";
import { pageArrays, pageVariableIndex, previewDataVars } from "../lib/data";

describe("client-script-scope", () => {
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
      { id: 'parse', kind: 'transform', source: 'counter', into: 'computed', transform: { kind: 'parse' } },
      { id: 'calc', kind: 'transform', source: 'computed', into: 'computed', transform: { kind: 'math', operation: 'add', operandType: "number", operand: 2 } },
    );
    doc.nodes.change = { ...makeText('Change'), id: 'change', attrId: 'change', semantic: 'button', scripts: [{
      id: 'change-script', trigger: 'click', steps: [{ id: 'change-step', kind: 'set-var', value: '"7"', into: 'counter' }],
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
    // 入力の配列そのものは、明示的にブラウザで使う。参照の代わりの値には、兄弟の秘密の値を含めない。
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
});

describe("client-literal-attributes", () => {
  const { parse } = createRequire(import.meta.url)('next/dist/compiled/node-html-parser');
  const tree = (n: any): unknown => [n.nodeType, n.tagName, n.nodeValue, n.attrs, n.childNodes.map(tree)];
  const attributes = (select: (s: string) => any[]) => ({
    image: select('#picture').map(n => n.getAttribute('alt')),
    svg: select('#svg').map(n => (n.tagName === 'IMG' ? n : n.querySelector('img')).getAttribute('alt')),
    audio: select('#audio').map(n => n.getAttribute('src')),
    video: select('#video').map(n => n.getAttribute('src')),
    embed: select('#frame').map(n => n.querySelector('iframe').getAttribute('src')),
  });
  for (const component of [false, true]) test(`${component ? 'component' : 'plain'} literal image/media attributes match Canvas and server lists after reload/navigation`, async () => {
    const doc = clientLiteralAttributesDoc(component), saved = JSON.stringify(doc);
    const canvas = parse(clientNestedCanvas(doc, literalItems));
    const expected = attributes(s => canvas.querySelectorAll(s));
    assert.deepEqual(expected, { image: Array(3).fill(literalText), svg: Array(3).fill(literalText),
      audio: Array(3).fill(literalSource), video: Array(3).fill(literalSource), embed: Array(3).fill(literalEmbed) });
    const serverDoc = structuredClone(doc); serverDoc.nodes.products.list!.from = 'response';
    const server = parse(await publishedClientNested(serverDoc, 'app/page.tsx', literalItems));
    assert.deepEqual(attributes(s => server.querySelectorAll(s)), expected);
    const html = await publishedClientNested(doc, 'app/page.tsx', literalItems);
    const runtime = listRuntimeDom(html, scriptsFile(doc));
    try {
      const template = JSON.stringify(tree(runtime.root.querySelector('[data-tpl]')!));
      for (let i = 0; i < 2; i++) {
        await runtime.click('reload'); assert.deepEqual(attributes(s => runtime.active(s)), expected);
        // 動的な画像の URL は、引き続き項目ごとに解決する。
        assert.deepEqual(runtime.active('#picture').map(n => n.getAttribute('src')), ['/images/First.png', '/images/Second.png', '/images/First.png']);
      }
      assert.equal(JSON.stringify(tree(runtime.root.querySelector('[data-tpl]')!)), template);
      runtime.navigate('<span data-page-body="other"></span>'); runtime.navigate(html);
      await runtime.click('reload'); assert.deepEqual(attributes(s => runtime.active(s)), expected);
    } finally { runtime.dispose(); }
    assert.equal(JSON.stringify(doc), saved);
    const restored = JSON.parse(saved);
    const reload = listRuntimeDom(await publishedClientNested(restored, 'app/page.tsx', literalItems), scriptsFile(restored));
    try { await reload.click('reload'); assert.deepEqual(attributes(s => reload.active(s)), expected); }
    finally { reload.dispose(); }
  });
});

describe("client-link-scope", () => {
  const { parse } = createRequire(import.meta.url)('next/dist/compiled/node-html-parser');
  const hrefs = (runtime: ReturnType<typeof listRuntimeDom>) => runtime.active('#detail').map(n => n.getAttribute('href'));

  for (const component of [false, true]) test(`${component ? 'component' : 'plain'} client links match Canvas with colliding server names and survive reload/navigation`, async () => {
    const doc = clientLinkDoc(component), saved = JSON.stringify(doc);
    const expected = parse(clientNestedCanvas(doc, linkItems)).querySelectorAll('#detail').map((n: any) => n.getAttribute('href'));
    assert.deepEqual(expected, ['/products/First', '/products/Second%20%26%20space', '/products/', '/products/', '/products/First', '/products/Data%20%7Blabel%7D%257Bname%257D']);
    const html = await publishedClientNested(doc, 'app/page.tsx', linkItems);
    assert.ok(!html.includes('UNUSED_SERVER_PRIVATE'));
    const runtime = listRuntimeDom(html, scriptsFile(doc));
    for (let i = 0; i < 2; i++) { await runtime.click('reload'); assert.deepEqual(hrefs(runtime), expected); }
    runtime.navigate('<span data-page-body="other"></span>'); runtime.navigate(html);
    await runtime.click('reload'); assert.deepEqual(hrefs(runtime), expected); runtime.dispose();
    assert.equal(JSON.stringify(doc), saved);
    const reloaded = listRuntimeDom(await publishedClientNested(JSON.parse(saved), 'app/page.tsx', linkItems), scriptsFile(doc));
    await reloaded.click('reload'); assert.deepEqual(hrefs(reloaded), expected); reloaded.dispose();
  });

  test('link parts retain only referenced scalar fallbacks and preserve roots, escapes and original positions', async () => {
    const url = '/profile/{profile.label}/[slug]/\\{name}/{fallback}';
    const doc = clientLinkDoc(false, url), html = await publishedClientNested(doc, 'app/page.tsx', linkItems);
    assert.ok(!html.includes('UNUSED_SERVER_PRIVATE'));
    const runtime = listRuntimeDom(html, scriptsFile(doc)); await runtime.click('reload');
    assert.deepEqual(hrefs(runtime), ['Global/global', 'Own/second', '/', '/global', 'Literal%20%7Bname%7D/global', 'Global/global'].map(v => `/profile/${v}/{name}/Server%20%7Bname%7D`));
    for (const n of runtime.root.querySelectorAll('[data-href-parts]')) {
      for (const p of JSON.parse(n.getAttribute('data-href-parts')!)) {
        assert.ok(typeof p === 'string' || (typeof p.name === 'string' && typeof p.at === 'number' && (!Object.hasOwn(p, 'fallback') || typeof p.fallback === 'string')));
      }
    }
    runtime.dispose();
  });

  for (const url of ['{url}', '{scheme}:alert(1)', '/{url}', '{empty}{url}', '/literal/%7Bname%7D', '/static']) test(`URL encoding and complete navigation policy: ${url}`, async () => {
    const values = ['https://example.com/a?x={name}', '/safe/{name}', 'mailto:a@example.com', '#section', 'javascript:alert(1)', '//evil.example', '/\\evil.example', '/a\nb', 'https:\\evil.example', 'data:image/png;base64,x'];
    const items = values.map(url => ({ url, empty: '', scheme: 'javascript', tags: [{ label: 'row' }] }));
    const doc = clientLinkDoc(false, url, items);
    const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc)); await runtime.click('reload');
    assert.deepEqual(hrefs(runtime), items.map(item => safeNavigationUrl(interpolateUrl(url, item)))); runtime.dispose();
  });

  test('new-tab links use the same row parts while server-rendered links need no client metadata', async () => {
    const doc = clientLinkDoc(); doc.nodes.detail.link!.newTab = true;
    const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', linkItems), scriptsFile(doc));
    await runtime.click('reload');
    assert.equal(hrefs(runtime)[1], '/products/Second%20%26%20space');
    assert.ok(runtime.active('#detail').every(n => n.getAttribute('target') === '_blank' && n.getAttribute('rel') === 'noopener noreferrer'));
    runtime.dispose();
    doc.nodes.products.list!.from = 'response';
    const html = await publishedClientNested(doc, 'app/page.tsx', linkItems);
    assert.ok(!html.includes('data-href-parts'));
    assert.deepEqual(parse(html).querySelectorAll('#detail').map((n: any) => n.getAttribute('href')), linkItems.map(item => safeNavigationUrl(interpolateUrl('/products/{name}', { name: 'First', ...item }))));
  });
});

describe("client-field-scope", () => {
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
    doc.nodes.change = { ...makeText('Change live'), id: 'change', attrId: 'change', scripts: [{ id: 'change-script', trigger: 'click', steps: [
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
    doc.nodes.change = { ...makeText('Change'), id: 'change', attrId: 'change', scripts: [{ id: 'change-script', trigger: 'click', steps: [
      { id: 'change-live', kind: 'set-var', into: 'live', value: 'Later' },
      { id: 'read-choice', kind: 'set-var', into: 'observed', value: '{choice}' },
    ] }] };
    doc.nodes.observed = { ...makeText('{observed}'), id: 'observed', attrId: 'observed' };
    doc.pages.p.children.push('change', 'observed');
    const rt = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', fieldItems), scriptsFile(doc)); await rt.click('reload'); await rt.click('change');
    assert.deepEqual(values(rt, 'choice'), ['First: Later', 'Second: Later']);
    assert.equal(rt.active('#observed')[0].textContent, 'First: Later'); rt.dispose();
  });
});

describe("client-image-scope", () => {
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
    (doc.pages.p.pageScripts![0].steps[0] as any).preview = { sample: items };
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
    (doc.pages.p.pageScripts![0].steps[0] as any).preview = { sample: items };
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
      assert.equal(span.querySelector('svg')?.getAttribute('viewBox'), '0 0 120 40');
      assert.match(span.getAttribute('style') ?? '', /--crisp-svg-width:\s*120px/);
      assert.match(span.getAttribute('style') ?? '', /--crisp-svg-ratio:\s*120\s*\/\s*40/);
    }
    for (const raw of runtime.active('#raw')) assert.equal(raw.querySelector('img')!.getAttribute('src'), '/{name}.png');
    runtime.dispose();
  });
});

describe("client-text-scope", () => {
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
    const row = nodes(panel).find(n => n.props?.className === 'row' && nodes(n).some(x => x.type === 'span' && x.props.className === 'lbl' && x.props.children === 'List to display'));
    const drop = nodes(row).find(n => n.props?.options).props;
    assert.ok(drop.options.some((o: any) => o.value === 'tags')); drop.onChange('tags');
    doc = structuredClone(useEditor.getState().doc);
    const { StepBody } = loadNestedUi('components/script-editor/StepBody.tsx');
    for (const step of [doc.pages.p.pageScripts![0].steps.at(-1)!, doc.nodes.reload.scripts![0].steps[0]]) {
      const html = renderToStaticMarkup(React.createElement(Ctx.Provider, { value: {
        doc, pageId: 'p', samples: previewDataVars(doc, 'p'), arrays: pageArrays(doc, 'p'), variableIndex: pageVariableIndex(doc, 'p'), transformSources: {}, targetLookup: { firstByAttr: new Map(), firstNodeIds: new Set() }, updateStep() {}, renameVar() {},
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
});
