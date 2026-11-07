import { expect, test } from "@playwright/test";
import { arrayFindFieldsDoc, literalFieldItems } from "../tests/helpers/array-find-fields";
import { clientScriptBundle } from "../tests/helpers/client-script-scope";
import { publishedComponentList } from "../tests/helpers/component-list-export";
import { scriptsFile } from "../lib/script-runtime";

test("real field selection keeps literal keys through undo, reload and server export", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const doc = arrayFindFieldsDoc(literalFieldItems, "name", "Literal");
  await page.goto("/robots.txt");
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await clientScriptBundle(doc) });
  const snapshot = () => page.evaluate(() => JSON.parse(JSON.stringify((window as any).clientScriptStore.getState().doc)));
  const before = await snapshot();
  const historyBefore = await page.evaluate(() => (window as any).clientScriptStore.getState().past.length);
  await page.getByRole("button", { name: "Edit action", exact: true }).click();
  const block = page.locator('[data-sel-key="step:find"]');
  await block.locator("select").nth(1).selectOption("meta.name");
  const value = block.locator("input").first();
  await value.fill("A%20%26%20B"); await value.blur();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  const saved = await snapshot();
  expect(saved.pages.p.pageScripts[0].steps[1]).toMatchObject({ field: "meta.name", value: "A%20%26%20B" });
  const historyAdded = await page.evaluate(() => (window as any).clientScriptStore.getState().past.length) - historyBefore;
  expect(historyAdded).toBeGreaterThan(0);
  for (let i = 0; i < historyAdded; i++) await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await snapshot()).toEqual(before);
  for (let i = 0; i < historyAdded; i++) await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await snapshot()).toEqual(saved);
  await page.getByRole("button", { name: "Reload saved", exact: true }).click();
  expect(await snapshot()).toEqual(saved);
  await page.setContent(await publishedComponentList(saved, "app/page.tsx", literalFieldItems));
  await expect(page.locator("#result")).toHaveText("Literal");
  expect(errors).toEqual([]);
});

for (const key of ["A & B", "A%20%26%20B", "absent"]) test(`browser find preserves literal-field priority for ${key}`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const doc = arrayFindFieldsDoc(literalFieldItems, "meta.name", key, true);
  const html = await publishedComponentList(doc, "app/page.tsx", literalFieldItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(doc) });
  for (let i = 0; i < 2; i++) {
    await page.locator("#act").click();
    await expect(page.locator("#result")).toHaveText(key === "absent" ? "" : "Literal");
  }
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(page.locator("#result")).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await page.locator("#act").click();
  await expect(page.locator("#result")).toHaveText(key === "absent" ? "" : "Literal");
  expect(errors).toEqual([]);
});
