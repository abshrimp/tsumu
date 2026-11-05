import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { componentListBundle, componentListDoc, publishedComponentList } from "../tests/helpers/component-list-export";

const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).componentListStore.getState();
  return { doc, past, future };
});
async function checkScopes(page: Page) {
  for (const label of ["red", "blue", "green", "yellow"]) {
    await expect(page.locator('[id="detail"]').filter({ hasText: new RegExp(`:${label}$`) })).toBeVisible();
  }
  await page.getByRole("button", { name: "hide blue", exact: true }).click();
  await expect(page.locator('[id="detail"]').filter({ hasText: /:blue$/ })).toBeHidden();
  for (const label of ["red", "green", "yellow"]) {
    await expect(page.locator('[id="detail"]').filter({ hasText: new RegExp(`:${label}$`) })).toBeVisible();
  }
  await page.getByRole("button", { name: "show blue", exact: true }).click();
  await expect(page.locator('[id="detail"]').filter({ hasText: /:blue$/ })).toBeVisible();
  await page.getByRole("button", { name: "Hide First", exact: true }).click();
  await expect(page.locator('[id="product-name"]').filter({ hasText: "First" })).toBeHidden();
  await expect(page.locator('[id="product-name"]').filter({ hasText: "Second" })).toBeVisible();
}

test("convert a nested-list card in SettingsPanel, undo/redo/reload, then run the same saved export", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await componentListBundle() });
  await expect(page.locator('[id="detail"]')).toHaveCount(4);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "コンポーネント化", exact: true }).click();
  const after = await snapshot(page);
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(after.doc.nodes[after.doc.nodes.products.children[0]].type).toBe("instance");
  await expect(page.locator('[id="detail"]')).toHaveCount(4);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(after.doc);
  await page.getByRole("button", { name: "Reload saved", exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(after.doc);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await checkScopes(page);
  expect((await snapshot(page)).doc).toEqual(after.doc);
  await page.setContent(await publishedComponentList(after.doc));
  await page.addScriptTag({ content: scriptsFile(after.doc) });
  await checkScopes(page);
  expect(errors).toEqual([]);
});


test("converted client list keeps its template and renders browser-loaded items", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const doc = componentListDoc();
  doc.pages.p.children = ["card"];
  doc.nodes.detail.text!.content = "Tag {値}";
  doc.pages.p.pageScripts = [{ id: "client-load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
    { id: "load-raw", kind: "store-load", key: "raw-tags", into: "rawTags" },
    { id: "split-tags", kind: "split", source: "{rawTags}", sep: ",", into: "tags" },
  ] }];
  await page.goto("/robots.txt");
  await page.evaluate(() => localStorage.setItem("raw-tags", "red,blue"));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await componentListBundle(doc) });
  await page.getByRole("button", { name: "コンポーネント化", exact: true }).click();
  const saved = (await snapshot(page)).doc;
  await page.setContent(await publishedComponentList(saved));
  await expect(page.locator("[data-client-list] [data-tpl]")).toHaveCount(1);
  await page.addScriptTag({ content: scriptsFile(saved) });
  await expect(page.locator('[data-client-list] > [data-item] [id="detail"]')).toHaveText(["Tag red", "Tag blue"]);
  expect(errors).toEqual([]);
});
