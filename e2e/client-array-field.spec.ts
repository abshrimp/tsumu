import { expect, test } from '@playwright/test';
import { scriptsFile } from '../lib/script-runtime';
import { clientArrayFieldFixture } from '../tests/helpers/client-array-field';
import { clientScriptBundle } from '../tests/helpers/client-script-scope';
import { publishedClientNested } from '../tests/helpers/client-nested-lists';

for (const component of [false, true]) test(`${component ? 'component' : 'plain'} array-field edited through ScriptEditor uses each target item`, async ({ page }) => {
  const { doc, items } = clientArrayFieldFixture(component);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: items } }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await clientScriptBundle(doc) });
  const snapshot = () => page.evaluate(() => (window as any).clientScriptStore.getState().doc);
  const before = await snapshot();
  await page.getByRole('button', { name: 'Edit action', exact: true }).click();
  const block = page.locator('.se-ws [data-sel-key="step:field"]');
  await expect(block.locator('select').first()).toHaveValue('targets');
  await block.getByRole('combobox', { name: '値の入力方法', exact: true }).selectOption('text');
  const input = block.locator('.se-value-choice input');
  await input.fill('{name}|{counter}|{entry}|\\{name}'); await input.press('Tab');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const saved = await snapshot();
  expect(saved.nodes.act.scripts[0].steps[0]).toMatchObject({ kind: 'array-field', array: 'targets', field: 'copied', value: '{name}|{counter}|{entry}|\\{name}' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await snapshot()).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await snapshot()).toEqual(saved);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click(); expect(await snapshot()).toEqual(saved);
  const html = await publishedClientNested(saved, 'app/page.tsx', items);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved) });
  for (let pass = 0; pass < 2; pass++) {
    await page.locator('#reload').click(); await page.locator('#change').click();
    const fields = page.locator('[id="entry"]').filter({ visible: true });
    await fields.nth(1).fill(`Edited ${pass} {name}`);
    await page.locator('[id="act"]').filter({ visible: true }).nth(1).click();
    await expect(page.locator('#result')).toHaveText(`First {label}|7|Edited ${pass} {name}|{name}|Second|7|Edited ${pass} {name}|{name}`);
    await expect(page.locator('#raw-result')).toHaveText('Raw {name}|false');
    await fields.nth(0).fill('First input');
    await page.locator('[id="act"]').filter({ visible: true }).nth(0).click();
    await expect(page.locator('#result')).toHaveText('First {label}|7|First input|{name}|Second|7|First input|{name}');
  }
  expect(errors).toEqual([]);
});
