import { expect, test, type Page, type Route } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const canvas = (page: Page) => page.locator('[data-tutorial="canvas"]');
const saved = (page: Page) => expect(page.getByText("サーバー保存済み")).toBeVisible();
function fixture(label: string): SiteDoc {
  const doc = createInitialDoc();
  doc.siteName = label;
  const heading = Object.values(doc.nodes).find((n) => n.text?.content.includes("見出しをここに"))!;
  heading.text!.content = label;
  return doc;
}
async function createSite(page: Page, remote?: SiteDoc) {
  const result = await page.request.post("/api/sites", { data: { name: "Bootstrap test" } });
  expect(result.ok()).toBeTruthy();
  const { site } = await result.json();
  if (remote) expect((await page.request.put(`/api/doc?site=${site.id}`, { data: remote })).ok()).toBeTruthy();
  return site.id as string;
}
async function prepare(page: Page, id: string, local?: SiteDoc, unsynced = false) {
  await page.addInitScript(({ id, local, unsynced }) => {
    localStorage.setItem("tsumu-help-seen-v1", "1");
    if (local) localStorage.setItem(`tsumu-doc-v1:${id}`, JSON.stringify(local));
    if (unsynced) localStorage.setItem(`tsumu-unsynced-v1:${id}`, "1");
  }, { id, local, unsynced });
}
async function holdInitialRead(page: Page, id: string, respond?: (route: Route) => Promise<void>) {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const requested = new Promise<void>((r) => { entered = r; });
  let first = true;
  const writes: string[] = [];
  await page.route(`**/api/doc?*`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.searchParams.get("site") !== id) return route.continue();
    if (req.method() !== "GET") { writes.push(req.method()); return route.continue(); }
    if (first && !url.searchParams.has("meta")) {
      first = false;
      entered();
      await gate;
      if (respond) return respond(route);
    }
    return route.continue();
  });
  return { requested, release, writes };
}
async function expectPending(page: Page, pending: { requested: Promise<void> }) {
  await pending.requested;
  await expect(page.locator(".boot")).toBeVisible();
  await expect(canvas(page)).toHaveCount(0);
  await expect(page.getByText("見出しをここに", { exact: false })).toHaveCount(0);
}

test("site validation and the first document read keep one continuous loading screen", async ({ page }) => {
  const id = await createSite(page, fixture("Continuous loading heading"));
  await prepare(page, id);
  let releaseSite!: () => void;
  let requestedSite!: () => void;
  const siteGate = new Promise<void>((resolve) => { releaseSite = resolve; });
  const siteRequested = new Promise<void>((resolve) => { requestedSite = resolve; });
  await page.route(`**/api/sites/${id}`, async (route) => {
    requestedSite();
    await siteGate;
    await route.continue();
  });
  const pending = await holdInitialRead(page, id);
  try {
    await page.goto(`/sites/${id}`);
    await siteRequested;
    await expect(page.getByText("エディタを準備しています", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      const w = window as any;
      w.initialBoot = document.querySelector(".boot");
      w.initialBootCard = document.querySelector(".boot-card");
      w.initialBootTip = document.querySelector(".boot-tip")!.textContent;
    });
    releaseSite();
    await expectPending(page, pending);
    expect(await page.evaluate(() => {
      const w = window as any;
      return document.querySelector(".boot") === w.initialBoot &&
        document.querySelector(".boot-card") === w.initialBootCard &&
        document.querySelector(".boot-tip")!.textContent === w.initialBootTip;
    })).toBe(true);
    await expect(page.locator('.boot[role="status"]')).toHaveCount(1);
    pending.release();
    await expect(canvas(page).getByText("Continuous loading heading", { exact: true })).toBeVisible();
    await saved(page);
    await expect(page.locator(".boot")).toHaveCount(0);
  } finally { releaseSite(); pending.release(); }
});

for (const cached of [false, true]) {
  test(`first HTTP load keeps placeholder ${cached ? "and stale cache" : "content"} hidden until the saved document arrives`, async ({ page }) => {
    const remote = fixture("Saved server heading");
    const id = await createSite(page, remote);
    await prepare(page, id, cached ? fixture("Stale cached heading") : undefined);
    const pending = await holdInitialRead(page, id);
    try {
      await page.goto(`/sites/${id}`);
      await expectPending(page, pending);
      await expect(page.getByText("Stale cached heading", { exact: true })).toHaveCount(0);
      // Global edit shortcuts must not modify the hidden, temporary document.
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Delete");
      await page.waitForTimeout(650);
      expect(pending.writes).toEqual([]);
      expect(await page.evaluate((id) => localStorage.getItem(`tsumu-unsynced-v1:${id}`), id)).toBeNull();
      if (!cached) expect(await page.evaluate((id) => localStorage.getItem(`tsumu-doc-v1:${id}`), id)).toBeNull();
      pending.release();
      await expect(canvas(page).getByText("Saved server heading", { exact: true })).toBeVisible();
      await saved(page);
      await expect(page.locator(".boot")).toHaveCount(0);
      await expect(page.getByText("保存されていない変更があります", { exact: true })).toHaveCount(0);
    } finally { pending.release(); }
  });
}

test("a truly empty server still creates and saves the initial document", async ({ page }) => {
  const id = await createSite(page);
  await prepare(page, id);
  const pending = await holdInitialRead(page, id);
  try {
    await page.goto(`/sites/${id}`);
    await expectPending(page, pending);
    pending.release();
    await expect(canvas(page).getByText("見出しをここに", { exact: false }).first()).toBeVisible();
    await saved(page);
    expect(pending.writes).toEqual(["PUT"]);
    const stored = await (await page.request.get(`/api/doc?site=${id}`)).json();
    expect(stored.exists).toBe(true);
    expect(stored.doc.pageOrder.length).toBeGreaterThan(0);
  } finally { pending.release(); }
});

for (const mode of ["offline", "error", "network", "invalid"] as const) {
  test(`${mode} initial load reveals the cached document and retains recovery behavior`, async ({ page }) => {
    const id = await createSite(page, fixture("Recovered server heading"));
    await prepare(page, id, fixture("Unsaved offline heading"));
    const pending = await holdInitialRead(page, id, (route) => mode === "network"
      ? route.abort("failed")
      : route.fulfill({ status: mode === "offline" ? 503 : mode === "error" ? 500 : 200,
          contentType: "application/json", body: JSON.stringify(mode === "invalid" ? { exists: true } : { error: mode }) }));
    try {
      await page.goto(`/sites/${id}`);
      await expectPending(page, pending);
      pending.release();
      await expect(canvas(page).getByText("Unsaved offline heading", { exact: true })).toBeVisible();
      await expect(page.locator(".boot")).toHaveCount(0);
      expect(pending.writes).toEqual([]);
      // A later reconnection must retain the mounted canvas instead of hiding/remounting it.
      await page.evaluate(() => { (window as any).initialCanvas = document.querySelector('[data-tutorial="canvas"]'); });
      await page.evaluate(() => window.dispatchEvent(new Event("cloud-sync-retry")));
      await expect(canvas(page)).toBeVisible();
      expect(await page.evaluate(() => (window as any).initialCanvas === document.querySelector('[data-tutorial="canvas"]'))).toBe(true);
      await expect(canvas(page).getByText("Recovered server heading", { exact: true })).toBeVisible();
      await saved(page);
    } finally { pending.release(); }
  });
}

for (const choice of ["remote", "local"] as const) {
  test(`unsynced local work still prompts for ${choice} conflict resolution after loading`, async ({ page }) => {
    const id = await createSite(page, fixture("Remote conflict heading"));
    await prepare(page, id, fixture("Local conflict heading"), true);
    const pending = await holdInitialRead(page, id);
    try {
      await page.goto(`/sites/${id}`);
      await expectPending(page, pending);
      pending.release();
      await expect(page.getByText("保存されていない変更があります", { exact: true })).toBeVisible();
      await expect(canvas(page).getByText("Local conflict heading", { exact: true })).toBeVisible();
      expect(pending.writes).toEqual([]);
      await page.getByRole("button", { name: choice === "remote" ? "サーバーの内容を使う" : "このブラウザの内容を使う", exact: true }).click();
      await saved(page);
      await expect(canvas(page).getByText(choice === "remote" ? "Remote conflict heading" : "Local conflict heading", { exact: true })).toBeVisible();
      const stored = await (await page.request.get(`/api/doc?site=${id}`)).json();
      expect(stored.doc.siteName).toBe(choice === "remote" ? "Remote conflict heading" : "Local conflict heading");
    } finally { pending.release(); }
  });
}

test("a delayed WebSocket snapshot uses the same initial loading gate", async ({ page }) => {
  const id = await createSite(page);
  await prepare(page, id);
  const remote = fixture("WebSocket saved heading");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const requested = new Promise<void>((r) => { entered = r; });
  await page.routeWebSocket("**/api/collab?**", (socket) => {
    socket.onMessage(async (raw) => {
      if (String(raw) === "ping") { socket.send("pong"); return; }
      const request = JSON.parse(String(raw));
      if (request.type !== "load") return;
      entered();
      await gate;
      socket.send(JSON.stringify({ type: "snapshot", requestId: request.requestId, exists: true,
        doc: remote, rev: "1", savedAt: Date.now() }));
    });
  });
  try {
    await page.goto(`/sites/${id}`);
    await expectPending(page, { requested });
    release();
    await expect(canvas(page).getByText("WebSocket saved heading", { exact: true })).toBeVisible();
    await saved(page);
  } finally { release(); }
});

test("offline without a cache reveals the usable initial document only after the read fails", async ({ page }) => {
  const id = await createSite(page);
  await prepare(page, id);
  const pending = await holdInitialRead(page, id, (route) => route.fulfill({ status: 503, body: "{}" }));
  try {
    await page.goto(`/sites/${id}`);
    await expectPending(page, pending);
    pending.release();
    await expect(canvas(page).getByText("見出しをここに", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("このブラウザにのみ保存", { exact: false })).toBeVisible();
    expect(pending.writes).toEqual([]);
  } finally { pending.release(); }
});

test("failed initial upload does not leave a new site stuck on the loading screen", async ({ page }) => {
  const id = await createSite(page);
  await prepare(page, id);
  await page.route("**/api/doc?*", (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Test save failed" }) })
    : route.continue());
  await page.goto(`/sites/${id}`);
  await expect(canvas(page).getByText("見出しをここに", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("サーバーに保存できません（このブラウザには保存済み）", { exact: true })).toBeVisible();
  await expect(page.locator(".boot")).toHaveCount(0);
  const stored = await (await page.request.get(`/api/doc?site=${id}`)).json();
  expect(stored.exists).toBe(false);
});
