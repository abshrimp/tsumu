import { expect, test, type Locator, type Page } from '@playwright/test';
import { componentListBundle, publishedComponentList } from '../tests/helpers/component-list-export';
import { defaultAudioDoc, audioSource } from '../tests/helpers/default-audio';
import { generateProject } from '../lib/generator';

const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).componentListStore.getState();
  return { doc, past, future };
});
async function expectControls(audio: Locator) {
  await expect(audio).toBeVisible();
  await expect(audio).toHaveJSProperty('controls', true);
  await expect(audio).toHaveAttribute('src', audioSource);
  await expect.poll(() => audio.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(20);
  await expect.poll(() => audio.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(100);
}

test(`component default audio controls survive settings save, design, preview and generated CSS`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(audioSource, route => route.fulfill({ contentType: 'audio/wav', body: Buffer.from('RIFF') }));
  const doc = defaultAudioDoc(true);
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await componentListBundle(doc, 'audio') });
  const input = page.locator('aside .row').filter({ has: page.locator('label', { hasText: /^(ファイルURL|File URL)$/ }) }).locator('input');
  await expect(input).toHaveValue('');
  const before = await snapshot(page);
  await input.fill(audioSource);
  await input.press('Tab');
  const saved = await snapshot(page);
  expect(saved.doc.nodes.audio.media.src).toBe(audioSource);
  expect(saved.doc.nodes.audio.styles).toEqual(doc.nodes.audio.styles);
  expect(saved.past.length).toBeGreaterThan(before.past.length);
  const audio = page.locator('.cv-root audio#audio').filter({ visible: true });
  await expect(audio).toHaveCount(1);
  await expectControls(audio);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await expect(page.locator('.cv-root audio')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await expectControls(audio);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  const reloaded = await snapshot(page);
  for (let i = 0; i < 2; i++) {
    await expectControls(audio);
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
    await expectControls(audio);
    expect(await snapshot(page)).toEqual(reloaded);
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
    expect(await snapshot(page)).toEqual(reloaded);
  }
  // 生成したページだけでなく、実際に出力するCSSも適用する。
  const { files } = generateProject(saved.doc);
  const html = await publishedComponentList(saved.doc);
  await page.setContent(`<html><head><style>${files['app/globals.css']}\n${files['styles/site.css']}</style></head><body>${html}</body></html>`);
  await expectControls(page.locator('audio#audio'));
  expect(errors).toEqual([]);
});
