import { test, expect, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { type FieldContent, type SiteDoc } from "../lib/types";
import { inputDefaultBundle, inputDefaultDoc, publishedInputDefault } from "../tests/helpers/input-default";
import { fieldEditorFixture } from "./helpers/field-editor";
import { publishedSelectDefault, selectDefaultBundle, selectDefaultDoc } from "../tests/helpers/select-default";
import { previewDynamicRadioBundle, publishedDynamicRadio } from "../tests/helpers/preview-dynamic-radio";

test.describe("input-default", () => {
const mountEditor = fieldEditorFixture(inputDefaultBundle);

async function setup(page: Page, doc: SiteDoc) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1200px;height:850px"></div></body></html>');
  await mountEditor(page, doc);
  await expect(page.locator("#entry")).toBeVisible();
  return errors;
}
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).initialEditor.getState();
  return { doc, past, future };
});
const toggle = (page: Page) => page.getByRole("button", { name: "Toggle preview", exact: true }).click();
const setting = (page: Page, label: string) => page.locator("aside .row, aside .stack").filter({
  has: page.locator("label").filter({ hasText: new RegExp(`^${label}$`) }),
}).locator("input");
async function value(page: Page, expected: string, changes = 0) {
  await expect(page.locator("#entry")).toHaveValue(expected);
  await expect(page.locator("#result")).toHaveText(`value=[${expected}]; changes=${changes}`);
}
async function published(page: Page, doc: SiteDoc, expected: string) {
  const { html } = await publishedInputDefault(doc);
  await page.setContent(html);
  await page.addScriptTag({ content: scriptsFile(doc) });
  await value(page, expected);
  expect(await page.locator("#entry").evaluate((el) => {
    const form = document.createElement("form");
    form.append(el.cloneNode(true));
    return new FormData(form).get("entry");
  })).toBe(expected);
}

const cases: { name: string; field: FieldContent; expected: string; query?: string }[] = [
  { name: "bounded range midpoint", field: { kind: "input", inputType: "range", min: "10", max: "20", step: "5" }, expected: "15" },
  { name: "default attribute is the range step base", field: { kind: "input", inputType: "range", defaultValue: "14", step: "5", max: "99" }, expected: "14" },
  { name: "resolved range constraints", field: { kind: "input", inputType: "range", min: "{low}", max: "{high}", step: "{increment}" }, query: "low=10&high=20&increment=5", expected: "15" },
  { name: "normalized color", field: { kind: "input", inputType: "color", defaultValue: "#ABCDEF" }, expected: "#abcdef" },
  { name: "invalid number", field: { kind: "input", inputType: "number", defaultValue: "invalid" }, expected: "" },
  { name: "invalid date", field: { kind: "input", inputType: "date", defaultValue: "2026-02-30" }, expected: "" },
  { name: "normalized datetime", field: { kind: "input", inputType: "datetime-local", defaultValue: "2026-11-05 12:30:00" }, expected: "2026-11-05T12:30" },
  { name: "single-line text", field: { kind: "input", defaultValue: "first\nsecond" }, expected: "firstsecond" },
  { name: "trimmed email", field: { kind: "input", inputType: "email", defaultValue: "  name@example.com  " }, expected: "name@example.com" },
  { name: "textarea line endings", field: { kind: "textarea", defaultValue: "first\r\nsecond" }, expected: "first\nsecond" },
];

test("initial input agrees between Canvas and generated output across input types", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1200px;height:850px"></div></body></html>');
  const publishedPage = await page.context().newPage();
  publishedPage.on("pageerror", (error) => errors.push(error.message));
  try {
    for (const entry of cases) {
      await test.step(entry.name, async () => {
        const doc = inputDefaultDoc(entry.field, entry.query);
        await mountEditor(page, doc);
        await expect(page.locator("#entry")).toBeVisible();
        const before = await snapshot(page);
        await expect(setting(page, "初期値")).toHaveValue(entry.field.defaultValue?.replace(/\r?\n/g, "") ?? "");
        await expect(page.locator("#result")).toHaveText("value=[{entry}]; changes={changes}");
        await toggle(page);
        await value(page, entry.expected);
        expect(await snapshot(page)).toEqual(before);
        await toggle(page);
        await toggle(page);
        await value(page, entry.expected);
        expect(await snapshot(page)).toEqual(before);
        await published(publishedPage, doc, entry.expected);
        expect(errors).toEqual([]);
      });
    }
  } finally {
    await publishedPage.close();
  }
});

test("SettingsPanel edits preserve raw defaults and history while preview respects native initial values", async ({ page }) => {
  const errors = await setup(page, inputDefaultDoc({ kind: "input", inputType: "number", defaultValue: "12" }));
  const initial = await snapshot(page);
  await setting(page, "初期値").fill("invalid");
  await toggle(page); // blur で、実際の SettingsPanel を通して確定する
  await value(page, "");
  const edited = await snapshot(page);
  expect(edited.doc.nodes.entry.field.defaultValue).toBe("invalid");
  expect(edited.past).toHaveLength(1);
  await page.evaluate(() => (window as any).initialEditor.getState().undo());
  await value(page, "12");
  expect((await snapshot(page)).doc).toEqual(initial.doc);
  await page.evaluate(() => (window as any).initialEditor.getState().redo());
  await value(page, "");
  expect(await snapshot(page)).toEqual(edited);
  await page.locator("#entry").fill("7");
  await value(page, "7", 1);
  expect(await snapshot(page)).toEqual(edited);
  await page.locator("#assign-input").click();
  await value(page, "8", 2);
  await toggle(page);
  await setting(page, "初期値").fill("30");
  await toggle(page);
  await value(page, "8", 0); // 新しい初期値で、スクリプトが設定した値を消してはならない
  const latest = await snapshot(page);
  expect(latest.doc.nodes.entry.field.defaultValue).toBe("30");
  expect(latest.past).toHaveLength(2);
  await published(page, latest.doc, "30");
  expect(errors).toEqual([]);
});

test("range bounds and input type can still be edited before entering preview", async ({ page }) => {
  const errors = await setup(page, inputDefaultDoc({ kind: "input", inputType: "range" }));
  await setting(page, "最小").fill("10");
  await setting(page, "最大").fill("20");
  await setting(page, "刻み").fill("5");
  await toggle(page);
  await value(page, "15");
  const bounded = await snapshot(page);
  expect(bounded.doc.nodes.entry.field.defaultValue).toBeUndefined();
  expect(bounded.past).toHaveLength(3);
  await page.evaluate(() => (window as any).initialEditor.getState().undo());
  await value(page, "15");
  await page.evaluate(() => (window as any).initialEditor.getState().undo());
  await value(page, "55");
  await page.evaluate(() => { const s = (window as any).initialEditor.getState(); s.redo(); s.redo(); });
  await value(page, "15");
  expect(await snapshot(page)).toEqual(bounded);
  await toggle(page);
  await page.locator("aside .row").filter({ has: page.locator("span.lbl").filter({ hasText: /^type$/ }) }).locator(".dd").click();
  await page.getByRole("button", { name: "color（色）", exact: true }).click();
  await toggle(page);
  await value(page, "#000000");
  const color = await snapshot(page);
  expect(color.doc.nodes.entry.field.defaultValue).toBeUndefined();
  await published(page, color.doc, "#000000");
  expect(errors).toEqual([]);
});

test("remote defaults update untouched preview inputs without replacing a later manual or scripted value", async ({ page }) => {
  const errors = await setup(page, inputDefaultDoc({ kind: "input", inputType: "number", defaultValue: "12" }));
  await toggle(page);
  await value(page, "12");
  const remote = async (defaultValue: string) => page.evaluate((next) => {
    const store = (window as any).initialEditor.getState();
    const doc = structuredClone(store.doc);
    doc.nodes.entry.field.defaultValue = next;
    store.applyRemoteDoc(doc);
  }, defaultValue);
  await remote("invalid");
  await value(page, "");
  await remote("24");
  await value(page, "24");
  await page.locator("#entry").fill("7");
  await value(page, "7", 1);
  await remote("30");
  await value(page, "7", 1);
  await page.locator("#assign-input").click();
  await value(page, "8", 2);
  await remote("invalid again");
  await value(page, "8", 2);
  const saved = await snapshot(page);
  expect(saved.doc.nodes.entry.field.defaultValue).toBe("invalid again");
  expect(saved.past).toHaveLength(0);
  await toggle(page);
  await toggle(page);
  await value(page, "8");
  expect(await snapshot(page)).toEqual(saved);
  await published(page, saved.doc, "");
  expect(errors).toEqual([]);
});
});

test.describe("select-default", () => {
const mountEditor = fieldEditorFixture(selectDefaultBundle);

async function setup(page: Page, doc = selectDefaultDoc()) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await mountEditor(page, doc);
  await expect(page.locator("#choice")).toBeVisible();
  const snapshot = () => page.evaluate(() => {
    const { doc, past, future } = (window as any).selectEditor.getState();
    return { doc, past, future };
  });
  return { errors, snapshot };
}

async function selection(page: Page, value: string, index: number) {
  await expect(page.locator("#choice")).toHaveValue(value);
  await expect(page.locator("#choice")).toHaveJSProperty("selectedIndex", index - 1);
  await expect(page.locator("#result")).toHaveText(`value=${value}; index=${index}`);
}

async function published(page: Page, doc: SiteDoc, value: string, index: number) {
  const { html } = await publishedSelectDefault(doc);
  await page.setContent(html);
  await page.addScriptTag({ content: scriptsFile(doc) });
  await selection(page, value, index);
  expect(await page.locator("#choice").evaluate((el) => {
    const form = document.createElement("form");
    form.append(el.cloneNode(true));
    return new FormData(form).get("choice");
  })).toBe(index ? value : null);
}

test("editing away the default option keeps preview, bindings and generated form values consistent", async ({ page }) => {
  const { errors, snapshot } = await setup(page);
  const options = page.locator("aside textarea");
  await options.fill("A\nC");
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await selection(page, "A", 1);
  const edited = await snapshot();
  expect(edited.doc.nodes.choice.field.defaultValue).toBe("B");
  expect(edited.doc.nodes.choice.field.options).toEqual([
    { label: "A", value: "A" }, { label: "C", value: "C" },
  ]);
  expect(edited.past).toHaveLength(1);
  await page.evaluate(() => (window as any).selectEditor.getState().undo());
  await selection(page, "B", 2);
  await page.evaluate(() => (window as any).selectEditor.getState().redo());
  await selection(page, "A", 1);
  expect(await snapshot()).toEqual(edited);
  // 編集した値を、初期値で上書きしない。
  await page.locator("#choice").selectOption("C");
  await selection(page, "C", 2);
  expect(await snapshot()).toEqual(edited);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  // 同じページでプレビューに戻ると、利用者の選択が残っている。
  await selection(page, "C", 2);
  expect(await snapshot()).toEqual(edited);
  await published(page, edited.doc, "A", 1);
  expect(errors).toEqual([]);
});

test("removing every option exposes no value and index zero", async ({ page }) => {
  const { errors, snapshot } = await setup(page);
  await page.locator("aside textarea").fill("");
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await selection(page, "", 0);
  const edited = await snapshot();
  expect(edited.doc.nodes.choice.field.options).toEqual([]);
  await page.evaluate(() => (window as any).selectEditor.getState().undo());
  await selection(page, "B", 2);
  await published(page, edited.doc, "", 0);
  expect(errors).toEqual([]);
});

test("default and dynamic select options agree between preview and the generated site", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  const snapshot = () => page.evaluate(() => {
    const { doc, past, future } = (window as any).selectEditor.getState();
    return { doc, past, future };
  });
  const publishedPage = await page.context().newPage();
  publishedPage.on("pageerror", (error) => errors.push(error.message));
  try {
    for (const [name, doc, value, index] of [
      ["valid default", selectDefaultDoc(), "B", 2],
      ["omitted default", selectDefaultDoc({ defaultValue: undefined }), "A", 1],
      ["resolved valid default", selectDefaultDoc({ options: ["{a}", "{b}"].map((value) => ({ label: value, value })), defaultValue: "{selected}" }, "a=A&b=B&selected=B"), "B", 2],
      ["resolved missing default", selectDefaultDoc({ options: ["{a}", "{b}"].map((value) => ({ label: value, value })), defaultValue: "{selected}" }, "a=A&b=C&selected=B"), "A", 1],
      ["resolved empty first option", selectDefaultDoc({ options: ["{empty}", "B"].map((value) => ({ label: value, value })), defaultValue: "C" }, "empty="), "", 1],
      ["resolved empty default", selectDefaultDoc({ options: ["A", "{empty}"].map((value) => ({ label: value, value })), defaultValue: "{empty}" }, "empty="), "", 2],
    ] as const) {
      await test.step(name, async () => {
        await mountEditor(page, doc);
        await expect(page.locator("#choice")).toBeVisible();
        const before = await snapshot();
        await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
        await selection(page, value, index);
        expect(await snapshot()).toEqual(before);
        await published(publishedPage, doc, value, index);
        expect(errors).toEqual([]);
      });
    }
  } finally {
    await publishedPage.close();
  }
});
});

test.describe("preview-dynamic-radio", () => {
async function expectSelection(page: Page, value: string, selected: string, checkText = true) {
  for (const id of ["small", "medium", "large"]) {
    if (selected === id) await expect(page.locator(`#${id} input`)).toBeChecked();
    else await expect(page.locator(`#${id} input`)).not.toBeChecked();
  }
  if (!checkText) return;
  const index = selected ? String(["small", "medium", "large"].indexOf(selected) + 1) : "";
  await expect(page.getByText(`size=${value}; small=${selected === "small"}; medium=${selected === "medium"}; large=${selected === "large"}; index=${index}`, { exact: true })).toBeVisible();
}

async function exerciseRadio(page: Page, checkText = true) {
  const selection = (value: string, selected: string) => expectSelection(page, value, selected, checkText);
  await selection("M", "medium");
  await page.getByRole("button", { name: "clear-medium", exact: true }).click();
  await selection("", "");
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByRole("button", { name: "select-small", exact: true }).click();
    await selection("S", "small");
  }
  await page.getByRole("button", { name: "clear-medium", exact: true }).click();
  await selection("S", "small");
  await page.getByRole("button", { name: "clear-small", exact: true }).click();
  await selection("", "");
  await page.getByRole("button", { name: "select-medium", exact: true }).click();
  await selection("M", "medium");
  await page.locator("#small input").check();
  await selection("S", "small");
  await page.getByRole("button", { name: "clear-small", exact: true }).click();
  await selection("", "");
  await page.getByRole("button", { name: "select-large", exact: true }).click();
  await selection("L", "large");
  await page.getByRole("button", { name: "clear-large", exact: true }).click();
  await selection("", "");
  await page.getByRole("button", { name: "select-small", exact: true }).click();
  await selection("S", "small");
  await page.getByRole("button", { name: "clear-group", exact: true }).click();
  await selection("", "");
}

async function setupPreview(page: Page, source: "query" | "data" | "literal") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.evaluate(() => {
    (window as any).radioLabels = { smallLabel: "S", mediumLabel: "M" };
    // JSON だけを差し替え、Canvas の取得・描画・スクリプトは実際の実装を使う。
    window.fetch = async (input) => {
      if (input !== "/api/fetch-json") throw new Error(`Unexpected fetch: ${input}`);
      return new Response(JSON.stringify({ json: (window as any).radioLabels }), { status: 200 });
    };
  });
  await page.addScriptTag({ content: await previewDynamicRadioBundle(source) });
  const snapshot = () => page.evaluate(() => {
    const { doc, past, future } = (window as any).radioEditor.getState();
    return { doc, past, future };
  });
  return { errors, snapshot };
}

for (const source of ["query", "data"] as const) {
  test(`preview radio scripts use current ${source} labels without editing the document`, async ({ page }) => {
    const { errors, snapshot } = await setupPreview(page, source);
    const before = await snapshot();
    await exerciseRadio(page);
    expect(await snapshot()).toEqual(before);

    if (source === "query") {
      await page.evaluate(() => (window as any).radioEditor.getState().updatePage("home", { query: "smallLabel=S2&mediumLabel=M2" }));
    } else {
      await page.evaluate(() => { (window as any).radioLabels = { smallLabel: "S2", mediumLabel: "M2" }; });
      await page.getByRole("button", { name: "Reload labels", exact: true }).click();
    }
    await expect(page.locator("#small input")).toHaveValue("S2");
    await expect(page.locator("#medium input")).toHaveValue("M2");
    await page.getByRole("button", { name: "select-small", exact: true }).click();
    await expectSelection(page, "S2", "small");
    await page.getByRole("button", { name: "clear-small", exact: true }).click();
    await expectSelection(page, "", "");

    if (source === "query") {
      await page.evaluate(() => (window as any).radioEditor.getState().undo());
      await expect(page.locator("#small input")).toHaveValue("S");
      await page.getByRole("button", { name: "select-small", exact: true }).click();
      await expectSelection(page, "S", "small");
      await page.getByRole("button", { name: "clear-group", exact: true }).click();
      await page.evaluate(() => (window as any).radioEditor.getState().redo());
      await expect(page.locator("#small input")).toHaveValue("S2");
      await page.getByRole("button", { name: "select-small", exact: true }).click();
      await expectSelection(page, "S2", "small");
      const after = await snapshot();
      expect(after.doc.nodes).toEqual(before.doc.nodes);
      expect(after.past).toHaveLength(1);
      expect(after.future).toHaveLength(0);
    } else expect(await snapshot()).toEqual(before);
    expect(errors).toEqual([]);
  });

  test(`exported radio scripts match the ${source} preview behavior`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { doc, html } = await publishedDynamicRadio(source);
    await page.setContent(html);
    await page.addScriptTag({ content: scriptsFile(doc) });
    // 公開したラジオボタンの選択の状態を、プレビューと比べる。
    await exerciseRadio(page, false);
    expect(errors).toEqual([]);
  });
}

// 代入の順序は、ラベルの出どころによらず同じランタイムを使う。ブラウザでの経路は1つにする。
// クエリとデータの解決は、上と Node.js のテストで別に試す。
for (const source of ["data"] as const) {
  test(`consecutive radio assignments compose in order with ${source} labels`, async ({ page }) => {
    const { errors, snapshot } = await setupPreview(page, source);
    await expectSelection(page, "M", "medium");
    const before = await snapshot();
    for (const [action, value, selected] of [
      ["select-clear-small", "", ""],
      ["clear-select-small", "S", "small"],
      ["small-medium", "M", "medium"],
      ["medium-small", "S", "small"],
      ["small-medium-clear", "", ""],
      ["small-medium-clear-small", "M", "medium"],
      ["group-small-clear", "", ""],
      ["small-group-clear", "", ""],
    ]) {
      // 前のクリックですでにその状態になっていても、1つのスクリプトの中の手順は順に実行する。
      for (let repeat = 0; repeat < 3; repeat++) {
        await page.getByRole("button", { name: action, exact: true }).click();
        await expectSelection(page, value, selected);
      }
    }
    expect(await snapshot()).toEqual(before);
    expect(errors).toEqual([]);
  });
}
});

test.describe("output-tag-dropdown", () => {
for (const width of [240, 288]) {
  test(`Output tag options and descriptions stay on one truncated line at panel width ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((width) => {
      localStorage.setItem("tsumu-help-seen-v1", "1");
      localStorage.setItem("tsumu-panel-r-w", String(width));
    }, width);
    const response = await page.request.post("/api/sites", { data: { name: "Output tag ellipsis" } });
    expect(response.ok()).toBeTruthy();
    const { site } = await response.json();
    await page.goto(`/sites/${site.id}`);
    await page.locator('[data-tutorial="layers-panel"]').getByText("ヒーロー", { exact: true }).click();
    await page.locator('[data-tutorial="right-tab-settings"]').click();
    const trigger = page.locator('[data-tutorial="settings-semantic"] .dd');
    const menu = page.locator(".dd-menu");
    const openMenu = async () => {
      // Playwright の自動スクロールで発生する scroll のイベントで一覧が閉じないよう、先に位置を合わせる。
      await trigger.scrollIntoViewIfNeeded();
      await trigger.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await trigger.click();
      await expect(menu).toBeVisible();
      // 間隔は、途中の座標ではなく、開くアニメーションが落ち着いた後に測る。
      await menu.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    };
    await openMenu();

    // 長い説明は1行のままで、どの項目も、間隔・全文・選択の動作を保つ。
    const items = menu.locator(".dd-item");
    await expect(items).toHaveCount(12);
    const measurements = await items.evaluateAll((buttons) => buttons.map((button) => {
      const label = button.querySelector<HTMLElement>(".dd-col > span")!;
      const desc = button.querySelector<HTMLElement>(".dd-desc")!;
      const row = button.getBoundingClientRect();
      const col = button.querySelector(".dd-col")!.getBoundingClientRect();
      const style = getComputedStyle(desc);
      return {
        label: label.textContent!,
        desc: desc.textContent!,
        title: button.getAttribute("title"),
        whiteSpace: style.whiteSpace,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        height: desc.getBoundingClientRect().height,
        lineHeight: parseFloat(style.lineHeight),
        top: col.top - row.top,
        bottom: row.bottom - col.bottom,
        truncated: desc.scrollWidth > desc.clientWidth,
      };
    }));
    expect(measurements.some((item) => item.truncated)).toBe(true);
    for (const item of measurements) {
      expect(item.whiteSpace).toBe("nowrap");
      expect(item.overflow).toBe("hidden");
      expect(item.textOverflow).toBe("ellipsis");
      expect(item.height).toBeCloseTo(item.lineHeight, 0);
      expect(item.top).toBeGreaterThanOrEqual(4);
      expect(item.bottom).toBeGreaterThanOrEqual(4);
      expect(item.title).toBe(`${item.label}\n${item.desc}`);
    }

    const label = "インラインテキスト（span）";
    await menu.getByRole("button", { name: new RegExp(label) }).click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAccessibleName(label);
    await expect(trigger).toHaveAttribute("title", label);
    await expect(trigger.locator(".dd-label")).toHaveCSS("white-space", "nowrap");
    await expect(trigger.locator(".dd-label")).toHaveCSS("text-overflow", "ellipsis");

    // 開き直すと選択が表示され、Escape・外側のクリック・選び直しも引き続き動く。
    await openMenu();
    await expect(menu.locator(".is-sel")).toContainText(label);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await openMenu();
    await page.locator('[data-tutorial="right-tab-settings"]').click();
    await expect(menu).toHaveCount(0);
    await openMenu();
    await menu.getByRole("button", { name: /^カスタム/ }).click();
    await expect(page.locator('[data-tutorial="settings-semantic"] input')).toBeVisible();
    await expect(menu).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
});
