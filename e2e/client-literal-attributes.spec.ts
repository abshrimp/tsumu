import { expect, test, type Page } from '@playwright/test';
import { componentListBundle, publishedComponentList } from '../tests/helpers/component-list-export';
import { clientLiteralAttributesDoc, literalItems, literalText, literalSource, literalEmbed } from '../tests/helpers/client-literal-attributes';
import { scriptsFile } from '../lib/script-runtime';

const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).componentListStore.getState(); return { doc, past, future };
});
async function check(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    for (const [selector, attribute, value] of [
      ['img#picture', 'alt', literalText], ['#audio', 'src', literalSource],
      ['#video', 'src', literalSource], ['#frame iframe', 'src', literalEmbed],
    ]) {
      const nodes = page.locator(selector).filter({ visible: true });
      await expect(nodes).toHaveCount(3);
      for (const node of await nodes.all()) await expect(node).toHaveAttribute(attribute, value);
    }
  }
}
for (const component of [false, true]) test(`${component ? 'component' : 'plain'} literal attributes persist through editor save, preview and export`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: literalItems } }));
  await page.route('https://example.com/**', route => route.fulfill({ body: '' }));
  const doc = clientLiteralAttributesDoc(component); doc.nodes.picture.image!.alt = 'Before';
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await componentListBundle(doc, 'picture') });
  // 実際の設定画面から変更する。
  const altInput = page.locator('aside .row').filter({ has: page.locator('label', { hasText: /^(代替テキスト|Alt text)$/ }) }).locator('input');
  await expect(altInput).toHaveValue('Before');
  const before = await snapshot(page);
  await altInput.fill(literalText); await altInput.press('Tab');
  const saved = await snapshot(page);
  expect(saved.doc.nodes.picture.image.alt).toBe(literalText);
  expect(saved.past.length).toBeGreaterThan(before.past.length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  const reloaded = await snapshot(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
    await check(page); expect(await snapshot(page)).toEqual(reloaded);
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
  }
  const html = await publishedComponentList(saved.doc, 'app/page.tsx', literalItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) });
  await check(page);
  const svgs = page.locator('#svg img').filter({ visible: true });
  await expect(svgs).toHaveCount(3);
  for (const svg of await svgs.all()) await expect(svg).toHaveAttribute('alt', literalText);
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(page.locator('#picture')).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await check(page); expect(errors).toEqual([]);
});
