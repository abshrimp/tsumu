import { test, expect, type Page } from "@playwright/test";
import { makeBox } from "../lib/presets";
import { scriptDragBundle, scriptDragDoc } from "../tests/helpers/script-drag";
import { scriptKeyboardBundle } from "../tests/helpers/script-keyboard";
import { readEditorCss } from "../tests/helpers/editor-css";
import { expectVariableMenuLayout } from "./helpers/variable-menu-layout";
import { varExplorerBundle } from "../tests/helpers/var-explorer";

test.describe("script-variable-change-trigger", () => {
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
});

test.describe("script-duplicate-history", () => {
let bundle: string;
test.beforeAll(async () => { bundle = await scriptKeyboardBundle(); });
test.beforeEach(async ({ page }) => {
  await page.goto("/robots.txt");
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});

async function pageScripts(page: Page) {
  return page.evaluate(() => (window as any).scriptKeyboardEditor.getState().doc.pages.p.pageScripts);
}

for (const kind of ["script", "step"] as const) {
  test(`Duplicate ${kind}: undo clears stale selection, and redo restores one edit`, async ({ page }) => {
    const before = await pageScripts(page);
    // スクリプトは左の一覧の「…」から、動作はカードの「…」から複製する
    const more = kind === "script"
      ? page.locator('.se-side-item:has([data-script-id="script"]) .se-side-more')
      : page.locator('.se-card[data-step-id="open"] .se-card-more');
    await more.click();
    await page.locator(".se-menu button", { hasText: "複製" }).click();
    const after = await pageScripts(page);
    if (kind === "script") {
      expect(after).toHaveLength(before.length + 1);
    } else {
      expect(after[0].steps).toHaveLength(before[0].steps.length + 1);
    }
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => pageScripts(page)).toEqual(before);
    // 選択は、元に戻して消えた複製の ID を指していた。Delete がそれを、
    // 関係の無い文書の編集に変えてはいけない。
    await expect(page.locator(".se-flow .is-selected")).toHaveCount(0);
    // 開いていた複製が消えても、きっかけを選ぶ画面には戻らず、元のスクリプトを開く
    await expect(page.locator(".se-when")).toBeVisible();
    await page.keyboard.press("Delete");
    await expect.poll(() => pageScripts(page)).toEqual(before);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => pageScripts(page)).toEqual(after);
  });
}


test("copied script actions survive text-copy attempts and remain pasteable in another tab", async ({ page, context }) => {
  const card = page.locator('.se-card[data-step-id="open"]');
  await card.click({ position: { x: 5, y: 4 } });
  await expect(card).toHaveClass(/is-selected/);
  const raw = await page.evaluate(() => {
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error("Action copy not handled");
    return data.getData("text/plain");
  });
  expect(raw).toMatch(/^Tsumu script actions v1\n/);

  // 入力欄のコピーイベントでメモリ上の控えが消えても、OSのコピーは残り得る。
  await page.evaluate(() => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new ClipboardEvent("copy", {
      bubbles: true, cancelable: true, clipboardData: new DataTransfer(),
    }));
    input.remove();
  });
  const pastedAfterInput = await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, raw);
  expect(pastedAfterInput).toBe(true);
  await expect(page.locator('.se-card[data-step-kind="open-page"]')).toHaveCount(2);

  // もう1つのタブにはモジュール内のコピー控えがない。保存済みのコピーとの照合で復元する。
  const other = await context.newPage();
  try {
    await other.goto("/robots.txt");
    await other.setContent('<html><body><div id="app"></div></body></html>');
    await other.addScriptTag({ content: bundle });
    await expect(other.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
    await other.evaluate((text) => {
      (window as any).__scriptClipboardText = text;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { readText: async () => (window as any).__scriptClipboardText },
      });
    }, raw);

    // ツールバーの貼り付けも非同期 Clipboard API から現在の内容を読む。
    await other.locator('.se-header [aria-label="貼り付け"]').click();
    await expect(other.locator('.se-card[data-step-kind="open-page"]')).toHaveCount(2);

    // OS側でほかの文字列をコピーしたら、古いブロックを誤貼り付けしない。
    await other.evaluate(() => { (window as any).__scriptClipboardText = "ordinary text"; });
    await other.locator('.se-header [aria-label="貼り付け"]').click();
    await expect(other.locator('.se-card[data-step-kind="open-page"]')).toHaveCount(2);

    await other.evaluate((text) => { (window as any).__scriptClipboardText = text; }, raw);
    const pastedInOtherTab = await other.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }, raw);
    expect(pastedInOtherTab).toBe(true);
    await expect(other.locator('.se-card[data-step-kind="open-page"]')).toHaveCount(3);
  } finally {
    await other.close();
  }
});
});

test.describe("var-explorer", () => {
let bundle: string;
test.beforeAll(async () => { bundle = await varExplorerBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readEditorCss() });
  await page.addScriptTag({ content: bundle });
});
const source = (page: Page) => page.getByPlaceholder("最初から入力されている文字", { exact: true });
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).pickerStore.getState();
  return { doc, past, future };
});
async function openPicker(page: Page) {
  await source(page).focus();
  await source(page).press("Control+/");
  await page.locator(".var-comp-explore").click();
  await expect(page.getByRole("dialog", { name: "変数を探す" })).toBeVisible();
}

test("Enter after closing variable details inserts the value and preserves save/Undo/Redo", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await openPicker(page);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "詳細を表示", exact: true }).click();
  const search = page.getByPlaceholder("変数名・値で検索");
  await search.fill("search");
  await expect(page.locator(".vx-row")).toHaveCount(3);
  await search.press("ArrowUp");
  await expect(page.locator(".vx-row.is-key .vx-tok")).toHaveText("{search.disabled}");
  await page.getByRole("button", { name: "詳細を隠す", exact: true }).click();
  await expect(page.locator(".vx-row")).toHaveCount(1);
  await expect(page.locator(".vx-row.is-key .vx-tok")).toHaveText("{search}");
  expect(await snapshot(page)).toEqual(before);
  await search.press("Enter");
  await expect(page.getByRole("dialog", { name: "変数を探す" })).toHaveCount(0);
  await expect(source(page)).toHaveValue("{search}");
  await page.locator("#outside").click();
  const after = await snapshot(page);
  expect(after.doc.nodes.target.field.defaultValue).toBe("{search}");
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(after.doc.nodes.other).toEqual(before.doc.nodes.other);
  await page.evaluate(() => (window as any).pickerStore.getState().undo());
  await expect(source(page)).toHaveValue("");
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.evaluate(() => (window as any).pickerStore.getState().redo());
  await expect(source(page)).toHaveValue("{search}");
  expect((await snapshot(page)).doc).toEqual(after.doc);
  expect(errors).toEqual([]);
});

test("Enter/Space toggles variable details, while Enter on a row inserts its selected value", async ({ page }) => {
  await openPicker(page); const before = await snapshot(page);
  const product = page.locator(".vx-row").filter({ has: page.locator(".vx-tok", { hasText: /^\{product\}$/ }) });
  const expand = product.getByRole("button", { name: "中を開く", exact: true });
  await expand.focus(); await expand.press("Enter");
  await expect(page.getByRole("dialog", { name: "変数を探す" })).toBeVisible();
  await expect(product.locator("button")).toHaveAttribute("aria-expanded", "true");
  expect(await snapshot(page)).toEqual(before);
  await product.locator("button").press("Space");
  await expect(product.locator("button")).toHaveAttribute("aria-expanded", "false");
  await product.focus(); await product.press("ArrowRight");
  const name = page.locator(".vx-row").filter({ has: page.locator(".vx-tok", { hasText: /^\{product\.name\}$/ }) });
  await name.focus(); await name.press("Enter");
  await expect(source(page)).toHaveValue("{product.name}");
  await page.locator("#outside").click();
  expect((await snapshot(page)).doc.nodes.target.field.defaultValue).toBe("{product.name}");
});

test("Search updates that remove candidates do not modify another target after clear, cancel, or reselection", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await openPicker(page);
  await page.getByRole("button", { name: "詳細を表示", exact: true }).click();
  const search = page.getByPlaceholder("変数名・値で検索");
  await search.fill("search"); await search.press("ArrowUp");
  await page.evaluate(() => (window as any).pickerStore.getState().updateNode("search", {
    type: "box", field: undefined, text: { content: "Search" },
  }));
  await expect(page.locator(".vx-row.is-key .vx-tok")).toHaveText("{search}");
  await page.evaluate(() => (window as any).pickerStore.getState().deleteNodes(["search"]));
  await expect(page.locator(".vx-row")).toHaveCount(0);
  const before = await snapshot(page);
  await search.press("Enter"); await search.press("ArrowDown");
  await expect(page.getByRole("dialog", { name: "変数を探す" })).toBeVisible();
  await search.press("Escape");
  await page.locator("#outside").click();
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => {
    const s = (window as any).pickerStore.getState(); s.setActivePage("q"); s.select("other");
  });
  await openPicker(page);
  await page.getByPlaceholder("変数名・値で検索").fill("other");
  await page.locator(".vx-row").click(); await page.locator("#outside").click();
  const after = await snapshot(page);
  expect(after.doc.nodes.other.field.defaultValue).toBe("{other}");
  expect(after.doc.nodes.target).toEqual(before.doc.nodes.target);
  expect(errors).toEqual([]);
});

test("Inspector suggestions dismiss outside but not on scrolling inside the menu", async ({ page }) => {
  const menu = page.locator(".var-comp");
  await source(page).focus();
  await source(page).press("Control+/");
  await expect(menu).toBeVisible();

  await menu.locator(".var-comp-list").evaluate((list) => {
    list.scrollTop += 30;
    list.dispatchEvent(new Event("scroll"));
  });
  await expect(menu).toBeVisible();
  await page.locator("#outside").click();
  await expect(menu).toHaveCount(0);

  // 補完を閉じても、利用者の編集は変わらない。
  await expect(source(page)).toHaveValue("");
  await source(page).focus();
  await source(page).press("Control+/");
  await expect(menu).toBeVisible();
  await source(page).press("Escape");
  await expect(menu).toHaveCount(0);
});

test("Suggestions close when the focused inspector field leaves its scroll viewport", async ({ page }) => {
  await page.evaluate(() => {
    const app = document.getElementById("app")!;
    app.style.height = "150px";
    app.style.overflowY = "auto";
    const spacer = document.createElement("div");
    spacer.style.height = "1800px";
    app.appendChild(spacer);
  });
  await source(page).scrollIntoViewIfNeeded();
  await source(page).focus();
  await source(page).press("Control+/");
  await expect(page.locator(".var-comp")).toBeVisible();

  await page.evaluate(() => {
    const app = document.getElementById("app")!;
    app.scrollTop = app.scrollHeight;
  });
  await expect(page.locator(".var-comp")).toHaveCount(0);
});

test("Both Settings hint actions fit without wrapping at desktop and mobile widths", async ({ page }) => {
  const input = source(page);
  const menu = page.locator(".var-comp");
  for (const width of [1440, 375, 320]) {
    await test.step(`${width}px`, async () => {
      await input.blur();
      await page.setViewportSize({ width, height: 900 });
      await input.focus();
      await input.press("Control+/");
      await expect(menu).toBeVisible();
      await expectVariableMenuLayout(page, width, 2);
      await input.press("Escape");
      await expect(menu).toHaveCount(0);
      await input.press("Control+/");
      await page.locator(".var-comp-explore").click();
      await expect(page.getByRole("dialog", { name: "変数を探す" })).toBeVisible();
      await page.getByPlaceholder("変数名・値で検索").press("Escape");
      await expect(page.getByRole("dialog", { name: "変数を探す" })).toHaveCount(0);
    });
  }
});


test("system date, browser and random variables are shown only after enabling details", async ({ page }) => {
  await openPicker(page);
  const dialog = page.getByRole("dialog", { name: "変数を探す" });
  await expect(dialog.locator(".vx-group h3").filter({ hasText: "現在の日付と時刻" })).toHaveCount(0);
  await expect(dialog.locator(".vx-group h3").filter({ hasText: "ランダムな値" })).toHaveCount(0);
  const search = page.getByPlaceholder("変数名・値で検索");
  await search.fill("system.randomInt");
  await expect(dialog.locator(".vx-row")).toHaveCount(0);
  await page.getByRole("button", { name: "詳細を表示", exact: true }).click();
  await expect(dialog.locator(".vx-row")).toHaveCount(1);
  await expect(dialog.locator(".vx-row .vx-tok")).toHaveText("{system.randomInt}");
  await search.fill("");
  for (const heading of ["現在の日付と時刻", "ページとブラウザ", "ランダムな値"]) {
    await expect(dialog.locator(".vx-group h3").filter({ hasText: heading })).toHaveCount(1);
  }
  await search.fill("system.randomInt");
  await dialog.locator(".vx-row").click();
  await expect(dialog).toHaveCount(0);
  await expect(source(page)).toHaveValue("{system.randomInt}");
  await page.locator("#outside").click();
  expect((await snapshot(page)).doc.nodes.target.field.defaultValue).toBe("{system.randomInt}");
});

test("advanced toggle can hide built-in matches without modifying the document", async ({ page }) => {
  await openPicker(page);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "詳細を表示", exact: true }).click();
  const search = page.getByPlaceholder("変数名・値で検索");
  await search.fill("system.page.url");
  await expect(page.locator(".vx-row .vx-tok")).toHaveText("{system.page.url}");
  await page.getByRole("button", { name: "詳細を隠す", exact: true }).click();
  await expect(page.locator(".vx-row")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});
});
