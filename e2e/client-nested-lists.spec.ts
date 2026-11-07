import { test, expect, type Page } from "@playwright/test";
import { nestedScopeItems, nestedScopeBundle, nestedScopeDoc, publishedNestedScope } from "../tests/helpers/nested-script-scope";
import { pagePlan } from "../lib/data";
import { scriptsFile } from "../lib/script-runtime";
import { clientNestedBundle, clientNestedDoc, publishedClientNested } from "../tests/helpers/client-nested-lists";
import { readEditorCss } from "../tests/helpers/editor-css";
import { emptyListBundle, publishedEmptyList } from "../tests/helpers/empty-list-preview";
import { listActions, nestedOperationsBundle, publishedNestedOperations } from "../tests/helpers/nested-list-operations";
import { nestedListSourcesBundle } from "../tests/helpers/nested-list-sources";

test.describe("client-nested-lists", () => {
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).clientNestedStore.getState(); return { doc, past, future };
});
const details = (page: Page) => page.locator('[id="detail"]').filter({ visible: true });
const activeRows = (page: Page) => page.locator('[id="tags-list"]').evaluateAll(lists => lists
  .filter(list => !list.closest('[data-tpl]')).map(list => Array.from(list.children)
    .filter(row => row.hasAttribute('data-item') && (row as HTMLElement).style.display !== 'none')
    .map(row => JSON.parse(row.getAttribute('data-item')!).label)));
async function check(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    await expect(details(page)).toHaveText(['Detail First:red', 'Detail First:blue', 'Detail Second:green', 'Detail Second:yellow']);
    await page.getByRole('button', { name: 'hide blue', exact: true }).click();
    await expect(details(page)).toHaveText(['Detail First:red', 'Detail Second:green', 'Detail Second:yellow']);
    await page.getByRole('button', { name: 'show blue', exact: true }).click();
    await expect(details(page)).toHaveCount(4);
  }
  for (const [action, expected] of [
    ['descending', [['red', 'blue'], ['yellow', 'green']]], ['filter', [['red'], ['green']]],
    ['filter', [['red'], ['green']]], ['empty', [[], []]], ['clear', [['red', 'blue'], ['yellow', 'green']]],
    ['ascending', [['blue', 'red'], ['green', 'yellow']]], ['clear', [['blue', 'red'], ['green', 'yellow']]],
  ] as const) {
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect.poll(() => activeRows(page)).toEqual(expected);
  }
}
test(`component nested browser arrays: configure, preview, reload and execute export`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: nestedScopeItems } }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await clientNestedBundle(true) });
  const source = page.locator('aside .row').filter({ has: page.locator('span.lbl', { hasText: /^表示するリスト$/ }) }).locator('button');
  await source.click();
  await page.locator('.dd-item').filter({ has: page.locator('.dd-col > span:first-child', { hasText: /^tags$/ }) }).click();
  await expect(source).toHaveText('tags');
  const configured = await snapshot(page);
  await page.getByRole('button', { name: 'Edit loading', exact: true }).click();
  const value = page.locator('.se-flow [data-step-id="reload-step"] .se-value-choice input');
  await value.fill('{response}'); await value.press('Tab');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const saved = await snapshot(page);
  expect(saved.doc.nodes.reload.scripts[0].steps[0].value).toBe('{response}');
  expect(saved.past.length).toBeGreaterThan(configured.past.length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(configured.doc);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  const reloaded = await snapshot(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
    await check(page);
    expect(await snapshot(page)).toEqual(reloaded);
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
  }
  const html = await publishedClientNested(saved.doc);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) });
  await check(page);
  // 本番と同じ、ページをまたいで残るランタイムで、別のページへ移動して戻り、一時的な値と操作をリセットする。
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(details(page)).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await check(page);
  expect(errors).toEqual([]);
});


test('nested static filters shadow server values without reinterpreting literal braces', async ({ page }) => {
  const doc = clientNestedDoc();
  for (const action of ['descending', 'ascending', 'filter', 'empty', 'clear']) {
    doc.pages.p.children = doc.pages.p.children.filter(id => id !== action); delete doc.nodes[action];
  }
  const tags = [{ label: 'red{literal}' }, { label: 'blue{literal}' }, { label: '' }];
  const items = [
    { name: 'First', wanted: 'blue{literal}', tags },
    { name: 'Second', wanted: 'red{literal}', tags },
    { name: 'Missing', tags },
    { name: 'Null', wanted: null, tags },
  ];
  (doc.pages.p.pageScripts![0].steps[0] as { preview?: { sample?: unknown } }).preview = { sample: items };
  doc.pages.p.pageScripts![0].steps.push(
    { id: 'global-wanted', kind: 'set-var', value: '{response.1.wanted}', into: 'wanted' },
    { id: 'base-filter', kind: 'list-display', mode: 'filter', array: 'tags', field: 'label', op: 'eq', value: '{wanted}', dir: 'asc' },
  );
  const plan = pagePlan(doc, 'p');
  expect(plan.serverIds.has('global-wanted')).toBe(true);
  expect(plan.listOps.get('tags')?.some(op => op.kind === 'filter')).toBe(true);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/robots.txt');
  await page.setContent(await publishedClientNested(doc, 'app/page.tsx', items));
  await page.addScriptTag({ content: scriptsFile(doc) });
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    // 型のある null の条件は、空文字のラベルに一致してはならない。
    await expect(details(page)).toHaveText(['Detail First:blue{literal}', 'Detail Second:red{literal}', 'Detail Missing:red{literal}']);
  }
  expect(errors).toEqual([]);
});

test(`component client text overrides the server scalar through real controls`, async ({ page }) => {
  const doc = clientNestedDoc(true);
  doc.pages.p.pageScripts![0].steps.push({ id: 'global-name', kind: 'set-var', value: '{response.0.name}', into: 'name' });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: nestedScopeItems } }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await clientNestedBundle(true, doc) });
  const source = page.locator('aside .row').filter({ has: page.locator('span.lbl', { hasText: /^表示するリスト$/ }) }).locator('button');
  await source.click();
  await page.locator('.dd-item').filter({ has: page.locator('.dd-col > span:first-child', { hasText: /^tags$/ }) }).click();
  const configured = await snapshot(page);
  await page.getByRole('button', { name: 'Edit loading', exact: true }).click();
  const value = page.locator('.se-flow [data-step-id="reload-step"] .se-value-choice input');
  await value.fill('{response}'); await value.press('Tab');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const saved = await snapshot(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(configured.doc);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
  await check(page);
  const html = await publishedClientNested(saved.doc);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) });
  await check(page);
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(details(page)).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await check(page); expect(errors).toEqual([]);
});

test(`component generated client links retain row URLs after reload and navigation`, async ({ page }) => {
  const { clientLinkDoc, linkItems } = await import('../tests/helpers/client-link-scope');
  let doc = clientLinkDoc(true, "/before");
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: linkItems } }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await clientNestedBundle(true, doc) });
  const source = page.locator('aside .row').filter({ has: page.locator('span.lbl', { hasText: /^表示するリスト$/ }) }).locator('button');
  await source.click();
  await page.locator('.dd-item').filter({ has: page.locator('.dd-col > span:first-child', { hasText: /^tags$/ }) }).click();
  await page.getByRole('button', { name: 'Edit loading', exact: true }).click();
  const value = page.locator('.se-flow [data-step-id="reload-step"] .se-value-choice input');
  await value.fill('{response}'); await value.press('Tab');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  // 補助するのは選択だけ。URL の編集・履歴・保存は、実際の設定のパネルを通す。
  await page.evaluate(() => (window as any).clientNestedStore.getState().select('detail'));
  const before = await snapshot(page);
  const url = page.getByPlaceholder('https://…・#ID・{変数}', { exact: true });
  await url.fill('/products/{name}'); await url.press('Tab');
  const edited = await snapshot(page);
  expect(edited.doc.nodes.detail.link.url).toBe('/products/{name}');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(edited.doc);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  doc = (await snapshot(page)).doc;
  const html = await publishedClientNested(doc, 'app/page.tsx', linkItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(doc) });
  const hrefs = () => details(page).evaluateAll(links => links.map(link => link.getAttribute('href')));
  const expected = ['/products/First', '/products/Second%20%26%20space', '/products/', '/products/', '/products/First', '/products/Data%20%7Blabel%7D%257Bname%257D'];
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    await expect.poll(hrefs).toEqual(expected);
  }
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(details(page)).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await page.getByRole('button', { name: 'Load items', exact: true }).click();
  await expect.poll(hrefs).toEqual(expected);
  expect(errors).toEqual([]);
});

test(`component generated row scripts preserve typed data and read edited fields on click`, async ({ page }) => {
  const { makeText } = await import('../lib/presets');
  const { clientScriptBundle, clientScriptFixture } = await import('../tests/helpers/client-script-scope');
  const { doc, items } = clientScriptFixture(true);
  doc.nodes.entry = { ...makeText(''), id: 'entry', attrId: 'entry', type: 'field', field: { kind: 'input', inputType: 'text' } };
  doc.pages.p.children.push('entry');
  doc.nodes.act.scripts![0].steps.push({ id: 'field', kind: 'set-var', value: '{name}|{entry}', into: 'chosen' });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: items } }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await clientScriptBundle(doc) });
  const readDoc = () => page.evaluate(() => (window as any).clientScriptStore.getState().doc);
  const before = await readDoc();
  await page.getByRole('button', { name: 'Edit action', exact: true }).click();
  const input = page.locator('.se-flow [data-step-id="field"] .se-value-choice input');
  await input.fill('{name}|{entry}|Edited'); await input.press('Tab');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const saved = await readDoc();
  expect(saved.nodes.act.scripts[0].steps.at(-1).value).toBe('{name}|{entry}|Edited');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await readDoc()).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await readDoc()).toEqual(saved);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click(); expect(await readDoc()).toEqual(saved);
  const html = await publishedClientNested(saved, 'app/page.tsx', items);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved) });
  for (let i = 0; i < 2; i++) {
    await page.locator('#reload').click();
    await page.locator('#entry').fill(`Edited ${i} {name}`);
    const buttons = page.locator('[id="act"]').filter({ visible: true });
    await buttons.nth(1).click();
    await expect(page.locator('#result')).toHaveText(`Second|Edited ${i} {name}|Edited`);
    await expect(page.locator('#raw-result')).toHaveText('green');
    await buttons.nth(0).click();
    await expect(page.locator('#result')).toHaveText(`Data {label}|Edited ${i} {name}|Edited`);
    await expect(page.locator('#raw-result')).toHaveText('red');
  }
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(page.locator('#result')).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await page.locator('#reload').click(); await page.locator('#entry').fill('Returned');
  await page.locator('[id="act"]').filter({ visible: true }).nth(1).click();
  await expect(page.locator('#result')).toHaveText('Second|Returned|Edited');
  expect(errors).toEqual([]);
});
});

test.describe("empty-list-preview", () => {
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).emptyListStore.getState();
  return { doc, past, future };
});
async function setup(page: Page, items: readonly unknown[]) {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readEditorCss() });
  await page.addScriptTag({ content: await emptyListBundle(items) });
  await page.getByRole("button", { name: "リスト表示にする", exact: true }).click();
  const before = await snapshot(page);
  const row = page.locator("aside .row").filter({ has: page.locator("span.lbl", { hasText: /^表示するリスト$/ }) });
  await row.locator("button").click();
  await page.locator(".dd-item").filter({ has: page.locator(".dd-col > span:first-child", { hasText: /^tags$/ }) }).click();
  return { errors, before };
}
const toggle = (page: Page) => page.getByRole("button", { name: "Toggle preview", exact: true }).click();
for (const [name, items, expected] of [
  ["first nested array empty", [{ name: "First", tags: [] }, { name: "Second", tags: ["green"] }], "FirstSecondTag: green"],
  ["later nested array empty", [{ name: "First", tags: ["red"] }, { name: "Second", tags: [] }], "FirstTag: redSecond"],
  ["all nested arrays empty", [{ name: "First", tags: [] }, { name: "Second", tags: [] }], "FirstSecond"],
  ["later nested array absent", [{ name: "First", tags: ["red"] }, { name: "Second" }], "FirstTag: redSecond"],
] as const) test(`${name}: settings, preview, history, reload and generated page have no phantom rows`, async ({ page }) => {
  const { errors, before } = await setup(page, structuredClone(items));
  const saved = await snapshot(page);
  expect(saved.past).toHaveLength(before.past.length + 1);
  await toggle(page);
  await expect(page.locator("#preview")).toHaveText(expected);
  await expect(page.locator("#preview .cv-placeholder")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(saved);
  await toggle(page);
  await page.evaluate(() => (window as any).emptyListStore.getState().undo());
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.evaluate(() => (window as any).emptyListStore.getState().redo());
  expect(await snapshot(page)).toEqual(saved);
  await page.evaluate(() => {
    const s = (window as any).emptyListStore.getState();
    s.replaceDoc(JSON.parse(JSON.stringify(s.doc)));
  });
  await toggle(page);
  await expect(page.locator("#preview")).toHaveText(expected);
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.setContent(await publishedEmptyList(saved.doc, structuredClone(items)));
  await expect(page.locator("body")).toHaveText(expected + "Unchanged");
  expect(errors).toEqual([]);
});

test("design-only guidance remains editable while empty preview can recover when data arrives", async ({ page }) => {
  const { errors } = await setup(page, [{ name: "First", tags: [] }, { name: "Second", tags: [] }]);
  await expect(page.locator("#preview .cv-placeholder")).toHaveCount(1);
  await expect(page.locator("#preview")).toContainText("Tag: ");
  const saved = await snapshot(page);
  await toggle(page);
  await expect(page.locator("#preview")).toHaveText("FirstSecond");
  expect(await snapshot(page)).toEqual(saved);
  await page.evaluate(() => (window as any).emptyListStore.getState().updateDoc((doc: any) => {
    const items = doc.pages.p.pageScripts[0].steps[0].preview.sample;
    items[0].tags = ["red"]; items[1].tags = ["green", "blue"];
  }));
  await expect(page.locator("#preview")).toHaveText("FirstTag: redSecondTag: greenTag: blue");
  await page.evaluate(() => (window as any).emptyListStore.getState().undo());
  await expect(page.locator("#preview")).toHaveText("FirstSecond");
  await page.evaluate(() => (window as any).emptyListStore.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps[0].preview.sample = [];
  }));
  await expect(page.locator("#preview")).toHaveText("");
  await expect(page.locator("#preview .cv-placeholder")).toHaveCount(0);
  await toggle(page);
  await expect(page.locator("#preview .cv-placeholder")).toHaveCount(1);
  expect(errors).toEqual([]);
});
});

test.describe("nested-list-operations", () => {
let bundle: string;
test.beforeAll(async () => { bundle = await nestedOperationsBundle(true); });

const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).nestedOperationsStore.getState();
  return { doc, past, future };
});
const rows = (page: Page) => page.locator('[id="tags-list"]').evaluateAll(lists => lists.map(list =>
  Array.from(list.children).filter(row => row.hasAttribute("data-item") && (row as HTMLElement).style.display !== "none")
    .map(row => JSON.parse(row.getAttribute("data-item")!).label)));

async function runOperations(page: Page) {
  await expect(page.locator('[id="tags-list"]')).toHaveCount(2);
  await expect.poll(() => rows(page)).toEqual([["red", "blue"], ["green", "yellow"]]);
  const sequence: Array<[string, string[][]]> = [
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
  const results: string[][][] = [];
  for (const [action, expected] of sequence) {
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(() => rows(page)).toEqual(expected);
    for (const label of ["red", "blue", "green", "yellow"]) {
      const detail = page.locator('[id="detail"]').filter({ hasText: new RegExp(`:${label}$`) });
      if (expected.flat().includes(label)) await expect(detail).toBeVisible();
      else await expect(detail).toBeHidden();
    }
    results.push(await rows(page));
  }
  return results;
}

test(`component-contained lists: select script arrays, sort, filter, clear and reopen preview`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  for (const action of listActions) {
    await page.getByRole("button", { name: `Edit ${action}`, exact: true }).click();
    const choice = page.locator(`.se-flow [data-step-id="${action}-step"] button.se-list-choice`);
    // 保存したスクリプトを書き換えるのではなく、実際のポップオーバーから選ぶ。
    await choice.click();
    const option = page.locator(".se-list-picker").getByRole("option", { name: "tags", exact: true });
    await expect(option).toBeVisible();
    await option.click();
    await expect(choice).toHaveText("tags");
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
  }
  const before = await snapshot(page);
  for (const action of listActions) expect(before.doc.nodes[action].scripts[0].steps[0].array).toBe("tags");
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  const previewResults = await runOperations(page);
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await expect(page.locator('[id="tags-list"][data-array]')).toHaveCount(0);
  await expect(page.locator('[id="detail"]')).toHaveCount(4);
  for (const detail of await page.locator('[id="detail"]').all()) {
    await expect(detail).toHaveText("Detail {name}:{label}");
    await expect(detail).toBeVisible();
  }
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  expect(await runOperations(page)).toEqual(previewResults);
  expect(await snapshot(page)).toEqual(before);
  // スクリプトの画面を通して保存した文書（コンポーネントのスクリプトを含む）から生成し、同じ操作を確かめる。
  await page.setContent(await publishedNestedOperations(before.doc));
  await page.addScriptTag({ content: scriptsFile(before.doc) });
  expect(await runOperations(page)).toEqual(previewResults);
  expect(errors).toEqual([]);
});

test("script list chooser filters candidates, supports the keyboard, and dismisses without changing the list", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "Edit descending", exact: true }).click();
  const choice = page.locator('.se-flow [data-step-id="descending-step"] button.se-list-choice');
  await expect(choice).toHaveAttribute("aria-haspopup", "listbox");
  await choice.click();
  const menu = page.locator(".se-list-picker");
  const search = menu.locator("input");
  await search.fill("tag");
  await expect(menu.getByRole("option", { name: "tags", exact: true })).toHaveCount(1);
  await search.press("Enter");
  await expect(menu).toBeHidden();
  await expect(choice).toHaveText("tags");
  const before = await snapshot(page);

  await choice.click();
  await search.fill("no-such-list");
  await expect(menu.getByRole("option")).toHaveCount(0);
  await search.press("Escape");
  await expect(menu).toBeHidden();
  await expect(choice).toHaveText("tags");

  await choice.click();
  await page.locator(".se-flow").click({ position: { x: 5, y: 5 } });
  await expect(menu).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("list selection menu shows the first sampled row, not all 20 records", async ({ page }) => {
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as any).nestedOperationsStore.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps[0].preview.sample = Array.from({ length: 20 }, (_, index) => ({
      name: "Row " + index,
      tags: [{ label: "Tag " + index }],
    }));
  }));
  await page.getByRole("button", { name: "Edit descending", exact: true }).click();
  const choice = page.locator('.se-flow [data-step-id="descending-step"] button.se-list-choice');
  await choice.click();
  const menu = page.locator(".se-list-picker");
  await expect(menu.getByRole("option", { name: "response.0.tags", exact: true })).toBeVisible();
  await expect(menu.getByRole("option", { name: /^response\.[1-9]\d*(?:\.|$)/ })).toHaveCount(0);
  await menu.locator("input").fill("response.3.tags");
  await expect(menu.getByRole("option")).toHaveCount(0);
  await menu.locator("input").press("Enter");
  await expect(choice).toHaveText("response.3.tags");
  const saved = await snapshot(page);
  expect(saved.doc.nodes.descending.scripts[0].steps[0].array).toBe("response.3.tags");
});

test("custom list picker accepts a path absent from the sample choices", async ({ page }) => {
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "Edit descending", exact: true }).click();
  const choice = page.locator('.se-flow [data-step-id="descending-step"] button.se-list-choice');
  await choice.click();
  const menu = page.locator(".se-list-picker");
  await menu.locator("input").fill("tags.3");
  await expect(menu.getByRole("option")).toHaveCount(0);
  await menu.locator("input").press("Enter");
  await expect(menu).toBeHidden();
  await expect(choice).toHaveText("tags.3");
  const saved = await snapshot(page);
  expect(saved.doc.nodes.descending.scripts[0].steps[0].array).toBe("tags.3");
});
});

test.describe("nested-list-sources", () => {
let bundle: string;
test.beforeAll(async () => { bundle = await nestedListSourcesBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readEditorCss() });
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "リスト表示にする", exact: true }).click();
});
const source = (page: Page) => page.locator("aside .row").filter({
  has: page.locator("span.lbl", { hasText: /^表示するリスト$/ }),
}).locator("button");
const saved = (page: Page) => page.evaluate(() => {
  const { doc, past, selection } = (window as any).nestedListStore.getState();
  return { doc, past, selection };
});
async function choose(page: Page, name: string) {
  await source(page).click();
  await page.locator(".dd-item").filter({ has: page.locator(".dd-col > span:first-child", { hasText: new RegExp(`^${name}$`) }) }).click();
}

for (const [from, text] of [
  ["tags", "First productredblueSecond productgreen"],
  ["scores", "First product03Second product2"],
  ["flags", "First productfalsetrueSecond producttrue"],
]) test(`Selecting ${from} from outer items displays each value and supports save, Undo, and Redo`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const before = await saved(page);
  await choose(page, from);
  await expect(page.locator("#preview")).toHaveText(text);
  const after = await saved(page);
  expect(after.doc.nodes[after.selection].list.from).toBe(from);
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(after.doc.nodes.products).toEqual(before.doc.nodes.products);
  expect(after.doc.nodes.other).toEqual(before.doc.nodes.other);
  await page.evaluate(() => (window as any).nestedListStore.getState().undo());
  expect((await saved(page)).doc).toEqual(before.doc);
  await page.evaluate(() => (window as any).nestedListStore.getState().redo());
  await expect(page.locator("#preview")).toHaveText(text);
  await page.evaluate(() => {
    const store = (window as any).nestedListStore;
    store.getState().replaceDoc(JSON.parse(JSON.stringify(store.getState().doc)));
  });
  await expect(page.locator("#preview")).toHaveText(text);
  expect(errors).toEqual([]);
});

test("Empty arrays can be selected and later display values after sample updates", async ({ page }) => {
  await choose(page, "empty");
  await expect(source(page)).toHaveText("empty");
  const before = await saved(page);
  await page.evaluate(() => (window as any).nestedListStore.getState().updateDoc((doc: any) => {
    const sample = doc.pages.p.pageScripts[0].steps[0].preview.sample;
    sample[0].empty = ["New first"]; sample[1].empty = ["New second"];
  }));
  await expect(page.locator("#preview")).toHaveText("First productNew firstSecond productNew second");
  const after = await saved(page);
  expect(after.doc.nodes[before.selection]).toEqual(before.doc.nodes[before.selection]);
});
});

test.describe("nested-script-scope", () => {
const snapshot = (page: Page) => page.evaluate(() => {
  const s = (window as any).nestedScopeStore?.getState();
  return s ? { doc: s.doc, past: s.past, future: s.future } : null;
});
for (const preview of [true, false]) test(`${preview ? "preview" : "exported"}: nested row scripts affect only their own detail`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const doc = nestedScopeDoc();
  if (preview) {
    await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
    await page.addScriptTag({ content: await nestedScopeBundle(doc) });
    await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  } else {
    await page.setContent(await publishedNestedScope(doc));
    await page.addScriptTag({ content: scriptsFile(doc) });
  }
  const before = await snapshot(page);
  const detail = (label: string) => page.locator('[id="detail"]').filter({ hasText: new RegExp(`:${label}$`) });
  const product = (label: string) => page.locator('[id="product-name"]').filter({ hasText: label });
  const visible = async (hidden: string[]) => {
    for (const label of ["red", "blue", "green", "yellow"]) {
      if (hidden.includes(label)) await expect(detail(label)).toBeHidden();
      else await expect(detail(label)).toBeVisible();
    }
  };
  await visible([]);
  await page.getByRole("button", { name: "hide red", exact: true }).click();
  await visible(["red"]);
  await expect(product("First")).toBeHidden();
  await expect(product("Second")).toBeVisible();
  await page.getByRole("button", { name: "hide green", exact: true }).click();
  await visible(["red", "green"]);
  await page.getByRole("button", { name: "show green", exact: true }).click();
  await visible(["red"]);
  await expect(product("First")).toBeHidden();
  await expect(product("Second")).toBeVisible();
  await page.getByRole("button", { name: "hide yellow", exact: true }).click();
  await visible(["red", "yellow"]);
  await page.getByRole("button", { name: "show red", exact: true }).click();
  await visible(["yellow"]);
  expect(await snapshot(page)).toEqual(before);
  if (preview) {
    await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
    // デザインのモードでは、変数の参照を解決せず、テンプレートの文字を表示する。
    const designDetails = page.locator('[id="detail"]');
    await expect(designDetails).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(designDetails.nth(i)).toHaveText("Detail {name}:{label}");
      await expect(designDetails.nth(i)).toBeVisible();
    }
    await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
    await page.getByRole("button", { name: "hide green", exact: true }).click();
    await visible(["green"]);
    expect(await snapshot(page)).toEqual(before);
  }
  expect(errors).toEqual([]);
});
});
