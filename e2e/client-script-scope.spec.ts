import { expect, test } from '@playwright/test';
import { makeText } from '../lib/presets';
import { scriptsFile } from '../lib/script-runtime';
import { clientScriptBundle, clientScriptFixture } from '../tests/helpers/client-script-scope';
import { publishedClientNested } from '../tests/helpers/client-nested-lists';

for (const component of [false, true]) test(`${component ? 'component' : 'plain'} generated row scripts preserve typed data and read edited fields on click`, async ({ page }) => {
  const { doc, items } = clientScriptFixture(component);
  doc.nodes.entry = { ...makeText(''), id: 'entry', attrId: 'entry', type: 'field', field: { kind: 'input', inputType: 'text' } };
  doc.pages.p.children.push('entry');
  doc.nodes.act.scripts![0].steps.push({ id: 'field', kind: 'set-var', value: '{name}|{entry}', into: 'chosen' });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: items } }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await clientScriptBundle(doc) });
  const snapshot = () => page.evaluate(() => (window as any).clientScriptStore.getState().doc);
  const before = await snapshot();
  await page.getByRole('button', { name: 'Edit action', exact: true }).click();
  const input = page.locator('.se-ws [data-sel-key="step:field"] input').first();
  await input.fill('{name}|{entry}|Edited'); await input.press('Tab');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const saved = await snapshot();
  expect(saved.nodes.act.scripts[0].steps.at(-1).value).toBe('{name}|{entry}|Edited');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await snapshot()).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await snapshot()).toEqual(saved);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click(); expect(await snapshot()).toEqual(saved);
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
