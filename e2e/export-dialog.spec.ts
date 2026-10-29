import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { loadLocale } from "../lib/i18n";
import { createInitialDoc, makeText } from "../lib/presets";

async function openExport(page: import("@playwright/test").Page, firstPageSlug?: string) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const result = await page.request.post("/api/sites", { data: { name: "Export UI" } });
  expect(result.ok()).toBeTruthy();
  const { site } = await result.json();
  await loadLocale();
  const doc = createInitialDoc();
  doc.siteName = "Export UI";
  if (firstPageSlug) doc.pages[doc.pageOrder[0]].slug = firstPageSlug;
  for (const item of Object.values(doc.pages)) {
    if (/\[[^\]]+\]/.test(item.slug)) item.unpublished = true;
  }
  expect((await page.request.put("/api/doc?site=" + site.id, { data: doc })).ok()).toBeTruthy();
  const heading = Object.values(doc.nodes).find((n) =>
    n.text?.content.includes("見出しをここに") || n.text?.content.includes("Your headline here")
  );
  if (!heading?.text) throw new Error("Starter hero heading not found in export test document");
  await page.goto("/sites/" + site.id);
  await expect(page.locator('[data-tutorial="canvas"]')
    .getByText(heading.text.content.split("\n")[0]).first()).toBeVisible();
  const reopen = async () => {
    await page.locator('[data-tutorial="menu"] > button').click();
    await page.getByRole("button", { name: "zipでエクスポート" }).click();
    const modal = page.locator(".export-modal");
    await expect(modal).toBeVisible();
    return modal;
  };
  return { modal: await reopen(), reopen };
}

test("export dialog validates layout, scopes, and downloads React, HTML, and Vue archives", async ({ page }) => {
  const { modal: initialModal, reopen } = await openExport(page);

  // 1. Compact grid + narrow viewport stacking
  const grid = initialModal.locator(".export-option-grid");
  await expect(grid).toHaveCSS("display", "grid");
  await expect(grid).toHaveCSS("grid-template-columns", /^\d+px \d+px$/);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(grid).toHaveCSS("grid-template-columns", /^\d+px$/);
  expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  expect(await initialModal.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.setViewportSize({ width: 1280, height: 720 });

  // 2. HTML export fixed options, scope validation, and ZIP download
  await expect(initialModal.locator("select#export-format")).toHaveCount(0);
  await expect(initialModal.getByText("フレームワーク", { exact: true })).toBeVisible();
  await expect(initialModal.getByText("言語", { exact: true })).toBeVisible();
  await expect(initialModal.getByText("スタイル", { exact: true })).toBeVisible();
  await expect(initialModal.getByText("出力範囲", { exact: true })).toBeVisible();
  await expect(initialModal.locator(".modal-desc .kbd")).toContainText("npm install && npm run dev");

  await initialModal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "HTML / CSS / JavaScript" }).click();
  await expect(initialModal.locator(".modal-desc")).toContainText("index.html");
  await expect(initialModal.locator(".modal-desc")).not.toContainText("npm run build");
  await expect(initialModal.locator(".modal-desc .kbd")).toHaveCount(0);
  await expect(initialModal.getByRole("button", { name: "言語" })).toContainText("JavaScript");
  await expect(initialModal.getByRole("button", { name: "スタイル" })).toContainText("CSS");
  await expect(initialModal.getByRole("button", { name: "出力範囲" })).toContainText("プロジェクト全体");

  await initialModal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "選択したコンポーネント" }).click();
  await expect(initialModal.locator(".check-list li.is-error")).toContainText(["書き出す要素かコンポーネントを選択してください。"]);
  await expect(initialModal.locator(".check-ok")).toHaveCount(0);
  await expect(initialModal.getByRole("button", { name: "zipをダウンロード" })).toBeDisabled();

  await initialModal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "プロジェクト全体", exact: true }).click();
  const [htmlDownload] = await Promise.all([
    page.waitForEvent("download"),
    initialModal.getByRole("button", { name: "zipをダウンロード" }).click(),
  ]);
  expect(htmlDownload.suggestedFilename()).toMatch(/html-javascript\.zip$/);
  const htmlZip = await JSZip.loadAsync(await readFile((await htmlDownload.path())!));
  const htmlNames = Object.keys(htmlZip.files);
  const index = htmlNames.find((p) => p.endsWith("/index.html"))!;
  expect(index).toBeTruthy();
  const html = await htmlZip.file(index)!.async("text");
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("styles/site.css");
  expect(htmlNames.some((p) => p.endsWith("/styles/site.css"))).toBe(true);
  expect(htmlNames.some((p) => p.endsWith("/package.json"))).toBe(false);
  expect(htmlNames.some((p) => p.endsWith("/next.config.mjs"))).toBe(false);

  // 3. React + Vite empty component recovery and JavaScript project download
  const reactModal = await reopen();
  await reactModal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "React + Vite" }).click();
  await reactModal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "選択したコンポーネント" }).click();
  await expect(reactModal.locator(".check-list li.is-error")).toHaveCount(1);
  await expect(reactModal.locator(".check-ok")).toHaveCount(0);
  await expect(reactModal.getByRole("button", { name: "zipをダウンロード" })).toBeDisabled();

  await reactModal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "プロジェクト全体", exact: true }).click();
  await reactModal.getByRole("button", { name: "言語" }).click();
  await page.getByRole("button", { name: "JavaScript", exact: true }).click();
  const [reactDownload] = await Promise.all([
    page.waitForEvent("download"),
    reactModal.getByRole("button", { name: "zipをダウンロード" }).click(),
  ]);
  expect(reactDownload.suggestedFilename()).toMatch(/react-javascript\.zip$/);
  const reactPaths = Object.keys((await JSZip.loadAsync(await readFile((await reactDownload.path())!))).files);
  expect(reactPaths.some((p) => p.endsWith("/src/App.jsx"))).toBe(true);
  expect(reactPaths.some((p) => p.endsWith("/src/App.tsx"))).toBe(false);
  expect(reactPaths.some((p) => p.endsWith("/jsconfig.json"))).toBe(true);

  // 4. Vue 3 + Vite SFC and Vite config download
  const vueModal = await reopen();
  await vueModal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "Vue 3 + Vite" }).click();
  await vueModal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "現在のページ" }).click();
  const [vueDownload] = await Promise.all([
    page.waitForEvent("download"),
    vueModal.getByRole("button", { name: "zipをダウンロード" }).click(),
  ]);
  const vueNames = Object.keys((await JSZip.loadAsync(await readFile((await vueDownload.path())!))).files);
  expect(vueNames.some((name) => name.endsWith("/src/App.vue"))).toBe(true);
  expect(vueNames.some((name) => name.endsWith("/vite.config.ts"))).toBe(true);
  expect(vueNames.some((name) => name.endsWith("/next.config.mjs"))).toBe(false);
});

test("single HTML downloads the current non-home page with inline CSS and scripts", async ({ page }) => {
  const { modal } = await openExport(page, "news/today");
  await expect(modal.getByRole("button", { name: "zipをダウンロード" })).toBeDisabled();
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "単一のHTML" }).click();
  await modal.getByRole("button", { name: "出力範囲" }).click();
  await expect(page.getByRole("button", { name: "プロジェクト全体", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "現在のページ" }).click();
  await expect(modal.locator(".modal-desc")).toContainText("HTMLファイル");
  await expect(modal.getByRole("button", { name: "言語" })).toContainText("JavaScript");
  await expect(modal.getByRole("button", { name: "スタイル" })).toContainText("CSS");
  const downloadButton = modal.getByRole("button", { name: "HTMLをダウンロード" });
  await expect(downloadButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const html = await readFile((await download.path())!, "utf8");
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("<style>");
  expect(html).toContain("data-page-plan");
  expect(html).not.toMatch(/<script[^>]*\bsrc=["'](?!data:)/);
  expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
});

test("single HTML preserves deferred script order, inert data attributes, and offline module identity", async ({ page }) => {
  const { toSingleHtmlProject } = await import("../lib/generator/single-html");
  const deferredProject = await toSingleHtmlProject({
    files: {
      "index.html": '<!doctype html><head><script defer src="late.js"></script></head>' +
        '<body><div id=target></div><script data-src=unexpected.js></script></body>',
      "late.js": 'document.getElementById("target").textContent = document.readyState',
      "unexpected.js": 'document.documentElement.dataset.unexpected = "yes"',
    },
    binaries: {}, remoteAssets: {},
  });
  const moduleProject = await toSingleHtmlProject({
    files: {
      "index.html": '<!doctype html><body><p></p><script type=module src="./js/entry.mjs"></script>',
      "js/entry.mjs": 'import { first } from "./sub/reexport.js"; import { id } from "./a.js";' +
        'const other = await import("./b.js");' +
        'document.querySelector("p").textContent = [first === id, id !== other.id, "</script>"].join(" ");',
      "js/sub/reexport.js": 'export { id as first } from "../a.js";',
      "js/a.js": "export const id = {};",
      "js/b.js": "export const id = {};",
    },
    remoteAssets: {}, binaries: {},
  });
  let servedHtml = deferredProject.files["index.html"];
  const externalRequests: string[] = [];
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: servedHtml });
    externalRequests.push(route.request().url());
    return route.abort();
  });

  await page.goto("http://single.example.test/");
  await expect(page.locator("#target")).toHaveText("interactive");
  expect(await page.locator("html").getAttribute("data-unexpected")).toBeNull();

  servedHtml = moduleProject.files["index.html"];
  await page.goto("http://single.example.test/");
  await expect(page.locator("p")).toHaveText("true true </script>");
  expect(externalRequests).toEqual([]);
});

test("同じ書き出し先のURLを検出し、URL修正後は両方のクエリページを書き出す", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Route aliases" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await loadLocale();
  const doc = createInitialDoc();
  doc.siteName = "Route aliases";
  for (const [id, slug, text] of [
    ["first", "about/team", "The original team page"],
    ["second", "about//team", "The other team page"],
  ]) {
    const node = makeText(text);
    doc.nodes[node.id] = node;
    doc.pages[id] = { id, name: id, slug, title: id, description: "", children: [node.id] };
    doc.pageOrder.push(id);
  }
  expect((await page.request.put(`/api/doc?site=${site.id}`, { data: doc })).ok()).toBeTruthy();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  const openModal = async () => {
    await page.locator('[data-tutorial="menu"] > button').click();
    await page.getByRole("button", { name: "zipでエクスポート", exact: true }).click();
    await expect(page.locator(".export-modal").getByRole("heading", { name: "コードをエクスポート" })).toBeVisible();
  };
  await openModal();
  const checks = page.locator(".modal .check-list li");
  await expect(checks.first()).not.toHaveClass(/is-error/);
  await expect(page.locator(".modal .check-list .is-error")).toContainText("重複");
  await expect(page.getByRole("button", { name: "zipをダウンロード", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();

  await page.locator(".hdr-page .dd").click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: /^second/ }).click();
  await page.locator('[data-tutorial="left-tab-site"]').click();
  const slug = page.locator('[data-tutorial="tutorial-page-slug"]');
  await expect(slug).toHaveValue("about//team");
  await slug.fill("/about///team/?tab=other");
  await slug.press("Enter");
  await expect(slug).toHaveValue("about/team?tab=other");
  await expect.poll(async () => {
    const saved = await (await page.request.get(`/api/doc?site=${site.id}`)).json();
    return { slug: saved.doc.pages.second.slug, query: saved.doc.pages.second.query };
  }).toEqual({ slug: "about/team", query: "tab=other" });

  await openModal();
  await expect(page.locator(".modal .check-list .is-error")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "zipをダウンロード", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const path = Object.keys(zip.files).find((name) => name.endsWith("app/about/team/page.tsx"))!;
  expect(path).toBeTruthy();
  const prefix = path.slice(0, -"page.tsx".length);
  expect(await zip.file(`${prefix}_q/p0.tsx`)!.async("string")).toContain("The original team page");
  expect(await zip.file(`${prefix}_q/p1.tsx`)!.async("string")).toContain("The other team page");
  expect(await zip.file(path)!.async("string")).toContain('["tab","other"]');
  expect(errors).toEqual([]);
});

// 公開先の読み取りだけを模擬する。GitHub への公開は一度も行わない。
test("大文字だけ違う転送を公開・書き出し前に止め、別のパスへの修正後は書き出せる", async ({ page }) => {
  const errors: string[] = [];
  const publishWrites: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/publish**", async route => {
    if (route.request().method() !== "GET") {
      publishWrites.push(route.request().method());
      await route.fulfill({ status: 500, json: { error: "Unexpected publication request" } });
      return;
    }
    await route.fulfill({ json: { configured: true, previewEnabled: true,
      production: { repo: "example/site", branch: "main", url: null, error: null },
      test: { repo: "example/site", branch: "preview", url: null, error: null },
    } });
  });
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Redirect check" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await loadLocale();
  const doc = createInitialDoc();
  doc.siteName = "Redirect check";
  doc.pages.about = { id: "about", name: "About us", slug: "about", title: "About us", description: "", children: [] };
  doc.pages.old = { id: "old", name: "Old URL", slug: "redirect-source", title: "", description: "", children: [], redirectTo: "/about?from=old#team" };
  doc.pageOrder.push("about", "old");
  expect((await page.request.put(`/api/doc?site=${site.id}`, { data: doc })).ok()).toBeTruthy();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  await page.locator(".hdr-page .dd").click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: /^Old URL/ }).click();
  await page.locator('[data-tutorial="left-tab-site"]').click();
  const slug = page.locator('[data-tutorial="tutorial-page-slug"]');
  await expect(slug).toHaveValue("redirect-source");
  await slug.fill("About");
  await slug.press("Enter");
  await expect(slug).toHaveValue("About");
  await expect.poll(async () => (await (await page.request.get(`/api/doc?site=${site.id}`)).json()).doc.pages.old.slug).toBe("About");

  await page.locator('[data-tutorial="publish"]').click();
  await expect(page.locator(".pub-modal .check-list .is-error")).toContainText("転送がくり返される");
  await expect(page.locator(".pub-modal .check-list .is-error")).toContainText("Old URL");
  for (const name of ["本番に公開", "テストに公開"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await page.locator(".pub-modal").getByRole("button", { name: "閉じる", exact: true }).click();
  const openModal = async () => {
    await page.locator('[data-tutorial="menu"] > button').click();
    await page.getByRole("button", { name: "zipでエクスポート", exact: true }).click();
    await expect(page.locator(".export-modal").getByRole("heading", { name: "コードをエクスポート" })).toBeVisible();
  };
  await openModal();
  await expect(page.locator(".export-modal .check-list .is-error")
    .filter({ hasText: "転送がくり返される" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "zipをダウンロード", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();

  await slug.fill("old-about");
  await slug.press("Enter");
  await expect(slug).toHaveValue("old-about");
  await page.locator('[data-tutorial="publish"]').click();
  await expect(page.locator(".pub-modal .check-list .is-error")).toHaveCount(0);
  for (const name of ["本番に公開", "テストに公開"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
  }
  await page.locator(".pub-modal").getByRole("button", { name: "閉じる", exact: true }).click();
  await openModal();
  await expect(page.locator(".modal .check-list .is-error")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "zipをダウンロード", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const configPath = Object.keys(zip.files).find(name => name.endsWith("next.config.mjs"))!;
  expect(configPath).toBeTruthy();
  const config = await zip.file(configPath)!.async("string");
  expect(config).toContain('"source": "/old-about"');
  expect(config).toContain('"destination": "/about?from=old#team"');
  expect(Object.keys(zip.files).some(name => name.endsWith("app/about/page.tsx"))).toBe(true);
  expect(publishWrites).toEqual([]);
  expect(errors).toEqual([]);
});
