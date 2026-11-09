import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { createInitialDoc } from "../lib/presets";
import { generateProject } from "../lib/generator";
import { generateExportProject } from "../lib/export-formats";
import { importedAssetPath, importedAssetUrl } from "../lib/generator/imported-assets";
import { browserDoc } from "./helpers/browser-doc";
import { storageKey } from "../lib/storage-keys";

const listKey = storageKey("sites-v1");

async function localMode(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
  });
  await page.route("**/api/sites**", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/doc**", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/assets", (route) => route.fulfill({ status: 503, json: {} }));
}
async function importedDoc(page: Page) {
  const sites = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]") as { id: string }[], listKey);
  return sites[0] ? JSON.parse((await browserDoc(page, sites[0].id)) || "null") : null;
}

test("HTML file import generates editable nodes and responsive CSS, not rawHtml", async ({ page }) => {
  await localMode(page);
  const html = [
    "<!doctype html><html><head><title>Editable HTML</title><style>",
    ".card { display: flex; gap: 24px; }",
    "@media screen and (max-width: 768px) { .card { flex-direction: column; gap: 12px; } }",
    "@media (min-width: 1000px) { .card { color: rgb(10, 20, 30); } }",
    "</style></head><body>",
    '<section class="card" id="card"><h1>Converted heading</h1><p>Converted text</p></section>',
    "</body></html>",
  ].join("");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "index.html", mimeType: "text/html", buffer: Buffer.from(html),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  const doc = await importedDoc(page);
  expect(doc).not.toBeNull();
  expect(doc.siteName).toBe("Editable HTML");
  expect(doc.pageOrder).toHaveLength(1);
  const home = doc.pages[doc.pageOrder[0]];
  expect(home.rawHtml).toBeUndefined();
  const card = Object.values(doc.nodes).find((node: any) => node.attrId === "card") as any;
  expect(card).toBeTruthy();
  expect(card.children).toHaveLength(2);
  expect(card.styles.base.default.display).toBe("flex");
  expect(card.styles.base.default.gap).toBe("24px");
  const mobile = doc.breakpoints.find((bp: any) => bp.maxWidth === 768);
  expect(mobile).toBeTruthy();
  expect(card.styles[mobile.id].default.flexDirection).toBe("column");
  expect(card.styles[mobile.id].default.gap).toBe("12px");
  const desktopOnlyBoundary = doc.breakpoints.find((bp: any) => bp.maxWidth === 999);
  expect(desktopOnlyBoundary).toBeTruthy();
  expect(card.styles[desktopOnlyBoundary.id].default.color).toBe("revert");
});

test("HTML import applies browser-compatible URL validation before storing links and sources", async ({ page }) => {
  await localMode(page);
  const html = '<html><body>' +
    '<a id="obfuscated-link" href="java&#x09;script:alert(1)">unsafe</a>' +
    '<a id="document-link" href="data:text/html;base64,PHNjcmlwdD4=">unsafe data</a>' +
    '<a id="ordinary-link" href="https://example.test/docs">safe</a>' +
    '<img id="obfuscated-image" src="java&#x0a;script:alert(2)" alt="unsafe">' +
    '<img id="inline-image" src="data:image/png;base64,aGVsbG8=" alt="inline">' +
    '</body></html>';
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "index.html", mimeType: "text/html", buffer: Buffer.from(html),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const doc = await importedDoc(page);
  const node = (id: string) => Object.values(doc.nodes).find((value: any) => value.attrId === id) as any;
  expect(node("obfuscated-link").link.url).toBe("#");
  expect(node("document-link").link.url).toBe("#");
  expect(node("ordinary-link").link.url).toBe("https://example.test/docs");
  expect(node("obfuscated-image").image.src).toBe("");
  expect(node("inline-image").image.src).toBe("data:image/png;base64,aGVsbG8=");
});

test("HTML import preserves selector classes and safe attributes in editor and export", async ({ page }) => {
  await localMode(page);
  const html = [
    '<!doctype html><html lang="en"><head><title>Selector fidelity</title>',
    '<style>:root { --base-color: #123456; } .card::before { content: "before"; } .card:focus-within { outline: 1px solid red; } .card { display: grid; color: var(--base-color) !important; }</style>',
    '</head><body><section id="card" class="card highlighted" data-topic="design"',
    ' aria-label="Featured card" title="Details" role="region" onclick="alert(1)">',
    '<h2>Visible text</h2></section></body></html>',
  ].join("");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "index.html", mimeType: "text/html", buffer: Buffer.from(html),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const doc = await importedDoc(page);
  const node = Object.values(doc.nodes).find((x: any) => x.attrId === "card") as any;
  expect(node.htmlClass).toBe("card highlighted");
  expect(node.styles.base.default.color).toBe("var(--base-color) !important");
  expect(doc.pages[doc.pageOrder[0]].customTopHtml).toContain(":root");
  expect(doc.pages[doc.pageOrder[0]].customTopHtml).toContain(".card:focus-within");
  expect(node.htmlAttrs).toMatchObject({
    "data-topic": "design", "aria-label": "Featured card", title: "Details", role: "region",
  });
  expect(node.htmlAttrs.onclick).toBeUndefined();
  expect(doc.pages[doc.pageOrder[0]].customTopHtml).toContain(".card::before");
  const project = generateProject(doc);
  const source = Object.entries(project.files)
    .filter(([name]) => name.endsWith("/page.tsx"))
    .map(([, body]) => body).join("\n");
  expect(source).toContain("card highlighted");
  expect(source).toContain('"data-topic":"design"');
  expect(source).not.toContain("onclick");
});

test("class styles are distributed to element controls and per-element custom CSS", async ({ page }) => {
  await localMode(page);
  const html = [
    '<!doctype html><html><head><title>Split classes</title><style>',
    '.card { display: grid; gap: 12px; --brand-color: #123456; clip-path: circle(50%); }',
    '.card .title { color: #123456; }',
    '@media (max-width: 768px) { .card { gap: 4px; } }',
    '</style></head><body><article class="card" id="card">',
    '<h2 class="title" id="title">Editable heading</h2></article></body></html>',
  ].join("");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "index.html", mimeType: "text/html", buffer: Buffer.from(html),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const doc = await importedDoc(page);
  const card = Object.values(doc.nodes).find((node: any) => node.attrId === "card") as any;
  const title = Object.values(doc.nodes).find((node: any) => node.attrId === "title") as any;
  expect(card.htmlClass).toBeUndefined();
  expect(title.htmlClass).toBeUndefined();
  expect(card.styles.base.default).toMatchObject({ display: "grid", gap: "12px" });
  expect(card.customCss).toContain("--brand-color: #123456;");
  expect(card.customCss).toContain("clip-path: circle(50%);");
  expect(card.styles.base.default.clipPath).toBeUndefined();
  // CSSOM may serialize the same authored hex color as rgb().
  expect(title.styles.base.default.color).toMatch(/^(?:#123456|rgb\(18,\s*52,\s*86\))$/);
  const breakpoint = doc.breakpoints.find((bp: any) => bp.maxWidth === 768);
  expect(card.styles[breakpoint.id].default.gap).toBe("4px");
});

test("HTML ZIP imports an image and linked CSS as editable assets and styles", async ({ page }) => {
  await localMode(page);
  const zip = new JSZip();
  const root = zip.folder("website")!;
  root.file("index.html", [
    '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>',
    '<body><div class="hero" id="hero"><img id="logo" src="images/logo.svg" alt="Logo"></div></body></html>',
  ].join(""));
  root.file("style.css", ".hero { display: grid; gap: 14px; }");
  root.file("images/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "website.zip", mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const doc = await importedDoc(page);
  const hero = Object.values(doc.nodes).find((node: any) => node.attrId === "hero") as any;
  const logo = Object.values(doc.nodes).find((node: any) => node.attrId === "logo") as any;
  expect(hero).toBeTruthy();
  expect(logo).toBeTruthy();
  expect(hero.styles.base.default.display).toBe("grid");
  expect(hero.styles.base.default.gap).toBe("14px");
  expect(logo.type).toBe("image");
  expect(logo.image.assetId).toBeTruthy();
  expect(doc.assets[logo.image.assetId]).toBeTruthy();
});

test("linked CSS @imports and external JS module files are preserved and resolved", async ({ page }) => {
  await localMode(page);
  const zip = new JSZip();
  const base = zip.folder("site")!;
  base.file("index.html", [
    '<!doctype html><html><head><title>External files</title>',
    '<link rel="stylesheet" href="styles/main.css">',
    '<script defer src="scripts/vendor.js"></script>',
    '</head><body><section id="card" class="card"><h1>CSS import</h1></section>',
    '<script type="module" src="scripts/main.js"></script></body></html>',
  ].join(""));
  base.file("styles/main.css",
    '@import "./base.css"; @import url("./mobile.css") screen and (max-width: 768px); .card { display: grid; }');
  base.file("styles/base.css", ".card { gap: 20px; }");
  base.file("styles/mobile.css", ".card { gap: 4px; }");
  base.file("scripts/vendor.js", "window.vendorLoaded = true;");
  base.file("scripts/main.js", 'import "./chunk.js"; window.mainLoaded = true;');
  base.file("scripts/chunk.js", "window.chunkLoaded = true;");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "separate.zip", mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const doc = await importedDoc(page);
  const home = doc.pages[doc.pageOrder[0]];
  const card = Object.values(doc.nodes).find((node: any) => node.attrId === "card") as any;
  expect(card.styles.base.default).toMatchObject({ display: "grid", gap: "20px" });
  const mobile = doc.breakpoints.find((bp: any) => bp.maxWidth === 768);
  expect(mobile).toBeTruthy();
  expect(card.styles[mobile.id].default.gap).toBe("4px");
  expect(home.rawHtml).toBeUndefined();

  const source = (filename: string) => Object.values(doc.assets)
    .find((asset: any) => asset.zip?.path === "site/scripts/" + filename) as any;
  const vendor = source("vendor.js");
  const main = source("main.js");
  const chunk = source("chunk.js");
  expect(vendor).toBeTruthy();
  expect(main).toBeTruthy();
  expect(chunk).toBeTruthy();
  expect(home.customTopHtml).toContain("script");
  expect(home.customTopHtml).toContain(vendor.dataUrl);
  expect(home.customEndHtml).toContain(main.dataUrl);
  expect(home.customTopHtml).not.toContain(main.dataUrl);
  const generated = generateProject(doc);
  const exportedPage = generated.files["app/page.tsx"];
  expect(exportedPage).toContain(importedAssetUrl(vendor));
  expect(exportedPage).toContain(importedAssetUrl(main));
  expect(generated.binaries[importedAssetPath(chunk)!]).toBeTruthy();
  expect(generated.binaries[importedAssetPath(main)!]).toBeTruthy();

  // The URL changes before the editor loads the imported site and shows its notices.
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  const notice = page.locator(".dialog-backdrop");
  await expect(notice).toContainText("インポート時の注意事項");
  await notice.getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("button", { name: "メニュー（書き出し・履歴・設定）" }).click();
  await page.getByRole("button", { name: "zipでエクスポート" }).click();
  const modal = page.locator(".export-modal");
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "単一のHTML" }).click();
  await modal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "現在のページ" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    modal.getByRole("button", { name: "HTMLをダウンロード" }).click(),
  ]);
  const html = await readFile((await download.path())!, "utf8");
  const published = await page.context().newPage();
  const requests: string[] = [];
  await published.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    requests.push(route.request().url());
    return route.abort();
  });
  await published.goto("http://published.example.test/");
  await expect.poll(() => published.evaluate(() => {
    const result = window as Window & { vendorLoaded?: boolean; mainLoaded?: boolean; chunkLoaded?: boolean };
    return [result.vendorLoaded, result.mainLoaded, result.chunkLoaded];
  })).toEqual([true, true, true]);
  expect(requests).toEqual([]);

});

test("multi-page HTML ZIP imports every page and converts internal page links", async ({ page }) => {
  await localMode(page);
  const zip = new JSZip();
  zip.file("website/index.html", '<html><head><title>Multi HTML</title></head><body><a id="next" href="about.html">About</a></body></html>');
  zip.file("website/about.html", '<html><head><title>About</title></head><body><h1>About us</h1></body></html>');
  zip.file("website/docs/index.html", '<html><head><title>Docs</title></head><body><p>Documentation</p></body></html>');
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "multi.zip", mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const doc = await importedDoc(page);
  expect(doc.pageOrder).toHaveLength(3);
  const paths = doc.pageOrder.map((id: string) => doc.pages[id].slug);
  expect(paths).toEqual(["", "about", "docs"]);
  const link = Object.values(doc.nodes).find((node: any) => node.attrId === "next") as any;
  const aboutId = doc.pageOrder.find((id: string) => doc.pages[id].slug === "about");
  expect(link.link).toMatchObject({ kind: "page", pageId: aboutId });
});



test("HTML ZIP survives save, reload, HTML export ZIP and reimport with editable content", async ({ page }) => {
  await localMode(page);
  const original = new JSZip()
    .file("index.html", '<!doctype html><html><head><title>Import round trip</title>' +
      '<link rel="stylesheet" href="main.css"></head><body>' +
      '<section id="roundtrip-card" class="card"><h1>Roundtrip verified</h1></section>' +
      '</body></html>')
    .file("main.css", ".card { display: flex; gap: 12px; }");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "input.zip", mimeType: "application/zip",
    buffer: await original.generateAsync({ type: "nodebuffer" }),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible();
  await page.reload();
  await expect(page.locator(".app")).toBeVisible();
  const saved = await importedDoc(page);
  const originalCard = Object.values(saved.nodes).find((node: any) => node.attrId === "roundtrip-card") as any;
  expect(originalCard?.styles?.base?.default?.display).toBe("flex");
  expect(originalCard?.styles?.base?.default?.gap).toBe("12px");
  const output = generateExportProject(saved, "html");
  expect(output.files["index.html"]).toContain("Roundtrip verified");
  const exported = new JSZip();
  for (const [path, source] of Object.entries(output.files)) exported.file(path, source);
  for (const [path, base64] of Object.entries(output.binaries)) {
    exported.file(path, Buffer.from(base64, "base64"));
  }
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "published.zip", mimeType: "application/zip",
    buffer: await exported.generateAsync({ type: "nodebuffer" }),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible();
  const restored = await importedDoc(page);
  expect(Object.values(restored.nodes).some((node: any) => node.text?.content === "Roundtrip verified")).toBe(true);
  expect(Object.values(restored.nodes).some((node: any) => node.styles?.base?.default?.display === "flex")).toBe(true);
});

test("normal-page ZIP conversion uses only index.html and keeps the site's other pages", async ({ page }) => {
  await localMode(page);
  const original = createInitialDoc();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "doc.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "カスタムコード", exact: true }).click();
  const zip = new JSZip();
  zip.file("website/index.html", "<h1>Only this page</h1>");
  zip.file("website/secondary.html", "<h1>Must not add a page</h1>");
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({
    name: "pages.zip", mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "置き換える", exact: true }).click();
  await expect.poll(async () => {
    const doc = await importedDoc(page);
    const home = doc?.pages[doc.pageOrder[0]];
    return home?.children?.some((id: string) => doc.nodes[id]?.text?.content === "Only this page");
  }).toBe(true);
  const doc = await importedDoc(page);
  expect(doc.pageOrder).toEqual(original.pageOrder);
  expect(Object.values(doc.nodes).some((node: any) => node.text?.content === "Must not add a page")).toBe(false);
});

test("normal-page HTML import replaces only that page while leaving other pages unchanged", async ({ page }) => {
  await localMode(page);
  const original = createInitialDoc();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "doc.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "カスタムコード", exact: true }).click();
  await page.locator('input[accept=".html,.htm,text/html"]').setInputFiles({
    name: "replacement.html", mimeType: "text/html",
    buffer: Buffer.from("<html><body><h1>One-page conversion</h1><p>New content</p></body></html>"),
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "置き換える", exact: true }).click();
  await expect.poll(async () => {
    const doc = await importedDoc(page);
    const first = doc?.pages[doc.pageOrder[0]];
    return first?.children?.length === 2 &&
      first.children.some((id: string) => doc.nodes[id]?.text?.content === "One-page conversion");
  }).toBe(true);
  const after = await importedDoc(page);
  expect(after.pageOrder).toEqual(original.pageOrder);
  for (const id of original.pageOrder.slice(1)) expect(after.pages[id]).toEqual(original.pages[id]);
  expect(after.pages[original.pageOrder[0]].rawHtml).toBeNull();
  expect(after.nodes).toBeDefined();
});

test("inline SVG import removes executable content before saving an editable icon", async ({ page }) => {
  await localMode(page);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" id="imported-icon" viewBox="0 0 12 12" ' +
    'onload="globalThis.svgExecuted=1"><script>globalThis.svgExecuted=2</script>' +
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="globalThis.svgExecuted=3"></div></foreignObject>' +
    '<rect width="12" height="12" fill="red"/></svg>';
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "inline.svg.html", mimeType: "text/html",
    buffer: Buffer.from("<!doctype html><title>Safe SVG</title><body>" + svg),
  });
  await expect(page).toHaveURL(new RegExp("/sites/[a-z0-9-]+$"), { timeout: 30000 });
  const doc = await importedDoc(page);
  const icon = Object.values(doc.nodes).find((item: any) => item.type === "icon") as any;
  expect(icon).toBeTruthy();
  expect(icon.icon.svg).toContain("<rect");
  expect(icon.icon.svg).not.toMatch(/onload|onerror|<script|foreignObject/i);
  expect(doc.pages[doc.pageOrder[0]].customEndHtml ?? "").not.toContain("svgExecuted");
  expect(Object.values(generateExportProject(doc, "html").files).join("\n")).not.toContain("svgExecuted");
  expect(await page.evaluate(() => (globalThis as any).svgExecuted)).toBeUndefined();
});
