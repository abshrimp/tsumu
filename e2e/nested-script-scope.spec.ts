import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { nestedScopeBundle, nestedScopeDoc, publishedNestedScope } from "../tests/helpers/nested-script-scope";

const snapshot = (page: Page) => page.evaluate(() => {
  const s = (window as any).nestedScopeStore?.getState();
  return s ? { doc: s.doc, past: s.past, future: s.future } : null;
});
for (const preview of [true, false]) test(`${preview ? "preview" : "exported"}: nested row scripts affect only their own detail`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const doc = nestedScopeDoc();
  if (preview) {
    await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
    await page.addScriptTag({ content: await nestedScopeBundle(doc) });
    await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  } else {
    await page.setContent(await publishedNestedScope(doc));
    await page.addScriptTag({ content: scriptsFile(doc) });
  }
  const before = await snapshot(page);
  const detail = (label: string) => page.locator('[id="detail"]').filter({ hasText: new RegExp(`:${label}$`) });
  const visible = async (hidden: string[]) => {
    for (const label of ["red", "blue", "green", "yellow"]) {
      if (hidden.includes(label)) await expect(detail(label)).toBeHidden();
      else await expect(detail(label)).toBeVisible();
    }
  };
  await visible([]);
  await page.getByRole("button", { name: "hide red", exact: true }).click();
  await visible(["red"]);
  await page.getByRole("button", { name: "hide green", exact: true }).click();
  await visible(["red", "green"]);
  await page.getByRole("button", { name: "show green", exact: true }).click();
  await visible(["red"]);
  await page.getByRole("button", { name: "hide yellow", exact: true }).click();
  await visible(["red", "yellow"]);
  await page.getByRole("button", { name: "show red", exact: true }).click();
  await visible(["yellow"]);
  expect(await snapshot(page)).toEqual(before);
  if (preview) {
    await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
    // デザイン画面は変数を展開せず、テンプレートの文字を見せる。
    const designDetails = page.locator('[id="detail"]');
    await expect(designDetails).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(designDetails.nth(i)).toHaveText("Detail {name}:{label}");
      await expect(designDetails.nth(i)).toBeVisible();
    }
    await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
    await page.getByRole("button", { name: "hide green", exact: true }).click();
    await visible(["green"]);
    expect(await snapshot(page)).toEqual(before);
  }
  expect(errors).toEqual([]);
});
