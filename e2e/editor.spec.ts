import { expect, test, type Page } from "@playwright/test";
import { ZipArchive } from "../lib/zip";
import { browserDoc } from "./helpers/browser-doc";

const HEADING = "見出しをここに";

/** 画面の不具合を見つけるため、ページの例外を集める。 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** API でサイトを作り、ヘルプのダイアログを出さないようにして、エディタを開く。 */
async function openNewSite(page: Page, name = "E2E"): Promise<string> {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const res = await page.request.post("/api/sites", { data: { name } });
  expect(res.ok()).toBeTruthy();
  const { site } = (await res.json()) as { site: { id: string } };
  await page.goto(`/sites/${site.id}`);
  await expect(canvas(page).getByText(HEADING).first()).toBeVisible();
  return site.id;
}

const canvas = (page: Page) => page.locator('[data-tutorial="canvas"]');
const layers = (page: Page) => page.locator('[data-tutorial="layers-panel"]');
const saved = (page: Page) => expect(page.getByText("サーバー保存済み")).toBeVisible();

async function deleteHero(page: Page) {
  await layers(page).getByText("ヒーロー", { exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(canvas(page).getByText(HEADING)).toHaveCount(0);
}

test("Create a site from Home and open it in the editor", { tag: "@core-editing" }, async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "新しいサイト" }).first().click();
  await page.getByLabel("サイト名").fill("はじめてのサイト");
  await page.getByRole("button", { name: "作成して開く" }).click();
  await page.waitForURL(/\/sites\//);
  await expect(canvas(page).getByText(HEADING).first()).toBeVisible();
  const siteName = page.locator(".hdr-page");
  await expect(siteName.getByRole("button", { name: "サイト名: はじめてのサイト" })).toBeVisible();
  await expect(siteName.locator(".dd")).toHaveCount(0, "page navigation belongs in the Pages tab");
  await saved(page);
  expect(errors).toEqual([]);
});

test("Tsumu page title and save preferences survive a reload", { tag: "@core-editing" }, async ({ page, context }) => {
  const id = await openNewSite(page, "Tsumu smoke");
  await saved(page);
  await expect(page).toHaveTitle("Tsumu smoke | Tsumu");
  await expect.poll(() => browserDoc(page, id)).not.toBeNull();
  expect((await context.cookies()).find((c) => c.name === "tsumu-lang")?.value).toBe("ja");

  // Reuse this smoke test's site and reload for the header's inline editing
  // regression. This avoids creating and reloading a second site in all three browsers.
  const header = page.locator(".hdr-page");
  const edit = header.locator(".hdr-site-name");
  await expect(edit).toHaveText("Tsumu smoke");
  const originalDocSiteName = (await (await page.request.get(`/api/doc?site=${id}`)).json()).doc.siteName;
  await edit.click();
  const field = header.getByRole("textbox", { name: "サイト名" });
  await expect(field).toBeFocused();
  await field.fill("  Renamed Tsumu smoke  ");
  await field.press("Enter");
  await expect(header.locator(".hdr-site-name-text")).toHaveText("Renamed Tsumu smoke");
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sites/${id}`);
    return (await response.json()).site.name;
  }).toBe("Renamed Tsumu smoke");
  expect((await (await page.request.get(`/api/doc?site=${id}`)).json()).doc.siteName).toBe(originalDocSiteName);

  await edit.click();
  await field.fill("Discard this change");
  await field.press("Escape");
  await expect(header.locator(".hdr-site-name-text")).toHaveText("Renamed Tsumu smoke");

  await edit.click();
  await field.fill("  ");
  await field.press("Enter");
  await expect(header.locator(".hdr-site-name-text")).toHaveText("Renamed Tsumu smoke");

  await page.reload();
  await expect(canvas(page).getByText(HEADING).first()).toBeVisible();
  await expect(header.locator(".hdr-site-name-text")).toHaveText("Renamed Tsumu smoke");
  await expect(page).toHaveTitle("Renamed Tsumu smoke | Tsumu");
  await expect(page.getByRole("button", { name: "始める" })).toHaveCount(0);
});

test("Deleting a node is undoable, persists, and survives a reload", { tag: "@core-editing" }, async ({ page }) => {
  const errors = watchErrors(page);
  await openNewSite(page);
  await deleteHero(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(canvas(page).getByText(HEADING).first()).toBeVisible();
  await deleteHero(page);
  await saved(page);
  await page.reload();
  await expect(layers(page).getByText("ナビバー", { exact: true })).toBeVisible();
  await expect(canvas(page).getByText(HEADING)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Live edits arrive immediately and a background SSE reconnect catches missed edits", async ({ browser }) => {
  // 互いに切り離した2つのブラウザのコンテキストを開き、終わった後で SSE の接続を閉じる。
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await ctxA.newPage();
    const siteId = await openNewSite(a);
    const b = await ctxB.newPage();
    await b.addInitScript(() => {
      localStorage.setItem("tsumu-help-seen-v1", "1");
      window.EventSource = class extends EventSource {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init);
          (window as any).collaborationEvents = this;
        }
      };
    });
    // WebSocket を使えない環境では、SSE の更新の通知が接続するのを待つ。
    const events = b.waitForRequest((r) => r.url().includes("/api/collab/events"));
    await b.goto(`/sites/${siteId}`);
    await expect(canvas(b).getByText(HEADING).first()).toBeVisible();
    await events;
    await expect.poll(() => b.evaluate(() => (window as any).collaborationEvents?.readyState)).toBe(1);
    await deleteHero(a);
    await saved(a);
    // 更新は、10秒ごとのポーリングより前に届くはず。
    await expect(canvas(b).getByText(HEADING)).toHaveCount(0, { timeout: 5_000 });
    // 切断中の1通知を取りこぼし、非表示中に再接続したときのブラウザイベントを再現する。
    await b.evaluate(() => {
      const events: EventSource = (window as any).collaborationEvents;
      events.addEventListener("message", event => {
        event.stopImmediatePropagation();
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        events.dispatchEvent(new Event("open"));
        Reflect.deleteProperty(document, "hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      }, { capture: true, once: true });
    });
    await a.keyboard.press("ControlOrMeta+z");
    await expect(canvas(a).getByText(HEADING).first()).toBeVisible();
    await saved(a);
    await expect(canvas(b).getByText(HEADING).first()).toBeVisible({ timeout: 5_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("Style, Settings, and Script panels open", { tag: "@core-editing" }, async ({ page }) => {
  const errors = watchErrors(page);
  await openNewSite(page);
  await layers(page).getByText("ボタン", { exact: true }).click();
  await page.locator('[data-tutorial="right-tab-style"]').click();
  await expect(page.locator('[data-tutorial="inspector"]')).toContainText("レイアウト");
  await page.locator('[data-tutorial="right-tab-settings"]').click();
  await expect(page.locator('[data-tutorial="settings-panel"]')).toContainText("意味付け");
  await page.getByText("ページのスクリプトを編集").click();
  await expect(page.locator('[data-tutorial="se-new"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="se-workspace"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("ZIP export produces a standard Next.js project", async ({ page }) => {
  await openNewSite(page, "Zip export");
  await page.locator('[data-tutorial="menu"]').click();
  await page.getByText("zipでエクスポート").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "zipをダウンロード" }).click();
  const file = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of file) chunks.push(c as Buffer);
  const zip = await ZipArchive.open(Buffer.concat(chunks));
  const names = Object.keys(zip.files);
  const root = names.find((n) => n.endsWith("package.json"))!.replace(/package\.json$/, "");
  const pkg = JSON.parse(await zip.file(`${root}package.json`)!.text());
  expect(Object.keys(pkg.dependencies)).toEqual(expect.arrayContaining(["next", "react", "react-dom"]));
  expect(await zip.file(`${root}app/page.tsx`)!.text()).toContain(HEADING);
});

test("Drag a canvas node to reorder it", { tag: "@core-editing" }, async ({ page }) => {
  const errors = watchErrors(page);
  await openNewSite(page);
  const order = async () => {
    const texts = await layers(page).innerText();
    return texts.indexOf("ボタン") < texts.indexOf("見出しをここに");
  };
  expect(await order()).toBe(false);
  const button = canvas(page).locator("[data-node]", { hasText: "はじめる" }).last();
  const heading = canvas(page).locator("[data-node]", { hasText: HEADING }).last();
  const from = (await button.boundingBox())!;
  const to = (await heading.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // ドラッグは 6px 動いてから始まる。見出しの上に落とす。
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + ((to.y + 4 - from.y - from.height / 2) * i) / 10);
  }
  await page.mouse.up();
  await expect.poll(order).toBe(true);
  expect(errors).toEqual([]);
});

test("Build a click script by choosing a trigger and an action", { tag: "@core-editing" }, async ({ page }) => {
  const errors = watchErrors(page);
  await openNewSite(page);
  await layers(page).getByText("ボタン", { exact: true }).click();
  await page.locator('[data-tutorial="right-tab-settings"]').click();
  await page.getByText("ページのスクリプトを編集").click();
  const workspace = page.locator('[data-tutorial="se-workspace"]');
  await expect(workspace).toBeVisible();
  // 要素の設定から開いたので、選んだきっかけはそのボタンに付く
  await page.locator('[data-tutorial="se-new"]').click();
  await workspace.locator('[data-trigger="click"]').click();
  await workspace.locator('[data-tutorial="se-add"]').click();
  await page.locator('.se-picker [data-action="show"]').click();
  await expect(workspace.locator(".se-card")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Custom code and icon scripts stored in documents never execute inside the editor", async ({ page }) => {
  const errors = watchErrors(page);
  const siteId = await openNewSite(page);
  await saved(page);
  // カスタムのコードやアイコンに onerror のハンドラーを含む、取り込んだ文書や復元した文書を再現する。
  const cur = await (await page.request.get(`/api/doc?site=${siteId}`)).json();
  const doc = cur.doc;
  const pageId = doc.pageOrder[0];
  const base = doc.nodes[doc.pages[pageId].children[0]];
  doc.nodes.evil_code = {
    ...base, id: "evil_code", type: "code", name: "Code", text: null, link: null, children: [], scripts: undefined,
    code: { html: `<p>custom code kept</p><img src="data:," onerror="window.__pwned = 'code'"><a href="javascript:window.__pwned='link'">x</a>` },
  };
  doc.nodes.evil_icon = {
    ...base, id: "evil_icon", type: "icon", name: "Icon", text: null, link: null, children: [], scripts: undefined,
    icon: { name: "x", svg: `<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned = 'icon'"><circle r="4"/></svg>` },
  };
  doc.pages[pageId].children.unshift("evil_code", "evil_icon");
  const rejected = await page.request.put(`/api/doc?site=${siteId}&base=${cur.rev}`, { data: doc });
  expect(rejected.status()).toBe(400);

  delete doc.nodes.evil_icon;
  doc.pages[pageId].children = doc.pages[pageId].children.filter((id: string) => id !== "evil_icon");
  const put = await page.request.put(`/api/doc?site=${siteId}&base=${cur.rev}`, { data: doc });
  expect(put.ok()).toBeTruthy();

  await page.reload();
  await expect(canvas(page).getByText("custom code kept")).toBeVisible();
  await expect(canvas(page).locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect.poll(() => canvas(page).locator("img").evaluateAll((els) => els.every((el) => (el as HTMLImageElement).complete))).toBe(true);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  expect(await page.evaluate(() => (window as { __pwned?: string }).__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("page appearance uses an icon-only trigger with light and dark menu options", async ({ page }) => {
  await openNewSite(page, "Page appearance");
  const trigger = page.locator(".hdr-page-theme button").first();
  await expect(trigger).toHaveAttribute("aria-label", "ページの配色");
  await expect(trigger.locator("svg")).toHaveCount(1);
  await expect(trigger).toHaveText("");
  await trigger.click();
  const options = page.locator(".dd-menu .dd-item");
  await expect(options).toHaveCount(2);
  await expect(options.filter({ hasText: "ライトモード" })).toBeVisible();
  await expect(options.filter({ hasText: "ダークモード" })).toBeVisible();
});

test("history separates published, automatic and manual backups into tabs", async ({ page }) => {
  await openNewSite(page, "Backup tabs");
  await page.locator('[data-tutorial="menu"] > button').click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: "履歴・ロールバック" }).click();
  const dialog = page.getByRole("dialog", { name: "履歴" });
  const published = dialog.getByRole("tab", { name: "公開サイト" });
  const automatic = dialog.getByRole("tab", { name: "編集データの自動バックアップ" });
  const manual = dialog.getByRole("tab", { name: "手動バックアップ" });

  await expect(published).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator(".hist-backup")).toHaveCount(0);
  await automatic.click();
  await expect(automatic).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator(".hist-backup")).toHaveCount(0);
  await manual.click();
  await expect(manual).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator(".hist-backup")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "バックアップZIPを書き出す" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "バックアップファイルを読み込む" })).toBeVisible();
  await published.click();
  await expect(dialog.locator(".hist-backup")).toHaveCount(0);
});

test("MCP connection opens its own modal dialog from the editor menu", async ({ page }) => {
  const errors = watchErrors(page);
  await openNewSite(page, "MCP menu");
  await page.locator('[data-tutorial="menu"] > button').click();
  const menuItems = page.locator(".dd-menu .dd-item");
  await expect(menuItems.filter({ hasText: "AIと接続（MCP）" })).toBeVisible();
  await menuItems.filter({ hasText: "AIと接続（MCP）" }).click();

  await expect(page.getByRole("dialog", { name: "AIと接続（MCP）" }).getByRole("heading", { level: 2 })).toHaveText("AIと接続（MCP）");
  await expect(page.locator(".mcp-modal .mcp-panel h3")).toHaveText("AIと接続");
  await expect(page.locator(".mcp-modal .mcp-plugins h3")).toHaveText("AIアプリにTsumuを追加");
  await expect(page.locator(".mcp-modal .mcp-guide-link")).toBeVisible();
  await expect(page.locator(".mcp-modal")).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".mcp-modal .modal-heading-icon svg")).toBeVisible();
  await expect(page.getByRole("button", { name: "接続を開始" })).toBeVisible();
  await page.locator(".modal-backdrop .modal-actions button").click();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  expect(errors).toEqual([]);
});

