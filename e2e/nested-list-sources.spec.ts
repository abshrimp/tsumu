import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { nestedListSourcesBundle } from "../tests/helpers/nested-list-sources";

let bundle: string;
test.beforeAll(async () => { bundle = await nestedListSourcesBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readFileSync("app/globals.css", "utf8") });
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "リスト表示にする", exact: true }).click();
});
const source = (page: Page) => page.locator("aside .row").filter({
  has: page.locator("label", { hasText: /^表示するリスト$/ }),
}).locator("button");
const saved = (page: Page) => page.evaluate(() => {
  const { doc, past, selection } = (window as any).nestedListStore.getState();
  return { doc, past, selection };
});
async function choose(page: Page, name: string) {
  await source(page).click();
  await page.locator(".dd-item").filter({ has: page.locator(".dd-col > span:first-child", { hasText: new RegExp(`^${name}$`) }) }).click();
}

for (const [from, text] of [
  ["tags", "First productredblueSecond productgreen"],
  ["scores", "First product03Second product2"],
  ["flags", "First productfalsetrueSecond producttrue"],
]) test(`Selecting ${from} from outer items displays each value and supports save, Undo, and Redo`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const before = await saved(page);
  await choose(page, from);
  await expect(page.locator("#preview")).toHaveText(text);
  const after = await saved(page);
  expect(after.doc.nodes[after.selection].list.from).toBe(from);
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(after.doc.nodes.products).toEqual(before.doc.nodes.products);
  expect(after.doc.nodes.other).toEqual(before.doc.nodes.other);
  await page.evaluate(() => (window as any).nestedListStore.getState().undo());
  expect((await saved(page)).doc).toEqual(before.doc);
  await page.evaluate(() => (window as any).nestedListStore.getState().redo());
  await expect(page.locator("#preview")).toHaveText(text);
  await page.evaluate(() => {
    const store = (window as any).nestedListStore;
    store.getState().replaceDoc(JSON.parse(JSON.stringify(store.getState().doc)));
  });
  await expect(page.locator("#preview")).toHaveText(text);
  expect(errors).toEqual([]);
});

test("Empty arrays can be selected and later display values after sample updates", async ({ page }) => {
  await choose(page, "empty");
  await expect(source(page)).toHaveText("empty");
  const before = await saved(page);
  await page.evaluate(() => (window as any).nestedListStore.getState().updateDoc((doc: any) => {
    const sample = doc.pages.p.pageScripts[0].steps[0].sample;
    sample[0].empty = ["New first"]; sample[1].empty = ["New second"];
  }));
  await expect(page.locator("#preview")).toHaveText("First productNew firstSecond productNew second");
  const after = await saved(page);
  expect(after.doc.nodes[before.selection]).toEqual(before.doc.nodes[before.selection]);
});
