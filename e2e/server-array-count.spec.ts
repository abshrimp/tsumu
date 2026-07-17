import { expect, test } from '@playwright/test';
import { scriptsFile } from '../lib/script-runtime';
import { publishedClientNested } from '../tests/helpers/client-nested-lists';
import { nestedScopeBundle } from '../tests/helpers/nested-script-scope';
import { serverArrayJoinDoc, serverArrayJoinItems } from '../tests/helpers/server-array-join';

for (const mode of ['server', 'client', 'filtered', 'owned-filtered', 'inherited-filtered', 'limited'] as const) for (const preview of [true, false]) test(`${mode}: ${preview ? 'Canvas' : 'export'} counts a fetched array on repeated clicks without exposing unused fields`, async ({ page }) => {
 const doc = serverArrayJoinDoc(), errors: string[] = [];
 const owned = mode === 'owned-filtered' || mode === 'inherited-filtered' || mode === 'limited';
 const data = owned ? [{ tags: [{ name: 'Alpha' }, { name: 'Beta' }] }, { tags: [{ name: 'Alpha' }, { name: 'Alpha' }, { name: 'Beta' }] }] : serverArrayJoinItems;
 if (owned) data.forEach(item => Object.assign(item, { children: [{ child: 'one' }] }));
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = data;
 doc.nodes.reload.scripts![0].steps = [{ id: 'count', kind: 'count', array: 'response', into: 'joined' }];
 if (mode === 'client') doc.nodes.reload.scripts![0].steps.unshift({ id: 'write', kind: 'split', source: 'a,b,c', sep: ',', into: 'response' });
 if (mode === 'filtered') {
  doc.pages.p.children = ['products', 'reload', 'result'];
  doc.nodes.products.list = { from: 'response' }; doc.nodes.products.children = [];
  doc.nodes.reload.scripts![0].steps.unshift({ id: 'filter', kind: 'filter-array', array: 'response', field: 'name', op: 'eq', value: 'Alpha' });
 }
 if (owned) {
  doc.pages.p.children = ['products', 'result'];
  doc.nodes.products.list = { from: 'response' }; doc.nodes.products.children = ['tags', 'reload'];
  doc.nodes.tags.list = { from: 'tags' }; doc.nodes.tags.children = [];
  doc.nodes.reload.scripts![0].steps = [
   { id: 'filter', kind: 'filter-array', array: 'tags', field: 'name', op: 'eq', value: 'Alpha' },
   { id: 'count', kind: 'count', array: 'tags', into: 'joined' },
  ];
 }
 if (mode === 'inherited-filtered') {
  doc.nodes.products.children = ['middle'];
  doc.nodes.middle = { ...doc.nodes.products, id: 'middle', list: { from: 'children' }, children: ['tags', 'reload'] };
 }
 if (mode === 'limited') {
  for (const node of Object.values(doc.nodes)) if (node.id !== 'reload') delete node.scripts;
  doc.nodes.tags.list!.limit = 1;
  doc.nodes.reload.scripts![0].steps = [{ id: 'count', kind: 'count', array: 'tags', into: 'joined' }];
 }
 page.on('pageerror', e => errors.push(e.message));
 await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: data } }));
 await page.goto('/robots.txt');
 if (preview) {
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await nestedScopeBundle(doc) });
  await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
 } else {
  await page.setContent(await publishedClientNested(doc, 'app/page.tsx', data));
  await page.addScriptTag({ content: scriptsFile(doc) });
 }
 for (let repeat = 0; repeat < 2; repeat++) {
  if (owned) {
   for (let i = 0; i < 2; i++) {
    await page.locator('#reload').nth(i).click();
    await expect(page.locator('#result')).toHaveText(mode === 'limited' ? '1' : String(i + 1));
   }
  } else {
   await page.locator('#reload').click();
   await expect(page.locator('#result')).toHaveText(mode === 'client' ? '3' : mode === 'filtered' ? '1' : '2');
  }
 }
 const scripts = await page.locator('[data-scripts]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-scripts')).join(''));
 expect(scripts).not.toMatch(/SECRET|private/);
 expect(errors).toEqual([]);
});

