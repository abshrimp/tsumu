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
      id: "element-change", trigger: "change", pos: { x: 32, y: 240 },
      steps: [{ id: "set-count", kind: "set-var", into: "count", value: "1" }],
    }],
  };
  doc.pages.p.pageScripts = [{
    id: "variable-change", trigger: "change", changeVariable: "count",
    pos: { x: 32, y: 32 },
    steps: [{ id: "record", kind: "set-var", into: "seen", value: "{count}" }],
  }];
  bundle = await scriptDragBundle(doc);
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});

const hat = (page: Page, id: string) => page.locator('.se-stack[data-script-id="' + id + '"] .se-hat');
async function saved(page: Page) {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).scriptDragEditor.getState().doc)));
}

test("old change triggers select an element without new settings", async ({ page }) => {
  await expect(hat(page, "element-change").locator("select").first()).toHaveValue("element");
  await expect(hat(page, "element-change").locator(".np-btn")).toContainText("Entry");
  const doc = await saved(page);
  expect(doc.nodes.target.scripts[0]).not.toHaveProperty("changeVariable");
  expect(doc.pages.p.pageScripts[0].changeVariable).toBe("count");
});

test("source switch saves a page-scoped variable watcher and returns to element selection", async ({ page }) => {
  await hat(page, "element-change").locator("select").first().selectOption("variable");
  let doc = await saved(page);
  const moved = doc.pages.p.pageScripts.find((script: any) => script.id === "element-change");
  expect(moved).toBeDefined();
  expect(moved.changeVariable).toBe("");
  expect(doc.nodes.target.scripts ?? []).toHaveLength(0);

  const input = hat(page, "element-change").getByPlaceholder("変数を選択");
  await input.fill("{count}");
  await input.blur();
  doc = await saved(page);
  expect(doc.pages.p.pageScripts.find((script: any) => script.id === "element-change").changeVariable).toBe("count");
  await expect(hat(page, "element-change").locator("select").first()).toHaveValue("variable");

  await hat(page, "element-change").locator("select").first().selectOption("element");
  doc = await saved(page);
  expect(doc.pages.p.scripts.find((script: any) => script.id === "element-change")).not.toHaveProperty("changeVariable");
  await expect(hat(page, "element-change").getByText("要素を選ぶまで実行されません")).toBeVisible();
});
