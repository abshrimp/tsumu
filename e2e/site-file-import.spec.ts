import { expect, test } from "@playwright/test";
import { ZipBuilder } from "../lib/zip";
import { createInitialDoc, makeIcon, makeImage } from "../lib/presets";
import { browserDoc, setBrowserDoc } from "./helpers/browser-doc";
import { generateExportProject } from "../lib/export-formats";
import { storageKey } from "../lib/storage-keys";

const listKey = storageKey("sites-v1");

function fixture(withAsset = false) {
  const doc = createInitialDoc();
  doc.siteName = withAsset ? "ZIP imported site" : "JSON imported site";
  doc.customHeadHtml = '<meta name="test-import" content="ok">';
  if (withAsset) {
    doc.assets["original-logo"] = {
      id: "original-logo", name: "logo.svg", width: 16, height: 16,
      mimeType: "image/svg+xml", path: "assets/on-old-server",
    };
    const image = makeImage();
    image.id = "imported-image";
    image.image!.assetId = "original-logo";
    doc.nodes[image.id] = image;
    doc.pages[doc.pageOrder[0]].children.push(image.id);
  }
  return doc;
}
async function localMode(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
  });
  await page.route("**/api/sites**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/doc**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/assets", route => route.fulfill({ status: 503, json: {} }));
}
async function getLocalSite(page: import("@playwright/test").Page) {
  const list = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]") as { id: string; name: string }[], listKey);
  return { list, doc: list[0] ? JSON.parse((await browserDoc(page, list[0].id)) || "null") : null };
}

test("ZIP file picker imports an editable site with original asset IDs", async ({ page }) => {
  await localMode(page);
  const doc = fixture(true);
  const zip = new ZipBuilder();
  const root = zip.folder("website");
  root.file("_tsumu/doc.json", JSON.stringify(doc));
  root.file("_tsumu/assets.json", JSON.stringify({
    version: 1, assets: { "original-logo": "public/assets/logo.svg" },
  }));
  root.file("public/assets/logo.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>');
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "website.zip", mimeType: "application/zip",
    buffer: Buffer.from(await zip.toBytes()),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  const result = await getLocalSite(page);
  expect(result.list).toHaveLength(1);
  expect(result.doc.pages).toEqual(doc.pages);
  expect(result.doc.nodes).toEqual(doc.nodes);
  expect(result.doc.assets["original-logo"].id).toBe("original-logo");
  expect(result.doc.assets["original-logo"].dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  await page.reload();
  await expect(page.locator(".app")).toBeVisible();
  expect((await getLocalSite(page)).list).toHaveLength(1);
});


test("ZIP without doc.json alerts before converting HTML on homepage drop", async ({ page }) => {
  await localMode(page);
  const zip = new ZipBuilder().file("index.html", "<!doctype html><html><body><h1>Converted page</h1></body></html>");
  const bytes = Buffer.from(await zip.toBytes());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], "plain-site.zip", { type: "application/zip" }));
    document.querySelector(".home-main")!.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer: transfer,
    }));
  }, Array.from(bytes));
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("ZIPに編集データが見つかりませんでした。HTMLを変換して読み込みます。");
  expect((await getLocalSite(page)).list).toHaveLength(0);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  expect((await getLocalSite(page)).list).toHaveLength(1);
});

test("dropping a JSON file imports a new editable site", async ({ page }) => {
  await localMode(page);
  const doc = fixture();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  const file = {
    name: "doc.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc)),
  };
  const payload = { name: file.name, type: file.mimeType, data: Array.from(file.buffer) };
  await expect(page.locator(".home-import-drop")).toHaveCount(0);
  await page.evaluate((input) => {
    const target = document.querySelector(".home-top");
    if (!target) throw new Error("Home header missing");
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(input.data)], input.name, { type: input.type }));
    target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, payload);
  await expect(page.locator(".home-drop-overlay")).toBeVisible();
  await page.evaluate((input) => {
    // 専用のドロップ先ではなく、ホームの別の部分にドロップする。
    const target = document.querySelector(".home-main");
    if (!target) throw new Error("Home content missing");
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(input.data)], input.name, { type: input.type }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, payload);
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const imported = await getLocalSite(page);
  expect(imported.list).toHaveLength(1);
  expect(imported.doc.siteName).toBe(doc.siteName);
  expect(imported.doc.customHeadHtml).toBe(doc.customHeadHtml);
});


test("normal text drag on the homepage does not trigger file import", async ({ page }) => {
  await localMode(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  const prevented = await page.evaluate(() => {
    const target = document.querySelector(".home-top");
    if (!target) throw new Error("Home header missing");
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "ordinary text");
    const event = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.locator(".home-drop-overlay")).toHaveCount(0);
  expect((await getLocalSite(page)).list).toHaveLength(0);
});

test("invalid JSON is rejected without creating a site", async ({ page }) => {
  await localMode(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "doc.json", mimeType: "application/json", buffer: Buffer.from("{not-json"),
  });
  await expect(page.locator(".home-notice[role=alert]")).toBeVisible();
  expect((await getLocalSite(page)).list).toHaveLength(0);
});

for (const lost of [false, true]) test(`server import reserves a site and saves its first revision (response lost: ${lost})`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-lang", "ja"));
  const doc = fixture();
  let stored: unknown = null;
  let siteId = "";
  await page.route("**/api/sites**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/sites" && route.request().method() === "GET")
      return route.fulfill({ json: { sites: [] } });
    if (path === "/api/sites" && route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      siteId = input.importId;
      expect(input.initialDoc).toBeUndefined();
      if (lost) return route.abort("connectionreset");
      return route.fulfill({ json: { site: { id: siteId, name: "Importing site" } } });
    }
    if (path === "/api/sites/" + siteId && route.request().method() === "GET")
      return route.fulfill({ json: { site: { id: siteId, name: doc.siteName, accessRole: "owner" } } });
    if (path === "/api/sites/" + siteId && route.request().method() === "PATCH")
      return route.fulfill({ json: { site: { id: siteId, name: doc.siteName, accessRole: "owner" } } });
    return route.fulfill({ status: 400, json: { error: "Unexpected site API" } });
  });
  await page.route("**/api/doc?**", async route => {
    if (route.request().method() === "PUT") {
      const input = route.request().postDataJSON();
      // DocumentRoom reconstructs collections after document settings.
      const { pages, nodes, assets, ...settings } = input;
      stored = { ...settings, pages, nodes, assets };
      return route.fulfill({ json: { ok: true, rev: "1", savedAt: 1 } });
    }
    return route.fulfill({ json: stored
      ? { exists: true, doc: stored, rev: "1", savedAt: 1 }
      : { exists: false } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "site.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9]{10}$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  expect(stored).toMatchObject({ siteName: doc.siteName, pages: doc.pages, nodes: doc.nodes });
});

test("importing archived CSS keeps style end tags as literal content in the published page", async ({ page }) => {
  await localMode(page);
  const zip = new ZipBuilder().file("index.html", '<link rel="stylesheet" href="theme.css"><p>CSS probe</p>')
    .file("theme.css", '@supports (display: grid) {p::before{content:"</StYlE><script>globalThis.cssExecuted=1</script><style>";}} @media (max-width:600px){p::after{content:"narrow"}}');
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "styles.zip", mimeType: "application/zip", buffer: Buffer.from(await zip.toBytes()),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const { doc } = await getLocalSite(page);
  const files = generateExportProject(doc, "html").files;
  const output = await page.context().newPage();
  await output.route("https://published.test/**", route => {
    const path = new URL(route.request().url()).pathname.slice(1) || "index.html";
    return Object.hasOwn(files, path) ? route.fulfill({ body: files[path],
      contentType: path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html" }) : route.abort();
  });
  await output.goto("https://published.test/");
  expect(await output.evaluate(() => (globalThis as typeof globalThis & { cssExecuted?: number }).cssExecuted)).toBeUndefined();
  await expect.poll(() => output.locator("p").first().evaluate(p => getComputedStyle(p, "::before").content)).toContain("</StYlE><script>");
  const afterContent = () => output.locator("p").first().evaluate(p => getComputedStyle(p, "::after").content);
  expect(await afterContent()).not.toContain("narrow");
  await output.setViewportSize({ width: 400, height: 600 });
  await expect.poll(afterContent).toContain("narrow");
});

test("an external HTML base retains external stylesheet integrity even with a local namesake", async ({ page }) => {
  await localMode(page);
  const zip = new ZipBuilder().file("index.html", '<base href="https://cdn.example.test/web/"><link rel=stylesheet href=theme.css integrity=sha256-AAAA><p>External</p>')
    .file("theme.css", "p{color:red}");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "external.zip", mimeType: "application/zip", buffer: Buffer.from(await zip.toBytes()),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const { doc } = await getLocalSite(page);
  const head = doc.pages[doc.pageOrder[0]].customTopHtml;
  expect(head).toContain('href="https://cdn.example.test/web/theme.css"');
  expect(head).toContain('integrity="sha256-AAAA"');
});

test("an import ID collision preserves the already stored site and document", async ({ page }) => {
  await localMode(page);
  await page.addInitScript(({ listKey }) => {
    const id = "aaaaaaaaaa";
    localStorage.setItem(listKey, JSON.stringify([{ id, name: "Existing site" }]));
    const random = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, "getRandomValues", { value: (bytes: Uint8Array) =>
      bytes.length === 10 ? bytes.fill(0) : random(bytes) });
  }, { listKey });
  await page.goto("/");
  await setBrowserDoc(page, "aaaaaaaaaa", JSON.stringify({ siteName: "Existing document" }));
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "site.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture())),
  });
  await expect(page.locator(".home-notice[role=alert]")).toBeVisible();
  const existing = await getLocalSite(page);
  expect(existing.list).toEqual([{ id: "aaaaaaaaaa", name: "Existing site" }]);
  expect(existing.doc).toEqual({ siteName: "Existing document" });
});

for (const lock of ["web-locks", "indexeddb"]) {
  test(`simultaneous local imports retain both documents and home entries with ${lock}`, async ({ page, context }) => {
    const other = await context.newPage();
    try {
      const tabs = [page, other];
      await Promise.all(tabs.map(async tab => {
        await localMode(tab);
        if (lock === "indexeddb") await tab.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined }));
        await tab.goto("/");
        await expect(tab.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
      }));
      await Promise.all(tabs.map(async (tab, i) => {
        const doc = fixture();
        doc.siteName = "Parallel site " + i;
        await tab.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
          name: "site.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
        });
        await expect(tab).toHaveURL(/\/sites\/[a-z0-9]{10}$/);
      }));
      const sites = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]") as { id: string; name: string }[], listKey);
      const saved = await Promise.all(sites.map(async site => [site.name, JSON.parse((await browserDoc(page, site.id)) || "null")?.siteName]));
      expect(saved.sort()).toEqual([["Parallel site 0", "Parallel site 0"], ["Parallel site 1", "Parallel site 1"]]);
    } finally { await other.close(); }
  });
}

test("local import waits for a preceding tab's site index to reach this tab", async ({ page, context }) => {
  const second = await context.newPage();
  try {
    await Promise.all([page, second].map(async tab => {
      await localMode(tab);
      await tab.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined }));
      await tab.goto("/");
      await expect(tab.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
    }));
    async function upload(tab: typeof page, name: string) {
      const doc = fixture();
      doc.siteName = name;
      await tab.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
        name: "site.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
      });
      await expect(tab).toHaveURL(/\/sites\/[a-z0-9]{10}$/);
    }
    await upload(page, "First tab");
    // Chromium は、2つ目のレンダラーの localStorage に変更を伝える前に、IndexedDB の
    // トランザクションを許可することがある。その見え方の遅れを、決まった形で再現する。
    await second.evaluate(({ listKey, markerKey }) => {
      const get = Storage.prototype.getItem;
      let until = 0;
      Storage.prototype.getItem = function (key: string) {
        if (this === localStorage && (key === listKey || key === markerKey)) {
          if (!until) until = performance.now() + 400;
          if (performance.now() < until) return null;
        }
        return get.call(this, key);
      };
    }, { listKey, markerKey: storageKey("sites-lock-v1") });
    await upload(second, "Second tab");
    await expect.poll(async () => (await getLocalSite(page)).list.map((site: { name: string }) => site.name))
      .toEqual(["Second tab", "First tab"]);
  } finally { await second.close(); }
});

test("JSON import strips active SVG from editable icons before the resulting site can be exported", async ({ page }) => {
  await localMode(page);
  const doc = fixture();
  const icon = makeIcon();
  icon.icon!.svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="globalThis.injectedSvg=1">' +
    '<script>globalThis.injectedSvg=2</script><rect width="10" height="10"/></svg>';
  doc.nodes[icon.id] = icon;
  doc.pages[doc.pageOrder[0]].children.push(icon.id);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "doc.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page).toHaveURL(new RegExp("/sites/[a-z0-9-]+$"), { timeout: 30000 });
  const saved = await getLocalSite(page);
  const svg = saved.doc.nodes[icon.id].icon.svg;
  expect(svg).toContain("<rect");
  expect(svg).not.toMatch(/onload|<script|injectedSvg/i);
  expect(await page.evaluate(() => (globalThis as any).injectedSvg)).toBeUndefined();
});

test.describe("mcp-draft-import", () => {
  const draftId = "12345678-1234-4234-8234-123456789abc";
  const secret = "s".repeat(43);
  const receipt = "abcdef01-1234-4234-8234-abcdef012345";
  const endpoint = "https://mcp.tsumu.ebii.net/drafts/" + draftId;

  test("one-time MCP URL imports a new editable site, then acknowledges deletion", async ({ page }) => {
    await localMode(page);
    const doc = createInitialDoc();
    doc.siteName = "AI-generated imported site";
    const styledNode = Object.values(doc.nodes).find(node => node.text?.heading === 1);
    expect(styledNode).toBeDefined();
    const baseStyles = styledNode!.styles.base?.default;
    expect(baseStyles).toBeDefined();
    baseStyles!.backgroundColor = "#183c32";
    baseStyles!.color = "#d9fa4a";
    let claims = 0, completions = 0;
    let releaseClaim!: () => void;
    const holdClaim = new Promise<void>(resolve => { releaseClaim = resolve; });
    await page.route(endpoint + "/claim", async route => {
      claims++;
      expect(route.request().headers()["authorization"]).toBe("Bearer " + secret);
      await holdClaim;
      await route.fulfill({ json: { doc: JSON.stringify(doc), receipt } });
    });
    await page.route(endpoint + "/complete", async route => {
      completions++;
      expect(route.request().postDataJSON()).toEqual({ receipt });
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/#tsumu-import=" + draftId + "." + secret);
    await expect(page.locator(".home-import-overlay")).toBeVisible();
    await expect(page.locator(".home-import-overlay")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(".home-import-overlay .boot-card")).toBeVisible();
    await expect(page.locator(".home-import-overlay .boot-bar")).toBeVisible();
    releaseClaim();
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
    await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
    expect(claims).toBe(1);
    expect(completions).toBe(1);
    const result = await getLocalSite(page);
    expect(result.list).toHaveLength(1);
    expect(result.doc.siteName).toBe(doc.siteName);
    expect(result.doc.nodes[styledNode!.id].styles.base.default.backgroundColor).toBe("#183c32");
    expect(result.doc.nodes[styledNode!.id].styles.base.default.color).toBe("#d9fa4a");
  });

  for (const failedApi of ["status", "sites"]) {
    test(`draft import retries after /api/${failedApi} fails during startup`, async ({ page }) => {
      await localMode(page);
      let recovered = false;
      await page.route("**/api/" + failedApi, route => recovered ? route.fallback() : route.fulfill({ status: 500, json: {} }));
      let claims = 0;
      await page.route(endpoint + "/claim", route => {
        claims++;
        return route.fulfill({ json: { doc: JSON.stringify(fixture()), receipt } });
      });
      await page.route(endpoint + "/complete", route => route.fulfill({ json: { ok: true } }));
      await page.goto("/#tsumu-import=" + draftId + "." + secret);
      const retry = page.locator(".home-notice.is-error button");
      await expect(retry).toBeVisible();
      await expect(page.locator(".home-import-overlay")).toHaveCount(0);
      expect(claims).toBe(0);
      recovered = true;
      await retry.click();
      await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
      expect(claims).toBe(1);
      expect((await getLocalSite(page)).list).toHaveLength(1);
    });
  }

  test("invalid MCP draft does not create a site or acknowledge deletion", async ({ page }) => {
    await localMode(page);
    let completions = 0;
    await page.route(endpoint + "/claim", route => route.fulfill({ json: { doc: "{bad-json", receipt } }));
    await page.route(endpoint + "/complete", route => {
      completions++;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto("/#tsumu-import=" + draftId + "." + secret);
    await expect(page.locator(".home-notice.is-error")).toBeVisible({ timeout: 30000 });
    expect(completions).toBe(0);
    expect((await getLocalSite(page)).list).toHaveLength(0);
    expect(new URL(page.url()).hash).toBe("");
  });
});

