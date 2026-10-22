import { expect, test, type Page } from '@playwright/test';
import { componentListBundle, publishedComponentList } from '../tests/helpers/component-list-export';
import { clientFieldDoc, fieldItems } from '../tests/helpers/client-field-scope';
import { clientImageDoc, imageItems } from '../tests/helpers/client-image-scope';
import { clientLiteralAttributesDoc, literalItems, literalText, literalSource, literalEmbed } from '../tests/helpers/client-literal-attributes';
import { scriptsFile } from '../lib/script-runtime';
import { createInitialDoc, makeField, makeText } from '../lib/presets';
import { fieldDefaults } from '../lib/fields';

const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).componentListStore.getState(); return { doc, past, future };
});
const fields = (page: Page, id: string) => page.locator('#' + id).filter({ visible: true });
async function checkFields(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    for (const id of ['entry', 'memo', 'choice']) {
      await expect(fields(page, id)).toHaveCount(2);
      await expect(fields(page, id).nth(0)).toHaveValue('Edit First');
      await expect(fields(page, id).nth(1)).toHaveValue('Edit Second');
    }
    await expect(fields(page, 'entry').nth(1)).toHaveAttribute('placeholder', 'Find Second');
  }
}

test(`component field edits retain row defaults through preview, undo, save and generated navigation`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: fieldItems } }));
  await page.goto('/robots.txt'); await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  const doc = clientFieldDoc(true); doc.nodes.entry.field!.defaultValue = 'Before';
  await page.addScriptTag({ content: await componentListBundle(doc, 'entry') });
  const input = page.locator('aside .row').filter({ has: page.locator('label', { hasText: /^初期値$/ }) }).locator('input');
  const before = await snapshot(page); await expect(input).toHaveValue('Before');
  await input.fill('Edit {name}'); await input.press('Tab'); const saved = await snapshot(page);
  expect(saved.doc.nodes.entry.field.defaultValue).toBe('Edit {name}');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click(); const reloaded = await snapshot(page);
  await page.getByRole('button', { name: 'Toggle preview', exact: true }).click(); await checkFields(page); expect(await snapshot(page)).toEqual(reloaded);
  const html = await publishedComponentList(saved.doc, 'app/page.tsx', fieldItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) }); await checkFields(page);
  const reset = await fields(page, 'memo').nth(1).evaluate((el: HTMLTextAreaElement) => {
    const value = el.value, initial = el.defaultValue, form = document.createElement('form');
    const clone = el.cloneNode(true) as HTMLTextAreaElement; form.append(clone); clone.value = 'Typed'; form.reset();
    return { value, initial, reset: clone.value };
  });
  expect(reset).toEqual({ value: 'Edit Second', initial: 'Edit Second', reset: 'Edit Second' });
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await page.evaluate(content => { document.body.innerHTML = content; }, html); await checkFields(page); expect(errors).toEqual([]);
});

test('native generated fields preserve typed values and normalize row-specific ranges', async ({ page }) => {
  const doc = clientFieldDoc();
  const items = [{ name: 'First', lower: '1', upper: '9', step: '2', number: '7', largeMin: '100', largeMax: '200', tags: [{}] }, { name: 'Second', lower: '2', upper: '8', step: '2', number: '6', largeMin: '200', largeMax: '400', tags: [{}] }];
  (doc.pages.p.pageScripts![0].steps[0] as any).sample = items;
  doc.nodes.memo.field!.defaultValue = '{name}: {live}'; doc.nodes.memo.field!.placeholder = '{name}: {live}';
  doc.nodes.entry.field = { kind: 'input', inputType: 'range', min: '{lower}', max: '{upper}', step: '{step}', defaultValue: '{number}' };
  for (const [id, value] of [['staticRange', '150'], ['emptyRange', undefined]]) {
    doc.nodes[id!] = { ...makeText(''), id: id!, attrId: id!, type: 'field', text: null, field: {
      kind: 'input', inputType: 'range', min: '{largeMin}', max: '{largeMax}', step: '10', defaultValue: value,
    } }; doc.nodes.row.children.push(id!);
  }
  doc.nodes.change = { ...makeText('Change live'), id: 'change', attrId: 'change', semantic: 'button', scripts: [{ id: 'change-script', trigger: 'click', steps: [
    { id: 'change-live', kind: 'set-var', into: 'live', value: 'Later \\{name}' },
  ] }] }; doc.pages.p.children.unshift('change');
  await page.goto('/robots.txt');
  await page.setContent(await publishedComponentList(doc, 'app/page.tsx', items)); await page.addScriptTag({ content: scriptsFile(doc) });
  await page.getByRole('button', { name: 'Load items', exact: true }).click();
  await expect(fields(page, 'entry').nth(0)).toHaveValue('7'); await expect(fields(page, 'entry').nth(1)).toHaveValue('6');
  await expect(fields(page, 'staticRange').nth(0)).toHaveValue('150'); await expect(fields(page, 'staticRange').nth(1)).toHaveValue('200');
  await expect(fields(page, 'emptyRange').nth(0)).toHaveValue('150'); await expect(fields(page, 'emptyRange').nth(1)).toHaveValue('300');
  await fields(page, 'memo').nth(1).fill('Typed');
  await page.getByRole('button', { name: 'Change live', exact: true }).click();
  await expect(fields(page, 'memo').nth(0)).toHaveValue('First: Later {name}');
  await expect(fields(page, 'memo').nth(1)).toHaveValue('Typed');
  await expect(fields(page, 'memo').nth(1)).toHaveAttribute('placeholder', 'Second: Later {name}');
});

test('radio preview defaults match the browser last checked selection', async ({ page }) => {
  const doc = createInitialDoc();
  const radioFields = [
    { id: 'first', label: 'First', checked: true },
    { id: 'second', label: 'Second', checked: true },
    { id: 'third', label: 'Unchecked', checked: false },
  ].map(({ id, label, checked }) => ({
    ...makeField('radio'), id, attrId: id,
    field: { kind: 'radio' as const, group: 'choice', label, checked },
  }));
  doc.nodes = Object.fromEntries(radioFields.map(node => [node.id, node]));
  doc.pages[doc.pageOrder[0]].children = radioFields.map(node => node.id);
  const expected = fieldDefaults(radioFields).choice;
  expect(expected).toBe('Second');
  await page.setContent(await publishedComponentList(doc));
  const radios = page.locator('input[type="radio"][name="choice"]');
  await expect(radios).toHaveCount(3);
  await expect(radios.nth(0)).not.toBeChecked();
  await expect(radios.nth(1)).toBeChecked();
  await expect(radios.nth(2)).not.toBeChecked();
  await expect(page.locator('input[name="choice"]:checked')).toHaveValue(expected);
});

const pictures = (page: Page) => page.locator('img[alt="Row image"]').filter({ visible: true });
async function checkImages(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    await expect(pictures(page)).toHaveCount(2);
    await expect(pictures(page).nth(0)).toHaveAttribute('src', '/images/First.png');
    await expect(pictures(page).nth(1)).toHaveAttribute('src', '/images/Second.png');
  }
}

test(`component image URL edits preserve row scope through preview, save and export`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: imageItems } }));
  await page.route('**/images/*.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await componentListBundle(clientImageDoc(true, '/images/before.png'), 'picture') });
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
    await checkImages(page); expect(await snapshot(page)).toEqual(reloaded);
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
  }
  const html = await publishedComponentList(saved.doc, 'app/page.tsx', imageItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) });
  await checkImages(page);
  await expect(pictures(page).nth(0)).not.toHaveAttribute('srcset');
  await expect(pictures(page).nth(1)).not.toHaveAttribute('srcset');
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(pictures(page)).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await checkImages(page); expect(errors).toEqual([]);
});

async function checkLiterals(page: Page) {
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

test(`component literal attributes persist through editor save, preview and export`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: literalItems } }));
  await page.route('https://example.com/**', route => route.fulfill({ body: '' }));
  const doc = clientLiteralAttributesDoc(true); doc.nodes.picture.image!.alt = 'Before';
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await componentListBundle(doc, 'picture') });
  // 変更は、実際の設定のパネルから行う。
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
    await checkLiterals(page); expect(await snapshot(page)).toEqual(reloaded);
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
  }
  const html = await publishedComponentList(saved.doc, 'app/page.tsx', literalItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) });
  await checkLiterals(page);
  const svgs = page.locator('#svg img').filter({ visible: true });
  await expect(svgs).toHaveCount(3);
  for (const svg of await svgs.all()) await expect(svg).toHaveAttribute('alt', literalText);
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(page.locator('#picture')).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await checkLiterals(page); expect(errors).toEqual([]);
});
