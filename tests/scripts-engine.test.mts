import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { makeText, createInitialDoc, makeBox } from "../lib/presets";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { publishedClientNested, clientNestedCanvas, loadNestedUi, clientNestedDoc } from "./helpers/client-nested-lists";
import { clientScriptFixture } from "./helpers/client-script-scope";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
import { createRequire } from "node:module";
import { clientLiteralAttributesDoc, literalItems, literalText, literalSource, literalEmbed } from "./helpers/client-literal-attributes";
import { interpolateUrl, lookupVar, interpolate } from "../lib/vars";
import { safeNavigationUrl } from "../lib/url-policy";
import { clientLinkDoc, linkItems } from "./helpers/client-link-scope";
import { clientFieldDoc, fieldItems } from "./helpers/client-field-scope";
import { EMPTY_GIF } from "../lib/generator/templates";
import { useEditor } from "../lib/store";
import { clientImageDoc, imageItems } from "./helpers/client-image-scope";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Ctx, type EdCtx } from "../components/script-editor/context";
import { pageArrays, pageVariableIndex, previewDataVars, mapNodeTokens, digPath, compareValues, filterConds, filterItems, matchOp, pagePlan, renameVarInPage, setVarSource, obfuscateVarNames } from "../lib/data";
import { changeIfVariableLeft, ifVariableOperators, ifVariableSample } from "../lib/if-variable-conditions";
import { matchesValueCondition, setVarPath, withinScriptValueLimit } from "../lib/value-semantics";
import { Script as JsScript, runInNewContext } from "node:vm";
import { compileScripts, cloneSteps, scriptTargetIds, pageScriptsOf, withPageScripts, type PageScript } from "../lib/script";
import { ACTIONS, findActions } from "../components/script-editor/catalog";
import { type ScriptStep, type ScriptTrigger, type SiteDoc, type Page, type DocNode, type FieldContent, PAGE_TARGET, type Script } from "../lib/types";
import { transformSync } from "./helpers/bundle";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runPurePageSteps } from "../lib/page-load-steps";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { generateProject } from "../lib/generator";
import { filterPredicate, listItemsExpr } from "../lib/generator/render-helpers";
import { scriptDataPickerDoc } from "./helpers/script-data-picker";
import { connectNewTransform, findStepLoc, listInsideLoop, mapStep, moveSteps, nudgeStep, removeKeys, insertAt, listIn, takeSelectedSteps } from "../components/script-editor/step-tree";
import { PAGE_DATA_RUNTIME, serializePageDataPlan } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";
import { generateExportProject } from "../lib/export-formats";
import { indexFieldTargets } from "../components/script-editor/field-index";
import { copyScriptBlocks, isScriptBlockClipboard, pasteScriptBlocks } from "../components/script-editor/clipboard";
import { scriptStatus, stepIssue } from "../components/script-editor/issues";
import { renderLeafNode } from "../components/canvas/render";
import { publishedScriptInputValue, scriptInputValueDoc } from "./helpers/script-input-value";
import { fieldDefaults, fieldStateValues, fieldValuePatch } from "../lib/fields";
import { publishedScriptSelectValue, scriptSelectValueDoc } from "./helpers/script-select-value";
import { chunkScriptSteps, SCRIPT_STEP_CHUNK_SIZE, SCRIPT_STEP_WINDOW_THRESHOLD } from "../components/script-editor/step-chunks";
import { scriptWorkspaceDoc } from "./helpers/script-workspace";
import { validDocumentScripts } from "../lib/document-validation";
import { observeScriptViewport } from "../components/script-editor/visibility";

describe("client-script-scope", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
describe("client-script-scope", () => {
  for (const component of [false, true]) test(`${component ? 'component' : 'plain'} script references use the clicked row without reinterpreting data`, async () => {
    const { doc, items } = clientScriptFixture(component);
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

  test("a fetch action resolves the clicked row URL in an exported client list", async () => {
    const { doc, items } = clientScriptFixture();
    doc.nodes.act.scripts![0].steps = [
      { id: "fetch-item", kind: "fetch", url: "https://example.test/products/{name}", as: "chosen" },
    ];
    const html = await publishedClientNested(doc, "app/page.tsx", items);
    const urls: string[] = [];
    const runtime = listRuntimeDom(html, scriptsFile(doc), {
      URL, location: { href: "https://example.test/" }, AbortController, TextDecoder, TextEncoder,
      fetch: async (url: string) => { urls.push(url); return Response.json("loaded"); },
    });
    try {
      await runtime.click("reload");
      await runtime.click("act");
      assert.deepEqual(urls, ["https://example.test/products/" + encodeURIComponent(items[0].name)]);
      assert.equal(runtime.active("#result")[0].textContent, "loaded");
    } finally {
      runtime.dispose();
    }
  });

  test('script values read live browser variables and fields at execution and encode URL data once', async () => {
    const { doc, items } = clientScriptFixture();
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
    const { doc } = clientScriptFixture(false, items);
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
    const { doc, items } = clientScriptFixture();
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
    const { doc } = clientScriptFixture(false, items);
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
    const { doc, items } = clientScriptFixture();
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
    const doc = clientImageDoc(false, '/img/{name}/{profile.label}/[slug]/\\{name}/{fallback}.png');
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
      '/img/Data {label}/Global/global/{name}/Server {name}.png',
      '/img////{name}/Server {name}.png',
      '/img///global/{name}/Server {name}.png',
      '/img/Data {label}/Literal {name}/global/{name}/Server {name}.png',
      '/img/Own {slug}/Own/own/{name}/Server {name}.png',
    ]);
    const parts = runtime.root.querySelectorAll('[data-image-src-parts]').map(n => JSON.parse(n.getAttribute('data-image-src-parts')!));
    assert.ok(parts.flat().every((p: any) => typeof p === 'string' || (typeof p.name === 'string' && (!Object.hasOwn(p, 'fallback') || typeof p.fallback === 'string'))));
    runtime.dispose();
  });

  test('no global collision remains correct and empty or unsafe row image uses the existing transparent fallback', async () => {
    const doc = clientImageDoc(false, '{name}');
    doc.pages.p.pageScripts![0].steps.pop();
    const items = [
      { name: '/first.png', tags: [{}] },
      { name: '/second.png', tags: [{}] },
      { name: null, tags: [{}] },
      { name: '', tags: [{}] },
      { name: 'javascript:alert(1)', tags: [{}] },
      { name: '//evil.example/pixel.png', tags: [{}] },
    ];
    (doc.pages.p.pageScripts![0].steps[0] as any).preview = { sample: items };
    const runtime = listRuntimeDom(await publishedClientNested(doc, 'app/page.tsx', items), scriptsFile(doc));
    await runtime.click('reload');
    assert.deepEqual(sources(runtime), ['/first.png', '/second.png', EMPTY_GIF, EMPTY_GIF, EMPTY_GIF, EMPTY_GIF]);
    runtime.dispose();
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
});

describe("if-variable-conditions", () => {
const categories = { "出展カテゴリ": ["物販"], "投票カテゴリ": ["物販"], "大分類": ["かう"] };
const samples = { data: { categories, name: "出展者", tags: ["物販"] } };

test("if variable references retain complete list objects and singleton arrays", () => {
  assert.deepEqual(ifVariableSample("{data.categories}", samples), categories);
  assert.deepEqual(ifVariableSample("{data.categories.出展カテゴリ}", samples), ["物販"]);
  assert.deepEqual(ifVariableSample('["物販"]', samples), ["物販"]);
  assert.equal(ifVariableSample("{later}", samples), undefined);
  assert.equal(ifVariableSample("Hello {data.categories}", samples), undefined);
  assert.deepEqual(ifVariableOperators("{data.categories}", samples), ["has-key", "empty", "eq"]);
  assert.deepEqual(ifVariableOperators("{data.categories.出展カテゴリ}", samples), ["contains", "contains-any", "empty", "eq"]);
  assert.equal(ifVariableOperators("{later}", samples), undefined);
  assert.equal(ifVariableOperators("{data.name}", samples), undefined);
});

test("if condition chooses relevant operation when switching between values and lists", () => {
  const scalar = { left: "{data.name}", op: "eq" as const, value: "物販" };
  const object = changeIfVariableLeft(scalar, "{data.categories}", samples);
  assert.deepEqual(object, { left: "{data.categories}", op: "has-key", value: "" });
  const array = changeIfVariableLeft(object, "{data.categories.出展カテゴリ}", samples);
  assert.deepEqual(array, { left: "{data.categories.出展カテゴリ}", op: "contains", value: "" });
  assert.deepEqual(changeIfVariableLeft({ ...array, value: "物販" }, "{data.tags}", samples), {
    left: "{data.tags}", op: "contains", value: "物販",
  });
  assert.deepEqual(changeIfVariableLeft({ ...array, value: "物販" }, "{later}", samples), {
    left: "{later}", op: "contains", value: "物販",
  });
  assert.deepEqual(changeIfVariableLeft(scalar, "{data.categories.出展カテゴリ}", samples), {
    left: "{data.categories.出展カテゴリ}", op: "contains", value: "物販",
  });
});

test("if condition membership and key predicates keep runtime evaluation unchanged", () => {
  assert.equal(matchesValueCondition(categories, "has-key", "出展カテゴリ"), true);
  assert.equal(matchesValueCondition(categories, "has-key", "未登録"), false);
  assert.equal(matchesValueCondition(categories["出展カテゴリ"], "contains", "物販"), true);
  assert.equal(matchesValueCondition(categories["出展カテゴリ"], "contains", "飲食"), false);
});
});

describe("script-alert", () => {
const dialog: ScriptStep = { id: "dialog", kind: "dialog", mode: "alert", message: "こんにちは {user}" };

test("one action can show alert, confirm, or prompt", () => {
  const item = ACTIONS.find((entry) => entry.key === "dialog");
  assert.ok(item);
  assert.equal(item.cat, "look");
  for (const query of ["アラート", "確認", "prompt", "警告"])
    assert.ok(findActions(query, "ja").some((entry) => entry.key === "dialog"), query);
  const created = [item.make()];
  assert.deepEqual(created, [{
    id: created[0].id, kind: "dialog", mode: "alert", message: "",
  }]);
});

test("dialog compiler handles variable-containing messages and prompt defaults", () => {
  const actions: ScriptStep[] = [
    dialog,
    { id: "confirm", kind: "dialog", mode: "confirm", message: "Proceed?", into: "approved" },
    { id: "prompt", kind: "dialog", mode: "prompt", message: "Name?", into: "answer", defaultValue: "{user}" },
  ];
  const compiled = compileScripts({
    scripts: [{ id: "main", trigger: "click", steps: actions }],
  }, () => "", (value, kind) => {
    assert.equal(kind, "value");
    return "compiled:" + value;
  });
  assert.deepEqual(compiled, [{
    trigger: "click",
    steps: [
      { kind: "dialog", mode: "alert", message: "compiled:こんにちは {user}" },
      { kind: "dialog", mode: "confirm", message: "compiled:Proceed?", into: "approved" },
      { kind: "dialog", mode: "prompt", message: "compiled:Name?", defaultValue: "compiled:{user}", into: "answer" },
    ],
  }]);
});

test("prompt and confirm result variable names appear in page variable index, alert does not", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{
    id: "steps", trigger: "click",    steps: [
      { id: "a", kind: "dialog", mode: "alert", message: "Hello", into: "unused" },
      { id: "b", kind: "dialog", mode: "confirm", message: "Continue?", into: "yes" },
      { id: "c", kind: "dialog", mode: "prompt", message: "Enter", into: "text" },
    ],
  }];
  assert.deepEqual(new Set(pageVariableIndex(doc, page.id).names).has("unused"), false);
  assert.ok(pageVariableIndex(doc, page.id).names.includes("yes"));
  assert.ok(pageVariableIndex(doc, page.id).names.includes("text"));
});

test("dialog body variables are renamed in both prompt and message inputs", () => {
  const node = { text: null, image: undefined, link: null, children: [],
    scripts: [{ id: "script", trigger: "click", steps: [
      { id: "prompt", kind: "dialog", mode: "prompt", message: "Name {old}", defaultValue: "{old}" },
    ] }],
  } as unknown as import("../lib/types").DocNode;
  mapNodeTokens(node, (name) => name === "old" ? "new" : null);
  const step = node.scripts?.[0].steps[0];
  assert.ok(step && step.kind === "dialog");
  assert.equal(step.message, "Name {new}");
  assert.equal(step.defaultValue, "{new}");
});

test("published scripts include dialog runtime only when used, including nested blocks", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{
    id: "load", trigger: "click",    steps: [{ id: "if", kind: "if",
      cond: { subject: "value", target: "input", op: "eq", value: "yes" },
      then: [dialog],
    }],
  }];
  const code = scriptsFile(doc);
  assert.match(code, /case "dialog":/);
  assert.doesNotThrow(() => new JsScript(code));
  page.pageScripts![0].steps = [{ id: "wait", kind: "wait", seconds: 0.05 }];
  assert.doesNotMatch(scriptsFile(doc), /case "dialog":/);
});
});

describe("script-block-composition", () => {
test("preview data preserves API nulls and prototype-like variable names as ordinary keys", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  const fetch = steps[0];
  if (fetch.kind !== "fetch") throw new Error("expected fetch step");
  assert.equal(previewDataVars(doc, "p", { live: { [fetch.id]: null } }).data, null,
    "a live null JSON response must not be replaced by the saved sample");
  steps.push({ id: "special", kind: "fetch", url: "https://example.com/data",
    as: "__proto__", preview: { sample: { value: "safe" } } });
  const vars = previewDataVars(doc, "p");
  assert.equal(Object.getPrototypeOf(vars), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(vars, "__proto__"), true);
  assert.equal(lookupVar(vars, "__proto__.value"), "safe");
  assert.equal(({} as Record<string, unknown>).value, undefined);
});

test("nested variable assignment never mutates prototypes or reads inherited paths", () => {
  const vars: Record<string, unknown> = {};
  setVarPath(vars, "__proto__", { polluted: true });
  assert.deepEqual(Object.getPrototypeOf(vars), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(vars, "__proto__"), true);
  assert.equal(lookupVar(vars, "__proto__.polluted"), true);
  setVarPath(vars, "constructor.name", "owned");
  assert.equal(lookupVar(vars, "constructor.name"), "owned");
  setVarPath(vars, "result.__proto__.polluted", "local");
  assert.equal(lookupVar(vars, "result.__proto__.polluted"), "local");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const original = { tags: ["red", "blue"] };
  const nested: Record<string, unknown> = { data: original };
  setVarPath(nested, "data.tags.0", "green");
  assert.equal(lookupVar(nested, "data.tags.0"), "green");
  assert.deepEqual(original.tags, ["red", "blue"], "nested writes must copy source values");
});

test("generated server page variables use a null prototype even for special URL keys", () => {
  const doc = scriptDataPickerDoc();
  const files = generateProject(doc).files;
  const page = files["app/page.tsx"];
  assert.match(page, /const vars: Vars = Object\.create\(null\);/);
  assert.doesNotMatch(page, /const vars: Vars = \{\};/);
  assert.doesNotThrow(() => transformSync(page, { loader: "tsx", jsx: "automatic" }));
  const vars = Object.create(null) as Record<string, unknown>;
  vars["__proto__"] = { safe: true };
  vars["constructor"] = "literal";
  assert.equal(Object.getPrototypeOf(vars), null);
  assert.deepEqual(lookupVar(vars, "__proto__.safe"), true);
  assert.equal(lookupVar(vars, "constructor"), "literal");
});

test("literal JSON in set-var is not misclassified as a full variable reference", () => {
  const json = '{"2026-11-23":"勤労感謝の日"}';
  const set: ScriptStep = { id: "json-value", kind: "set-var", into: "holidayJSON", value: json };
  assert.equal(setVarSource(set), null);
  const compiled = compileScripts({ scripts: [{
    id: "json-script", trigger: "click", steps: [set],
  }] }, () => "/");
  assert.equal(compiled[0].steps[0].value, json);
  const vars: Record<string, unknown> = {};
  assert.equal(runPurePageSteps([set], vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.deepEqual(vars.holidayJSON, { "2026-11-23": "勤労感謝の日" });
  const reference: ScriptStep = { id: "ref", kind: "set-var",
    into: "holidayName", value: "{date}" };
  assert.equal(setVarSource(reference), "date");
  assert.equal(compileScripts({ scripts: [{
    id: "ref-script", trigger: "click", steps: [reference],
  }] }, () => "/")[0].steps[0].value, "{date}");
});

test("JSON lookup resolves own keys without traversing inherited prototypes", () => {
  const json = JSON.parse('{"2026-11-23":"勤労感謝の日","__proto__":{"polluted":true},"constructor":{"name":"own"}}');
  assert.equal(lookupVar(json, "2026-11-23"), "勤労感謝の日");
  assert.equal(digPath(json, "2026-11-23"), "勤労感謝の日");
  assert.equal(lookupVar(json, "__proto__.polluted"), true);
  assert.equal(digPath(json, "__proto__.polluted"), true);
  assert.equal(lookupVar(json, "constructor.name"), "own");
  assert.equal(lookupVar({}, "constructor"), undefined);
  assert.equal(lookupVar({}, "__proto__.polluted"), undefined);
  assert.equal(digPath({}, "toString"), undefined);
  assert.equal(digPath({}, "__proto__.polluted"), undefined);
  assert.equal(lookupVar({ list: [11, 12] }, "list.-1"), 12);
  assert.equal(lookupVar({ list: [] }, "list.-1"), undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("every supported action can be picked in the editor", () => {
  assert.equal(ACTIONS.length, 22);
  assert.equal(findActions("").length, 22);
  for (const key of ["transform", "list-display", "set-state", "dialog", "break-loop", "set-list-item", "remove-list-item", "make-list"]) {
    assert.ok(ACTIONS.some(item => item.key === key), key);
  }
  assert.ok(findActions("値で削除", "ja").some(item => item.key === "remove-list-item"));
  assert.ok(findActions("値を加工", "ja").some(item => item.key === "transform"));
  // 一覧に出す名前は短く、どの言語でも検索の対象になる
  for (const item of ACTIONS) assert.ok(findActions(item.title).includes(item), item.key);
});

test("untrusted JSON objects cannot crash preview or emitted filter/sort comparisons", () => {
  const unsafe = JSON.parse('{"toString":"not callable","valueOf":"not callable"}');
  const rows = [{ meta: unsafe, id: "10" }, { meta: "safe", id: "2" }];
  const filter = { kind: "filter" as const, conds: [
    { field: "meta", op: "eq" as const, value: "[object Object]" },
  ] };
  assert.deepEqual(filterItems(rows, [filter]), [], "object values are never equal to display strings");
  assert.doesNotThrow(() => compareValues(unsafe, "safe"));
  assert.equal(compareValues(unsafe, unsafe), 0);
  const predicate = filterPredicate([filter], "vars");
  assert.ok(predicate);
  const evaluate = new Function("item", "vars", "lookupVar", "interpolate", `return (${predicate});`);
  assert.equal(evaluate(rows[0], {}, lookupVar, interpolate), false);
  assert.equal(evaluate(rows[1], {}, lookupVar, interpolate), false);
  const sort = listItemsExpr({ from: "rows" }, "vars", "rows",
    [{ kind: "sort", field: "meta", dir: "asc" }]);
  const rendered = new Function("vars", "toItems", "lookupVar", `return (${sort});`);
  const sorted = rendered({ rows }, (value: unknown) => value, lookupVar);
  assert.deepEqual(sorted, [...rows].sort((a, b) => compareValues(a.meta, b.meta)));
  // 入れ子の配列の文字も、単一の値の絞り込みでの等しさの意味と一致する。
  const nested = [{ meta: [[1, 2], [3, 4]] }];
  assert.deepEqual(filterItems(nested, [{ kind: "filter", conds: [
    { field: "meta", op: "eq", value: "1,2,3,4" },
  ] }]), [], "nested lists require structural rather than string equality");
});

test("generated list filters and sorting expressions pass strict TypeScript checking", () => {
  const ops = [
    { kind: "filter" as const, conds: [{ field: "meta", op: "contains" as const, value: "A" }] },
    { kind: "sort" as const, field: "meta", dir: "asc" as const },
  ];
  const expression = listItemsExpr({ from: "rows" }, "vars", "rows", ops);
  const source = `
type Item = Record<string, unknown>;
type Vars = Record<string, unknown>;
declare const vars: Vars;
declare function lookupVar(vars: Vars, key: string): unknown;
declare function interpolate(value: string, vars: Vars): string;
declare function toItems(value: unknown): Item[];
const filtered: Item[] = ${expression};
`;
  // TypeScript 7 は、古い JS のコンパイラーの API を公開せず、ネイティブの CLI を使う。
  // 出力した式は、実際のプロジェクトのコンパイラーで確かめる。
  const folder = mkdtempSync(join(tmpdir(), "tsumu-generated-filter-"));
  try {
    const sourceFile = join(folder, "generated.ts");
    writeFileSync(sourceFile, source, "utf8");
    try {
      execFileSync(resolve(process.cwd(), "node_modules/.bin/tsc"), [
        "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022",
        "--lib", "es2022", sourceFile,
      ], { cwd: process.cwd(), encoding: "utf8" });
    } catch (cause) {
      const error = cause as { stdout?: string; stderr?: string; message?: string };
      assert.fail("Generated TypeScript failed:\\n" +
        (error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? ""));
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("generated list filter expressions use only own JSON fields", () => {
  const inherited = String(({} as { constructor: unknown }).constructor);
  const filter = { kind: "filter" as const, conds: [
    { field: "constructor", op: "eq" as const, value: inherited },
  ] };
  const expected = filterItems([{}, { constructor: inherited }], [filter]);
  assert.deepEqual(expected, [{ constructor: inherited }]);
  const predicate = filterPredicate([filter], "vars");
  assert.ok(predicate);
  const evaluate = new Function("item", "vars", "lookupVar", "interpolate", `return (${predicate});`);
  assert.equal(evaluate({}, {}, lookupVar, interpolate), false);
  assert.equal(evaluate({ constructor: inherited }, {}, lookupVar, interpolate), true);
});

test("blank list-filter rows do not collapse preceding OR boundaries", () => {
  const step: Extract<ScriptStep, { kind: "list-display" }> = {
    id: "filter-gap", kind: "list-display", mode: "filter", array: "rows",
    field: "name", op: "eq", value: "red", dir: "asc",
    or: [
      { field: "", op: "eq", value: "", and: false },
      { field: "active", op: "eq", value: "yes", and: true },
    ],
  };
  const conditions = filterConds(step);
  assert.equal(conditions.length, 2);
  assert.equal(conditions[1].and, false, "OR survives an unfinished field in the preceding row");
  const items = [
    { name: "red", active: "no" },
    { name: "blue", active: "yes" },
    { name: "blue", active: "no" },
  ];
  const filter = { kind: "filter" as const, conds: conditions };
  assert.deepEqual(filterItems(items, [filter]), items.slice(0, 2));
  const compiled = filterPredicate([filter], "vars");
  assert.ok(compiled);
  const evalFilter = new Function("item", "vars", "lookupVar", "interpolate", `return (${compiled});`);
  assert.deepEqual(items.filter((item) => evalFilter(item, {}, lookupVar, interpolate)), items.slice(0, 2));
});

test("list filters invert individual conditions without duplicating negative operators", () => {
  const items = [
    { name: "red", active: "yes" },
    { name: "blue", active: "yes" },
    { name: "red-blue", active: "no" },
  ];
  const filter = { kind: "filter" as const, conds: [
    { field: "name", op: "contains" as const, value: "red", not: true },
    { field: "active", op: "eq" as const, value: "no", not: true, and: true },
  ] };
  assert.deepEqual(filterItems(items, [filter]), [items[1]]);
  const expr = filterPredicate([filter], "vars");
  assert.match(expr ?? "", /!\(/);
  assert.match(expr ?? "", /includes/);
  assert.match(expr ?? "", /&&/);
  assert.deepEqual(filterItems(items, [{ kind: "filter",
    conds: [{ field: "active", op: "empty", value: "", not: true }] }]), items);
});

test("if blocks and display filters agree for missing, null and list-valued fields", () => {
  const items = [
    { name: "A", tags: ["x", "y"] }, { name: "" },
    { id: 3 }, { name: null }, { name: "B" },
  ];
  const criteria = [
    { field: "name", op: "empty" as const, value: "" },
    { field: "name", op: "eq" as const, value: "A", not: true },
    { field: "tags", op: "contains" as const, value: "x" },
  ];
  for (const condition of criteria) {
    const expected = filterItems(items, [{ kind: "filter", conds: [condition] }]);
    const vars: Record<string, unknown> = { items, result: [] };
    const steps: ScriptStep[] = [
      { id: "each", kind: "for-each", array: "items", then: [
        { id: "condition", kind: "if", cond: {
          subject: "var", target: "", left: "{ループ.値." + condition.field + "}",
          op: condition.op, value: condition.value, not: condition.not,
        }, then: [
          { id: "add", kind: "set-list-item", list: "result", key: "", value: "{ループ.値}" },
        ] },
      ] },
    ];
    assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.deepEqual(vars.result, expected, JSON.stringify(condition));
  }
});
test(">= and <= are consistent in list filters and server-side page-load if", () => {
  assert.equal(matchOp("10", "gte", "10"), true);
  assert.equal(matchOp("10", "lte", "10"), true);
  assert.equal(matchOp("9", "gte", "10"), false);
  assert.equal(matchOp("11", "lte", "10"), false);
  const items = [{ score: 9 }, { score: 10 }, { score: 15 }, { score: 20 }, { score: 21 }];
  const ops = [{ kind: "filter" as const, conds: [
    { field: "score", op: "gte" as const, value: "10" },
    { field: "score", op: "lte" as const, value: "20", and: true },
  ] }];
  assert.deepEqual(filterItems(items, ops), items.slice(1, 4));
  const predicate = filterPredicate(ops, "vars");
  assert.match(predicate ?? "", />=/);
  assert.match(predicate ?? "", /<=/);
  const vars: Record<string, unknown> = { score: "10" };
  const steps: ScriptStep[] = [
    { id: "positive", kind: "if", cond: {
      subject: "var", target: "", left: "{score}", op: "gte", value: "10",
    }, then: [{ id: "yes", kind: "set-var", value: "yes", into: "result" }],
       else: [{ id: "no", kind: "set-var", value: "no", into: "result" }] },
    { id: "negative", kind: "if", cond: {
      subject: "var", target: "", left: "{score}", op: "lte", value: "10", not: true,
    }, then: [{ id: "unexpected", kind: "set-var", value: "wrong", into: "result" }] },
  ];
  assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(vars.result, "yes");
});

test("if blocks group AND before OR and work in server-side page-load execution", () => {
  const cases = [
    { first: "yes", second: "no", third: "yes", expected: "accepted" },
    { first: "yes", second: "no", third: "no", expected: "rejected" },
    { first: "no", second: "no", third: "yes", expected: "accepted" },
    { first: "yes", second: "yes", third: "no", expected: "accepted" },
  ];
  for (const input of cases) {
    const vars: Record<string, unknown> = { ...input };
    const steps: ScriptStep[] = [{
      kind: "if", id: "compound-if",
      cond: { subject: "var", target: "", left: "{first}", op: "eq", value: "yes" },
      conditions: [
        { subject: "var", target: "", left: "{second}", op: "eq", value: "yes", and: true },
        { subject: "var", target: "", left: "{third}", op: "eq", value: "no", not: true, and: false },
      ],
      then: [{ kind: "set-var", id: "then", into: "result", value: "accepted" }],
      else: [{ kind: "set-var", id: "else", into: "result", value: "rejected" }],
    }];
    assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.equal(vars.result, input.expected);
  }
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push({
    id: "server-if", kind: "if",
    cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "10" },
    conditions: [
      { subject: "var", target: "", left: "{data.name}", op: "eq", value: "Product", and: true },
      { subject: "var", target: "", left: "{data.price}", op: "eq", value: "5", and: false },
    ],
    then: [{ id: "true-result", kind: "set-var", into: "check", value: "yes" }],
    else: [{ id: "false-result", kind: "set-var", into: "check", value: "no" }],
  });
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("server-if"));
  assert.equal(previewDataVars(doc, "p").check, "yes");
  const files = generateProject(doc).files;
  assert.match(files["app/page.tsx"], /"conditions"/);
  assert.doesNotThrow(() => transformSync(files["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("cloning and renaming scripts preserve every joined if condition", () => {
  const doc = scriptDataPickerDoc();
  const original: ScriptStep = {
    id: "nested-if", kind: "if",
    cond: { subject: "var", target: "", left: "{old.score}", op: "gte", value: "10" },
    conditions: [
      { subject: "var", target: "", left: "{old.name}", op: "eq", value: "yes", and: true },
      { subject: "value", target: "field-id", op: "eq", value: "{old.expected}", and: false },
    ],
    then: [], else: [],
  };
  doc.pages.p.pageScripts![0].steps.push(original);
  const cloned = cloneSteps([original], () => "new-id")[0];
  assert.ok(cloned.kind === "if");
  if (cloned.kind !== "if" || original.kind !== "if") throw new Error("Expected if step");
  assert.notStrictEqual(cloned.conditions, original.conditions);
  assert.deepEqual(cloned.conditions, original.conditions);
  assert.deepEqual(scriptTargetIds({ attrId: "", scripts: [{
    id: "s", trigger: "click", steps: [original],
  }] }), ["field-id"]);
  renameVarInPage(doc, "p", "old", "current");
  assert.equal(original.cond.left, "{current.score}");
  assert.equal(original.conditions?.[0].left, "{current.name}");
  assert.equal(original.conditions?.[1].value, "{current.expected}");
  const script = compileScripts({ scripts: [{
    id: "s", trigger: "click", steps: [original],
  }] }, () => "/")[0];
  const serialized = script.steps[0];
  assert.ok(Array.isArray(serialized.conditions));
  assert.equal((serialized.conditions as Array<{ and: boolean }>)[0].and, true);
  assert.equal((serialized.conditions as Array<{ and: boolean }>)[1].and, false);
});

test("incomplete clauses preserve the original OR groups on the server", () => {
  for (const [left, right, expected] of [
    ["yes", "no", "accepted"],
    ["no", "yes", "accepted"],
    ["no", "no", "rejected"],
  ] as const) {
    const vars: Record<string, unknown> = { left, right };
    const steps: ScriptStep[] = [{
      id: "if-with-incomplete-or", kind: "if",
      cond: { subject: "var", target: "", left: "{left}", op: "eq", value: "yes" },
      conditions: [
        { subject: "var", target: "", left: "", op: "eq", value: "", and: false },
        { subject: "var", target: "", left: "{right}", op: "eq", value: "yes", and: true },
      ],
      then: [{ id: "accepted", kind: "set-var", into: "result", value: "accepted" }],
      else: [{ id: "rejected", kind: "set-var", into: "result", value: "rejected" }],
    }];
    assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.equal(vars.result, expected);
  }
});

test("incomplete if clauses are neutral until their comparison source is set", () => {
  for (const { status, and, expected } of [
    { status: "ready", and: true, expected: "yes" },
    { status: "ready", and: false, expected: "yes" },
    { status: "waiting", and: true, expected: "no" },
    { status: "waiting", and: false, expected: "no" },
  ]) {
    const vars: Record<string, unknown> = { status };
    const steps: ScriptStep[] = [{
      id: "test-if", kind: "if",
      cond: { subject: "var", target: "", left: "{status}", op: "eq", value: "ready" },
      conditions: [{ subject: "var", target: "", left: "", op: "eq", value: "", and }],
      then: [{ id: "yes", kind: "set-var", into: "result", value: "yes" }],
      else: [{ id: "no", kind: "set-var", into: "result", value: "no" }],
    }];
    assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.equal(vars.result, expected);
  }
  const vars: Record<string, unknown> = {};
  const steps: ScriptStep[] = [{
    id: "blank-if", kind: "if",
    cond: { subject: "var", target: "", left: "", op: "eq", value: "", not: true },
    then: [{ id: "bad", kind: "set-var", into: "result", value: "yes" }],
    else: [{ id: "safe", kind: "set-var", into: "result", value: "no" }],
  }];
  assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(vars.result, "no");
});

test("if blocks with browser-only additional clauses do not run during SSR", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "client-status", kind: "store-load", key: "status", into: "status" },
    { id: "client-if", kind: "if",
      cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "10" },
      conditions: [
        { subject: "var", target: "", left: "{status}", op: "eq", value: "ready", and: true },
      ],
      then: [{ id: "client-out", kind: "set-var", into: "result", value: "yes" }],
    },
    { id: "element-if", kind: "if",
      cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "10" },
      conditions: [{ subject: "visible", target: "box", and: true }],
      then: [{ id: "element-out", kind: "set-var", into: "elementResult", value: "yes" }],
    },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(!plan.serverIds.has("client-if"));
  assert.ok(!plan.serverIds.has("element-if"));
});


test("missing field results clear stale values before the fallback recipe", () => {
  const steps: ScriptStep[] = [
    { id: "previous", kind: "set-var", into: "selected", value: "stale" },
    { id: "missing", kind: "transform", source: "records.0", into: "selected",
      transform: { kind: "field", key: "doesNotExist" } },
    { id: "fallback", kind: "transform", source: "selected", into: "selected",
      transform: { kind: "fallback", when: "missing", text: "no match" } },
  ];
  const vars: Record<string, unknown> = { records: [{ name: "first" }] };
  assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(vars.selected, "no match");

  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "saved", kind: "set-var", into: "selected", value: "stale" },
    { id: "read-missing", kind: "transform", source: "data.rows.0", into: "selected",
      transform: { kind: "field", key: "absent" } },
    { id: "fallback-missing", kind: "transform", source: "selected", into: "selected",
      transform: { kind: "fallback", when: "missing", text: "no match" } },
  );
  assert.equal(previewDataVars(doc, "p").selected, "no match");
  const files = generateProject(doc).files;
  assert.match(files["app/page.tsx"], /result\.kind === "missing"/);
  assert.doesNotThrow(() => transformSync(files["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("failed numeric transforms preserve earlier values instead of using fallback", () => {
  const steps: ScriptStep[] = [
    { id: "previous", kind: "set-var", into: "selected", value: "original" },
    { id: "bad", kind: "transform", source: "not-a-number", into: "selected",
      transform: { kind: "math", operation: "add", operandType: "number", operand: 1 } },
    { id: "fallback", kind: "transform", source: "selected", into: "selected",
      transform: { kind: "fallback", when: "missing", text: "replacement" } },
  ];
  const vars: Record<string, unknown> = { "not-a-number": "invalid" };
  assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(vars.selected, "original");
});
test("dynamic JSON field names retain accurate totals for truncated API samples", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  const fetch = steps[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch step");
  fetch.preview ??= {}; fetch.preview.sample = {
    groups: { a: Array.from({ length: 20 }, (_, i) => i), b: [1, 2] },
  };
  fetch.preview ??= {}; fetch.preview.totals = { "groups.a": 103 };
  steps.push(
    { id: "dynamic-name", kind: "set-var", value: "a", into: "targetKey" },
    { id: "pick-list", kind: "transform", source: "data.groups", into: "picked",
      transform: { kind: "field", key: "{targetKey}" } },
    { id: "count-picked", kind: "transform", source: "picked", into: "actualCount",
      transform: { kind: "length" } },
  );
  assert.equal(previewDataVars(doc, "p").actualCount, 103,
    "a dynamic key must resolve to its source path before sample count correction");
});

test("three ordinary blocks compose a value in preview and server generated output", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  const chain: ScriptStep[] = [
    { id: "t1", kind: "transform", source: "data", into: "chosen", transform: { kind: "field", key: "tags" } },
    { id: "t2", kind: "transform", source: "chosen", into: "chosen", transform: { kind: "length" } },
    { id: "t3", kind: "transform", source: "chosen", into: "chosen", transform: { kind: "math", operation: "add", operandType: "number", operand: 5 } },
  ];
  steps.splice(1, 1, ...chain);
  const plan = pagePlan(doc, "p");
  for (const block of chain) assert.ok(plan.serverIds.has(block.id));
  assert.equal(previewDataVars(doc, "p").chosen, 7);
  const files = generateProject(doc).files;
  assert.ok(files["lib/value-recipe.ts"]);
  const server = files["app/page.tsx"];
  assert.match(server, /__evalValueRecipe/);
  assert.match(server, /"math"/);
  assert.doesNotThrow(() => transformSync(server, { loader: "tsx", jsx: "automatic" }));
});


test("test-site Next.js exports use proxy convention without legacy middleware", () => {
  const files = generateProject(scriptDataPickerDoc(), "test").files;
  assert.ok(files["proxy.ts"]);
  assert.equal(files["middleware.ts"], undefined);
  assert.ok(files["proxy.ts"].includes("export function proxy(req: NextRequest)"));
  assert.match(files["proxy.ts"], /X-Robots-Tag/);
  assert.match(files["proxy.ts"], /status: 403/);
  assert.ok(files["proxy.ts"].includes('matcher: "/:path*"'));
});

test("generated recipe evaluator narrows its discriminated result under strict TypeScript", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push({
    id: "typecheck-recipe", kind: "transform", source: "data", into: "result",
    transform: { kind: "length" },
  });
  const generated = generateProject(doc).files["lib/value-recipe.ts"];
  assert.ok(generated);
  const folder = mkdtempSync(join(tmpdir(), "tsumu-generated-recipe-"));
  try {
    const recipeFile = join(folder, "value-recipe.ts");
    const consumerFile = join(folder, "consumer.ts");
    writeFileSync(recipeFile, generated, "utf8");
    writeFileSync(consumerFile, `import { evaluateValueRecipe } from "./value-recipe";
const vars: Record<string, unknown> = {};
const result = evaluateValueRecipe([1, 2], [{ kind: "length" }], vars);
if (result.kind === "value") vars.count = result.value;
else if (result.kind === "missing") vars.count = undefined;
else vars.error = result.code;
`, "utf8");
    try {
      execFileSync(resolve(process.cwd(), "node_modules/.bin/tsc"), [
        "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022",
        "--module", "esnext", "--moduleResolution", "bundler", "--lib", "es2022",
        consumerFile,
      ], { cwd: process.cwd(), encoding: "utf8" });
    } catch (cause) {
      const error = cause as { stdout?: string; stderr?: string; message?: string };
      assert.fail("Generated evaluator failed TypeScript checking:\\n" +
        (error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? ""));
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("holiday dictionary rows are built using keyed writes and a list loop", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  steps.push(
    { id: "holidays-fetch", kind: "fetch", as: "祝日",
      url: "https://holidays-jp.github.io/api/v1/date.json",
      preview: { sample: { "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日" } } },
    { id: "today", kind: "set-var", into: "今日の日付", value: "2026-11-23" },
    { id: "todays-holiday", kind: "transform", source: "祝日", into: "今日の祝日",
      transform: { kind: "field", key: "{今日の日付}" } },
    { id: "make-rows", kind: "set-var", into: "祝日一覧", value: "[]" },
    { id: "each-holiday", kind: "for-each", array: "祝日", then: [
      { id: "make-row", kind: "set-var", into: "祝日行", value: "{}" },
      { id: "key", kind: "set-list-item", list: "祝日行", key: "日付", value: "{ループ.キー}" },
      { id: "value", kind: "set-list-item", list: "祝日行", key: "祝日名", value: "{ループ.値}" },
      { id: "append-row", kind: "set-list-item", list: "祝日一覧", key: "", value: "{祝日行}" },
    ] },
  );
  const preview = previewDataVars(doc, "p");
  assert.equal(preview["今日の祝日"], "勤労感謝の日");
  assert.deepEqual(JSON.parse(JSON.stringify(preview["祝日一覧"])), [
    { "日付": "2026-11-03", "祝日名": "文化の日" },
    { "日付": "2026-11-23", "祝日名": "勤労感謝の日" },
  ]);
  assert.ok(pageArrays(doc, "p").some(({ name }) => name === "祝日一覧"));
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("todays-holiday"));
  assert.ok(plan.serverIds.has("each-holiday"));
  const files = generateProject(doc).files;
  assert.ok(files["app/page.tsx"].includes("for-each"));
  assert.doesNotThrow(() => transformSync(files["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("renaming variables updates dynamic keys and values in list writes", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  steps.push(
    { id: "init-rows", kind: "set-var", into: "rows", value: "{}" },
    { id: "rename-key", kind: "set-list-item", list: "rows",
      key: "{labels.keyName}", value: "{labels.valueName}" },
  );
  renameVarInPage(doc, "p", "labels", "displayLabels");
  const renamed = steps.find((step) => step.id === "rename-key");
  assert.equal(renamed?.kind, "set-list-item");
  if (!renamed || renamed.kind !== "set-list-item") throw new Error("Expected keyed write");
  assert.equal(renamed.key, "{displayLabels.keyName}");
  assert.equal(renamed.value, "{displayLabels.valueName}");
});

test("browser-only list key variables keep their write outside SSR", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "dynamic-column", kind: "store-load", key: "chosen-field", into: "keyName" },
    { id: "init-rows", kind: "set-var", into: "rows", value: "{}" },
    { id: "client-write", kind: "set-list-item", list: "rows", key: "{keyName}", value: "42" },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(!plan.serverIds.has("client-write"));
  assert.ok(plan.clientVars.has("rows"));
});
test("server data transforms interpolate strings and source variables without client-only adapters", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "person", kind: "set-var", into: "person", value: "田中" },
    { id: "fallback", kind: "transform", source: "missing", into: "greeting",
      transform: { kind: "fallback", when: "missing", text: "こんにちは、{person}さん" } },
    { id: "dynamic-name", kind: "set-var", into: "lookupField", value: "price" },
    { id: "read-price", kind: "transform", source: "data", into: "cost",
      transform: { kind: "field", key: "{lookupField}" } },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("fallback"));
  assert.ok(plan.serverIds.has("read-price"));
  const vars = previewDataVars(doc, "p");
  assert.equal(vars.greeting, "こんにちは、田中さん");
  assert.equal(vars.cost, 12);
  const generated = generateProject(doc).files["app/page.tsx"];
  assert.match(generated, /"kind":"fallback"/);
  assert.match(generated, /"key":"\{_\d+\}"/);
  assert.doesNotThrow(() => transformSync(generated, { loader: "tsx", jsx: "automatic" }));
});


test("if block operands can refer to another variable", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "threshold", kind: "set-var", value: "{data.price}", into: "threshold" },
    { id: "cmp", kind: "if",
      cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "{threshold}" },
      then: [{ id: "yes", kind: "set-var", into: "above", value: "true" }],
      else: [{ id: "no", kind: "set-var", into: "above", value: "false" }],
    },
  );
  const result = previewDataVars(doc, "p");
  assert.equal(result.threshold, 12);
  assert.equal(result.above, true);
});

test("server preview calculates with numeric strings and filters lists through loops", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "rate", kind: "set-var", value: "1.5", into: "rate" },
    { id: "calc", kind: "transform", source: "data.price", into: "total",
      transform: { kind: "math", operation: "multiply", operandType: "variable", operand: "rate" } },
    { id: "copy-tags", kind: "set-var", value: "{data.tags}", into: "tags" },
    { id: "append", kind: "set-list-item", list: "tags", key: "", value: "green" },
    { id: "empty-tags", kind: "set-var", value: "[]", into: "filteredTags" },
    { id: "filter-tags", kind: "for-each", array: "tags", then: [
      { id: "keep", kind: "if", cond: {
        subject: "var", target: "", left: "{ループ.値}", op: "eq", value: "red", not: true,
      }, then: [{ id: "add-tag", kind: "set-list-item", list: "filteredTags", key: "", value: "{ループ.値}" }] },
    ] },
  );
  const vars = previewDataVars(doc, "p");
  assert.equal(vars.total, 18);
  assert.deepEqual(vars.filteredTags, ["blue", "green"]);
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("calc"));
  assert.ok(plan.serverIds.has("append"));
  assert.ok(plan.serverIds.has("filter-tags"));
  const generated = generateProject(doc).files["app/page.tsx"];
  assert.match(generated, /"set-list-item"/);
  assert.match(generated, /"for-each"/);
  assert.doesNotThrow(() => transformSync(generated, { loader: "tsx", jsx: "automatic" }));
});
test("a browser-only operand keeps its arithmetic block in the client runtime", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "browser-rate", kind: "store-load", key: "tax", into: "rate" },
    { id: "dynamic-total", kind: "transform", source: "data.price", into: "total",
      transform: { kind: "math", operation: "multiply", operandType: "variable", operand: "rate" } },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(!plan.serverIds.has("dynamic-total"));
  assert.ok(plan.clientVars.has("total"));
});

test("page-load for-each and if execute on fetched items before rendering, including nested transforms", () => {
  const doc = scriptDataPickerDoc();
  const load = doc.pages.p.pageScripts![0].steps;
  const fetch = load[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch fixture");
  fetch.preview ??= {}; fetch.preview.sample = {
    rows: [
      { price: 10, enabled: "true" },
      { price: 7, enabled: "false" },
      { price: 5, enabled: "true" },
    ],
  };
  load.push(
    { id: "zero", kind: "set-var", value: "0", into: "total" },
    { id: "init-number", kind: "transform", source: "total", into: "total",
      transform: { kind: "parse" } },
    { id: "empty", kind: "set-var", value: "[]", into: "prices" },
    { id: "init-list", kind: "transform", source: "prices", into: "prices",
      transform: { kind: "parse" } },
    { id: "each-price", kind: "for-each", array: "data.rows", then: [
      { id: "if-enabled", kind: "if",
        cond: { subject: "var", target: "", left: "{enabled}", op: "eq", value: '\"true\"' },
        then: [
          { id: "double", kind: "transform", source: "price", into: "doubled",
            transform: { kind: "math", operation: "multiply", operandType: "number", operand: 2 } },
          { id: "sum", kind: "transform", source: "total", into: "total",
            transform: { kind: "math", operation: "add", operandType: "variable", operand: "doubled" } },
          { id: "append", kind: "set-list-item", list: "prices", key: "", value: "{doubled}" },
        ], else: [
          { id: "excluded", kind: "set-var", value: "excluded", into: "status" },
        ] },
    ] },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("each-price"));
  assert.ok(!plan.clientVars.has("doubled"));
  const preview = previewDataVars(doc, "p");
  assert.equal(preview.total, 30);
  assert.deepEqual(preview.prices, [20, 10]);
  assert.equal(preview.status, "excluded");
  const project = generateProject(doc).files;
  assert.ok(project["lib/page-load-steps.ts"]);
  assert.ok(project["lib/value-recipe.ts"]);
  assert.match(project["app/page.tsx"], /__runPurePageSteps/);
  assert.match(project["app/page.tsx"], /"for-each"/);
  assert.doesNotThrow(() => transformSync(project["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("generated page-load evaluator matches editor behavior without TypeScript dependencies", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "outer", kind: "for-each", array: "data.tags", then: [
      { id: "set-var", kind: "set-var", value: "{値}", into: "last" },
    ] },
  );
  const project = generateProject(doc).files;
  const source = project["lib/page-load-steps.ts"];
  const generated = new Function(
    source.replace("export const runPurePageSteps", "const runPurePageSteps") +
    "\nreturn runPurePageSteps;",
  )() as typeof runPurePageSteps;
  const initial = { data: { tags: ["a", "b", "c"] } };
  const actual = structuredClone(initial) as Record<string, unknown>;
  assert.equal(generated(doc.pages.p.pageScripts![0].steps.slice(-1), actual,
    lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(actual.last, "c");
});

test("oversized page-load loops abort without leaving partial variable changes", () => {
  const vars: Record<string, unknown> = { rows: Array(100001).fill(1), output: "unchanged" };
  const loop: ScriptStep = { id: "large", kind: "for-each", array: "rows", then: [
    { id: "write", kind: "set-var", value: "{値}", into: "output" },
  ] };
  assert.equal(runPurePageSteps([loop], vars, lookupVar, interpolate, evaluateValueRecipe), false);
  assert.equal(vars.output, "unchanged");
});

test("page-load repeat count can come from a numeric-string variable", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "count", kind: "set-var", into: "count", value: "3" },
    { id: "initial", kind: "set-var", into: "sum", value: "0" },
    { id: "numeric", kind: "transform", source: "sum", into: "sum", transform: { kind: "parse" } },
    { id: "iterate", kind: "repeat", times: "{count}", then: [
      { id: "increment", kind: "transform", source: "sum", into: "sum",
        transform: { kind: "math", operation: "add", operandType: "number", operand: 1 } },
    ] },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("iterate"));
  assert.equal(previewDataVars(doc, "p").sum, 3);
  const files = generateProject(doc).files;
  assert.match(files["app/page.tsx"], /"times":"\{_\d+\}"/);
  assert.doesNotThrow(() => transformSync(files["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("page-load nested browser effects are not mistakenly executed or discarded by SSR", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "not-server", kind: "for-each", array: "data.tags", then: [
      { id: "copy", kind: "copy", value: "{値}" },
    ] },
    { id: "unbounded", kind: "repeat", times: 0, then: [
      { id: "assign", kind: "set-var", into: "never", value: "not server" },
    ] },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(!plan.serverIds.has("not-server"));
  assert.ok(!plan.serverIds.has("unbounded"));
  assert.ok(!plan.serverIds.has("copy"));
});

test("page-load nested loops read the nearest item's fields and preserve the outer result", () => {
  const doc = scriptDataPickerDoc();
  const fetch = doc.pages.p.pageScripts![0].steps[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch fixture");
  fetch.preview ??= {}; fetch.preview.sample = {
    rows: [{ key: "outer", nested: [{ key: "a" }, { key: "b" }] }],
  };
  const steps = doc.pages.p.pageScripts![0].steps;
  steps.push(
    { id: "empty", kind: "set-var", value: "[]", into: "collected" },
    { id: "parse", kind: "transform", source: "collected", into: "collected", transform: { kind: "parse" } },
    { id: "each-outer", kind: "for-each", array: "data.rows", then: [
      { id: "each-inner", kind: "for-each", array: "nested", then: [
        { id: "collect", kind: "set-list-item", list: "collected", key: "", value: "{key}" },
      ] },
    ] },
  );
  assert.ok(pagePlan(doc, "p").serverIds.has("each-outer"));
  assert.deepEqual(previewDataVars(doc, "p").collected, ["a", "b"]);
});

test("a canvas transform chain serializes to the browser runtime without losing step order", () => {
  const doc = scriptDataPickerDoc();
  const node = { ...makeBox(), id: "action", attrId: "action", scripts: [{
    id: "click", trigger: "click" as const, steps: [
      { id: "input", kind: "set-var" as const, into: "number", value: "4" },
      { id: "parse", kind: "transform" as const, source: "number", into: "number", transform: { kind: "parse" as const } },
      { id: "math", kind: "transform" as const, source: "number", into: "number",
        transform: { kind: "math" as const, operation: "multiply" as const, operandType: "number" as const, operand: 3 } },
    ],
  }] };
  doc.nodes.action = node;
  doc.pages.p.children.push("action");
  const steps = compileScripts(node, () => "/")[0].steps;
  assert.deepEqual(steps.map(s => s.kind), ["set-var", "transform", "transform"]);
  assert.equal(steps[2].into, "number");
  assert.doesNotThrow(() => new Function(scriptsFile(doc)));
});

test("newly dropped processing blocks inherit the preceding output without mutation", () => {
  const doc = scriptDataPickerDoc();
  const script = { ...doc.pages.p.pageScripts![0], nodeId: null };
  const incoming: ScriptStep[] = [
    { id: "next", kind: "transform", source: "", into: "", transform: { kind: "length" } },
  ];
  const connected = connectNewTransform([script], { scriptId: script.id, list: "root", index: 2 }, incoming);
  assert.deepEqual(connected, [
    { id: "next", kind: "transform", source: "chosen", into: "chosen", transform: { kind: "length" } },
  ]);
  assert.equal((incoming[0] as Extract<ScriptStep, { kind: "transform" }>).source, "");
});

test("constant load steps are evaluated on the server without leaking unused values to browser scripts", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push({
    id: "private", kind: "set-var", value: "UNUSED_PRIVATE_SENTINEL", into: "private",
  });
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("private"));
  assert.equal(previewDataVars(doc, "p").private, "UNUSED_PRIVATE_SENTINEL");
  const files = generateProject(doc).files;
  assert.ok(files["app/page.tsx"].includes("UNUSED_PRIVATE_SENTINEL"));
  assert.doesNotMatch(files["public/scripts.js"] ?? "", /UNUSED_PRIVATE_SENTINEL/);
});

test("fetched sample totals are preserved through aliases in composition without truncating actual data", () => {
  const doc = scriptDataPickerDoc();
  const fetch = doc.pages.p.pageScripts![0].steps[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch fixture");
  fetch.preview ??= {}; fetch.preview.totals = { tags: 52 };
  doc.pages.p.pageScripts![0].steps.push(
    { id: "alias", kind: "set-var", value: "{data.tags}", into: "selectedTags" },
    { id: "len", kind: "transform", source: "selectedTags", into: "total", transform: { kind: "length" } },
  );
  assert.equal(previewDataVars(doc, "p").total, 52);
  assert.equal(previewDataVars(doc, "p", {
    live: { fetch: { tags: ["x", "y", "z"] } },
  }).total, 3);
  assert.equal(previewDataVars(doc, "p", {
    live: { fetch: { tags: ["x", "y"] } },
    liveTotals: { fetch: { tags: 42 } },
  }).total, 42);
});


test("script editor list counts use source totals rather than truncated samples", () => {
  const doc = scriptDataPickerDoc();
  const fetch = doc.pages.p.pageScripts![0].steps[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch fixture");
  fetch.preview ??= {};
  fetch.preview.sample = { tags: Array.from({ length: 20 }, (_, i) => i) };
  fetch.preview.totals = { tags: 150 };
  doc.pages.p.pageScripts![0].steps.push({
    id: "alias", kind: "set-var", value: "{data.tags}", into: "selectedTags",
  });
  const listCounts: Record<string, number> = {};
  const values = previewDataVars(doc, "p", { listCounts });
  assert.equal((values.data as { tags: number[] }).tags.length, 20);
  assert.equal(listCounts["data.tags"], 150);
  assert.equal(listCounts.selectedTags, 150);
  assert.equal(listCounts.data, undefined);
});

test("script editor list counts are omitted for non-fetch and unresolved values", () => {
  const doc = scriptDataPickerDoc();
  const counts: Record<string, number> = {};
  previewDataVars(doc, "p", { listCounts: counts });
  assert.equal(counts.unknown, undefined);
});
});

describe("script-cancellation", () => {
const wait: ScriptStep = { id: "wait", kind: "wait", seconds: 10 };
const hide: ScriptStep = { id: "hide", kind: "hide", target: "banner" };

function harness(steps: ScriptStep[], opts: { trigger?: ScriptTrigger; preview?: boolean } = {}) {
  const trigger = opts.trigger ?? "load";
  const doc: SiteDoc = {
    siteName: "Script navigation", pageOrder: ["a", "b"], assets: {},
    pages: Object.fromEntries(["a", "b"].map((id) => [id, {
      id, name: id, slug: id === "a" ? "" : "second", title: id, description: "", children: id === "a" ? ["start"] : [],
    }])),
    nodes: { start: { ...makeBox(), id: "start", scripts: [{ id: "script", trigger, steps }] } },
  };
  let pageId = "a";
  const pageMarker = () => ({ getAttribute: (name: string) => name === "data-page-body" ? pageId : null });
  let marker = opts.preview ? null : pageMarker();
  const timers = new Map<number, () => void>();
  let seq = 0;
  let triggerRemoved = false;
  const frames: Array<() => void> = [];
  let mutation: () => void = () => {};
  const events = new Map<string, Function>();
  const target = { style: { display: "" }, matches: () => false };
  const starter = {
    nodeType: 1, parentElement: null,
    getAttribute: () => JSON.stringify([{ trigger, steps }]),
    closest: (selector: string): unknown => selector === "[data-scripts]" ? starter : null,
  };
  const root = {
    querySelector: () => marker,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" ? (pageId === "a" && !triggerRemoved ? [starter] : []) : selector === "#banner" ? [target] : [],
    contains: () => true,
    addEventListener: (name: string, fn: Function, capture = false) => events.set(`${name}:${capture}`, fn),
    removeEventListener: () => {},
  };
  const dispose = runInNewContext(opts.preview ? `(${SCRIPT_RUNTIME})({}).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (s: string) => s },
    MutationObserver: class { constructor(fn: () => void) { mutation = fn; } observe() {} disconnect() {} },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    setTimeout: (fn: () => void) => { timers.set(++seq, fn); return seq; },
    clearTimeout: (id: number) => timers.delete(id),
  }) as () => void;
  return {
    target,
    pending: () => timers.size,
    click: () => events.get("click:false")!({ target: starter }),
    scan() { mutation(); while (frames.length) frames.shift()!(); },
    navigate(id: string, replaceMarker = false) {
      pageId = id;
      if (replaceMarker) marker = pageMarker();
    },
    removeTrigger() { triggerRemoved = true; },
    async tick() {
      const next = timers.entries().next().value;
      if (next) { timers.delete(next[0]); next[1](); }
      await new Promise<void>((done) => setImmediate(done));
    },
    dispose,
  };
}

test("a page's delayed action cannot change the next page", async () => {
  const h = harness([wait, hide]);
  assert.equal(h.pending(), 1);
  h.navigate("b"); h.scan();
  await h.tick();
  assert.equal(h.target.style.display, "");
  assert.equal(h.pending(), 0);
});

test("a click-only delayed action stops before the navigation scan has run", async () => {
  const h = harness([wait, hide], { trigger: "click" });
  h.click();
  assert.equal(h.pending(), 1);
  h.navigate("b");
  await h.tick();
  assert.equal(h.target.style.display, "");
});

test("a pending action does not resume after leaving and returning to the same page", async () => {
  const h = harness([wait, hide], { trigger: "click" });
  h.click();
  h.navigate("b"); h.scan();
  h.navigate("a"); h.scan();
  await h.tick();
  assert.equal(h.target.style.display, "");
  // 戻った後でも、新しく始めた動作は動く。
  h.click(); await h.tick();
  assert.equal(h.target.style.display, "none");
});

test("a new-page action started before the navigation scan is not canceled", async () => {
  const h = harness([
    { id: "set", kind: "set-var", into: "status", value: "fresh" },
    wait,
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "{status}", op: "eq", value: "fresh" }, then: [hide] },
  ], { trigger: "click" });
  h.navigate("b");
  h.click();
  h.scan(); await h.tick();
  assert.equal(h.target.style.display, "none", "the scan must keep the new page's action and variables");
});

test("replacing a page with another instance of the same page cancels old work", async () => {
  const h = harness([wait, hide], { trigger: "click" });
  h.click();
  h.navigate("a", true);
  await h.tick();
  assert.equal(h.target.style.display, "");
});

test("a fresh instance of a page without seeds starts with fresh script variables", () => {
  const h = harness([
    { id: "check", kind: "if", cond: { subject: "var", target: "", left: "{count}", op: "eq", value: "1" }, then: [hide] },
    { id: "write", kind: "set-var", into: "count", value: "1" },
  ], { trigger: "click" });
  h.click();
  h.navigate("a", true);
  h.scan();
  h.click();
  assert.equal(h.target.style.display, "");
  h.click();
  assert.equal(h.target.style.display, "none");
});

test("a reused element runs its load script once per page visit", () => {
  const h = harness([wait]);
  assert.equal(h.pending(), 1);
  h.navigate("b"); h.scan();
  assert.equal(h.pending(), 0);
  h.navigate("a"); h.scan(); h.scan();
  assert.equal(h.pending(), 1);
});

test("unrelated mutations and removal of the trigger do not cancel same-page actions", async () => {
  const h = harness([wait, hide]);
  // ページの印はそのまま残る。関係の無い DOM の走査は、ページの移動ではない。
  h.removeTrigger(); h.scan(); await h.tick();
  assert.equal(h.target.style.display, "none");
});

test("waits nested in if and repeat blocks cannot continue on another page", async () => {
  const h = harness([
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "yes", op: "eq", value: "yes" }, then: [
      { id: "repeat", kind: "repeat", times: 0, then: [wait, hide] },
    ] },
    hide,
  ]);
  assert.equal(h.pending(), 1);
  h.navigate("b"); h.scan(); await h.tick();
  assert.equal(h.target.style.display, "");
  assert.equal(h.pending(), 0, "the infinite repeat must not schedule another timer");
});

test("for-each continuations and their following steps stop after navigation", async () => {
  const h = harness([
    { id: "items-input", kind: "set-var", value: "a,b", into: "items" },
    { id: "split", kind: "transform", source: "items", into: "items", transform: { kind: "split", separator: "," } },
    { id: "each", kind: "for-each", array: "items", then: [wait, hide] },
    hide,
  ], { trigger: "click" });
  h.click();
  assert.equal(h.pending(), 1);
  h.navigate("b"); h.scan(); await h.tick();
  assert.equal(h.target.style.display, "");
  assert.equal(h.pending(), 0);
});

test("preview without a page marker keeps working and disposal cancels pending work", async () => {
  const h = harness([wait, hide], { preview: true });
  await h.tick();
  assert.equal(h.target.style.display, "none");
  const disposed = harness([wait, hide], { preview: true });
  disposed.dispose(); await disposed.tick();
  assert.equal(disposed.target.style.display, "");
});

test("navigating away releases outstanding script timers without waiting for the delay", () => {
  const h = harness([wait, hide], { trigger: "click" });
  h.click();
  assert.equal(h.pending(), 1);
  h.navigate("b");
  h.scan();
  assert.equal(h.pending(), 0, "page transition should clear stale timers immediately");
});

test("disposing the script runtime releases outstanding script timers immediately", () => {
  const h = harness([wait, hide], { preview: true });
  assert.equal(h.pending(), 1);
  h.dispose();
  assert.equal(h.pending(), 0, "unmount should not keep a pending timeout alive");
});
});

describe("script-conditions-shortcircuit", () => {
// ブラウザ用と単独の書き出しに埋め込む条件の判定そのものを動かす。
// 項目を読んだ回数が見えるよう、差し込む依存は小さくしておく。
function exportedFilter() {
  const start = SCRIPT_RUNTIME.indexOf("function passOne(conds, item)");
  const end = SCRIPT_RUNTIME.indexOf("function passes(fs, item)", start);
  assert.ok(start > 0 && end > start);
  const source = SCRIPT_RUNTIME.slice(start, end);
  return runInNewContext(`(function () {
    function fieldOf(item, field) { return item[field]; }
    function matchValueCondition(value, op, expected) { return value === expected; }
    ${source}
    return passOne;
  })()`) as (conds: Array<{field:string; op:string; value:string; and?:boolean}>, item: object) => boolean;
}

test("client list predicates short-circuit satisfied OR groups", () => {
  const passOne = exportedFilter();
  let accesses = 0;
  const item = { flag: "yes", get expensive() { accesses++; throw new Error("unnecessary predicate"); } };
  assert.equal(passOne([
    { field: "flag", op: "eq", value: "yes" },
    { field: "expensive", op: "eq", value: "no", and: false },
  ], item), true);
  assert.equal(accesses, 0);
});

test("client list predicates short-circuit failed AND groups", () => {
  const passOne = exportedFilter();
  let accesses = 0;
  const item = { flag: "yes", get expensive() { accesses++; throw new Error("unnecessary predicate"); } };
  assert.equal(passOne([
    { field: "flag", op: "eq", value: "no" },
    { field: "expensive", op: "eq", value: "yes", and: true },
  ], item), false);
  assert.equal(accesses, 0);
});

test("client list predicates preserve normal AND-before-OR grouping", () => {
  const passOne = exportedFilter();
  const conds = [
    { field: "a", op: "eq", value: "yes" },
    { field: "b", op: "eq", value: "yes", and: false },
    { field: "c", op: "eq", value: "yes", and: true },
  ];
  assert.equal(passOne(conds, { a: "no", b: "yes", c: "yes" }), true);
  assert.equal(passOne(conds, { a: "no", b: "yes", c: "no" }), false);
  assert.equal(passOne(conds, { a: "yes", b: "no", c: "no" }), true);
  assert.equal(passOne([], {}), true);
});

function exportedFilterChain() {
  const start = SCRIPT_RUNTIME.indexOf("function passOne(conds, item)");
  const end = SCRIPT_RUNTIME.indexOf("// 配列の並べ替え: 配列の名前", start);
  assert.ok(start > 0 && end > start);
  return runInNewContext(`(function () {
    function fieldOf(item, field) { return item[field]; }
    function matchValueCondition(value, op, expected) { return value === expected; }
    ${SCRIPT_RUNTIME.slice(start, end)}
    return passes;
  })()`) as (filters: Array<{ join?: string; conds: Array<{field:string;op:string;value:string}> }>, item: object) => boolean;
}

test("client list filters short-circuit subsequent filter blocks with AND/OR", () => {
  const passes = exportedFilterChain();
  let reads = 0;
  const item = { flag: "yes", get expensive() { reads++; throw new Error("unnecessary filter"); } };
  assert.equal(passes([
    { conds: [{ field: "flag", op: "eq", value: "yes" }] },
    { join: "or", conds: [{ field: "expensive", op: "eq", value: "no" }] },
  ], item), true);
  assert.equal(reads, 0, "a successful OR branch must skip later filters");
  assert.equal(passes([
    { conds: [{ field: "flag", op: "eq", value: "no" }] },
    { join: "and", conds: [{ field: "expensive", op: "eq", value: "yes" }] },
  ], item), false);
  assert.equal(reads, 0, "a failed AND branch must skip later filters");
});

test("browser runtime does not retain an unused competing scalar comparator", () => {
  assert.doesNotMatch(SCRIPT_RUNTIME, /\bfunction cmp\(/);
});

test("generated page-data filter skips irrelevant filter operations", () => {
  const start = PAGE_DATA_RUNTIME.indexOf("function filter(items, operations, vars)");
  const end = PAGE_DATA_RUNTIME.indexOf("function applyOps(items, operations, vars)", start);
  assert.ok(start > 0 && end > start);
  const reads: string[] = [];
  const filter = runInNewContext(`(function () {
    function passes(_item, conditions) {
      reads.push(conditions[0].id);
      return conditions[0].ok;
    }
    ${PAGE_DATA_RUNTIME.slice(start, end)}
    return filter;
  })()`, { reads }) as (items: object[], ops: object[], vars: object) => object[];
  const item = { id: 1 };
  const run = (first: boolean, join: string) => filter([item], [
    { kind: "filter", conds: [{ id: "first", ok: first }] },
    { kind: "filter", join, conds: [{ id: "second", ok: !first }] },
  ], {});
  assert.equal(run(true, "or").length, 1);
  assert.deepEqual(reads, ["first"], "a successful OR branch should skip later filters");
  reads.length = 0;
  assert.equal(run(false, "and").length, 0);
  assert.deepEqual(reads, ["first"], "a failed AND branch should skip later filters");
});
});

describe("script-data-export", () => {
const pageDataPlan = (doc: SiteDoc, page: Page) => serializePageDataPlan(pagePlan(doc, page.id));

function fixture() {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  const steps = [
    { id: "fetch", kind: "fetch", as: "data", url: "https://data.example.test/items",
      preview: { sample: { items: [{ id: "editor", price: 99 }] } } },
    { id: "items", kind: "transform", source: "data", into: "items",
      transform: { kind: "field", key: "items" } },
    { id: "size", kind: "transform", source: "items", into: "size",
      transform: { kind: "length" } },
    { id: "math", kind: "transform", source: "size", into: "total",
      transform: { kind: "math", operation: "add", operand: "offset", operandType: "variable" } },
    { id: "empty-selected", kind: "set-var", value: "null", into: "selected" },
    { id: "lookup", kind: "for-each", array: "items", then: [
      { id: "match-id", kind: "if", cond: { subject: "var", target: "",
        left: "{ループ.値.id}", op: "eq", value: "second" }, then: [
        { id: "selected", kind: "set-var", into: "selected", value: "{ループ.値}" },
        { id: "stop", kind: "break-loop" },
      ] },
    ] },
    { id: "each", kind: "for-each", array: "items", then: [
      { id: "per-item", kind: "transform", source: "price", into: "lastPrice",
        transform: { kind: "math", operation: "multiply", operandType: "number", operand: 2 } },
    ] },
    { id: "conditional", kind: "if", cond: { subject: "var", left: "{total}",
      op: "gt", value: "3" }, then: [
      { id: "yes", kind: "set-var", into: "branch", value: "high" },
    ], else: [{ id: "no", kind: "set-var", into: "branch", value: "low" }] },
    { id: "repeat", kind: "repeat", times: 2, then: [
      { id: "inc", kind: "transform", source: "total", into: "total",
        transform: { kind: "math", operation: "add", operandType: "number", operand: 1 } },
    ] },
    { id: "list", kind: "list-display", mode: "filter", array: "items",
      field: "id", op: "eq", value: "first", not: true, dir: "asc" },
  ];
  page.pageScripts = [{ id: "load-new", trigger: "load",    steps }] as unknown as typeof page.pageScripts;
  return { doc, page };
}

const response = { items: [
  { id: "first", price: 1 },
  { id: "second", price: 3 },
] };

const expected = (result: Record<string, unknown>, shown: unknown) => {
  assert.equal(result.size, 2);
  assert.equal(result.total, 6);
  assert.equal(result.branch, "high");
  assert.equal(result.lastPrice, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(result.selected)), response.items[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), response.items);
  assert.deepEqual(JSON.parse(JSON.stringify(shown)), [response.items[1]]);
};

test("the document exports its pure transform, nested loop, conditions and list display", async () => {
  const { doc, page } = fixture();
  const plan = pageDataPlan(doc, page);
  assert.deepEqual(plan.steps.map((step) => step.kind), [
    "fetch", "transform", "transform", "transform", "set-var",
    "for-each", "for-each", "if", "repeat",
  ]);
  assert.ok(!JSON.stringify(plan).includes("editor"));
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "?offset=2" }, URLSearchParams, TextDecoder, TextEncoder,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: async () => Response.json(response),
    console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const vars = await sandbox.window.__pageDataReady;
  expected(vars, sandbox.window.__pageListRows(vars.items, "items", vars));
});

test("the same transform semantics run in native SSR without browser globals", async () => {
  const { doc, page } = fixture();
  const plan = pageDataPlan(doc, page);
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData, listItemsWithOps } = await import(uri);
  const vars = await loadPageData(plan, "?offset=2", async () => Response.json(response));
  expected(vars, listItemsWithOps(plan.listOps, vars, "items", 0));
});

test("exported HTML carries the page plan and executable data runtime", () => {
  const { doc, page } = fixture();
  // このテストは、インタープリターだけでなく、実際に書き出したファイルを動かす。
  // 初期の他のページには、HTML が意図的に拒否する動的な [slug] のパスが含まれる。
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const project = generateExportProject(doc, "html");
  const html = project.files["index.html"];
  assert.ok(html, "The HTML export must have a downloadable entry point");
  assert.match(html, /data-page-plan/);
  const planSource = html.split("data-page-plan>")[1]?.split("</script>")[0];
  assert.ok(planSource, "The generated HTML must embed a serializable page plan");
  const exported = JSON.parse(planSource);
  assert.equal(exported.steps.filter((s: { kind: string }) => s.kind === "transform").length, 3);
  assert.ok(project.files["data-loader.js"].includes("runPurePageSteps"));
  assert.ok(project.files["data-loader.js"].includes("evaluateValueRecipe"));
});

test("generated browser event runtime retains transform and list-display actions", () => {
  const { doc, page } = fixture();
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const node = doc.nodes[page.children[0]];
  node.scripts = [{
    id: "click-value", trigger: "click",    steps: [
      { id: "increment", kind: "transform", source: "total", into: "total",
        transform: { kind: "math", operation: "add", operandType: "number", operand: 1 } },
      { id: "filter", kind: "list-display", mode: "filter", array: "items",
        field: "id", op: "eq", value: "second" },
    ],
  }] as unknown as typeof node.scripts;
  const project = generateExportProject(doc, "html");
  const html = project.files["index.html"];
  assert.match(html, /data-scripts=/);
  assert.ok(html.includes("transform"));
  assert.ok(html.includes("list-display"));
  assert.ok(project.files["scripts.js"].includes("Value transform failed:"));
  assert.ok(project.files["scripts.js"].includes("list-display"));
});


test("dictionary entries are expanded into rows using ordinary loops in generated SSR", async () => {
  const { doc, page } = fixture();
  page.pageScripts = [{ id: "entries-page", trigger: "load",    steps: [
      { id: "remote", kind: "fetch", as: "record", url: "https://data.example.test/record" },
      { id: "empty", kind: "set-var", into: "pairs", value: "[]" },
      { id: "entries", kind: "for-each", array: "record", then: [
        { id: "init", kind: "set-var", into: "entry", value: "{}" },
        { id: "property", kind: "set-list-item", list: "entry", key: "property", value: "{ループ.キー}" },
        { id: "content", kind: "set-list-item", list: "entry", key: "content", value: "{ループ.値}" },
        { id: "append", kind: "set-list-item", list: "pairs", key: "", value: "{entry}" },
      ] },
    ],
  }] as unknown as typeof page.pageScripts;
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const exported = generateExportProject(doc, "sveltekit");
  const routesSource = exported.files["src/lib/site-routes.js"];
  const routeModule = await import("data:text/javascript;base64," + Buffer.from(routesSource).toString("base64"));
  const plan = routeModule.pages[0].plan;
  const uri = "data:text/javascript;base64," +
    Buffer.from(exported.files["src/lib/site-data.js"]).toString("base64");
  const { loadPageData } = await import(uri);
  const vars = await loadPageData(plan, "", async () => new Response(
    JSON.stringify({ first: 1, second: 2 }), { status: 200,
      headers: { "Content-Type": "application/json" } },
  ));
  const output = plan.steps.find((step: { kind: string; value?: string }) =>
    step.kind === "set-var" && step.value === "[]");
  assert.ok(output && "into" in output, "Generated plan must include the output list");
  assert.deepEqual(JSON.parse(JSON.stringify(vars[output.into])), [
    { property: "first", content: 1 }, { property: "second", content: 2 },
  ]);
});
test("export preserves variable references after obfuscating a transformation chain", async () => {
  const { doc, page } = fixture();
  page.pageScripts = [{ id: "chain", trigger: "load",    steps: [
      { id: "csv", kind: "set-var", into: "csv", value: "Alpha,Beta" },
      { id: "split", kind: "transform", source: "csv", into: "names",
        transform: { kind: "split", separator: "," } },
      { id: "count", kind: "transform", source: "names", into: "count",
        transform: { kind: "length" } },
    ],
  }] as unknown as typeof page.pageScripts;
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const output = generateExportProject(doc, "sveltekit");
  const routes = output.files["src/lib/site-routes.js"];
  const routeModule = await import("data:text/javascript;base64," + Buffer.from(routes).toString("base64"));
  const steps = routeModule.pages[0].plan.steps;
  assert.equal(steps[1].source, steps[0].into);
  assert.equal(steps[2].source, steps[1].into);
  const { loadPageData } = await import("data:text/javascript;base64," +
    Buffer.from(output.files["src/lib/site-data.js"]).toString("base64"));
  const vars = await loadPageData({ steps, listOps: {} }, "", async () => {
    throw new Error("No network call expected");
  });
  assert.equal(vars[steps[2].into], 2);
});


test("multiple if clauses retain AND-before-OR grouping in browser and SSR", async () => {
  const { doc, page } = fixture();
  page.pageScripts = [{ id: "joined", trigger: "load",    steps: [{
      id: "joined-if", kind: "if",
      cond: { subject: "var", target: "", left: "{flag}", op: "eq", value: '\"1\"' },
      conditions: [
        { subject: "var", target: "", left: "{mode}", op: "eq", value: "enabled", and: false },
        { subject: "var", target: "", left: "{mode}", op: "eq", value: "disabled", and: true },
      ],
      then: [{ id: "true", kind: "set-var", into: "result", value: "yes" }],
      else: [{ id: "false", kind: "set-var", into: "result", value: "no" }],
    }],
  }] as unknown as typeof page.pageScripts;
  const plan = pageDataPlan(doc, page);
  assert.equal(plan.steps.length, 1);
  assert.deepEqual((plan.steps[0] as { conditions?: unknown[] }).conditions?.length, 2);
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "?flag=1&mode=other" }, URLSearchParams, TextDecoder, TextEncoder,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) }, console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const browser = await sandbox.window.__pageDataReady;
  assert.equal(browser.result, "yes");
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData } = await import(uri);
  const server = await loadPageData(plan, "?flag=1&mode=other");
  assert.equal(server.result, "yes");

  // 実際の要素が関わる条件は、SSR の間には実行できない。「もし」のブロックを黙って飛ばさず、
  // 生成したクライアントのスクリプトのために残す。
  const conditional = (page.pageScripts![0].steps[0] as unknown as {
    conditions: Array<{ subject: string; target: string }>;
    id: string;
  });
  conditional.conditions[0].subject = "checked";
  conditional.conditions[0].target = "checkbox";
  const clientPlan = pageDataPlan(doc, page);
  assert.equal(clientPlan.steps.some((st) => st.kind === "if"), false);
  assert.equal(pagePlan(doc, page.id).serverIds.has(conditional.id), false);
});

test("if condition arrays are serialized into emitted event scripts", () => {
  const { doc, page } = fixture();
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const node = doc.nodes[page.children[0]];
  node.scripts = [{ id: "click", trigger: "click",    steps: [{ id: "if", kind: "if",
      cond: { subject: "var", target: "", left: "1", op: "eq", value: "1" },
      conditions: [{ subject: "var", target: "", left: "1", op: "eq", value: "2", and: false }],
      then: [{ id: "then", kind: "set-var", into: "result", value: "yes" }],
      else: [{ id: "else", kind: "set-var", into: "result", value: "no" }],
    }],
  }] as unknown as typeof node.scripts;
  const result = generateExportProject(doc, "html");
  assert.match(result.files["index.html"], /&quot;conditions&quot;/);
  assert.match(result.files["scripts.js"], /testConditions/);
});



test("missing field values clear stale data before a following fallback", () => {
  const vars: Record<string, unknown> = {
    records: [{ name: "first" }], selected: "stale",
  };
  const steps = [
    { kind: "transform", source: "records.0", into: "selected",
      transform: { kind: "field", key: "unknown" } },
    { kind: "transform", source: "selected", into: "selected",
      transform: { kind: "fallback", when: "missing", text: "not found" } },
  ];
  assert.equal(runPurePageSteps(steps as any, vars,
    (scope, name) => lookupVar(scope, name), interpolate, evaluateValueRecipe), true);
  assert.equal(vars.selected, "not found");
});
test("blank additional if clauses are ignored when evaluating exported page data", () => {
  const vars: Record<string, unknown> = { enabled: "yes" };
  const steps = [{
    kind: "if",
    cond: { subject: "var", left: "{enabled}", op: "eq", value: "yes" },
    conditions: [{ subject: "var", left: "", op: "eq", value: "", not: true, and: true }],
    then: [{ kind: "set-var", into: "result", value: "accepted" }],
    else: [{ kind: "set-var", into: "result", value: "rejected" }],
  }];
  assert.equal(runPurePageSteps(steps as any, vars,
    (scope, name) => lookupVar(scope, name), interpolate, evaluateValueRecipe), true);
  assert.equal(vars.result, "accepted");
});


test("value-transform sort uses natural Japanese numeric collation", () => {
  const items = [{ title: "10" }, { title: "2" }, { title: "1" }];
  const result = evaluateValueRecipe(items,
    [{ kind: "sort", field: "title", direction: "asc" }], {});
  assert.equal(result.kind, "value");
  if (result.kind === "value") {
    assert.deepEqual(result.value, [items[2], items[1], items[0]]);
  }
  assert.deepEqual(items.map((i) => i.title), ["10", "2", "1"]);
});


test("incomplete OR clause retains the OR group before a later AND clause", () => {
  for (const input of [
    { a: "no", c: "yes", expected: "accepted" },
    { a: "yes", c: "no", expected: "accepted" },
    { a: "no", c: "no", expected: "rejected" },
  ]) {
    const vars: Record<string, unknown> = { a: input.a, c: input.c };
    const steps = [{
      kind: "if", cond: { subject: "var", left: "{a}", op: "eq", value: "yes" },
      conditions: [
        { subject: "var", left: "", op: "eq", value: "", and: false },
        { subject: "var", left: "{c}", op: "eq", value: "yes", and: true },
      ],
      then: [{ kind: "set-var", into: "result", value: "accepted" }],
      else: [{ kind: "set-var", into: "result", value: "rejected" }],
    }];
    assert.equal(runPurePageSteps(steps as any, vars,
      (scope, name) => lookupVar(scope, name), interpolate, evaluateValueRecipe), true);
    assert.equal(vars.result, input.expected);
  }
});


test("empty OR filtering preserves group boundaries in browser and SSR", async () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{ id: "load", trigger: "load", steps: [
    { id: "fetch", kind: "fetch", url: "https://public.example.test/items.json", as: "items" },
    { id: "filter", kind: "list-display", mode: "filter", array: "items",
      field: "status", op: "eq", value: "ready",
      or: [
        { field: "", op: "eq", value: "", and: false },
        { field: "status", op: "eq", value: "pending", and: true },
      ],
    },
  ] }] as unknown as typeof page.pageScripts;
  const plan = pageDataPlan(doc, page);
  const operations = (plan.listOps as Record<string, Array<{
    kind: string; conds?: Array<{ field: string; and?: boolean }>;
  }>>).items;
  assert.equal(operations?.[0]?.conds?.[1]?.and, false);
  const rows = [
    { status: "ready", title: "A" },
    { status: "pending", title: "B" },
    { status: "disabled", title: "C" },
  ];
  const respond = async () => new Response(JSON.stringify(rows),
    { status: 200, headers: { "content-type": "application/json" } });
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "" }, URLSearchParams, TextDecoder, TextEncoder,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: respond, console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const browser = await sandbox.window.__pageDataReady;
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData, listItemsWithOps } = await import(uri);
  const server = await loadPageData(plan, "", respond);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.items)), rows);
  assert.deepEqual(JSON.parse(JSON.stringify(server.items)), rows);
  for (const shown of [sandbox.window.__pageListRows(browser.items, "items", browser),
    listItemsWithOps(plan.listOps, server, "items", 0)]) {
    assert.deepEqual(JSON.parse(JSON.stringify(shown)), rows.slice(0, 2));
  }
});


test("unfinished if conditions remain neutral and preserve OR groups", () => {
  const unfinished = { subject: "var", target: "", left: "", op: "eq", value: "", and: false };
  const yes = { subject: "var", target: "", left: "{status}", op: "eq", value: "yes", and: true };
  for (const [status, accepted] of [["yes", true], ["no", false]] as const) {
    const vars: Record<string, unknown> = { status };
    const steps = [{
      kind: "if",
      cond: { subject: "var", target: "", left: "{status}", op: "eq", value: "no", not: true },
      conditions: [unfinished, yes],
      then: [{ kind: "set-var", into: "accepted", value: "true" }],
      else: [{ kind: "set-var", into: "accepted", value: "false" }],
    }];
    assert.equal(runPurePageSteps(steps as any, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.equal(vars.accepted, accepted);
  }
});
});

describe("script-data-prototype-safety", () => {
test("JSON lookups ignore inherited properties but keep own special keys", () => {
  const data = JSON.parse('{"__proto__":{"ok":true},"constructor":{"name":"own"},"rows":[11,12]}');
  assert.equal(lookupVar(data, "__proto__.ok"), true);
  assert.equal(digPath(data, "__proto__.ok"), true);
  assert.equal(lookupVar(data, "constructor.name"), "own");
  assert.equal(lookupVar({}, "constructor"), undefined);
  assert.equal(lookupVar({}, "toString"), undefined);
  assert.equal(digPath({}, "__proto__.polluted"), undefined);
  assert.equal(digPath({}, "toString"), undefined);
  assert.equal(lookupVar({ rows: [11, 12] }, "rows.-1"), 12);
  assert.equal(digPath({ rows: [] }, "rows.-1"), undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("typed list comparisons distinguish arrays, missing fields, and null", () => {
  const values = [
    { tags: ["x", "y"], name: "A" },
    { tags: ["x", null, "y"], name: null },
    { name: null },
    { tags: [], value: { toString: "not callable" } },
    {},
  ];
  const filter = (field: string, op: "eq" | "empty", value: string, not = false) =>
    filterItems(values, [{ kind: "filter", conds: [{ field, op, value, not }] }]);
  assert.deepEqual(filter("tags", "eq", '["x","y"]'), [values[0]]);
  assert.deepEqual(filter("tags", "eq", "x,y"), [], "display-text equality is not structural equality");
  assert.deepEqual(filter("name", "empty", ""), values.slice(1));
  assert.deepEqual(filter("name", "empty", "", true), [values[0]]);
  assert.equal(matchesValueCondition(values[3].value, "eq", "[object Object]"), false);
  assert.equal(matchesValueCondition(values[3].value, "eq", { toString: "not callable" }), true);
});

test("generated browser and SSR engines avoid inherited-key reads and nested __proto__ writes", async () => {
  const plan = {
    steps: [
      { kind: "transform", id: "fallback", source: "constructor", into: "safe",
        transform: { kind: "fallback", when: "missing", text: "default" } },
      { kind: "transform", id: "missing", source: "__proto__.polluted", into: "clean",
        transform: { kind: "fallback", when: "missing", text: "not inherited" } },
      { kind: "fetch", id: "api", url: "/api/test.json", as: "nested.__proto__.polluted" },
    ],
    listOps: {},
  };
  const response = async () => new Response("42", {
    headers: { "content-type": "application/json" }, status: 200,
  });
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "" }, URLSearchParams, TextDecoder, TextEncoder,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: response, console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const browser = await sandbox.window.__pageDataReady as Record<string, unknown>;
  assert.equal(browser.safe, "default");
  assert.equal(browser.clean, "not inherited");
  assert.equal((browser.nested as Record<string, unknown>).__proto__ &&
    (browser.nested as Record<string, Record<string, unknown>>)["__proto__"].polluted, 42);

  const url = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData } = await import(url);
  const server = await loadPageData(plan, "", response);
  assert.equal(server.safe, browser.safe);
  assert.equal(server.clean, browser.clean);
  assert.equal(server.nested["__proto__"].polluted, 42);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});


test("gte/lte list-display filters yield identical browser and SSR results", async () => {
  const rows = [
    { tag: ["x", "y"], score: 9 },
    { tag: ["x", "y"], score: 10 },
    { tag: ["x", null, "y"], score: 15 },
    { tag: ["x", "y"], score: 20 },
    { tag: null, score: 21 },
  ];
  const plan = {
    steps: [{ id: "fetch", kind: "fetch", as: "items", url: "/api/rows.json" }],
    listOps: { items: [
      { kind: "filter", conds: [{ field: "tag", op: "eq", value: '["x","y"]' }] },
      { kind: "filter", conds: [
        { field: "score", op: "gte", value: "10" },
        { field: "score", op: "lte", value: "20", and: true },
      ] },
    ] },
  };
  const response = async () => new Response(JSON.stringify(rows), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "" }, URLSearchParams, TextDecoder, TextEncoder,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: response, console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const browser = await sandbox.window.__pageDataReady;
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData, listItemsWithOps } = await import(uri);
  const server = await loadPageData(plan, "", response);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.items)), rows);
  assert.deepEqual(JSON.parse(JSON.stringify(server.items)), rows);
  for (const shown of [sandbox.window.__pageListRows(browser.items, "items", browser),
    listItemsWithOps(plan.listOps, server, "items", 0)]) {
    assert.deepEqual(JSON.parse(JSON.stringify(shown)), [rows[1], rows[3]]);
  }
});
});

describe("script-field-index", () => {
function node(id: string, attrId: string, field?: FieldContent): DocNode {
  return {
    ...makeBox(),
    id,
    attrId,
    ...(field ? { type: "field" as const, field } : {}),
  };
}

test("field index preserves first matching IDs and select choices", () => {
  const nodes = {
    box: node("box", "duplicate"),
    duplicate: node("duplicate", "duplicate", { kind: "select", options: ["ignored"].map(value => ({label:value,value})) }),
    select: node("select", "choice", { kind: "select", options: ["First", "", "Second"].map(value => ({label:value,value})) }),
  };
  const tree = [{ id: "box" }, { id: "duplicate" }, { id: "select" }];
  const indexed = indexFieldTargets({ nodes }, tree);

  assert.equal(indexed.byAttr.get("duplicate"), null);
  assert.deepEqual(indexed.byAttr.get("choice"), {
    kind: "select", bool: false, choices: ["First", "Second"],
  });
  assert.equal(indexed.byAttr.get("missing"), undefined);
});

test("field index distinguishes radio items from groups and deduplicates labels", () => {
  const nodes = {
    group: node("group", "fruit", { kind: "radio", group: "fruit", label: "Apple" }),
    item: node("item", "apple-button", { kind: "radio", group: "fruit", label: "Banana" }),
    duplicateLabel: node("duplicateLabel", "banana-button", { kind: "radio", group: "fruit", label: "Banana" }),
    checkbox: node("checkbox", "agree", { kind: "checkbox" }),
  };
  const indexed = indexFieldTargets({ nodes }, Object.keys(nodes).map((id) => ({ id })));

  assert.deepEqual(indexed.byAttr.get("fruit"), {
    kind: "radio", bool: false, choices: ["Apple", "Banana"],
  });
  assert.deepEqual(indexed.byNode.get("item"), {
    kind: "radio", bool: true, choices: [],
  });
  assert.deepEqual(indexed.byAttr.get("agree"), {
    kind: "checkbox", bool: true, choices: [],
  });
});
});

describe("script-file-value", () => {
/** DOM の正規化は真似せず、ランタイムから setter・プレビューの状態・通知への呼び出しだけを記録する。 */
function runAssignment(initial: string, value: string, preview: boolean, type = "file") {
  const script = { id: "load", trigger: "load" as const, steps: [{ id: "set", kind: "set-value" as const, target: "upload", value }] };
  const doc: SiteDoc = {
    siteName: "File assignment", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["start"] } },
    nodes: { start: { ...makeBox(), id: "start", scripts: [script] } },
  };
  const writes: string[] = [], events: string[] = [], patches: [string, string][] = [];
  const timers: Function[] = [];
  let current = initial;
  const input = {
    id: "upload", type, matches: () => true, closest: () => null,
    get value() { return current; },
    set value(v: string) { writes.push(v); current = v; },
    dispatchEvent: (event: Event) => events.push(event.type),
  };
  const start = { getAttribute: () => JSON.stringify([script]), closest: () => null };
  const root = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" ? [start] : selector === "#upload" ? [input] : [],
    addEventListener() {}, removeEventListener() {}, contains: () => true,
  };
  runInNewContext(preview ? `(${SCRIPT_RUNTIME})(env).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (s: string) => s }, Event,
    env: { setValue: (id: string, v: string) => { patches.push([id, v]); return true; } },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame() {}, setTimeout: (fn: Function) => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  return { current, writes, events, patches, timers: timers.length };
}

for (const preview of [true, false]) {
  const context = preview ? "preview" : "exported";
  test(`${context} nonempty file assignments do not change values, notify, or write preview state`, () => {
    for (const initial of ["", "C:\\fakepath\\selected.txt"]) {
      for (const value of ["photo.png", " ", "false"]) {
        assert.deepEqual(runAssignment(initial, value, preview), { current: initial, writes: [], events: [], patches: [], timers: 0 });
      }
    }
  });

  test(`${context} file clearing still writes an empty value only when needed`, () => {
    assert.deepEqual(runAssignment("", "", preview), { current: "", writes: [], events: [], patches: [], timers: 0 });
    assert.deepEqual(runAssignment("C:\\fakepath\\selected.txt", "", preview), {
      current: "", writes: [""], events: preview ? [] : ["input", "change"],
      patches: preview ? [["upload", ""]] : [], timers: preview ? 1 : 0,
    });
  });

  test(`${context} ordinary text assignment is unchanged`, () => {
    assert.deepEqual(runAssignment("", "Ada", preview, "text"), {
      current: "Ada", writes: ["Ada"], events: preview ? [] : ["input", "change"],
      patches: preview ? [["upload", "Ada"]] : [], timers: preview ? 1 : 0,
    });
  });
}
});

describe("script-flow", () => {
const wait = (id: string): ScriptStep => ({ id, kind: "wait", seconds: 1 });
const script = (): PageScript => ({
  id: "s", trigger: "click", nodeId: "button",
  steps: [
    wait("a"),
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "{x}", op: "eq", value: "1" }, then: [wait("b"), wait("c")], else: [] },
    { id: "loop", kind: "repeat", times: 2, then: [wait("d")] },
    wait("e"),
  ],
});
const ids = (steps: ScriptStep[]): unknown[] => steps.map((step) =>
  "then" in step ? [step.id, ids(step.then), ...(step.kind === "if" && step.else ? [ids(step.else)] : [])] : step.id);

test("moving a step keeps the rest in order and can cross into a branch", () => {
  const scripts = [script()];
  const from = findStepLoc(scripts[0], "e")!;
  const moved = moveSteps(scripts, from, new Set(["e"]), { list: "if:then", beforeId: "c" });
  assert.deepEqual(ids(moved[0].steps), ["a", ["if", ["b", "e", "c"], []], ["loop", ["d"]]]);
  const intoEmptyElse = moveSteps(scripts, from, new Set(["e"]), { list: "if:else", beforeId: null });
  assert.deepEqual(ids(intoEmptyElse[0].steps), ["a", ["if", ["b", "c"], ["e"]], ["loop", ["d"]]]);
  assert.deepEqual(ids(scripts[0].steps), ["a", ["if", ["b", "c"], []], ["loop", ["d"]], "e"], "the source is not mutated");
});

test("a drop that changes nothing returns the same array, so no history entry is made", () => {
  const scripts = [script()];
  const from = findStepLoc(scripts[0], "a")!;
  assert.equal(moveSteps(scripts, from, new Set(["a"]), { list: "root", beforeId: "if" }), scripts);
  const last = findStepLoc(scripts[0], "e")!;
  assert.equal(moveSteps(scripts, last, new Set(["e"]), { list: "root", beforeId: null }), scripts);
});

test("a container cannot be dropped inside itself", () => {
  const scripts = [script()];
  const from = findStepLoc(scripts[0], "if")!;
  assert.equal(moveSteps(scripts, from, new Set(["if"]), { list: "if:then", beforeId: null }), scripts);
});

test("several selected steps move together and keep their relative order", () => {
  const scripts = [script()];
  const from = findStepLoc(scripts[0], "a")!;
  const moved = moveSteps(scripts, from, new Set(["a", "e"]), { list: "loop:then", beforeId: null });
  assert.deepEqual(ids(moved[0].steps), [["if", ["b", "c"], []], ["loop", ["d", "a", "e"]]]);
});

test("keyboard reordering moves one position within the same list and stops at the ends", () => {
  const scripts = [script()];
  const down = nudgeStep(scripts, findStepLoc(scripts[0], "a")!, 1);
  assert.deepEqual(ids(down[0].steps).slice(0, 2), [["if", ["b", "c"], []], "a"]);
  assert.equal(nudgeStep(scripts, findStepLoc(scripts[0], "a")!, -1), scripts);
  assert.equal(nudgeStep(scripts, findStepLoc(scripts[0], "d")!, 1), scripts);
});

test("only lists inside a repeat accept the action that stops repeating", () => {
  const item = script();
  assert.equal(listInsideLoop(item, "root"), false);
  assert.equal(listInsideLoop(item, "if:then"), false);
  assert.equal(listInsideLoop(item, "loop:then"), true);
});

test("unfinished actions are reported with what to do next, and finished ones are not", () => {
  assert.ok(stepIssue({ id: "x", kind: "show", target: "" }));
  assert.equal(stepIssue({ id: "x", kind: "show", target: "menu" }), null);
  assert.ok(stepIssue({ id: "x", kind: "open-page", pageId: "" }));
  assert.ok(stepIssue({ id: "x", kind: "set-var", into: "", value: "1" }));
  assert.equal(stepIssue(wait("x")), null);
  assert.equal(scriptStatus({ id: "s", trigger: "load", nodeId: PAGE_TARGET, steps: [] }).ready, false);
  assert.equal(scriptStatus({ id: "s", trigger: "load", nodeId: PAGE_TARGET, steps: [wait("x")] }).ready, true);
  const pending = scriptStatus({ id: "s", trigger: "click", nodeId: "b", steps: [wait("x"), { id: "y", kind: "hide", target: "" }] });
  assert.deepEqual([pending.ready, pending.pending], [false, 1]);
});

test("pasted actions get new IDs and land after the selection, or at the end of the open script", () => {
  const scripts = [script()];
  const copied = copyScriptBlocks(scripts, ["step:if"])!;
  assert.deepEqual(ids(copied.steps), [["if", ["b", "c"], []]]);
  const afterA = pasteScriptBlocks(scripts, ["step:a"], copied, "s")!;
  assert.equal(afterA.scripts[0].steps.length, 5);
  assert.equal(afterA.scripts[0].steps[1].kind, "if");
  assert.notEqual(afterA.scripts[0].steps[1].id, "if");
  const atEnd = pasteScriptBlocks(scripts, [], copied, "s")!;
  assert.equal(atEnd.scripts[0].steps.at(-1)!.kind, "if");
  assert.equal(pasteScriptBlocks(scripts, [], copied, null), null, "nothing is open, so there is nowhere to paste");
});


test("script operations never modify a second script with the same action IDs", () => {
  const first = { ...script(), id: "first", steps: [wait("shared"), wait("first-only")] };
  const second = { ...script(), id: "second", steps: [wait("shared"), wait("second-only")] };
  const originals = [first, second];

  const copied = copyScriptBlocks(originals, ["step:shared"], "first")!;
  assert.equal(copied.steps.length, 1);
  assert.equal(copied.steps[0].id, "shared");

  const removed = removeKeys(originals, ["step:shared"], "first");
  assert.deepEqual(removed[0].steps.map((step) => step.id), ["first-only"]);
  assert.equal(removed[1], second);

  const modified = mapStep(originals, "shared", () => ({ id: "shared", kind: "wait", seconds: 7 }), "first");
  assert.equal(modified[0].steps[0].kind === "wait" && modified[0].steps[0].seconds, 7);
  assert.equal(modified[1], second);

  const moved = moveSteps(originals, { scriptId: "first", list: "root", index: 0 },
    new Set(["shared"]), { list: "root", beforeId: null });
  assert.deepEqual(moved[0].steps.map((step) => step.id), ["first-only", "shared"]);
  assert.equal(moved[1], second);

  const pasted = pasteScriptBlocks(originals, ["step:shared"], copied, "first")!;
  assert.equal(pasted.scripts[0].steps.length, 3);
  assert.equal(pasted.scripts[1], second);
  assert.deepEqual(originals[0], first);
});

test("pasting uses document order even when actions were selected in reverse order", () => {
  const scripts = [script()];
  const copied = copyScriptBlocks(scripts, ["step:a"])!;
  const result = pasteScriptBlocks(scripts, ["step:e", "step:a"], copied, "s")!;
  assert.equal(result.scripts[0].steps.at(-1)?.kind, "wait");
  assert.equal(result.selection.length, 1);
  assert.equal(result.scripts[0].steps.at(-1)?.id, result.selection[0].slice(5));
  assert.notEqual(result.scripts[0].steps.at(-1)?.id, "a");
});

test("pasting after a selected parent stays outside its nested branch", () => {
  const scripts = [script()];
  const copied = copyScriptBlocks(scripts, ["step:a"])!;
  const result = pasteScriptBlocks(scripts, ["step:if", "step:c"], copied, "s")!;
  assert.equal(result.scripts[0].steps[2].id, result.selection[0].slice(5));
  assert.deepEqual(ids(scripts[0].steps), ["a", ["if", ["b", "c"], []], ["loop", ["d"]], "e"]);
});

test("pasting does not use a selection from another script", () => {
  const scripts = [script(), { ...script(), id: "other", steps: [wait("only")] }];
  const copied = copyScriptBlocks(scripts, ["step:a"])!;
  const result = pasteScriptBlocks(scripts, ["step:e"], copied, "other")!;
  assert.deepEqual(ids(result.scripts[0].steps), ids(scripts[0].steps));
  assert.equal(result.scripts[1].steps.length, 2);
  assert.equal(result.scripts[1].steps[1].id, result.selection[0].slice(5));
});

test("external script clipboard records must have valid nested structure", () => {
  const copied = copyScriptBlocks([script()], ["step:if"])!;
  assert.equal(isScriptBlockClipboard(JSON.parse(JSON.stringify(copied))), true);
  assert.equal(isScriptBlockClipboard({ ...copied, steps: [{ id: "bad", kind: "if" }] }), false);
  assert.equal(isScriptBlockClipboard({ ...copied, scripts: [{ id: "bad", steps: [] }] }), false);
  assert.equal(isScriptBlockClipboard({ ...copied, v: 2 }), false);
  assert.equal(isScriptBlockClipboard({ v: 1, scripts: [], steps: [] }), false);
  assert.equal(isScriptBlockClipboard({ v: 1, scripts: [], steps: [{ id: "a", kind: "if", then: [{ id: "b", kind: "wait", then: [] }] }] }), false);
});

test("unconfigured script steps keep their empty fields when copied and pasted", () => {
  const source = script();
  source.steps = [
    { id: "unset-copy", kind: "copy", value: "" },
    { id: "unset-show", kind: "show", target: "" },
    { id: "unset-if", kind: "if",
      cond: { subject: "value", target: "", op: "eq", value: "" },
      then: [{ id: "unset-page", kind: "open-page", pageId: "" }] },
  ];
  const scripts = [source];
  const clip = copyScriptBlocks(scripts, ["step:unset-copy", "step:unset-show", "step:unset-if"])!;
  assert.ok(isScriptBlockClipboard(JSON.parse(JSON.stringify(clip))));
  const pasted = pasteScriptBlocks(scripts, ["step:unset-if"], clip, source.id)!;
  assert.equal(pasted.selection.length, 3);
  assert.equal(pasted.scripts[0].steps.length, 6);
  assert.deepEqual(pasted.scripts[0].steps.slice(3).map((step) => step.kind),
    ["copy", "show", "if"]);
  const [copy, show, conditional] = pasted.scripts[0].steps.slice(3);
  assert.equal(copy.kind === "copy" && copy.value, "");
  assert.equal(show.kind === "show" && show.target, "");
  assert.equal(conditional.kind === "if" && conditional.then[0]?.kind === "open-page" &&
    conditional.then[0].pageId, "");
  assert.ok(pasted.scripts[0].steps.every((step, i, all) => all.findIndex((item) => item.id === step.id) === i));
});

test("scripts are stored on their trigger element or on the page, without layout data", () => {
  const pageId = "home";
  const doc = {
    siteName: "Test",
    pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["button"] } },
    pageOrder: ["home"],
    nodes: { button: { ...makeBox(), id: "button" } },
  } as unknown as SiteDoc;
  const views: PageScript[] = [
    { id: "load", trigger: "load", nodeId: PAGE_TARGET, steps: [wait("w")] },
    { id: "hide", trigger: "click", nodeId: "button", steps: [{ id: "h", kind: "hide", target: "x" }] },
    { id: "gone", trigger: "click", nodeId: "missing", steps: [wait("z")] },
  ];
  const next = withPageScripts(doc, pageId, ["button"], views);
  assert.deepEqual(next.pages[pageId].pageScripts, [{ id: "load", trigger: "load", steps: [wait("w")] }]);
  assert.deepEqual(next.nodes.button.scripts, [{ id: "hide", trigger: "click", steps: [{ id: "h", kind: "hide", target: "x" }] }]);
  assert.deepEqual(pageScriptsOf(next, ["button"], pageId).map((item) => [item.id, item.nodeId]),
    [["load", PAGE_TARGET], ["hide", "button"]], "the page's scripts come first, then elements in page order");
  // 「クリックしたとき → 開く」だけのスクリプトは、ボックスではリンクとして保存する
  const linked = withPageScripts(doc, pageId, ["button"], [
    { id: "open", trigger: "click", nodeId: "button", steps: [{ id: "o", kind: "open-url", url: "https://example.com" }] },
  ]);
  assert.deepEqual(linked.nodes.button.link, { kind: "url", url: "https://example.com", newTab: false });
  assert.equal(linked.nodes.button.scripts, undefined);
});
});

describe("script-hover-cancellation", () => {
const hide: ScriptStep = { id: "hide", kind: "hide", target: "banner" };
function mount(generated: boolean) {
  const steps = [hide];
  const scripts = [{ trigger: "hover-end", keep: true, steps }];
  const doc: SiteDoc = {
    siteName: "Hover cancellation", assets: {}, pageOrder: ["a", "b"],
    pages: {
      a: { id: "a", name: "A", slug: "", title: "", description: "", children: ["node"] },
      b: { id: "b", name: "B", slug: "b", title: "", description: "", children: [] },
    },
    nodes: { node: { ...makeBox(), id: "node", scripts: [{
      id: "hover", trigger: "hover-end", keepOnShown: true, steps,
    }] } },
  };
  let pageId = "a";
  let display = "";
  const target = { style: { get display() { return display; }, set display(s: string) { display = s; } }, matches: () => false };
  const element = {
    nodeType: 1, parentElement: null,
    getAttribute: () => JSON.stringify(scripts),
    closest: (selector: string): unknown => selector === "[data-scripts]" ? element : null,
    matches: () => false,
  };
  const events = new Map<string, (event: unknown) => void>();
  let observer: () => void = () => {};
  const frames: Array<() => void> = [];
  const timers = new Map<number, () => void>();
  let seq = 0;
  const marker = { getAttribute: () => pageId };
  const document = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]"
      ? pageId === "a" ? [element] : [] : selector === "#banner" ? [target] : [],
    contains: (value: unknown) => value !== element || pageId === "a",
    addEventListener: (name: string, listener: (event: unknown) => void) => events.set(name, listener),
    removeEventListener: () => {},
  };
  const globals = {
    document, CSS: { escape: (name: string) => name },
    MutationObserver: class { constructor(fn: () => void) { observer = fn; } observe() {} disconnect() {} },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    setTimeout: (fn: () => void) => { timers.set(++seq, fn); return seq; },
    clearTimeout: (id: number) => timers.delete(id),
  };
  runInNewContext(generated ? scriptsFile(doc) : `(${SCRIPT_RUNTIME})({}).install(document);`, globals);
  return {
    beginHoverExit() {
      events.get("mouseover")!({ target: element, relatedTarget: null });
      events.get("mouseout")!({ target: element, relatedTarget: null });
    },
    navigate() { pageId = "b"; observer(); while (frames.length) frames.shift()!(); },
    changePageWithoutScan() { pageId = "b"; },
    get pending() { return timers.size; },
    tick() { const timer = timers.entries().next().value; if (timer) { timers.delete(timer[0]); timer[1](); } },
    get display() { return display; },
  };
}

for (const generated of [false, true]) {
  test(`${generated ? "published" : "preview"} hover-end cannot run after its element was removed by navigation`, () => {
    const h = mount(generated);
    h.beginHoverExit();
    assert.equal(h.pending, 1);
    h.changePageWithoutScan();
    h.tick();
    assert.equal(h.display, "", "the old page's hover-end must not mutate the new page");
  });
}

test("hover exit timeouts are cleared immediately after a preview page transition", () => {
  const h = mount(false);
  h.beginHoverExit();
  assert.equal(h.pending, 1);
  h.navigate();
  assert.equal(h.pending, 0);
  assert.equal(h.display, "");
});
});

describe("script-input-value", () => {
/** setter の結果は外から渡す。DOM の正規化そのものは、ネイティブの e2e で検証する。 */
function assignments(preview: boolean, initial: string, requested: string[], accepted: string[]) {
  const doc = scriptInputValueDoc({ kind: "input", inputType: "number", defaultValue: initial }, "", "");
  const script = { id: "load", trigger: "load", steps: requested.map((value, i) => ({ id: `set-${i}`, kind: "set-value", target: "entry", value })) };
  doc.nodes.entry.scripts = [script as any];
  doc.pages.home.children = ["entry"];
  doc.pages.home.pageScripts = undefined;
  const writes: string[] = [], events: string[] = [], patches: string[] = [], timers: Function[] = [];
  let current = initial;
  const input = {
    id: "entry", tagName: "INPUT", type: "number", matches: () => true, closest: () => null,
    getAttribute: (key: string) => key === "data-scripts" ? JSON.stringify([script]) : null,
    get value() { return current; },
    set value(v: string) { current = accepted[writes.length]; writes.push(v); },
    dispatchEvent: (e: Event) => events.push(e.type),
  };
  const root = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" || selector === "#entry" ? [input] : [],
    addEventListener() {}, removeEventListener() {}, contains: () => true,
  };
  runInNewContext(preview ? `(${SCRIPT_RUNTIME})(env).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (v: string) => v }, Event,
    env: { setValue: (_id: string, value: string) => { patches.push(value); return true; } },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {},
    setTimeout: (fn: Function) => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  return { current, writes, events, patches, timers: timers.length };
}

for (const preview of [true, false]) {
  const label = preview ? "preview" : "exported";
  test(`${label}: assignments notify only effective native value changes`, () => {
    const result = assignments(preview, "12", ["invalid", "invalid", "different-invalid", "8", "8"], ["", "", "", "8"]);
    assert.deepEqual(result, {
      current: "8", writes: ["invalid", "invalid", "different-invalid", "8"],
      events: preview ? [] : ["input", "change", "input", "change"],
      patches: preview ? ["", "8"] : [], timers: preview ? 2 : 0,
    });
  });
  test(`${label}: normalization can retain the prior value without notifying`, () => {
    assert.deepEqual(assignments(preview, "20", ["99", "999"], ["20", "20"]), {
      current: "20", writes: ["99", "999"], events: [], patches: [], timers: 0,
    });
  });
  test(`${label}: normalized values are forwarded rather than requested values`, () => {
    assert.deepEqual(assignments(preview, "10", ["99", "14"], ["20", "15"]), {
      current: "15", writes: ["99", "14"],
      events: preview ? [] : ["input", "change", "input", "change"],
      patches: preview ? ["20", "15"] : [], timers: preview ? 2 : 0,
    });
  });
}

test("generated number input includes its assignment scripts", async () => {
  const doc = scriptInputValueDoc({ kind: "input", inputType: "number", defaultValue: "12" }, "invalid", "8");
  const { html } = await publishedScriptInputValue(doc);
  assert.match(html, /type="number"/);
  assert.match(html, /data-scripts=/);
});

for (const kind of ["input", "textarea"] as const) {
  test(`${kind}: Canvas records native input in capture phase before change scripts can rerender it`, () => {
    const doc = scriptInputValueDoc({ kind, defaultValue: "before" }, "assigned", "restored");
    const values = { entry: "before" };
    const render = (interactive = true) => renderLeafNode(doc.nodes.entry, {}, {
      interactive, fieldValues: values,
      onField: (name, value) => { values[name as "entry"] = value; },
    }) as any;
    const leaf = render();
    assert.equal(typeof leaf.props.onInputCapture, "function");
    leaf.props.onInputCapture({ currentTarget: { value: "typed" } });
    // スクリプトによる再描画が bubble の onChange より前でも、入力値を保つ。
    assert.equal(render().props.value, "typed");
    leaf.props.onChange({ target: { value: "typed" } });
    assert.equal(render().props.value, "typed");
    assert.equal(render(false).props.onInputCapture, undefined);
    assert.equal(doc.nodes.entry.field!.defaultValue, "before");
  });
}
});

describe("script-malformed-runtime", () => {
function mount(raw: string) {
  let currentRaw = raw;
  const maps: Map<unknown, unknown>[] = [];
  class TrackedMap<K, V> extends Map<K, V> {
    constructor(...args: ConstructorParameters<typeof Map<K, V>>) {
      super(...args);
      maps.push(this);
    }
  }
  const target = { style: { display: "" }, matches: () => false };
  const element = {
    nodeType: 1, parentElement: null,
    getAttribute: () => currentRaw,
    closest: (selector: string): unknown => selector === "[data-scripts]" ? element : null,
  };
  const listeners = new Map<string, (event: any) => void>();
  const marker = { getAttribute: () => "p" };
  const document = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]"
      ? [element] : selector === "#banner" ? [target] : [],
    contains: () => true,
    addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn),
    removeEventListener: () => {},
  };
  const globals = {
    document, Map: TrackedMap, CSS: { escape: (name: string) => name },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    setTimeout, clearTimeout,
  };
  runInNewContext(`(${SCRIPT_RUNTIME})({}).install(document);`, globals);
  return {
    click: () => listeners.get("click")!({ target: element }),
    setScript: (next: string) => { currentRaw = next; },
    get parsedCache() { return maps[0] as Map<string, unknown>; },
    target,
  };
}

test("unexpected JSON data-scripts shapes do not crash the runtime scanner", () => {
  for (const raw of ["null", "{}", "42", '"text"', '{"trigger":"click","steps":[]}',
      '[null,3,{"trigger":"click","steps":null}]']) {
    assert.doesNotThrow(() => mount(raw), raw);
  }
});

test("corrupt steps and conditions are skipped without losing later valid actions", () => {
  const steps = [
    null, false, 123,
    { kind: "if", cond: null, then: [{ kind: "hide", target: "banner" }] },
    { kind: "transform", source: "x", into: "x" },
    { kind: "set-var", into: 99, value: "malformed" },
    { kind: "list-display", mode: "filter", array: "rows", conds: [null] },
    { kind: "hide", target: "banner" },
  ];
  const h = mount(JSON.stringify([{ trigger: "click", steps }]));
  assert.doesNotThrow(() => h.click());
  assert.equal(h.target.style.display, "none");
});

test("malformed variable references and non-coercible values cannot abort later steps", () => {
  const brokenText = { toString: null };
  const steps = [
    { kind: "set-var", into: "fromRef", rawRef: { name: 42 } },
    { kind: "set-var", into: "missingRef", rawRef: { fallback: "x" } },
    { kind: "set-var", into: "fromParts", value: { scriptParts: [null, { name: false }] } },
    { kind: "set-var", into: "broken", value: brokenText },
    { kind: "set-value", target: "absent", value: brokenText },
    { kind: "open-url", url: brokenText },
    { kind: "wait", seconds: brokenText },
    { kind: "repeat", times: brokenText, then: [{ kind: "hide", target: "banner" }] },
    { kind: "if", cond: { subject: "var", left: brokenText, op: "eq", value: "x" }, then: [{ kind: "hide", target: "banner" }] },
    { kind: "if", cond: { subject: "visible", target: brokenText }, then: [{ kind: "hide", target: "banner" }] },
    { kind: "hide", target: "banner" },
  ];
  const h = mount(JSON.stringify([{ trigger: "click", steps }]));
  assert.doesNotThrow(() => h.click());
  assert.equal(h.target.style.display, "none");
});

test("parsed script cache remains bounded while live script attributes change", () => {
  const h = mount(JSON.stringify([{ trigger: "click", steps: [] }]));
  for (let i = 0; i < 400; i++) {
    h.setScript(JSON.stringify([{ id: `edition-${i}`, trigger: "click",
      steps: [{ kind: "hide", target: "banner" }] }]));
    h.click();
  }
  assert.ok(h.parsedCache.size <= 256, "old script revisions must be evicted");
  h.target.style.display = "";
  h.click();
  assert.equal(h.target.style.display, "none", "the most recent script is still runnable");
  const latest = [...h.parsedCache.keys()].at(-1)!;
  assert.match(latest, /edition-399/, "the active script should be retained");
});
});

describe("script-preview-change-lifecycle", () => {
const changeSteps: ScriptStep[] = [{ id: "hide", kind: "hide", target: "banner" }];
const clickSteps: ScriptStep[] = [{ id: "set", kind: "set-value", target: "field", value: "changed" }];

function harness() {
  let pageId = "a";
  let display = "";
  let clock = 0;
  const pending = new Map<number, () => void>();
  const listeners = new Map<string, (event: { target: unknown }) => void>();
  const source = {
    nodeType: 1, parentElement: null,
    getAttribute: () => JSON.stringify([{ trigger: "click", steps: clickSteps }]),
    closest: (selector: string): unknown => selector === "[data-scripts]" ? source : null,
    matches: () => false,
  };
  const field = {
    nodeType: 1, parentElement: null,
    type: "text", tagName: "INPUT", value: "initial", name: "", checked: false,
    getAttribute: () => JSON.stringify([{ trigger: "change", steps: changeSteps }]),
    closest: (selector: string): unknown => selector === "[data-scripts]" ? field : null,
    matches: (selector: string) => selector === "input,select,textarea",
  };
  const banner = {
    style: {
      get display() { return display; },
      set display(v: string) { display = v; },
    },
    matches: () => false,
  };
  const marker = { getAttribute: () => pageId };
  const root = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) =>
      selector === "[data-scripts]" ? [source, field] :
        selector === "#field" ? [field] :
          selector === "#banner" ? [banner] : [],
    contains: () => true,
    addEventListener: (name: string, fn: (event: { target: unknown }) => void, capture = false) =>
      listeners.set(name + ":" + capture, fn),
    removeEventListener: () => {},
  };
  const globals = {
    document: root, window: {}, CSS: { escape: (name: string) => name },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    setTimeout: (fn: () => void) => { pending.set(++clock, fn); return clock; },
    clearTimeout: (id: number) => pending.delete(id),
  };
  const dispose = runInNewContext(
    "(" + SCRIPT_RUNTIME + ")({ setValue: function () { return true; } }).install(document);",
    globals
  ) as () => void;
  return {
    click() { listeners.get("click:false")!({ target: source }); },
    navigate(id: string) { pageId = id; },
    tick() {
      const task = pending.entries().next().value;
      if (task) { pending.delete(task[0]); task[1](); }
    },
    pending: () => pending.size,
    get display() { return display; },
    dispose,
  };
}

test("preview ignores delayed change notifications from the previous page", () => {
  const h = harness();
  h.click();
  assert.equal(h.pending(), 1);
  h.navigate("b");
  h.tick();
  assert.equal(h.display, "", "old input scripts must not hide the next page's target");
  h.dispose();
});

test("preview still dispatches delayed changes on the original page", () => {
  const h = harness();
  h.click();
  assert.equal(h.pending(), 1);
  h.tick();
  assert.equal(h.display, "none", "change handlers remain usable on the same page");
  h.dispose();
});
});

describe("script-runtime-budget", () => {
const hide: ScriptStep = { id: "hide", kind: "hide", target: "banner" };

function mount(steps: ScriptStep[], generated: boolean) {
  const doc: SiteDoc = {
    siteName: "Runtime budget", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Page", slug: "", title: "", description: "", children: ["node"] } },
    nodes: { node: { ...makeBox(), id: "node", scripts: [
      { id: "script", trigger: "click", steps },
    ] } },
  };
  let writes = 0;
  let display = "";
  const target = {
    matches: () => false,
    style: {
      get display() { return display; },
      set display(value: string) { writes++; display = value; },
    },
  };
  const events = new Map<string, (event: unknown) => void>();
  const element = {
    nodeType: 1, parentElement: null,
    getAttribute: () => JSON.stringify([{ trigger: "click", steps }]),
    closest: (selector: string) => selector === "[data-scripts]" ? element : null,
  };
  const page = { getAttribute: () => "p" };
  const document = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? page : null,
    querySelectorAll: (selector: string) =>
      selector === "[data-scripts]" ? [element] : selector === "#banner" ? [target] : [],
    contains: () => true,
    addEventListener: (name: string, listener: (event: unknown) => void) => events.set(name, listener),
    removeEventListener: () => {},
  };
  const globals = {
    document, CSS: { escape: (name: string) => name },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    setTimeout, clearTimeout,
  };
  runInNewContext(generated ? scriptsFile(doc) : `(${SCRIPT_RUNTIME})({}).install(document);`, globals);
  return {
    click() { events.get("click")!({ target: element }); },
    get writes() { return writes; },
    get display() { return display; },
  };
}

for (const generated of [false, true]) {
  const variant = generated ? "published" : "preview";
  test(`${variant} runtime bounds deeply nested conditional scripts`, async () => {
    let steps: ScriptStep[] = [hide];
    for (let i = 0; i < 256; i++) {
      steps = [{
        id: `if-${i}`, kind: "if",
        cond: { subject: "var", target: "", left: "true", op: "eq", value: "true" },
        then: steps,
      }];
    }
    const h = mount(steps, generated);
    h.click();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(h.writes, 0, "nested scripts must stop beyond the runtime depth budget");
  });

  test(`${variant} runtime bounds high-volume finite loop work per event`, async () => {
    const steps: ScriptStep[] = [{
      id: "outer", kind: "repeat", times: 30,
      then: [{ id: "inner", kind: "repeat", times: 1000, then: [hide] }],
    }];
    const h = mount(steps, generated);
    h.click();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(h.writes > 0, "the script should still execute valid steps");
    assert.ok(h.writes <= 20_000, `event exceeded execution budget: ${h.writes} writes`);
  });
}
});

describe("script-runtime-reentrancy", () => {
function script(trigger: Script["trigger"], steps: ScriptStep[]): Script {
  return { id: trigger, trigger, steps };
}

const assignments: ScriptStep[] = [
  { id: "a", kind: "set-value", target: "field", value: "a" },
  { id: "b", kind: "set-value", target: "field", value: "b" },
];

function mount(scripts: Script[], mode: "published" | "preview" | "preview form") {
  const doc: SiteDoc = {
    siteName: "Script input", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["node"] } },
    nodes: { node: { ...makeBox(), id: "node", scripts } },
  };
  const listeners = new Map<string, Array<(event: any) => void>>();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let dispatches = 0;
  let previewWrites = 0;
  const input = {
    nodeType: 1, tagName: "INPUT", type: "text", name: "", disabled: false,
    value: "initial", checked: false, parentElement: null,
    matches: (selector: string) => selector === "input,select,textarea",
    closest: (selector: string): unknown => selector === "[data-scripts]" ? input : null,
    getAttribute: () => JSON.stringify(scripts),
    dispatchEvent: (event: { type: string }) => {
      if (++dispatches > 20) throw new Error("recursive change event loop");
      emit(event.type, false);
    },
  };
  const marker = {
    getAttribute: (name: string) => name === "data-page-body" ? "p" : null,
  };
  const queries: string[] = [];
  const document = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) => {
      queries.push(selector);
      return selector === "[data-scripts]" || selector === "#field" ? [input] : [];
    },
    contains: () => true,
    addEventListener: (name: string, fn: (event: any) => void) =>
      listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    removeEventListener: () => {},
  };
  function emit(type: string, isTrusted: boolean) {
    for (const listener of listeners.get(type) ?? []) listener({ target: input, isTrusted });
  }
  const env = mode === "preview form" ? { setValue: () => { previewWrites++; return true; } } : {};
  runInNewContext(mode === "published" ? scriptsFile(doc) : `(${SCRIPT_RUNTIME})(env).install(document);`, {
    document, window: {}, env, CSS: { escape: (name: string) => name },
    Event: class { constructor(public type: string) {} },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  return {
    input, queries,
    get writes() { return mode === "preview form" ? previewWrites : dispatches / 2; },
    get pending() { return timers.size; },
    change: () => emit("input", true),
    click: () => emit("click", true),
    async tick() {
      const current = Array.from(timers.entries());
      for (const [id, fn] of current) { timers.delete(id); fn(); }
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

for (const mode of ["preview", "preview form", "published"] as const) {
  test(`${mode} change handler does not recursively trigger itself through set-value`, async () => {
    const h = mount([script("change", assignments)], mode);
    h.change();
    await h.tick();
    assert.equal(h.input.value, "b");
    assert.equal(h.writes, 2, "only the two intentional changes may send notifications");
    assert.equal(h.pending, 0);
  });

  test(`${mode} changes after waits keep their causal chain while independent inputs still run`, async () => {
    const h = mount([script("change", [{ id: "wait", kind: "wait", seconds: 0 }, ...assignments])], mode);
    h.change();
    h.change();
    assert.equal(h.pending, 2, "both independent inputs can start while waiting");
    await h.tick();
    await h.tick();
    assert.equal(h.writes, 4);
    assert.equal(h.pending, 0, "the delayed actions must not start the same change handler again");
  });

  test(`${mode} form changes triggered by the initial load reach their change handler`, async () => {
    const h = mount([
      script("load", [assignments[0]]), script("change", [assignments[1]]),
    ], mode);
    await h.tick();
    await h.tick();
    assert.equal(h.input.value, "b");
    assert.equal(h.writes, 2);
    assert.equal(h.pending, 0);
  });
}

test("published variable-only scripts do not query the document for absent live bindings", () => {
  const h = mount([script("click", [{ id: "write", kind: "set-var", into: "count", value: "1" }])], "published");
  h.click();
  assert.equal(h.queries.some((query) => query.startsWith("[data-live")), false);
});
});

describe("script-select-value", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
/** 実際の Canvas のデータのフックの状態と変数を読む。DOM の選択とイベントは、ネイティブの e2e で確かめる。 */
function canvasData(doc = scriptSelectValueDoc()) {
  const slots: any[] = [];
  let cursor = 0;
  const hooks = { ...React,
    useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn, useEffect() {},
    useRef: (value: unknown) => ({ current: value }),
    useState(initial: unknown) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial;
      return [slots[at], (next: any) => { slots[at] = typeof next === "function" ? next(slots[at]) : next; }];
    },
  };
  const file = resolve("components/canvas/useCanvasData.ts");
  const require = createRequire(file), mod = { exports: {} as any };
  const code = transformSync(readFileSync(file, "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => id === "react" ? hooks : id === "../../lib/store" ? { useEditor: Object.assign((pick: any) => pick(useEditor.getState()), useEditor) } : require(id), mod, mod.exports);
  return () => {
    cursor = 0;
    return mod.exports.useCanvasData({ doc, page: doc.pages.home, activePageId: "home", previewIndex: 0, mode: "preview", setPreviewIndex() {} });
  };
}

for (const [name, options, requested, expected, index] of [
  ["absent option", ["A", "B"], "C", null, "0"],
  ["empty assignment without an empty option", ["A", "B"], "", null, "0"],
  ["valid option", ["A", "B"], "A", "A", "1"],
  ["actual empty option", ["A", "{empty}", "B"], "", "", "2"],
  ["missing beside an empty option", ["A", "{empty}", "B"], "C", null, "0"],
  ["no options", [], "C", null, "0"],
] as const) test(`script select assignment: ${name}`, () => {
  const doc = scriptSelectValueDoc([...options]);
  useEditor.getState().replaceDoc(doc);
  const before = structuredClone({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future });
  const renderData = canvasData(doc);
  let data = renderData();
  const fields = data.fieldVarNodes;
  const patch = fieldValuePatch(fields, "choice", requested, fieldDefaults(fields, data.pageVars), data.pageVars);
  assert.deepEqual(patch, { choice: expected });
  data.setFieldValues(patch);
  data = renderData();
  assert.equal(data.pageVars.choice, expected ?? "");
  assert.equal(data.pageVars["choice.index"], index);
  const leaf = renderLeafNode(doc.nodes.choice, {}, { interactive: true, vars: data.pageVars, fieldValues: data.fieldValues }) as any;
  assert.equal(leaf.props.value, expected ?? "");
  assert.equal(leaf.props.children.length, options.length, "never insert a synthetic option");
  if (expected === null) {
    const element = { selectedIndex: 0 };
    leaf.props.ref(element);
    assert.equal(element.selectedIndex, -1, "React's first-option fallback is cleared after commit");
  }
  assert.deepEqual({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future }, before);
});

test("no-selection and an empty option have different preview indices", () => {
  const fields = [scriptSelectValueDoc(["A", "{empty}"]).nodes.choice];
  assert.equal(fieldStateValues(fields, { choice: null }, { empty: "" })["choice.index"], "0");
  assert.equal(fieldStateValues(fields, { choice: "" }, { empty: "" })["choice.index"], "2");
});

/** ネイティブの value の setter の後の結果を返す、最小限の入力欄。通知とプレビューへの呼び出しだけを検証する。 */
function runtimeAssignments(preview: boolean, options: string[], initial: number, values: string[]) {
  const doc = scriptSelectValueDoc(options);
  const script = { id: "load", trigger: "load", steps: values.map((value, i) => ({ id: `set-${i}`, kind: "set-value", target: "choice", value })) };
  doc.pages.home.pageScripts = undefined;
  doc.nodes = { choice: { ...doc.nodes.choice, scripts: [script as any] } };
  doc.pages.home.children = ["choice"];
  const events: string[] = [], patches: string[] = [], timers: Function[] = [];
  let selectedIndex = initial;
  const input = {
    id: "choice", tagName: "SELECT", type: "select-one", matches: () => true, closest: () => null,
    getAttribute: (key: string) => key === "data-scripts" ? JSON.stringify([script]) : null,
    get selectedIndex() { return selectedIndex; },
    get value() { return options[selectedIndex] ?? ""; },
    set value(v: string) { selectedIndex = options.indexOf(v); },
    dispatchEvent: (e: Event) => events.push(e.type),
  };
  const root = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" || selector === "#choice" ? [input] : [],
    addEventListener() {}, removeEventListener() {}, contains: () => true,
  };
  runInNewContext(preview ? `(${SCRIPT_RUNTIME})(env).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (v: string) => v }, Event,
    env: { setValue: (_id: string, value: string) => { patches.push(value); return true; } },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {},
    setTimeout: (fn: Function) => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  return { selectedIndex, events, patches, timers: timers.length };
}
for (const preview of [true, false]) {
  const label = preview ? "preview" : "exported";
  for (const [name, options, initial, values, expected, changes] of [
    ["repeated missing values", ["A", "B"], 1, ["C", "C", "D"], -1, 1],
    ["repeated clear", ["A", "B"], 1, ["", ""], -1, 1],
    ["missing then actual empty", ["A", "", "B"], 2, ["C", "", ""], 1, 2],
    ["empty then missing", ["A", "", "B"], 1, ["C", "C"], -1, 1],
    ["no choices", [], -1, ["C", ""], -1, 0],
    ["valid changes", ["A", "B"], 1, ["A", "A", "B"], 1, 2],
  ] as const) test(`${label}: ${name} only notifies effective selection changes`, () => {
    const got = runtimeAssignments(preview, [...options], initial, [...values]);
    assert.equal(got.selectedIndex, expected);
    assert.equal(got.events.length, preview ? 0 : changes * 2);
    assert.equal(got.patches.length, preview ? changes : 0);
    assert.equal(got.timers, preview ? changes : 0);
  });
}

test("generated select includes its assignment scripts and selected option", async () => {
  const { html } = await publishedScriptSelectValue(scriptSelectValueDoc());
  assert.match(html, /data-scripts=/);
  assert.match(html, /<option value="A">A<\/option><option value="B" selected="">B<\/option>/);
});
});

describe("script-step-chunks", () => {
test("large script step windows preserve every original step and insertion index", () => {
  const steps: ScriptStep[] = Array.from({ length: 4096 }, (_, i) => ({
    id: "wait-" + i, kind: "wait", seconds: i,
  }));
  const before = [...steps];
  const chunks = chunkScriptSteps(steps);
  assert.equal(chunks.length, Math.ceil(steps.length / SCRIPT_STEP_CHUNK_SIZE));
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1)!.start, 4080);
  assert.ok(chunks.every((part) => part.steps.length <= SCRIPT_STEP_CHUNK_SIZE));
  const flattened = chunks.flatMap((part) => part.steps);
  for (let i = 0; i < steps.length; i++) {
    assert.strictEqual(flattened[i], steps[i]);
    assert.equal(chunks[Math.floor(i / SCRIPT_STEP_CHUNK_SIZE)].start +
      i % SCRIPT_STEP_CHUNK_SIZE, i);
  }
  assert.deepEqual(steps, before);
  assert.equal(SCRIPT_STEP_WINDOW_THRESHOLD, 128);
});

test("window heights include nested branches but remain finite under deeply nested input", () => {
  const root: ScriptStep[] = [{ id: "wait", kind: "wait", seconds: 1 }];
  for (let depth = 0; depth < 30; depth++) {
    root.splice(0, root.length, {
      id: "repeat-" + depth, kind: "repeat", times: 2,
      then: [root[0]],
    });
  }
  const height = chunkScriptSteps(root)[0].estimatedHeight;
  assert.ok(height > 70);
  assert.ok(Number.isFinite(height));
});
});

describe("script-step-tree-purity", () => {
function fixture(): Script[] {
  return [{
    id: "script", steps: [{
      id: "decision", kind: "if",
      cond: { subject: "var", target: "", left: "ready", op: "eq", value: "true" },
      then: [{ id: "yes", kind: "wait", seconds: 1 }],
    }],
  }];
}

const elseLocation = { scriptId: "script", list: "decision:else", index: 0 };

test("looking up an absent else branch does not mutate the source script", () => {
  const scripts = fixture();
  const initial = structuredClone(scripts);
  assert.equal(listIn(scripts[0], elseLocation.list), null);
  assert.deepEqual(scripts, initial);
  const pending: ScriptStep[] = [{
    id: "transform", kind: "transform", source: "", into: "",
    transform: { kind: "length" },
  }];
  const connected = connectNewTransform(scripts, elseLocation, pending);
  assert.deepEqual(connected, pending);
  assert.deepEqual(scripts, initial);
  const [remaining, removed] = takeSelectedSteps(scripts, elseLocation, new Set());
  assert.deepEqual(remaining, scripts);
  assert.deepEqual(removed, []);
  assert.deepEqual(scripts, initial);
});

test("inserting into a new else branch changes only the cloned document", () => {
  const scripts = fixture();
  const initial = structuredClone(scripts);
  const next = insertAt(scripts, elseLocation, [{ id: "no", kind: "wait", seconds: 2 }]);
  assert.notEqual(next, scripts);
  assert.deepEqual(scripts, initial);
  assert.deepEqual(listIn(next[0], elseLocation.list), [{ id: "no", kind: "wait", seconds: 2 }]);
  assert.equal(listIn(scripts[0], elseLocation.list), null);
});

test("connecting a new transform in an existing else branch preserves the source", () => {
  const scripts = fixture();
  const branch = scripts[0].steps[0];
  if (branch.kind !== "if") throw new Error("Expected if branch");
  branch.else = [{ id: "set", kind: "set-var", value: "hello", into: "message" }];
  const initial = structuredClone(scripts);
  const result = connectNewTransform(scripts, { ...elseLocation, index: 1 }, [{
    id: "transform", kind: "transform", source: "", into: "", transform: { kind: "field", key: "name" },
  }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "transform");
  if (result[0].kind === "transform") {
    assert.equal(result[0].source, "message");
    assert.equal(result[0].into, "message");
  }
  assert.deepEqual(scripts, initial);
});

test("duplicate branch IDs resolve the first owner in both reads and edits", () => {
  const scripts = fixture();
  const first = scripts[0].steps[0];
  if (first.kind !== "if") throw new Error("Expected if branch");
  first.then = [{
    id: "duplicate", kind: "if",
    cond: first.cond,
    then: [{ id: "first-child", kind: "wait", seconds: 1 }],
  }];
  scripts[0].steps.push({
    id: "duplicate", kind: "if",
    cond: first.cond,
    then: [{ id: "second-child", kind: "wait", seconds: 2 }],
  });
  const original = structuredClone(scripts);
  assert.deepEqual(listIn(scripts[0], "duplicate:then")?.map((step) => step.id), ["first-child"]);
  const next = insertAt(scripts, { scriptId: "script", list: "duplicate:then", index: 1 },
    [{ id: "inserted", kind: "wait", seconds: 3 }]);
  assert.deepEqual(listIn(next[0], "duplicate:then")?.map((step) => step.id), ["first-child", "inserted"]);
  assert.equal(next[0].steps[1], scripts[0].steps[1], "later duplicate branch remains shared");
  assert.deepEqual(scripts, original, "the original document is never mutated");

  const [afterRemoval, removed] = takeSelectedSteps(next, { scriptId: "script", list: "duplicate:then", index: 1 }, new Set());
  assert.deepEqual(removed.map((step) => step.id), ["inserted"]);
  assert.deepEqual(listIn(afterRemoval[0], "duplicate:then")?.map((step) => step.id), ["first-child"]);
});

test("a missing first duplicate else branch is not silently redirected to the next duplicate", () => {
  const scripts = fixture();
  const first = scripts[0].steps[0];
  if (first.kind !== "if") throw new Error("Expected if branch");
  first.id = "duplicate";
  scripts[0].steps.push({
    id: "duplicate", kind: "if", cond: first.cond,
    then: [], else: [{ id: "other", kind: "wait", seconds: 1 }],
  });
  assert.equal(listIn(scripts[0], "duplicate:else"), null);
  const original = structuredClone(scripts);
  const next = insertAt(scripts, { scriptId: "script", list: "duplicate:else", index: 0 },
    [{ id: "new-else", kind: "wait", seconds: 1 }]);
  assert.deepEqual(listIn(next[0], "duplicate:else")?.map((step) => step.id), ["new-else"]);
  assert.equal(next[0].steps[1], scripts[0].steps[1]);
  assert.deepEqual(scripts, original);
});

test("dragging one middle block keeps both adjacent blocks connected", () => {
  const scripts: Script[] = [{
    id: "s", trigger: "click",    steps: ["a", "b", "c", "d"].map((id) => ({ id, kind: "wait" as const, seconds: 1 })),
  }];
  const original = structuredClone(scripts);
  const [remaining, taken] = takeSelectedSteps(scripts, { scriptId: "s", list: "root", index: 1 }, new Set(["b"]));
  assert.deepEqual(taken.map((step) => step.id), ["b"]);
  assert.deepEqual(remaining[0].steps.map((step) => step.id), ["a", "c", "d"]);
  assert.deepEqual(scripts, original);
});

test("dragging multiple selected blocks leaves unselected blocks in order", () => {
  const scripts: Script[] = [{
    id: "s", trigger: "click",    steps: ["a", "b", "c", "d"].map((id) => ({ id, kind: "wait" as const, seconds: 1 })),
  }];
  const [remaining, taken] = takeSelectedSteps(scripts, { scriptId: "s", list: "root", index: 1 }, new Set(["b", "d"]));
  assert.deepEqual(taken.map((step) => step.id), ["b", "d"]);
  assert.deepEqual(remaining[0].steps.map((step) => step.id), ["a", "c"]);
});

test("dragging an unselected block does not pull along the previous selection", () => {
  const scripts: Script[] = [{
    id: "s", trigger: "click",    steps: ["a", "b", "c"].map((id) => ({ id, kind: "wait" as const, seconds: 1 })),
  }];
  const [remaining, taken] = takeSelectedSteps(scripts, { scriptId: "s", list: "root", index: 2 }, new Set(["a", "b"]));
  assert.deepEqual(taken.map((step) => step.id), ["c"]);
  assert.deepEqual(remaining[0].steps.map((step) => step.id), ["a", "b"]);
});
});

describe("script-storage-safety", () => {
test("script storage fallback retains prototype-like keys when cookies and localStorage are disabled", () => {
  const start = SCRIPT_RUNTIME.indexOf('  var prefix = "";');
  const end = SCRIPT_RUNTIME.indexOf("  /*/store*/", start);
  assert.ok(start >= 0 && end > start, "the runtime must contain its storage implementation");
  const code = SCRIPT_RUNTIME.slice(start, end);
  const unavailable = () => { throw new Error("storage unavailable"); };
  const location = { hostname: "site.example", protocol: "https:" };
  const document = { get cookie() { return unavailable(); }, set cookie(_value: string) { unavailable(); } };
  const localStorage = {
    getItem: unavailable, setItem: unavailable, removeItem: unavailable,
  };
  const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
  const storage = new Function(
    "env", "location", "document", "localStorage", "has",
    code + "\nreturn { storeGet, storeSet };",
  )({ storePrefix: "" }, location, document, localStorage, has) as {
    storeGet: (key: string, shared: boolean) => string;
    storeSet: (key: string, value: string, shared: boolean) => void;
  };
  for (const shared of [false, true]) {
    for (const key of ["__proto__", "constructor", "toString", "ordinary"]) {
      storage.storeSet(key, "value for " + key, shared);
      assert.equal(storage.storeGet(key, shared), "value for " + key);
    }
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("script storage round-trips primitive and structured JSON values locally and through shared cookies", () => {
  const start = SCRIPT_RUNTIME.indexOf('  var prefix = "";');
  const end = SCRIPT_RUNTIME.indexOf("  /*/store*/", start);
  const storageSource = SCRIPT_RUNTIME.slice(start, end);
  const values = new Map<string, string>();
  const cookies = new Map<string, string>();
  const document = {
    get cookie() { return [...cookies.values()].join("; "); },
    set cookie(raw: string) {
      const pair = raw.split(";", 1)[0];
      const key = pair.slice(0, pair.indexOf("="));
      if (/; max-age=0(?:;|$)/i.test(raw)) cookies.delete(key);
      else cookies.set(key, pair);
    },
  };
  const localStorage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
  const storage = new Function("env", "location", "document", "localStorage", "has",
    storageSource + "\nreturn { storeGet, storeSet };")(
      { storePrefix: "", sharedDomain: "example.com" }, { hostname: "one.example.com", protocol: "https:" },
      document, localStorage,
      (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key),
    ) as { storeGet(k: string, shared: boolean): unknown; storeSet(k: string, v: unknown, shared: boolean): void };
  const cases: Array<[string, unknown]> = [
    ["number", 12], ["string", "0012"], ["text", "日本語 + quoted \"text\""],
    ["json-looking-string", '{"city":"Kyoto"}'], ["prefix-string", "tsumu-store-v1:plain"],
    ["envelope-looking-string", 'tsumu-store-v1:{"value":12,"missing":false}'],
    ["boolean", false], ["null", null],
    ["array", [1, false, null, { city: "Kyoto" }]],
    ["dictionary", { a: 1, b: [2] }], ["missing", undefined],
  ];
  for (const shared of [false, true]) {
    for (const [key, value] of cases) {
      storage.storeSet(key, value, shared);
      assert.deepEqual(storage.storeGet(key, shared), value, key);
      assert.equal(cookies.has(key), shared);
      if (typeof value === "string" && key !== "envelope-looking-string") {
        const raw = shared
          ? decodeURIComponent((cookies.get(key) ?? "").slice(key.length + 1))
          : values.get(key);
        assert.equal(raw, value, `stored string must be verbatim: ${key}`);
      }
    }
    assert.equal(storage.storeGet("absent", shared), undefined);
  }
  document.cookie = "external=0012";
  assert.equal(storage.storeGet("external", true), "0012");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("exported browser script includes prototype-free storage", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{
    id: "load", trigger: "load",    steps: [
      { id: "save", kind: "store-save", key: "__proto__", value: "value" },
      { id: "read", kind: "store-load", key: "__proto__", into: "record" },
    ],
  }];
  const file = generateProject(doc).files["public/scripts.js"];
  assert.ok(file);
  assert.match(file, /var mem = Object\.create\(null\)/);
});
});

describe("script-var-path-bounds", () => {
test("nested writes reject sparse array indexes without changing the original variable", () => {
  const original = [{ name: "first" }];
  const vars: Record<string, unknown> = { rows: original };
  for (const invalid of ["rows.3", "rows.1000000", "rows.1000001", "rows.length", "rows.foo", "rows.-1"]) {
    assert.equal(setVarPath(vars, invalid, 7, withinScriptValueLimit), undefined, invalid);
    assert.deepEqual(vars.rows, [{ name: "first" }], invalid);
    assert.equal((vars.rows as unknown[]).length, 1, invalid);
  }
  assert.equal(vars.rows, original, "invalid writes should not replace the source array");
});

test("nested writes still support existing indexes and contiguous append", () => {
  const original = [{ name: "first" }];
  const vars: Record<string, unknown> = { rows: original };
  assert.equal(setVarPath(vars, "rows.0.name", "updated", withinScriptValueLimit), "rows");
  assert.deepEqual(vars.rows, [{ name: "updated" }]);
  assert.equal(original[0].name, "first", "nested path assignment must be copy-on-write");
  assert.equal(setVarPath(vars, "rows.1", { name: "second" }, withinScriptValueLimit), "rows");
  assert.deepEqual(vars.rows, [{ name: "updated" }, { name: "second" }]);
  assert.equal(setVarPath(vars, "rows.2", { name: "third" }, withinScriptValueLimit), "rows");
  assert.equal((vars.rows as unknown[]).length, 3);
});

test("full arrays cannot be extended beyond the script list limit", () => {
  const rows = Array(10000).fill(0);
  const vars: Record<string, unknown> = { rows };
  assert.equal(setVarPath(vars, "rows.10000", 1, withinScriptValueLimit), undefined);
  assert.equal(vars.rows, rows);
  assert.equal(setVarPath(vars, "rows.9999", 1, withinScriptValueLimit), "rows");
  assert.equal((vars.rows as number[])[9999], 1);
});

test("non-finite numbers never silently change into JSON null or compare as valid values", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(matchesValueCondition(bad, "eq", bad), false);
    assert.equal(matchesValueCondition([bad], "contains", bad), false);
    assert.equal(withinScriptValueLimit(bad), false);
    assert.equal(withinScriptValueLimit([1, { bad }]), false);
    const vars: Record<string, unknown> = { existing: 42 };
    assert.equal(setVarPath(vars, "existing", bad, withinScriptValueLimit), undefined);
    assert.equal(vars.existing, 42, "invalid writes must not mutate existing variables");
    assert.equal(setVarPath(vars, "nested.bad", bad, withinScriptValueLimit), undefined);
    assert.equal(Object.hasOwn(vars, "nested"), false);
  }
  assert.equal(withinScriptValueLimit(1), true);
  assert.equal(withinScriptValueLimit(null), true);
  assert.equal(withinScriptValueLimit(undefined), true, "undefined represents a missing value");
  assert.equal(withinScriptValueLimit([0, true, false, "text"]), true);
});

test("unsupported scalar kinds are rejected before JSON persistence", () => {
  for (const unsupported of [1n, Symbol("x"), () => 1]) {
    assert.equal(withinScriptValueLimit(unsupported), false);
    assert.equal(withinScriptValueLimit({ unsupported }), false);
  }
});

{
  const locale = readFileSync("lib/locales/ja.ts", "utf8");
  const definition = (key: string, translated: string) =>
    locale.includes(JSON.stringify(key) + ": " + JSON.stringify(translated));

  test("JSON controls call a key an 項目 without changing the storage-key terminology", () => {
    for (const [key, text] of [
      ["Key (blank to append)", "項目（空欄なら末尾）"],
      ["Field name", "項目名"],
      ["Field name to read", "取り出す項目名"],
      ["Set {value} at key {key} of list {list}", "リスト{list}の項目{key}に{value}を入れる"],
      ["List item field", "リスト内の項目名"],
      ["Field name / {variable}", "項目名 / {変数}"],
      ["have an item (comparison)", "項目がある"],
    ]) assert.equal(definition(key, text), true, key);
  });

  test("list labels distinguish array elements from dictionary items", () => {
    assert.equal(definition("List · {length} elements", "リスト・{length}要素"), true);
    assert.equal(definition("List · {length} items", "リスト・{length}項目"), true);
    assert.equal(locale.includes("{ループ.キー}"), true);
  });
}

function previewCopies(copies: [string, string][], initial: Record<string, unknown>) {
  let sourceReads = 0;
  const vars = {
    source: { get value() {
      assert.ok(++sourceReads <= 20, "preview retried the same copy without making progress");
      return 7;
    } },
  };
  const steps: ScriptStep[] = copies.map(([into, src], i) => ({
    id: "copy-" + i, kind: "set-var", into, value: "{" + src + "}",
  }));
  const doc: SiteDoc = {
    siteName: "", pages: { p: {
      id: "p", name: "", title: "", description: "", slug: "", children: [],
      pageScripts: [
        { id: "load", trigger: "load", steps: Object.entries(initial).map(([into, value]) => ({
          id: "init-" + into, kind: "fetch", as: into, method: "GET", url: "/data", preview: { sample: value },
        })) },
        { id: "click", trigger: "click", steps },
      ],
    } }, pageOrder: ["p"], nodes: {}, assets: {},
  };
  return previewDataVars(doc, "p", { vars });
}

test("nested preview copies resolve downstream samples and preserve existing fields", () => {
  const result = previewCopies([
    ["last", "article.title"], ["article.title", "source.value"],
    ["article.flag", "source.value"], ["constructor", "source.value"],
  ], { article: { flag: false } });
  assert.deepEqual(result, { article: { title: 7, flag: false }, last: 7, constructor: 7 });
});

test("unwritable or cyclic preview copies finish without inventing sample values", () => {
  const result = previewCopies([
    ["rows.4", "source.value"], ["loopA", "loopB"], ["loopB", "loopA"],
  ], { rows: [] });
  assert.deepEqual(result, { rows: [] });
});

const featureSteps: ScriptStep[] = [
  { id: "assign", kind: "set-var", into: "x", value: "1" },
  { id: "insert", kind: "set-list-item", list: "items", key: "", value: "1" },
  { id: "delete", kind: "remove-list-item", list: "items", mode: "value", value: "1" },
  { id: "count", kind: "transform", source: "items", into: "count", transform: { kind: "length" } },
];
for (const step of featureSteps) test(`published nested ${step.kind} includes only its required variable operations`, () => {
  const doc: SiteDoc = {
    siteName: "", assets: {}, pageOrder: ["p"], nodes: {}, pages: { p: {
      id: "p", name: "", slug: "", description: "", title: "", children: [], pageScripts: [{
        id: "s", trigger: "click", steps: [{ id: "repeat", kind: "repeat", times: 1, then: [step] }],
      }],
    } },
  };
  const code = scriptsFile(doc);
  assert.doesNotThrow(() => new JsScript(code));
  for (const other of featureSteps) assert.equal(code.includes(`case "${other.kind}":`), step.kind === other.kind);
  assert.equal(code.includes("var evalRecipe ="), step.kind === "transform");
  assert.equal(code.includes("var removeItem ="), step.kind === "remove-list-item");
});

for (const layout of ["single", "stacks"] as const) {
  test(`${layout} script workspace exports 4000 blocks without mutation`, () => {
    const doc = scriptWorkspaceDoc(layout);
    const scripts = doc.pages.p.pageScripts!;
    assert.equal(scripts.length, layout === "single" ? 1 : 160);
    const steps = scripts.flatMap((script) => script.steps);
    assert.equal(steps.length, 4000);
    assert.equal(new Set(steps.map((step) => step.id)).size, 4000);
    assert.deepEqual(scriptWorkspaceDoc(layout), doc, "test fixture must be deterministic");
    const snapshot = JSON.stringify(doc);
    const project = generateExportProject(doc, "nextjs");
    const encoded = project.files["app/page.tsx"].match(/data-scripts=\{("(?:[^"\\]|\\.)*")\}/)?.[1];
    assert.ok(encoded, "export contains the page script payload");
    const exported = JSON.parse(JSON.parse(encoded));
    assert.deepEqual(exported, scripts.map((script) => ({
      trigger: "load", steps: script.steps.map(() => ({ kind: "wait", seconds: 1 })),
    })), "all 4000 operations must be exported, not just an empty page");
    assert.equal(JSON.stringify(doc), snapshot);
  });
}
});

describe("script-variable-change", () => {
const pos = { x: 16, y: 16 };

function fixture(watchers: Script[], clickSteps: ScriptStep[]): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Variable changes", assets: {}, pageOrder: ["p"],
    pages: {
      p: {
        id: "p", name: "P", slug: "", title: "", description: "",
        children: ["button"], pageScripts: watchers,
      },
    },
    nodes: {
      button: {
        ...makeBox(), id: "button",
        scripts: [{ id: "click", trigger: "click", pos, steps: clickSteps }],
      },
    },
  };
}

function watcher(id: string, variable: string, steps: ScriptStep[]): Script {
  return { id, pos, trigger: "change", changeVariable: variable, steps };
}

function browserRun(published: boolean, doc: SiteDoc, search = "") {
  const notifications: { name: string; value: unknown }[] = [];
  const listeners = new Map<string, Array<(event: { target: unknown }) => void>>();
  const on = (type: string, fn: (event: { target: unknown }) => void) =>
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  const pageScripts = JSON.stringify(compileScripts(
    { scripts: doc.pages.p.pageScripts }, () => "/", undefined, true, pagePlan(doc, "p").serverIds,
  ));
  const nodeScripts = JSON.stringify(compileScripts(doc.nodes.button, () => "/"));
  const marker = {
    nodeType: 1, parentElement: null,
    getAttribute: (name: string) =>
      name === "data-page-body" ? "p" : name === "data-scripts" ? pageScripts : null,
  };
  const button = {
    nodeType: 1, parentElement: null,
    getAttribute: (name: string) => name === "data-scripts" ? nodeScripts : null,
    closest: (selector: string) => selector === "[data-scripts]" ? button : null,
  };
  const root = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" ? [marker, button] : [],
    contains: () => true,
    addEventListener: on,
    removeEventListener: () => {},
  };
  const globals = {
    document: root, location: { search }, URLSearchParams,
    window: {
      __siteVarsOnChange: (name: string, value: unknown) => notifications.push({ name, value }),
    },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    CSS: { escape: (text: string) => text },
    setTimeout, clearTimeout,
  };
  const script = published ? scriptsFile(doc) : "(" + SCRIPT_RUNTIME + ")({}).install(document);";
  runInNewContext(script, globals);
  return {
    notifications,
    click: () => (listeners.get("click") ?? []).forEach((fn) => fn({ target: button })),
  };
}

test("existing element-change scripts remain valid without a migration", () => {
  const legacy: Script = {
    id: "old", trigger: "change", pos,
    steps: [{ id: "set", kind: "set-var", into: "seen", value: "true" }],
  };
  const modern = watcher("new", "stats.total", legacy.steps);
  assert.equal(validDocumentScripts([legacy, modern]), true);
  const compiled = compileScripts({ scripts: [legacy, modern] }, () => "/");
  assert.equal("changeVariable" in compiled[0], false);
  assert.equal(compiled[1].changeVariable, "stats.total");
  assert.equal(compileScripts({ scripts: [watcher("empty", "", legacy.steps)] }, () => "/").length, 0);
});

test("renaming and exported variable obfuscation update watched variable paths", () => {
  const doc = fixture([
    watcher("watch", "stats.total", [
      { id: "seen", kind: "set-var", into: "status", value: "true" },
    ]),
  ], [
    { id: "assign", kind: "set-var", into: "stats", value: "{}" },
  ]);
  // 名前の編集の流れでは、まず値を作る側の名前を変え、その後で参照を更新する。
  const producer = doc.nodes.button.scripts![0].steps[0];
  if (producer.kind !== "set-var") throw new Error("expected set-var producer");
  producer.into = "renamed";
  renameVarInPage(doc, "p", "stats", "renamed");
  assert.equal(doc.pages.p.pageScripts?.[0].changeVariable, "renamed.total");
  const published = obfuscateVarNames(doc);
  const assignment = published.nodes.button.scripts?.[0].steps[0];
  assert.equal(assignment?.kind, "set-var");
  if (assignment?.kind !== "set-var") return;
  assert.notEqual(assignment.into, "renamed");
  assert.equal(published.pages.p.pageScripts?.[0].changeVariable, assignment.into + ".total");
  assert.equal(doc.pages.p.pageScripts?.[0].changeVariable, "renamed.total", "source doc must remain unchanged");
});

for (const published of [false, true]) {
  const where = published ? "published" : "preview";

  test(where + " fires variable-change trigger only when the value changes", () => {
    const doc = fixture([
      watcher("watch", "count", [
        { id: "record", kind: "set-var", into: "seen", value: "{count}" },
      ]),
    ], [
      { id: "first", kind: "set-var", into: "count", value: "1" },
      { id: "same", kind: "set-var", into: "count", value: "1" },
      { id: "second", kind: "set-var", into: "count", value: "2" },
      { id: "unrelated", kind: "set-var", into: "other", value: "7" },
    ]);
    const harness = browserRun(published, doc);
    harness.click();
    assert.deepEqual(
      harness.notifications.filter((n) => n.name === "seen").map((n) => n.value),
      [1, 2],
    );
  });

  test(where + " watches nested paths and ignores unchanged descendants", () => {
    const doc = fixture([
      watcher("child", "nested.item", [
        { id: "child-seen", kind: "set-var", into: "childSeen", value: "{nested.other}" },
      ]),
      watcher("parent", "nested", [
        { id: "parent-seen", kind: "set-var", into: "parentSeen", value: "{nested.other}" },
      ]),
    ], [
      { id: "first", kind: "set-var", into: "nested.item", value: "1" },
      { id: "same", kind: "set-var", into: "nested.item", value: "1" },
      { id: "parent", kind: "set-var", into: "nested", value: "{\"item\":1,\"other\":2}" },
    ]);
    const harness = browserRun(published, doc);
    harness.click();
    assert.deepEqual(harness.notifications.filter((n) => n.name === "childSeen").map((n) => n.value), [undefined]);
    assert.deepEqual(harness.notifications.filter((n) => n.name === "parentSeen").map((n) => n.value), [undefined, 2]);
  });

  test(where + " writes missing values before resolving URL parameters of the same name", () => {
    const doc = fixture([], [
      { id: "input", kind: "set-var", into: "data", value: "{}" },
      { id: "missing", kind: "transform", source: "data", into: "result",
        transform: { kind: "field", key: "absent" } },
      { id: "output", kind: "set-var", into: "message", value: "Found: {result}" },
    ]);
    const harness = browserRun(published, doc, "?result=stale");
    harness.click();
    assert.equal(harness.notifications.find((entry) => entry.name === "message")?.value, "Found: ");
  });

  test(where + " tracks last-item and length references across indexed writes", () => {
    const doc = fixture([
      watcher("tail", "items.-1", [{ id: "a", kind: "set-var", into: "tail", value: "{items.-1}" }]),
      watcher("size", "items.length", [{ id: "b", kind: "set-var", into: "size", value: "{items.length}" }]),
    ], [
      { id: "init", kind: "set-var", into: "items", value: "[1]" },
      { id: "append", kind: "set-var", into: "items.1", value: "2" },
      { id: "edit", kind: "set-var", into: "items.1", value: "3" },
      { id: "first", kind: "set-var", into: "items.0", value: "4" },
    ]);
    const harness = browserRun(published, doc);
    harness.click();
    assert.deepEqual(harness.notifications.filter((n) => n.name === "tail").map((n) => n.value), [1, 2, 3]);
    assert.deepEqual(harness.notifications.filter((n) => n.name === "size").map((n) => n.value), [1, 2]);
  });

  test(where + " fires watchers in order for assignments in page-load scripts", () => {
    const doc = fixture([
      watcher("watch", "stats.total", [
        { id: "record", kind: "set-var", into: "seen", value: "{stats.total}" },
      ]),
      { id: "load", pos, trigger: "load", steps: [
        { id: "init", kind: "set-var", into: "stats", value: '{"total":1}' },
        { id: "loop", kind: "repeat", times: 1, then: [
          { id: "update", kind: "set-var", into: "stats.total", value: "2" },
          { id: "copy", kind: "set-var", into: "after", value: "{seen}" },
        ] },
        { id: "independent", kind: "set-var", into: "title", value: "Example" },
      ] },
    ], []);
    const plan = pagePlan(doc, "p");
    assert.deepEqual([...plan.serverIds], ["independent"]);
    assert.ok(plan.clientVars.has("stats") && plan.clientVars.has("after"));
    assert.deepEqual(browserRun(published, doc).notifications.filter((n) => n.name === "seen").map((n) => n.value), [1, 2]);
  });

  test(where + " prevents recursive variable triggers across asynchronous script continuations", async () => {
    const doc = fixture([
      watcher("self", "count", [
        { id: "seen", kind: "set-var", into: "seen", value: "{count}" },
        { id: "loop", kind: "repeat", times: 1, then: [
          { id: "mark", kind: "set-var", into: "marker", value: "true" },
        ] },
        { id: "replace", kind: "set-var", into: "count", value: "2" },
      ]),
    ], [{ id: "start", kind: "set-var", into: "count", value: "1" }]);
    const harness = browserRun(published, doc);
    harness.click();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(harness.notifications.filter(n => n.name === "count").map(n => n.value), [1, 2]);
    assert.deepEqual(harness.notifications.filter(n => n.name === "seen").map(n => n.value), [1]);
  });

  test(where + " prevents recursive variable-trigger updates", () => {
    const doc = fixture([
      watcher("self", "count", [
        { id: "replace", kind: "set-var", into: "count", value: "2" },
      ]),
    ], [{ id: "start", kind: "set-var", into: "count", value: "1" }]);
    const harness = browserRun(published, doc);
    harness.click();
    assert.deepEqual(harness.notifications.filter((n) => n.name === "count").map((n) => n.value), [1, 2]);
  });
}

test("browser list edits retain their initialized variable and record the exact mutation target", () => {
  const doc = fixture([
    { id: "load", pos, trigger: "load", steps: [
      { id: "init", kind: "set-var", into: "catalog", value: '{"rows":[1,2]}' },
      { id: "server-init", kind: "set-var", into: "serverRows", value: "[1,2]" },
      { id: "server-loop", kind: "repeat", times: 1, then: [
        { id: "server-append", kind: "set-list-item", list: "serverRows", key: "", value: "3" },
      ] },
    ] },
  ], [{ id: "remove", kind: "remove-list-item", list: "catalog.rows", mode: "key", value: "0" }]);
  const plan = pagePlan(doc, "p");
  assert.equal(plan.serverIds.has("init"), false);
  assert.ok(plan.serverIds.has("server-loop"));
  assert.deepEqual([...plan.clientListTargets], ["catalog.rows"]);
  assert.ok(plan.clientVars.has("catalog"));
});
});

describe("script-viewport", () => {
test("offscreen focused windows are released after focus leaves, without another intersection", async (t) => {
  const observers: FakeObserver[] = [];
  class FakeObserver {
    targets = new Set<Element>();
    disconnected = false;
    constructor(private callback: IntersectionObserverCallback) { observers.push(this); }
    observe(el: Element) { this.targets.add(el); }
    unobserve(el: Element) { this.targets.delete(el); }
    disconnect() { this.disconnected = true; }
    intersect(el: Element, visible: boolean) {
      this.callback([{ target: el, isIntersecting: visible } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver);
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: FakeObserver });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "IntersectionObserver", previous);
    else Reflect.deleteProperty(globalThis, "IntersectionObserver");
  });
  const doc = { activeElement: null as object | null };
  const workspace = {};
  class WindowElement extends EventTarget {
    ownerDocument = doc;
    fields = [{}, {}];
    closest() { return workspace; }
    contains(el: object | null) { return !!el && this.fields.includes(el); }
  }
  const chunk = new WindowElement();
  const stack = new WindowElement();
  const chunkStates: boolean[] = [];
  const stackStates: boolean[] = [];
  const stopChunk = observeScriptViewport(chunk as unknown as HTMLElement, (v) => chunkStates.push(v));
  const stopStack = observeScriptViewport(stack as unknown as HTMLElement, (v) => stackStates.push(v));
  t.after(stopChunk);
  t.after(stopStack);
  assert.equal(observers.length, 1, "chunks and stacks share one observer");
  const observer = observers[0];
  const intersect = (el: WindowElement, visible: boolean) => observer.intersect(el as unknown as Element, visible);

  intersect(chunk, true);
  doc.activeElement = chunk.fields[0];
  intersect(chunk, false);
  assert.equal(chunkStates.at(-1), true, "scrolling must retain the focused draft");

  chunk.dispatchEvent(new Event("focusout"));
  doc.activeElement = chunk.fields[1];
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(chunkStates.at(-1), true, "moving between fields must retain the window");

  chunk.dispatchEvent(new Event("focusout"));
  doc.activeElement = stack.fields[0];
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(chunkStates.at(-1), false, "focus departure must release an offscreen window");
  intersect(stack, true);
  intersect(stack, false);
  assert.equal(stackStates.at(-1), true);
  stack.dispatchEvent(new Event("focusout"));
  doc.activeElement = null;
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(stackStates.at(-1), false, "whole stacks use the same focus protection");

  chunk.dispatchEvent(new Event("focusout"));
  intersect(chunk, true);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(chunkStates.at(-1), true, "reentry supersedes a queued offscreen focus check");
  chunk.dispatchEvent(new Event("focusout"));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(chunkStates.at(-1), true, "visible windows stay mounted after blur");

  doc.activeElement = chunk.fields[0];
  intersect(chunk, false);
  chunk.dispatchEvent(new Event("focusout"));
  const count = chunkStates.length;
  stopChunk();
  doc.activeElement = null;
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  chunk.dispatchEvent(new Event("focusout"));
  intersect(chunk, true);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(chunkStates.length, count, "cleanup cancels queued focus work and intersection delivery");
  assert.equal(observer.targets.size, 1);
  assert.equal(observer.disconnected, false);
  stopStack();
  assert.equal(observer.disconnected, true);
});
});
