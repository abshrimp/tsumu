import { expect, test, type Page } from "@playwright/test";
import { pendingImportBundle } from "../tests/helpers/pending-import";

let bundle: string;
test.beforeAll(async () => { bundle = await pendingImportBundle(); });
test.beforeEach(async ({ page }) => {
  await page.route("http://pending-import.test/", (route) => route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' }));
  await page.goto("http://pending-import.test/");
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-tip="フォントを追加"]')).toBeVisible();
});

async function hold(page: Page, pattern: string | RegExp, body: string, contentType: string) {
  let arrived!: () => void;
  let release!: () => void;
  let finished!: () => void;
  let requestUrl = "";
  const started = new Promise<void>((resolve) => { arrived = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const done = new Promise<void>((resolve) => { finished = resolve; });
  await page.route(pattern, async (route) => {
    requestUrl = route.request().url();
    arrived();
    await gate;
    await route.fulfill({ contentType, body, headers: { "access-control-allow-origin": "*" } });
    finished();
  });
  return { started, finish: async () => {
    const response = page.waitForResponse((response) => response.url() === requestUrl);
    release();
    await done;
    await (await response).finished();
  } };
}
async function doc(page: Page) { return page.evaluate(() => (window as any).importEditor.getState().doc); }
async function settle(page: Page) {
  // 遅らせた取得と React の更新を待ち、その後で何も変わらないことを確かめる。
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function startFont(page: Page) {
  const request = await hold(page, /https:\/\/fonts\.googleapis\.com\/css2\?family=New\+Font/, "@font-face { font-family: New Font; font-weight: 100 900; }", "text/css");
  await page.locator('[data-tip="フォントを追加"]').click();
  await page.getByRole("searchbox", { name: "Google Fontsを検索" }).fill("New Font");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await request.started;
  return request;
}
test("Google Fonts suggestions do not include arbitrary alphabetical catalog entries", async ({ page }) => {
  await page.locator('[data-tip="フォントを追加"]').click();
  const results = page.getByRole("group", { name: "Google Fontsの検索結果" });
  await expect(results.getByRole("button")).toHaveCount(32);
  await expect(results.getByRole("button", { name: /Noto Sans JP/ })).toBeVisible();
  await expect(results.getByRole("button", { name: /ABeeZee/ })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Google Fontsを検索" }).fill("ABeeZee");
  await expect(results.getByRole("button", { name: /ABeeZee/ })).toBeVisible();
});

test("Adobe Fonts lists published project families without requiring embed code", async ({ page }) => {
  await page.route("http://pending-import.test/api/fonts/adobe/status?**", (route) =>
    route.fulfill({ json: { status: "available", fonts: [
      { name: "Source Han Sans", family: "source-han-sans-japanese", loading: "dynamic" },
    ] } }));
  await page.locator('[data-tip="フォントを追加"]').click();
  await page.getByRole("button", { name: "Adobe Fonts" }).click();
  await page.getByRole("textbox", { name: "WebプロジェクトIDまたはURL" }).fill("abc1234");
  await page.getByRole("button", { name: /Source Han Sans/ }).click();
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect.poll(async () => (await doc(page)).nodes.a.styles.base.default.fontFamily)
    .toBe("source-han-sans-japanese");
  expect((await doc(page)).adobeFonts).toEqual([
    { family: "source-han-sans-japanese", kitId: "abc1234", loading: "dynamic" },
  ]);
});

test("Adobe Fonts places project setup help next to the ID label without redundant warnings", async ({ page }) => {
  await page.locator('[data-tip="フォントを追加"]').click();
  await page.getByRole("button", { name: "Adobe Fonts" }).click();
  await expect(page.getByText("Webプロジェクトが未設定です。")).toHaveCount(0);
  await expect(page.locator(".font-add-label-row")
    .getByRole("button", { name: "Adobe Fontsの追加方法" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ここ" }))
    .toHaveAttribute("href", "https://fonts.adobe.com/my_fonts#web_projects-section");
  await expect(page.getByRole("link", { name: "源ノ明朝" }))
    .toHaveAttribute("href", "https://fonts.adobe.com/fonts/source-han-serif-japanese");
});

test("Adobe lookup failure is not called an expired subscription and does not require manual input", async ({ page }) => {
  await page.route("http://pending-import.test/api/fonts/adobe/status?**", (route) =>
    route.fulfill({ json: { status: "unknown", fonts: [] } }));
  await page.locator('[data-tip="フォントを追加"]').click();
  await page.getByRole("button", { name: "Adobe Fonts" }).click();
  await page.getByRole("textbox", { name: "WebプロジェクトIDまたはURL" }).fill(
    "https://use.typekit.net/abc1234.js");
  await expect(page.getByText(/期限切れとは限りません/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "CSSのfont-family名" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "追加", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "ここ" })).toBeVisible();
  await expect(page.locator(".font-add-label-row").getByRole("button", { name: "Adobe Fontsの追加方法" })).toBeVisible();
});

test("Existing Adobe fonts remain selectable when metadata API is unavailable", async ({ page }) => {
  await page.route("http://pending-import.test/api/fonts/adobe/status?**", (route) =>
    route.fulfill({ json: { status: "reachable", fonts: [], loading: "dynamic" } }));
  await page.evaluate(() => {
    (window as any).importEditor.getState().updateDoc((doc: any) => {
      doc.adobeFonts = [{ family: "poprumcute", kitId: "tud1nus", loading: "dynamic" }];
    });
  });
  await page.locator('[data-tip="フォントを追加"]').click();
  await page.getByRole("button", { name: "Adobe Fonts" }).click();
  await expect(page.getByRole("textbox", { name: "WebプロジェクトIDまたはURL" })).toHaveCount(0);
  await page.getByRole("button", { name: "tud1nus", exact: true }).click();
  await expect(page.getByText(/フォント配信先には接続できましたが/)).toBeVisible();
  await page.getByRole("group", { name: "AdobeのWebプロジェクト内のフォント" })
    .getByRole("button", { name: /poprumcute/ }).click();
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect.poll(async () => (await doc(page)).nodes.a.styles.base.default.fontFamily).toBe("poprumcute");
  expect((await doc(page)).adobeFonts).toEqual([
    { family: "poprumcute", kitId: "tud1nus", loading: "dynamic" },
  ]);
});

test("Saved Adobe projects hide the ID field until + is selected", async ({ page }) => {
  await page.evaluate(() => (window as any).importEditor.getState().updateDoc((d: any) => {
    d.adobeFonts = [
      { family: "poprumcute", kitId: "jys5tkg", loading: "dynamic" },
    ];
  }));
  await page.locator('[data-tip="フォントを追加"]').click();
  await page.getByRole("button", { name: "Adobe Fonts" }).click();
  await expect(page.getByRole("textbox", { name: "WebプロジェクトIDまたはURL" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "jys5tkg", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Webプロジェクトを追加" }).click();
  await expect(page.getByRole("textbox", { name: "WebプロジェクトIDまたはURL" })).toBeVisible();
  await page.getByRole("button", { name: "jys5tkg", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "WebプロジェクトIDまたはURL" })).toHaveCount(0);
});

test("Removing an Adobe project clears its font registrations and applied font styles in one undo step", async ({ page }) => {
  await page.evaluate(() => (window as any).importEditor.getState().updateDoc((d: any) => {
    d.adobeFonts = [
      { family: "poprumcute", kitId: "jys5tkg", loading: "dynamic" },
      { family: "source-han-serif-japanese", kitId: "jys5tkg", loading: "dynamic" },
      { family: "acumin-pro", kitId: "abc1234", loading: "css" },
    ];
    d.nodes.a.styles.base.default.fontFamily = "poprumcute";
  }));
  await page.locator('[data-tip="フォントを追加"]').click();
  await page.getByRole("button", { name: "Adobe Fonts" }).click();
  const before = await doc(page);
  await page.getByRole("button", { name: "Webプロジェクト jys5tkg を削除" }).click();
  const confirm = page.getByRole("dialog", { name: "Adobe Webプロジェクトの削除" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("登録済みのフォント2件");
  await expect(confirm).toContainText("Adobe Fonts側のWebプロジェクトは削除されません");
  expect(await doc(page)).toEqual(before);
  await confirm.getByRole("button", { name: "キャンセル" }).click();
  expect(await doc(page)).toEqual(before);
  await page.getByRole("button", { name: "Webプロジェクト jys5tkg を削除" }).click();
  await page.getByRole("dialog", { name: "Adobe Webプロジェクトの削除" })
    .getByRole("button", { name: "削除", exact: true }).click();
  const after = await doc(page);
  expect(after.adobeFonts).toEqual([{ family: "acumin-pro", kitId: "abc1234", loading: "css" }]);
  expect(after.nodes.a.styles.base.default.fontFamily).toBeUndefined();
  await page.evaluate(() => (window as any).importEditor.getState().undo());
  expect(await doc(page)).toEqual(before);
  await page.evaluate(() => (window as any).importEditor.getState().redo());
  expect(await doc(page)).toEqual(after);
});

async function startImage(page: Page, picker = page.locator('[data-tutorial="style-background"] .img-pick')) {
  const request = await hold(page, "http://pending-import.test/api/assets", JSON.stringify({ path: "assets/new.svg" }), "application/json");
  await picker.locator(".img-pick-thumb").click();
  await picker.locator('input[type="file"]').setInputFiles({ name: "new.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>') });
  await request.started;
  return request;
}

for (const change of ["breakpoint", "state", "selection", "multiselection"] as const) {
  test(`Changing ${change} during font loading does not apply it to another editing target`, async ({ page }) => {
    const pending = await startFont(page);
    await page.evaluate((change) => {
      const s = (window as any).importEditor.getState();
      if (change === "breakpoint") s.setBreakpoint("sm");
      if (change === "state") s.setStyleState("hover");
      if (change === "selection") s.select("b");
      if (change === "multiselection") (window as any).importEditor.setState({ selectedIds: ["a", "b"] });
    }, change);
    await settle(page);
    const before = await doc(page);
    await pending.finish(); await settle(page);
    expect(await doc(page)).toEqual(before);
    await expect(page.getByRole("button", { name: "確認中…", exact: true })).toHaveCount(0);
  });
}

test("Selecting another asset while an image uploads preserves the selection and Undo/Redo", async ({ page }) => {
  const pending = await startImage(page);
  await page.locator('.img-pick-cell[data-tip="old.svg"]').click();
  const chosen = await doc(page);
  expect(chosen.nodes.a.styles.base.default.backgroundImage).toContain("data:image/svg+xml");
  await pending.finish(); await settle(page);
  const completed = await doc(page);
  expect({ ...completed, assets: chosen.assets }).toEqual(chosen);
  expect(Object.values(completed.assets)).toContainEqual(expect.objectContaining({ path: "assets/new.svg" }));
  await page.evaluate(() => (window as any).importEditor.getState().undo());
  expect(await doc(page)).toEqual(chosen);
  await page.evaluate(() => (window as any).importEditor.getState().redo());
  expect(await doc(page)).toEqual(completed);
  await page.evaluate(() => { (window as any).importEditor.getState().undo(); (window as any).importEditor.getState().undo(); });
  expect((await doc(page)).nodes.a.styles.base.default.backgroundImage).toBe('url("https://example.test/a.png")');
});

test("Changing breakpoint during image upload does not set a background on the wrong breakpoint", async ({ page }) => {
  const pending = await startImage(page);
  await page.evaluate(() => (window as any).importEditor.getState().setBreakpoint("sm"));
  await settle(page);
  const before = await doc(page);
  await pending.finish(); await settle(page);
  const completed = await doc(page);
  expect({ ...completed, assets: before.assets }).toEqual(before);
  expect(Object.values(completed.assets)).toContainEqual(expect.objectContaining({ path: "assets/new.svg" }));
});

test("Switching pages during OGP image upload retains only completed assets", async ({ page }) => {
  await page.evaluate(() => (window as any).importEditor.getState().select(null));
  await page.locator('[data-tutorial="page-seo"] .sec-head').click();
  const picker = page.locator('[data-tutorial="page-settings"] .img-pick');
  await expect(picker).toBeVisible();
  const pending = await startImage(page, picker);
  await page.evaluate(() => (window as any).importEditor.getState().setActivePage("q"));
  await settle(page);
  const before = await doc(page);
  await pending.finish(); await settle(page);
  const completed = await doc(page);
  expect({ ...completed, assets: before.assets }).toEqual(before);
  expect(Object.values(completed.assets)).toContainEqual(expect.objectContaining({ path: "assets/new.svg" }));
});

for (const initial of [undefined, "https://example.test/original.png"]) {
  test(`OGP image URL input survives upload until blur (${initial ? "existing URL" : "unset"})`, async ({ page }) => {
    await page.evaluate((initial) => {
      const s = (window as any).importEditor.getState();
      if (initial) s.updatePage("p", { ogImage: { url: initial } });
      s.select(null);
    }, initial);
    await page.locator('[data-tutorial="page-seo"] .sec-head').click();
    const picker = page.locator('[data-tutorial="page-settings"] .img-pick');
    const pending = await startImage(page, picker);
    const url = picker.locator("input.input");
    const draft = "https://example.test/newer.png";
    await url.fill(draft);
    await expect(url).toBeFocused();
    const before = await doc(page);
    expect(before.pages.p.ogImage).toEqual(initial ? { url: initial } : undefined);
    await pending.finish();
    await expect.poll(async () => Object.values((await doc(page)).assets).some((a: any) => a.path === "assets/new.svg")).toBe(true);
    await settle(page);
    await expect(url).toBeVisible();
    await expect(url).toBeFocused();
    await expect(url).toHaveValue(draft);
    const completed = await doc(page);
    expect({ ...completed, assets: before.assets }).toEqual(before);
    await url.press("Tab");
    await expect.poll(async () => (await doc(page)).pages.p.ogImage).toEqual({ url: draft });
    expect((await doc(page)).assets).toEqual(completed.assets);
  });
}

test("Closing a font addition ignores its result and allows a subsequent successful import", async ({ page }) => {
  const pending = await startFont(page);
  await page.locator('[data-tip="フォントを追加"]').click();
  const before = await doc(page);
  await pending.finish(); await settle(page);
  expect(await doc(page)).toEqual(before);
  await page.unroute("https://fonts.googleapis.com/**");
  await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "@font-face { font-weight: 100 900; }", headers: { "access-control-allow-origin": "*" } }));
  await page.locator('[data-tip="フォントを追加"]').click();
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect.poll(async () => (await doc(page)).nodes.a.styles.base.default.fontFamily).toBe("New Font");
  expect((await doc(page)).customFonts).toEqual([{ family: "New Font", weights: "variable" }]);
});

test("Closing the image picker prevents a late upload from changing the background", async ({ page }) => {
  const pending = await startImage(page);
  await page.locator('[data-tutorial="style-background"] .img-pick-thumb').click();
  const before = await doc(page);
  await pending.finish(); await settle(page);
  const completed = await doc(page);
  expect({ ...completed, assets: before.assets }).toEqual(before);
  expect(Object.values(completed.assets)).toContainEqual(expect.objectContaining({ path: "assets/new.svg" }));
});

for (const boundary of ["undo", "undo-redo", "replace", "restore"] as const) {
  test(`${boundary} during image loading preserves history and completed files without stale assignment`, async ({ page }) => {
    await page.evaluate(() => (window as any).importEditor.getState().updateNode("b", { name: "Edit to redo" }));
    const pending = await startImage(page);
    await page.evaluate((boundary) => {
      const s = (window as any).importEditor.getState();
      if (boundary === "undo" || boundary === "undo-redo") s.undo();
      if (boundary === "undo-redo") s.redo();
      if (boundary === "replace") s.replaceDoc(structuredClone(s.doc));
      if (boundary === "restore") s.restoreDoc({ ...structuredClone(s.doc), siteName: "Restored" });
    }, boundary);
    const before = await page.evaluate(() => {
      const s = (window as any).importEditor.getState();
      return { doc: s.doc, past: s.past, future: s.future, selection: s.selection, selectedIds: s.selectedIds };
    });
    await pending.finish(); await settle(page);
    const after = await page.evaluate(() => {
      const s = (window as any).importEditor.getState();
      return { doc: s.doc, past: s.past, future: s.future, selection: s.selection, selectedIds: s.selectedIds };
    });
    const file = Object.values(after.doc.assets).find((asset: any) => asset.path === "assets/new.svg") as any;
    expect(file).toBeTruthy();
    const retained = (doc: any) => ({ ...doc, assets: { ...doc.assets, [file.id]: file } });
    expect(after).toEqual({ ...before, doc: retained(before.doc), past: before.past.map(retained), future: before.future.map(retained) });
    for (let i = 0; i < 2; i++) {
      if (before.future.length) {
        await page.evaluate(() => (window as any).importEditor.getState().redo());
        expect(await doc(page)).toEqual(retained(before.future[0]));
        await page.evaluate(() => (window as any).importEditor.getState().undo());
        expect(await doc(page)).toEqual(retained(before.doc));
      } else if (before.past.length) {
        await page.evaluate(() => (window as any).importEditor.getState().undo());
        expect(await doc(page)).toEqual(retained(before.past.at(-1)));
        await page.evaluate(() => (window as any).importEditor.getState().redo());
        expect(await doc(page)).toEqual(retained(before.doc));
      }
    }
  });
}

test("Unrelated Undo during font loading preserves Redo without registering a stale font", async ({ page }) => {
  await page.evaluate(() => (window as any).importEditor.getState().updateNode("b", { name: "Edit to redo" }));
  const pending = await startFont(page);
  await page.evaluate(() => (window as any).importEditor.getState().undo());
  const before = await doc(page);
  await pending.finish(); await settle(page);
  expect(await doc(page)).toEqual(before);
  await page.evaluate(() => (window as any).importEditor.getState().redo());
  expect((await doc(page)).nodes.b.name).toBe("Edit to redo");
  expect((await doc(page)).customFonts).toBeUndefined();
});
