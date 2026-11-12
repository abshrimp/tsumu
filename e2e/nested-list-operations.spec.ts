import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { listActions, nestedOperationsBundle, publishedNestedOperations } from "../tests/helpers/nested-list-operations";

let bundle: string;
test.beforeAll(async () => { bundle = await nestedOperationsBundle(true); });

const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).nestedOperationsStore.getState();
  return { doc, past, future };
});
const rows = (page: Page) => page.locator('[id="tags-list"]').evaluateAll(lists => lists.map(list =>
  Array.from(list.children).filter(row => row.hasAttribute("data-item") && (row as HTMLElement).style.display !== "none")
    .map(row => JSON.parse(row.getAttribute("data-item")!).label)));

async function runOperations(page: Page) {
  await expect(page.locator('[id="tags-list"]')).toHaveCount(2);
  await expect.poll(() => rows(page)).toEqual([["red", "blue"], ["green", "yellow"]]);
  const sequence: Array<[string, string[][]]> = [
    ["descending", [["red", "blue"], ["yellow", "green"]]],
    ["descending", [["red", "blue"], ["yellow", "green"]]],
    ["filter", [["red"], ["green"]]],
    ["filter", [["red"], ["green"]]],
    ["empty", [[], []]],
    ["clear", [["red", "blue"], ["yellow", "green"]]],
    ["ascending", [["blue", "red"], ["green", "yellow"]]],
    ["filter", [["red"], ["green"]]],
    ["clear", [["blue", "red"], ["green", "yellow"]]],
  ];
  const results: string[][][] = [];
  for (const [action, expected] of sequence) {
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(() => rows(page)).toEqual(expected);
    for (const label of ["red", "blue", "green", "yellow"]) {
      const detail = page.locator('[id="detail"]').filter({ hasText: new RegExp(`:${label}$`) });
      if (expected.flat().includes(label)) await expect(detail).toBeVisible();
      else await expect(detail).toBeHidden();
    }
    results.push(await rows(page));
  }
  return results;
}

test(`component-contained lists: select script arrays, sort, filter, clear and reopen preview`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  for (const action of listActions) {
    await page.getByRole("button", { name: `Edit ${action}`, exact: true }).click();
    const choice = page.locator(`.se-ws [data-sel-key="step:${action}-step"] button.se-list-choice`);
    // 保存したスクリプトを書き換えるのではなく、実際のポップオーバーから選ぶ。
    await choice.click();
    const option = page.locator(".se-list-picker").getByRole("option", { name: "tags", exact: true });
    await expect(option).toBeVisible();
    await option.click();
    await expect(choice).toHaveText("tags");
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
  }
  const before = await snapshot(page);
  for (const action of listActions) expect(before.doc.nodes[action].scripts[0].steps[0].array).toBe("tags");
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  const previewResults = await runOperations(page);
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await expect(page.locator('[id="tags-list"][data-array]')).toHaveCount(0);
  await expect(page.locator('[id="detail"]')).toHaveCount(4);
  for (const detail of await page.locator('[id="detail"]').all()) {
    await expect(detail).toHaveText("Detail {name}:{label}");
    await expect(detail).toBeVisible();
  }
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  expect(await runOperations(page)).toEqual(previewResults);
  expect(await snapshot(page)).toEqual(before);
  // スクリプトの画面を通して保存した文書（コンポーネントのスクリプトを含む）から生成し、同じ操作を確かめる。
  await page.setContent(await publishedNestedOperations(before.doc));
  await page.addScriptTag({ content: scriptsFile(before.doc) });
  expect(await runOperations(page)).toEqual(previewResults);
  expect(errors).toEqual([]);
});

test("script list chooser filters candidates, supports the keyboard, and dismisses without changing the list", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "Edit descending", exact: true }).click();
  const choice = page.locator('.se-ws [data-sel-key="step:descending-step"] button.se-list-choice');
  await expect(choice).toHaveAttribute("aria-haspopup", "listbox");
  await choice.click();
  const menu = page.locator(".se-list-picker");
  const search = menu.locator("input");
  await search.fill("tag");
  await expect(menu.getByRole("option", { name: "tags", exact: true })).toHaveCount(1);
  await search.press("Enter");
  await expect(menu).toBeHidden();
  await expect(choice).toHaveText("tags");
  const before = await snapshot(page);

  await choice.click();
  await search.fill("no-such-list");
  await expect(menu.getByRole("option")).toHaveCount(0);
  await search.press("Escape");
  await expect(menu).toBeHidden();
  await expect(choice).toHaveText("tags");

  await choice.click();
  await page.locator(".se-ws").click({ position: { x: 5, y: 5 } });
  await expect(menu).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("list selection menu shows the first sampled row, not all 20 records", async ({ page }) => {
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as any).nestedOperationsStore.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps[0].preview.sample = Array.from({ length: 20 }, (_, index) => ({
      name: "Row " + index,
      tags: [{ label: "Tag " + index }],
    }));
  }));
  await page.getByRole("button", { name: "Edit descending", exact: true }).click();
  const choice = page.locator('.se-ws [data-sel-key="step:descending-step"] button.se-list-choice');
  await choice.click();
  const menu = page.locator(".se-list-picker");
  await expect(menu.getByRole("option", { name: "response.0.tags", exact: true })).toBeVisible();
  await expect(menu.getByRole("option", { name: /^response\.[1-9]\d*(?:\.|$)/ })).toHaveCount(0);
  await menu.locator("input").fill("response.3.tags");
  await expect(menu.getByRole("option")).toHaveCount(0);
  await menu.locator("input").press("Enter");
  await expect(choice).toHaveText("response.3.tags");
  const saved = await snapshot(page);
  expect(saved.doc.nodes.descending.scripts[0].steps[0].array).toBe("response.3.tags");
});

test("custom list picker accepts a path absent from the sample choices", async ({ page }) => {
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "Edit descending", exact: true }).click();
  const choice = page.locator('.se-ws [data-sel-key="step:descending-step"] button.se-list-choice');
  await choice.click();
  const menu = page.locator(".se-list-picker");
  await menu.locator("input").fill("tags.3");
  await expect(menu.getByRole("option")).toHaveCount(0);
  await menu.locator("input").press("Enter");
  await expect(menu).toBeHidden();
  await expect(choice).toHaveText("tags.3");
  const saved = await snapshot(page);
  expect(saved.doc.nodes.descending.scripts[0].steps[0].array).toBe("tags.3");
});
