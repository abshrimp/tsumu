import { expect, test, type Page } from "@playwright/test";
import { serverSourceItems, serverSourceBundle } from "../tests/helpers/server-parent-list-source";
import { scriptsFile } from "../lib/script-runtime";
import { publishedClientNested } from "../tests/helpers/client-nested-lists";

const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).serverSourceStore.getState(); return { doc, past, future };
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
test(`component server parent and browser child: configure, preview, reload and execute export`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: serverSourceItems } }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await serverSourceBundle(true) });
  const source = page.locator('aside .row').filter({ has: page.locator('label', { hasText: /^表示するリスト$/ }) }).locator('button');
  await source.click();
  await page.locator('.dd-item').filter({ has: page.locator('.dd-col > span:first-child', { hasText: /^tags$/ }) }).click();
  await expect(source).toHaveText('tags');
  const configured = await snapshot(page);
  await page.getByRole('button', { name: 'Edit loading', exact: true }).click();
  const value = page.locator('.se-ws [data-sel-key="step:reload-step"] input').first();
  await value.fill('global,other'); await value.press('Tab');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const saved = await snapshot(page);
  expect(saved.doc.nodes.reload.scripts[0].steps[0].source).toBe('global,other');
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
  const html = await publishedClientNested(saved.doc, 'app/page.tsx', serverSourceItems);
  expect(html).not.toContain('PRIVATE_SERVER_SENTINEL');
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) });
  await check(page);
  // 本番と同じ常駐ランタイムで別ページへ移動し、戻ったときの変数と操作をリセットする。
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(details(page)).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await check(page);
  expect(errors).toEqual([]);
});
