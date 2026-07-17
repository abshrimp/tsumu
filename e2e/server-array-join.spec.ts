import { expect, test } from '@playwright/test';
import { makeText } from '../lib/presets';
import { scriptsFile } from '../lib/script-runtime';
import { publishedClientNested } from '../tests/helpers/client-nested-lists';
import { nestedScopeBundle } from '../tests/helpers/nested-script-scope';
import { serverArrayJoinDoc, serverArrayJoinItems } from '../tests/helpers/server-array-join';

for (const preview of [true, false]) test(`${preview ? 'Canvas' : 'export'} joins a fetched array on repeated clicks without exposing unused fields`, async ({ page }) => {
 const doc = serverArrayJoinDoc(), errors: string[] = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: serverArrayJoinItems } }));
 await page.goto('/robots.txt');
 if (preview) {
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await nestedScopeBundle(doc) });
  await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
 } else {
  await page.setContent(await publishedClientNested(doc, 'app/page.tsx', serverArrayJoinItems));
  await page.addScriptTag({ content: scriptsFile(doc) });
 }
 for (let repeat = 0; repeat < 2; repeat++) {
  await page.locator('#reload').click();
  await expect(page.locator('#result')).toHaveText('Alpha,Beta');
 }
 const scripts = await page.locator('[data-scripts]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-scripts')).join(''));
 expect(scripts).not.toMatch(/SECRET|private/);
 expect(errors).toEqual([]);
});

for (const array of ['tags', 'info.tags']) test(`export joins ${array} from the owning client ancestor across a cloned server list`, async ({ page }) => {
 const doc = serverArrayJoinDoc(), items = array === 'tags' ? [{ tags: ['Local'] }, { tags: null }] : [{ info: { tags: ['Local'] } }, { info: null }, { info: {} }], errors: string[] = [];
 page.on('pageerror', e => errors.push(e.message));
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
 doc.pages.p.pageScripts![0].steps.push(
  { id: 'tags', kind: 'split', source: 'Server', sep: ',', into: array },
  { id: 'inner', kind: 'split', source: 'one', sep: ',', into: 'inner' },
 );
 doc.pages.p.children = ['load', 'products', 'result'];
 doc.nodes.load = { ...makeText('Load'), id: 'load', attrId: 'load', semantic: 'button', scripts: [{ id: 'load', trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: 'copy', kind: 'set-var', value: '{response}', into: 'clients' }] }] };
 doc.nodes.products.list = { from: 'clients' }; doc.nodes.products.children = ['tags'];
 doc.nodes.tags.list = { from: 'inner' }; doc.nodes.tags.children = ['reload'];
 Object.assign(doc.nodes.reload.scripts![0].steps[0], { array, field: '' });
 await page.goto('/robots.txt');
 await page.setContent(await publishedClientNested(doc, 'app/page.tsx', items));
 await page.addScriptTag({ content: scriptsFile(doc) });
 for (let repeat = 0; repeat < 2; repeat++) {
  await page.locator('#load').click();
  const buttons = page.locator('[id="reload"]').filter({ visible: true });
  await buttons.nth(0).click(); await expect(page.locator('#result')).toHaveText('Local');
  for (let i = 1; i < items.length; i++) { await buttons.nth(i).click(); await expect(page.locator('#result')).toHaveText(''); }
 }
 expect(errors).toEqual([]);
});

test('a closer server row keeps its join value ahead of an outer client row', async ({ page }) => {
 const doc = serverArrayJoinDoc(), items = [{ info: { tags: ['Outer'] }, children: [{ info: { tags: ['Inner'] } }, { info: null }, { info: {} }] }];
 const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
 doc.pages.p.pageScripts![0].steps.push(
  { id: 'page', kind: 'split', source: 'Page', sep: ',', into: 'info.tags' },
  { id: 'inner', kind: 'set-var', value: '{response.0.children}', into: 'inner' },
 );
 doc.pages.p.children = ['load', 'products', 'result'];
 doc.nodes.load = { ...makeText('Load'), id: 'load', attrId: 'load', semantic: 'button', scripts: [{ id: 'load', trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: 'copy', kind: 'set-var', value: '{response}', into: 'clients' }] }] };
 doc.nodes.products.list = { from: 'clients' }; doc.nodes.products.children = ['tags'];
 doc.nodes.tags.list = { from: 'inner' }; doc.nodes.tags.children = ['reload'];
 Object.assign(doc.nodes.reload.scripts![0].steps[0], { array: 'info.tags', field: '' });
 await page.goto('/robots.txt');
 await page.setContent(await publishedClientNested(doc, 'app/page.tsx', items));
 await page.addScriptTag({ content: scriptsFile(doc) });
 for (let repeat = 0; repeat < 2; repeat++) {
  await page.locator('#load').click();
  const buttons = page.locator('[id="reload"]').filter({ visible: true });
  for (const [i, expected] of ['Inner', '', ''].entries()) {
   await buttons.nth(i).click(); await expect(page.locator('#result')).toHaveText(expected);
  }
 }
 expect(errors).toEqual([]);
});
