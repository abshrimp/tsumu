import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";

const HEADING = "見出しをここに";

/** Collect page exceptions to detect a broken UI. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Create a site through the API, suppress the help dialog, and open the editor. */
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

test("Create a site from Home and open it in the editor", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "新しいサイト" }).first().click();
  await page.getByLabel("サイト名").fill("はじめてのサイト");
  await page.getByRole("button", { name: "作成して開く" }).click();
  await page.waitForURL(/\/sites\//);
  await expect(canvas(page).getByText(HEADING).first()).toBeVisible();
  await saved(page);
  expect(errors).toEqual([]);
});

test("Tsumu page title and save preferences survive a reload", async ({ page, context }) => {
  const id = await openNewSite(page, "Tsumu smoke");
  await saved(page);
  await expect(page).toHaveTitle("Tsumu smoke | Tsumu");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage))).toContain(`tsumu-doc-v1:${id}`);
  expect((await context.cookies()).find((c) => c.name === "tsumu-lang")?.value).toBe("ja");
  await page.reload();
  await expect(canvas(page).getByText(HEADING).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "始める" })).toHaveCount(0);
});

test("Deleting a node is undoable, persists, and survives a reload", async ({ page }) => {
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

test("Edits from another user arrive immediately without waiting for polling", async ({ browser }) => {
  // Open two isolated browser contexts and close their SSE connections afterward.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await ctxA.newPage();
    const siteId = await openNewSite(a);
    const b = await ctxB.newPage();
    await b.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    // Where WebSocket is unavailable, wait for SSE update notifications to connect.
    const events = b.waitForRequest((r) => r.url().includes("/api/collab/events"));
    await b.goto(`/sites/${siteId}`);
    await expect(canvas(b).getByText(HEADING).first()).toBeVisible();
    await events;
    await b.waitForTimeout(500);
    await deleteHero(a);
    await saved(a);
    // The update should arrive before the 10-second polling interval.
    await expect(canvas(b).getByText(HEADING)).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("Style, Settings, and Script panels open", async ({ page }) => {
  const errors = watchErrors(page);
  await openNewSite(page);
  await layers(page).getByText("ボタン", { exact: true }).click();
  await page.locator('[data-tutorial="right-tab-style"]').click();
  await expect(page.locator('[data-tutorial="inspector"]')).toContainText("レイアウト");
  await page.locator('[data-tutorial="right-tab-settings"]').click();
  await expect(page.locator('[data-tutorial="settings-panel"]')).toContainText("意味付け");
  await page.getByText("ページのスクリプトを編集").click();
  await expect(page.locator('[data-tutorial="se-palette"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="se-workspace"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("Publishing explains the missing GitHub configuration", async ({ page }) => {
  await openNewSite(page);
  await page.locator('[data-tutorial="publish"]').click();
  await expect(page.getByText("GitHubへの公開が設定されていません")).toBeVisible();
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
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const names = Object.keys(zip.files);
  const root = names.find((n) => n.endsWith("package.json"))!.replace(/package\.json$/, "");
  const pkg = JSON.parse(await zip.file(`${root}package.json`)!.async("string"));
  expect(Object.keys(pkg.dependencies)).toEqual(expect.arrayContaining(["next", "react", "react-dom"]));
  expect(await zip.file(`${root}app/page.tsx`)!.async("string")).toContain(HEADING);
});

test("Drag a canvas node to reorder it", async ({ page }) => {
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
  // A drag starts after 6px of movement; drop above the heading.
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + ((to.y + 4 - from.y - from.height / 2) * i) / 10);
  }
  await page.mouse.up();
  await expect.poll(order).toBe(true);
  expect(errors).toEqual([]);
});

test("Drag a palette block into the script workspace", async ({ page }) => {
  const errors = watchErrors(page);
  await openNewSite(page);
  await layers(page).getByText("ボタン", { exact: true }).click();
  await page.locator('[data-tutorial="right-tab-settings"]').click();
  await page.getByText("ページのスクリプトを編集").click();
  const workspace = page.locator('[data-tutorial="se-workspace"]');
  await expect(workspace).toBeVisible();
  const before = await workspace.locator(".se-stack").count();
  const item = page.locator(".se-pal-item").first();
  const from = (await item.boundingBox())!;
  const ws = (await workspace.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + 10 + ((ws.x + ws.width / 2 - from.x) * i) / 10, from.y + ((ws.y + ws.height / 2 - from.y) * i) / 10);
  }
  await page.mouse.up();
  await expect(workspace.locator(".se-stack")).toHaveCount(before + 1);
  expect(errors).toEqual([]);
});

test("Custom code and icon scripts stored in documents never execute inside the editor", async ({ page }) => {
  const errors = watchErrors(page);
  const siteId = await openNewSite(page);
  await saved(page);
  // Simulate imported or restored documents containing onerror handlers in custom code and icons.
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
  const put = await page.request.put(`/api/doc?site=${siteId}&base=${cur.rev}`, { data: doc });
  expect(put.ok()).toBeTruthy();

  await page.reload();
  await expect(canvas(page).getByText("custom code kept")).toBeVisible();
  await expect(canvas(page).locator('a[href^="javascript:"]')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as { __pwned?: string }).__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});
