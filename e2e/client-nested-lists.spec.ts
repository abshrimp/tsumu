import { expect, test, type Page } from "@playwright/test";
import { nestedScopeItems } from "../tests/helpers/nested-script-scope";
import { pagePlan } from "../lib/data";
import { scriptsFile } from "../lib/script-runtime";
import { clientNestedBundle, clientNestedDoc, publishedClientNested } from "../tests/helpers/client-nested-lists";

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
  const source = page.locator('aside .row').filter({ has: page.locator('label', { hasText: /^表示するリスト$/ }) }).locator('button');
  await source.click();
  await page.locator('.dd-item').filter({ has: page.locator('.dd-col > span:first-child', { hasText: /^tags$/ }) }).click();
  await expect(source).toHaveText('tags');
  const configured = await snapshot(page);
  await page.getByRole('button', { name: 'Edit loading', exact: true }).click();
  const value = page.locator('.se-ws [data-sel-key="step:reload-step"] input').first();
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
  // Navigate away and back with the production-style persistent runtime to reset temporary values and operations.
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
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
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
    // A typed null condition must not match an empty-string label.
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
  const source = page.locator('aside .row').filter({ has: page.locator('label', { hasText: /^表示するリスト$/ }) }).locator('button');
  await source.click();
  await page.locator('.dd-item').filter({ has: page.locator('.dd-col > span:first-child', { hasText: /^tags$/ }) }).click();
  const configured = await snapshot(page);
  await page.getByRole('button', { name: 'Edit loading', exact: true }).click();
  const value = page.locator('.se-ws [data-sel-key="step:reload-step"] input').first();
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
  const source = page.locator('aside .row').filter({ has: page.locator('label', { hasText: /^表示するリスト$/ }) }).locator('button');
  await source.click();
  await page.locator('.dd-item').filter({ has: page.locator('.dd-col > span:first-child', { hasText: /^tags$/ }) }).click();
  await page.getByRole('button', { name: 'Edit loading', exact: true }).click();
  const value = page.locator('.se-ws [data-sel-key="step:reload-step"] input').first();
  await value.fill('{response}'); await value.press('Tab');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  // Only selection is assisted; URL editing, history, and saving go through the actual Settings panel.
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
