import { expect, test, type Page } from '@playwright/test';
import { componentListBundle, publishedComponentList } from '../tests/helpers/component-list-export';
import { clientImageDoc, imageItems } from '../tests/helpers/client-image-scope';
import { scriptsFile } from '../lib/script-runtime';

const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).componentListStore.getState(); return { doc, past, future };
});
const pictures = (page: Page) => page.locator('img[alt="Row image"]').filter({ visible: true });
async function check(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    await expect(pictures(page)).toHaveCount(2);
    await expect(pictures(page).nth(0)).toHaveAttribute('src', '/images/First.png');
    await expect(pictures(page).nth(1)).toHaveAttribute('src', '/images/Second.png');
  }
}
for (const component of [false, true]) test(`${component ? 'component' : 'plain'} image URL edits preserve row scope through preview, save and export`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: imageItems } }));
  await page.route('**/images/*.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await componentListBundle(clientImageDoc(component, '/images/before.png'), 'picture') });
  const input = page.locator('aside [data-tutorial="settings-image"] .row').filter({ has: page.locator('label', { hasText: /^URL$/ }) }).locator('input');
  await expect(input).toHaveValue('/images/before.png');
  const before = await snapshot(page);
  await input.fill('/images/{name}.png'); await input.press('Tab');
  const saved = await snapshot(page);
  expect(saved.doc.nodes.picture.image.src).toBe('/images/{name}.png');
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
  const html = await publishedComponentList(saved.doc, 'app/page.tsx', imageItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) });
  await check(page);
  await expect(pictures(page).nth(0)).not.toHaveAttribute('srcset');
  await expect(pictures(page).nth(1)).not.toHaveAttribute('srcset');
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(pictures(page)).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await check(page); expect(errors).toEqual([]);
});
