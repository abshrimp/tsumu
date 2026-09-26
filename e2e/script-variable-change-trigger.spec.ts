import { expect, test, type Page } from "@playwright/test";
import { makeBox } from "../lib/presets";
import { scriptDragBundle, scriptDragDoc } from "../tests/helpers/script-drag";

let bundle: string;
test.beforeAll(async () => {
  const doc = scriptDragDoc();
  doc.pages.p.children = ["target"];
  doc.nodes.target = {
    ...makeBox(), id: "target", name: "Entry",
    scripts: [{
      id: "element-change", trigger: "change",      steps: [{ id: "set-count", kind: "set-var", into: "count", value: "1" }],
    }],
  };
  doc.pages.p.pageScripts = [{
    id: "variable-change", trigger: "change", changeVariable: "count",
    steps: [{ id: "record", kind: "set-var", into: "seen", value: "{count}" }],
  }];
  bundle = await scriptDragBundle(doc);
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});

const when = (page: Page) => page.locator(".se-when");
const watch = (page: Page) => when(page).getByRole("combobox", { name: "変化を見張る対象" });
async function open(page: Page, id: string) {
  await page.locator(`.se-side-open[data-script-id="${id}"]`).click();
  await expect(page.locator(`.se-side-open[data-script-id="${id}"]`)).toHaveAttribute("aria-current", "true");
}
async function saved(page: Page) {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).scriptDragEditor.getState().doc)));
}

test("element change triggers show the element without variable settings", async ({ page }) => {
  await open(page, "element-change");
  await expect(watch(page)).toHaveValue("element");
  await expect(when(page).locator(".np-btn")).toContainText("Entry");
  const doc = await saved(page);
  expect(doc.nodes.target.scripts[0]).not.toHaveProperty("changeVariable");
  expect(doc.pages.p.pageScripts[0].changeVariable).toBe("count");
});

test("switching to a variable saves a page-scoped watcher; switching back waits for an element", async ({ page }) => {
  await open(page, "element-change");
  await watch(page).selectOption("variable");
  let doc = await saved(page);
  const moved = doc.pages.p.pageScripts.find((script: any) => script.id === "element-change");
  expect(moved).toBeDefined();
  expect(moved.changeVariable).toBe("");
  expect(doc.nodes.target.scripts ?? []).toHaveLength(0);
  // まだ見張る変数を選んでいないので、動かないことを印で示す
  await expect(page.locator('.se-side-open[data-script-id="element-change"] .se-side-warn')).toBeVisible();

  const input = when(page).getByPlaceholder("変数を選択");
  await input.fill("{count}");
  await input.blur();
  doc = await saved(page);
  expect(doc.pages.p.pageScripts.find((script: any) => script.id === "element-change").changeVariable).toBe("count");
  await expect(watch(page)).toHaveValue("variable");

  // 入力欄に戻すと、要素を選ぶまでは保存せず（変数の見張りのまま）、要素の一覧を開く
  await watch(page).selectOption("element");
  await expect(page.locator(".np.dd-menu")).toBeVisible();
  expect(await saved(page)).toEqual(doc);
  await page.locator(".np.dd-menu .np-row", { hasText: "Entry" }).click();
  doc = await saved(page);
  expect(doc.pages.p.pageScripts.find((script: any) => script.id === "element-change")).toBeUndefined();
  expect(doc.nodes.target.scripts.find((script: any) => script.id === "element-change")).not.toHaveProperty("changeVariable");
});

test("closing the element list without choosing keeps the variable watcher", async ({ page }) => {
  await open(page, "variable-change");
  const before = await saved(page);
  await watch(page).selectOption("element");
  await expect(page.locator(".np.dd-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".np.dd-menu")).toHaveCount(0);
  await expect(watch(page)).toHaveValue("variable");
  expect(await saved(page)).toEqual(before);
});
