import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { previewDynamicRadioBundle, publishedDynamicRadio } from "../tests/helpers/preview-dynamic-radio";

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
