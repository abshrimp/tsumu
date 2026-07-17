import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { emptyListBundle, publishedEmptyList } from "../tests/helpers/empty-list-preview";

const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).emptyListStore.getState();
  return { doc, past, future };
});
async function setup(page: Page, items: readonly unknown[]) {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readFileSync("app/globals.css", "utf8") });
  await page.addScriptTag({ content: await emptyListBundle(items) });
  await page.getByRole("button", { name: "リスト表示にする", exact: true }).click();
  const before = await snapshot(page);
  const row = page.locator("aside .row").filter({ has: page.locator("label", { hasText: /^表示するリスト$/ }) });
  await row.locator("button").click();
  await page.locator(".dd-item").filter({ has: page.locator(".dd-col > span:first-child", { hasText: /^tags$/ }) }).click();
  return { errors, before };
}
const toggle = (page: Page) => page.getByRole("button", { name: "Toggle preview", exact: true }).click();
for (const [name, items, expected] of [
  ["first nested array empty", [{ name: "First", tags: [] }, { name: "Second", tags: ["green"] }], "FirstSecondTag: green"],
  ["later nested array empty", [{ name: "First", tags: ["red"] }, { name: "Second", tags: [] }], "FirstTag: redSecond"],
  ["all nested arrays empty", [{ name: "First", tags: [] }, { name: "Second", tags: [] }], "FirstSecond"],
  ["later nested array absent", [{ name: "First", tags: ["red"] }, { name: "Second" }], "FirstTag: redSecond"],
] as const) test(`${name}: settings, preview, history, reload and generated page have no phantom rows`, async ({ page }) => {
  const { errors, before } = await setup(page, structuredClone(items));
  const saved = await snapshot(page);
  expect(saved.past).toHaveLength(before.past.length + 1);
  await toggle(page);
  await expect(page.locator("#preview")).toHaveText(expected);
  await expect(page.locator("#preview .cv-placeholder")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(saved);
  await toggle(page);
  await page.evaluate(() => (window as any).emptyListStore.getState().undo());
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.evaluate(() => (window as any).emptyListStore.getState().redo());
  expect(await snapshot(page)).toEqual(saved);
  await page.evaluate(() => {
    const s = (window as any).emptyListStore.getState();
    s.replaceDoc(JSON.parse(JSON.stringify(s.doc)));
  });
  await toggle(page);
  await expect(page.locator("#preview")).toHaveText(expected);
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.setContent(await publishedEmptyList(saved.doc, structuredClone(items)));
  await expect(page.locator("body")).toHaveText(expected + "Unchanged");
  expect(errors).toEqual([]);
});

test("design-only guidance remains editable while empty preview can recover when data arrives", async ({ page }) => {
  const { errors } = await setup(page, [{ name: "First", tags: [] }, { name: "Second", tags: [] }]);
  await expect(page.locator("#preview .cv-placeholder")).toHaveCount(1);
  await expect(page.locator("#preview")).toContainText("Tag: ");
  const saved = await snapshot(page);
  await toggle(page);
  await expect(page.locator("#preview")).toHaveText("FirstSecond");
  expect(await snapshot(page)).toEqual(saved);
  await page.evaluate(() => (window as any).emptyListStore.getState().updateDoc((doc: any) => {
    const items = doc.pages.p.pageScripts[0].steps[0].sample;
    items[0].tags = ["red"]; items[1].tags = ["green", "blue"];
  }));
  await expect(page.locator("#preview")).toHaveText("FirstTag: redSecondTag: greenTag: blue");
  await page.evaluate(() => (window as any).emptyListStore.getState().undo());
  await expect(page.locator("#preview")).toHaveText("FirstSecond");
  await page.evaluate(() => (window as any).emptyListStore.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps[0].sample = [];
  }));
  await expect(page.locator("#preview")).toHaveText("");
  await expect(page.locator("#preview .cv-placeholder")).toHaveCount(0);
  await toggle(page);
  await expect(page.locator("#preview .cv-placeholder")).toHaveCount(1);
  expect(errors).toEqual([]);
});
