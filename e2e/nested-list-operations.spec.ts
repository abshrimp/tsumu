import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { listActions, nestedOperationsBundle, publishedNestedOperations } from "../tests/helpers/nested-list-operations";

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
  await page.addScriptTag({ content: await nestedOperationsBundle(true) });
  for (const action of listActions) {
    await page.getByRole("button", { name: `Edit ${action}`, exact: true }).click();
    const choice = page.locator(`.se-ws [data-sel-key="step:${action}-step"] select.se-in-strong`);
    // Select named arrays through the real array selector rather than writing a loop variable directly.
    await expect(choice.locator('option[value="tags"]')).toHaveText("tags");
    await choice.selectOption("tags");
    await expect(choice).toHaveValue("tags");
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
  // Generate the document saved through the script editor, including component scripts, and verify the same operations.
  await page.setContent(await publishedNestedOperations(before.doc));
  await page.addScriptTag({ content: scriptsFile(before.doc) });
  expect(await runOperations(page)).toEqual(previewResults);
  expect(errors).toEqual([]);
});
