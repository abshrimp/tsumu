import { expect, test, type Page } from "@playwright/test";
import { editorBootstrapBundle } from "../tests/helpers/editor-bootstrap";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const fixture = (): SiteDoc => ({ siteName: "Paste scope", assets: {}, pageOrder: ["p"], pages: {
  p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a"] },
}, nodes: { a: { ...makeText("Copied text"), id: "a" } } });

test.describe("Editorのネイティブpaste受信範囲", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await editorBootstrapBundle(true); });
  test.beforeEach(async ({ page }) => {
    await page.route("http://paste-scope.test/**", route => route.request().url().endsWith("/")
      ? route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' })
      : route.fulfill({ status: 503, body: "{}" }));
    await page.goto("http://paste-scope.test/");
    await page.evaluate(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    await page.addScriptTag({ content: bundle });
    await expect(page.locator(".app")).toBeVisible();
    await page.evaluate(doc => {
      const s = (window as any).pasteEditor.getState(); s.replaceDoc(doc); s.setActivePage("p"); s.select("a");
      (window as any).pasteUploads = 0;
      const fetch = window.fetch;
      window.fetch = async (url, options) => {
        if (String(url) === "/api/assets") { (window as any).pasteUploads++; return new Promise(() => {}); }
        return fetch(url, options);
      };
    }, fixture());
  });
  const snapshot = (page: Page) => page.evaluate(() => {
    const { doc, past, future } = (window as any).pasteEditor.getState();
    return { doc, past, future, uploads: (window as any).pasteUploads };
  });
  async function paste(page: Page, kind: "elements" | "artwork", selector = "body") {
    return page.evaluate(({ kind, selector }) => {
      const data = new DataTransfer();
      if (kind === "elements") data.setData("application/x-tsumu+json", JSON.stringify({
        v: 1, site: "default", nodes: [(window as any).pasteEditor.getState().doc.nodes.a], rootIds: ["a"], assets: {}, components: {}, componentNodes: [], customFonts: [],
      }));
      else data.items.add(new File(["synthetic image"], "test.png", { type: "image/png" }));
      const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
      document.querySelector(selector)!.dispatchEvent(event);
      return event.defaultPrevented;
    }, { kind, selector });
  }
  for (const context of ["preview", "modal", "script"] as const) for (const kind of ["elements", "artwork"] as const) {
    test(`${context}の背後へ${kind}を貼り付けない`, async ({ page }) => {
      await page.evaluate(context => {
        if (context === "preview") (window as any).pasteEditor.getState().setMode("preview");
        else { const el = document.createElement("div"); el.className = context === "modal" ? "modal-backdrop" : "se-backdrop"; document.body.append(el); }
      }, context);
      const before = await snapshot(page);
      expect(await paste(page, kind)).toBe(false);
      await page.waitForTimeout(100);
      expect(await snapshot(page)).toEqual(before);
      await expect(page.locator(".paste-notice")).toHaveCount(0);
    });
  }
  for (const target of ["input", "textarea", "select", "contenteditable"]) test(`${target}の貼り付けは横取りしない`, async ({ page }) => {
    await page.evaluate(target => {
      const el = document.createElement(target === "contenteditable" ? "div" : target); el.id = "native-target";
      if (target === "contenteditable") el.contentEditable = "true";
      document.body.append(el);
    }, target);
    const before = await snapshot(page);
    expect(await paste(page, "elements", "#native-target")).toBe(false);
    expect(await snapshot(page)).toEqual(before);
  });
  test("閉じるアニメーション中のモーダルはデザイン貼り付けを妨げず、Undo/Redoできる", async ({ page }) => {
    await page.evaluate(() => { const el = document.createElement("div"); el.className = "modal-backdrop is-leaving"; document.body.append(el); });
    const before = await snapshot(page);
    expect(await paste(page, "elements")).toBe(true);
    const after = await snapshot(page);
    expect(Object.keys(after.doc.nodes)).toHaveLength(2);
    expect(after.past).toHaveLength(before.past.length + 1);
    await page.evaluate(() => (window as any).pasteEditor.getState().undo());
    expect((await snapshot(page)).doc).toEqual(before.doc);
    await page.evaluate(() => (window as any).pasteEditor.getState().redo());
    expect((await snapshot(page)).doc).toEqual(after.doc);
  });
});

// 実Next Editorのコピー操作とブラウザ生成pasteで、保存データまで確認する。
for (const context of ["preview", "settings"] as const) test(`実エディタの${context}でCtrl+Vしても保存文書を変更しない`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const created = await page.request.post("/api/sites", { data: { name: "Native paste scope" } });
  expect(created.ok()).toBeTruthy(); const { site } = await created.json();
  const endpoint = `/api/doc?site=${site.id}`, doc = fixture();
  expect((await page.request.put(endpoint, { data: doc })).ok()).toBeTruthy();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="save-status"]')).toContainText("サーバー保存済み");
  await page.locator('[data-node="a"]').click();
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem("tsumu-clipboard-v1"))).toBe(true);
  await page.evaluate(() => {
    (window as any).nativePastes = [];
    window.addEventListener("paste", event => (window as any).nativePastes.push({ trusted: event.isTrusted, data: event.clipboardData?.getData("application/x-tsumu+json"), prevented: event.defaultPrevented }));
  });
  if (context === "preview") await page.getByRole("button", { name: "プレビュー", exact: true }).click();
  else {
    await page.getByRole("button", { name: "メニュー（書き出し・履歴・設定）", exact: true }).click();
    await page.locator(".dd-menu").getByRole("button", { name: "設定", exact: true }).click();
    await expect(page.locator(".modal h2")).toHaveText("設定");
  }
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => page.evaluate(() => (window as any).nativePastes.length)).toBe(1);
  const event = await page.evaluate(() => (window as any).nativePastes[0]);
  expect(event.trusted).toBe(true); expect(JSON.parse(event.data).rootIds).toEqual(["a"]); expect(event.prevented).toBe(false);
  await page.waitForTimeout(1200);
  expect((await (await page.request.get(endpoint)).json()).doc).toEqual(doc);
  if (context === "settings") await page.locator(".modal").getByRole("button", { name: "閉じる", exact: true }).click();
  else await page.getByRole("button", { name: "デザイン", exact: true }).click();
  await expect(page.locator('[data-node]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-node="a"]')).toBeVisible();
  expect((await (await page.request.get(endpoint)).json()).doc).toEqual(doc);
});
