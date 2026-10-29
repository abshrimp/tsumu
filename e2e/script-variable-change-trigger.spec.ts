import { expect, test, type Page } from "@playwright/test";
import { makeBox } from "../lib/presets";
import { scriptDragBundle, scriptDragDoc } from "../tests/helpers/script-drag";

test.describe("variable change trigger", () => {
  let bundle: string;
  test.beforeAll(async () => {
    const doc = scriptDragDoc();
    doc.pages.p.children = ["target"];
    doc.nodes.target = {
      ...makeBox(), id: "target", name: "Entry",
      scripts: [{
        id: "element-change", trigger: "change", steps: [{ id: "set-count", kind: "set-var", into: "count", value: "1" }],
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
});

test.describe("script node picker", () => {
  let bundle: string;
  test.beforeAll(async () => {
    const doc = scriptDragDoc();
    const node = (id: string, name: string, children: string[] = []) => ({
      ...makeBox(), id, name, children,
    });
    doc.pages.p.children = ["catalog", "other"];
    doc.nodes = {
      catalog: node("catalog", "商品グループ", ["price", "details"]),
      price: node("price", "金額"),
      details: node("details", "詳細", ["label"]),
      label: node("label", "商品名"),
      other: node("other", "独立した要素"),
    };
    doc.pages.p.pageScripts![0].steps.push({
      id: "pick-target", kind: "show", target: "",
    });
    bundle = await scriptDragBundle(doc);
  });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
  });
  const trigger = (page: Page) => page.locator('.se-flow [data-step-id="pick-target"] .np-btn');
  const menu = (page: Page) => page.locator(".np.dd-menu");
  const row = (page: Page, name: string) => menu(page).locator(".np-row").filter({
    has: page.locator(".np-name", { hasText: new RegExp("^" + name + "$") }),
  });
  const query = (page: Page) => page.getByPlaceholder("要素の名前で検索");
  const picked = (page: Page) => page.evaluate(() =>
    (window as any).scriptDragEditor.getState().doc.pages.p.pageScripts[0].steps[1].target
  );

  test("outside pointer closes element picker even when the clicked row stops propagation", async ({ page }) => {
    const before = await picked(page);
    await trigger(page).click();
    await expect(menu(page)).toBeVisible();

    const workspace = page.locator(".se-flow");
    await workspace.evaluate((el) => el.addEventListener("pointerdown", (event) => event.stopPropagation()));
    await workspace.click({ position: { x: 15, y: 15 } });
    await expect(menu(page)).toHaveCount(0);
    expect(await picked(page)).toBe(before);

    await trigger(page).click();
    await expect(menu(page)).toBeVisible();
    // タッチの pointerdown では、マウスの mousedown が発生しない。それでも閉じなければならない。
    await workspace.evaluate((el) => el.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 31, pointerType: "touch", button: 0, buttons: 1,
    })));
    await expect(menu(page)).toHaveCount(0);

    await trigger(page).click();
    await query(page).focus();
    await page.getByRole("button", { name: "閉じる", exact: true }).first().focus();
    await expect(menu(page)).toHaveCount(0);
  });

  test("search matches a parent collapsed; expansion reveals all children including nonmatches", async ({ page }) => {
    await trigger(page).click();
    await query(page).fill("商品グループ");
    const catalog = row(page, "商品グループ");
    await expect(catalog).toBeVisible();
    await expect(catalog.getByRole("button", { name: "開く" })).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, "金額")).toHaveCount(0);
    await expect(row(page, "詳細")).toHaveCount(0);

    await catalog.getByRole("button", { name: "開く" }).click();
    await expect(catalog.getByRole("button", { name: "閉じる" })).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "金額")).toBeVisible();
    await expect(row(page, "詳細")).toBeVisible();
    await expect(row(page, "商品名")).toHaveCount(0);
    await row(page, "詳細").getByRole("button", { name: "開く" }).click();
    await expect(row(page, "商品名")).toBeVisible();

    // 検索した言葉を含んでいなかった子を選ぶ。
    await row(page, "金額").click();
    await expect(menu(page)).toHaveCount(0);
    expect(await picked(page)).toBeTruthy();
    await expect(trigger(page)).toContainText("金額");
  });

  test("searching only for a descendant opens its unmatched ancestry, but a matching parent stays closed", async ({ page }) => {
    await trigger(page).click();
    await query(page).fill("金額");
    await expect(row(page, "商品グループ")).toBeVisible();
    await expect(row(page, "商品グループ").getByRole("button", { name: "閉じる" }))
      .toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "金額")).toBeVisible();
    await expect(row(page, "詳細")).toHaveCount(0);

    await query(page).fill("商品");
    await expect(row(page, "商品グループ").getByRole("button", { name: "開く" }))
      .toHaveAttribute("aria-expanded", "false");
    await expect(row(page, "商品名")).toHaveCount(0);
    await query(page).press("ArrowRight");
    await expect(row(page, "金額")).toBeVisible();
    await query(page).press("ArrowLeft");
    await expect(row(page, "金額")).toHaveCount(0);
  });
});
