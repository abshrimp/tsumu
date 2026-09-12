import { expect, test, type Frame, type Page } from "@playwright/test";
import JSZip from "jszip";
import { fixtureAsset, zipCssBrowser } from "../tests/helpers/zip-css-browser";

async function previewFrame(page: Page) {
  await expect(page.locator("#preview")).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-popups");
  const frame = await (await page.locator("#preview").elementHandle())!.contentFrame();
  if (!frame) throw new Error("Preview frame was not created");
  await expect(frame.locator("#version")).toBeVisible();
  return frame;
}

async function expectStylesAndResources(target: Page | Frame) {
  await expect(target.locator("#nested-rule")).toHaveCSS("display", "grid");
  await expect(target.locator("#nested-rule")).toHaveCSS("gap", "13px");
  await expect(target.locator("#external-resource")).toHaveCSS("color", "rgb(80, 90, 100)");
  expect(await target.locator("#external-resource").evaluate(async (element) => {
    const url = /^url\("(.*)"\)$/.exec(getComputedStyle(element).backgroundImage)![1];
    const image = new Image();
    image.src = url;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  })).toEqual([11, 4]);
  // くり返した上位のレイヤーの @import が、間にある下位のレイヤーのシートに勝たなければならない。
  await expect(target.locator("#import-order")).toHaveCSS("color", "rgb(11, 22, 33)");
  // それぞれのシートが、同じ名前空間の接頭辞を別々に宣言している。1つに展開すると、これが壊れる。
  await expect(target.locator("#namespace-scope")).toHaveCSS("color", "rgb(12, 34, 56)");
  await expect(target.locator("#svg-rect")).toHaveCSS("fill", "rgb(24, 57, 91)");
  await expect(target.locator("#svg-rect")).toHaveAttribute("filter", "url(#identity)");
  expect(await target.evaluate(() => (window as any).zipCssLiteral)).toBe("url(images/not-an-asset.svg)");
  await expect(target.locator("#blocked-import")).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(target.locator("#direct-image")).toHaveJSProperty("naturalWidth", 9);
  await expect(target.locator("#direct-image")).toHaveJSProperty("naturalHeight", 6);
  await expect(target.locator("#direct-image")).toHaveAttribute("src", /#direct$/);
  const resources = await target.evaluate(async () => {
    const background = getComputedStyle(document.getElementById("background")!).backgroundImage;
    const url = /^url\("(.*)"\)$/.exec(background)?.[1];
    if (!url) throw new Error(`Expected a CSS background URL, received ${background}`);
    if (!url.endsWith("#paint")) throw new Error(`Lost CSS image fragment: ${url}`);
    const image = new Image();
    image.src = url;
    await image.decode();
    const fonts = await document.fonts.load('40px "Tsumu CSS Probe"', "X");
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = '40px "Tsumu CSS Probe"';
    return {
      image: [image.naturalWidth, image.naturalHeight],
      fonts: fonts.map((font) => font.status), width: context.measureText("X").width,
    };
  });
  expect(resources.image).toEqual([7, 5]);
  expect(resources.fonts.length).toBeGreaterThan(0);
  expect(resources.fonts.every((status) => status === "loaded")).toBe(true);
  expect(resources.width).toBeCloseTo(40, 2);
}

async function expectLinkSemantics(page: Page, target: Page | Frame) {
  await expect(target.locator("#main-sheet")).toHaveAttribute("title", "Base");
  await expect(target.locator("#main-sheet")).toHaveAttribute("media", "screen");
  await expect(target.locator("#main-sheet")).not.toHaveAttribute("integrity", /./);
  await expect(target.locator("#print-only")).toHaveCSS("border-top-width", "0px");
  await expect(target.locator("#disabled-only")).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(target.locator("#alternate-only")).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(target.locator("#disabled-sheet")).toHaveJSProperty("disabled", true);
  await expect(target.locator("#alternate-sheet")).toHaveAttribute("rel", "alternate stylesheet");
  await expect(target.locator("#alternate-sheet")).toHaveAttribute("title", "Alternate");
  await target.locator("#disabled-sheet").evaluate((link: HTMLLinkElement) => { link.disabled = false; });
  await expect(target.locator("#disabled-only")).toHaveCSS("color", "rgb(31, 41, 51)");
  await target.locator("#disabled-sheet").evaluate((link: HTMLLinkElement) => { link.disabled = true; });
  await expect(target.locator("#disabled-only")).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.emulateMedia({ media: "print" });
  await expect(target.locator("#print-only")).toHaveCSS("border-top-width", "7px");
  await page.emulateMedia({ media: "screen" });
  await expect(target.locator("#print-only")).toHaveCSS("border-top-width", "0px");
}

for (const storage of ["local", "remote"] as const) {
  test(`ZIP inline CSS ${storage}: quoted assets survive native import, preview and route export`, async ({ page }) => {
    const fixture = await zipCssBrowser(page, storage);
    // エディタは、書いたままの引用符・文字参照・アセットのパス・書式を残す。
    expect(fixture.doc.pages.p.rawHtml).toContain('id="inline-double" style=\'background-image:url("images/background.svg")\'');
    expect(fixture.doc.pages.p.rawHtml).toContain('id="inline-numeric" style="background-image:url(&#34;images/background.svg&#34;)"');
    expect(fixture.doc.pages.p.rawHtml).toContain('href="css/main.css?version=3#sheet"');
    expect(fixture.doc.pages.p.rawHtml).toContain('integrity="sha256-');

    async function checkImages(target: Page | Frame, exported: boolean) {
      for (const id of ["custom", "double", "single", "unquoted", "query", "fragment", "numeric", "image-set", "raw-query"]) {
        const image = await target.locator(`#inline-${id}`).evaluate(async (element) => {
          const css = getComputedStyle(element).backgroundImage;
          const url = /url\("([^"]+)"\)/.exec(css)?.[1];
          if (!url) throw new Error(`Missing background image: ${element.id}: ${css}`);
          const image = new Image();
          image.src = url;
          await image.decode();
          return { url, width: image.naturalWidth, height: image.naturalHeight };
        });
        expect([image.width, image.height]).toEqual([7, 5]);
        const url = new URL(image.url);
        expect(url.hash).toBe(id === "query" || id === "fragment" ? "#paint" : "");
        if (exported) {
          expect(url.pathname).toBe("/assets/site-images-background.svg");
          const query = id === "query" ? "?v=1&theme=dark" : id === "raw-query" ? "?quot;" : "";
          expect(url.search).toBe(query);
        } else if (storage === "remote") {
          expect(url.searchParams.get("sig")).toMatch(/^fixture-/);
          expect(url.searchParams.get("v")).toBe(id === "query" ? "1" : null);
        } else {
          expect(url.protocol).toBe("data:");
          expect(url.search).toBe("");
        }
      }
    }

    await fixture.mount();
    await checkImages(await previewFrame(page), false);
    const stored = structuredClone(fixture.doc);
    const output = await fixture.openExport();
    await checkImages(page, true);
    expect(output.html).toContain('id="inline-double" style="background-image:url(&quot;/assets/site-images-background.svg&quot;)"');
    expect(fixture.doc).toEqual(stored);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });

  test(`ZIP CSS ${storage}: nested styles, images and a real font load in the opaque preview`, async ({ page, browserName }) => {
    const fixture = await zipCssBrowser(page, storage);
    await fixture.mount();
    const frame = await previewFrame(page);
    expect(await frame.evaluate(() => {
      try { void parent.document; return false; } catch { return true; }
    })).toBe(true);
    await expectStylesAndResources(frame);
    expect(fixture.externalRequests).toEqual(expect.arrayContaining(["https://zip-cdn.test/external.css", "https://zip-editor.test/shared/external.svg"]));
    await expectLinkSemantics(page, frame);
    expect(await page.evaluate(() => (window as any).zipCssHarness.rendered.some((html: string) => html.includes("tsumu-zip-css:")))).toBe(false);
    if (storage === "remote") {
      const background = fixtureAsset(fixture.doc, "site/images/background.svg").path!;
      const font = fixtureAsset(fixture.doc, "site/fonts/probe.ttf").path!;
      expect(fixture.signatures[0].paths).toEqual(expect.arrayContaining([background, font]));
      expect(fixture.resources.length).toBeGreaterThan(0);
      expect(fixture.resources.every((request) => !request.cookie)).toBe(true);
      const fontRequest = fixture.resources.find((request) => new URL(request.url).searchParams.get("path") === font);
      expect(fontRequest).toBeDefined();
      expect(await frame.evaluate(() => self.origin)).toBe("null");
      // WebKit は、横取りしたこのフォントのリクエストで Origin を省くことがある。
      // ブラウザがヘッダーを報告するときは、サンドボックスのオリジンと一致しなければならない。
      if (browserName !== "webkit" || fontRequest!.origin !== undefined) expect(fontRequest!.origin).toBe("null");
      expect(new URL(fontRequest!.url).searchParams.get("font")).toBe("2");
      const backgroundRequest = fixture.resources.find((request) => new URL(request.url).searchParams.get("path") === background);
      expect(new URL(backgroundRequest!.url).searchParams.get("cache")).toBe("4");
    } else {
      expect(fixture.signatures).toHaveLength(0);
      expect(fixture.resources).toHaveLength(0);
    }
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });

  test(`ZIP CSS ${storage}: the generated route resolves independent exported stylesheets`, async ({ page }) => {
    const fixture = await zipCssBrowser(page, storage);
    const output = await fixture.openExport();
    await expectStylesAndResources(page);
    expect(fixture.externalRequests).toEqual(expect.arrayContaining(["https://zip-cdn.test/external.css", "https://zip-export.test/shared/external.svg"]));
    await expectLinkSemantics(page, page);
    const main = await page.locator("#main-sheet").getAttribute("href");
    expect(new URL(main!, page.url()).search).toBe("?version=3");
    expect(new URL(main!, page.url()).hash).toBe("#sheet");
    expect(Object.keys(output.files).filter((path) => path.startsWith("public/assets/") && path.endsWith(".css")).length).toBeGreaterThan(1);
    expect(Object.values(output.files).some((text) => text.includes('@import "//zip-cdn.test/external.css"') && text.includes('url("/shared/external.svg")'))).toBe(true);
    const queryValues = fixture.exportedRequests.map((url) => new URL(url).search);
    expect(queryValues).toEqual(expect.arrayContaining(["?theme=1", "?again=1", "?font=2", "?cache=4"]));
    expect(fixture.signatures).toHaveLength(0);
    expect(fixture.resources).toHaveLength(0);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test("ZIP preview rebuilds edited dependencies but preserves live state until an explicit expiry refresh", async ({ page }) => {
  await page.clock.install();
  const fixture = await zipCssBrowser(page, "remote");
  await fixture.mount();
  const frame = await previewFrame(page);
  await expect(frame.locator("#nested-rule")).toHaveCSS("gap", "13px");
  const edited = structuredClone(fixture.doc);
  const theme = fixtureAsset(edited, "site/css/nested/theme.css");
  theme.zip!.stylesheet!.source = theme.zip!.stylesheet!.source.replace("gap: 13px", "gap: 17px");
  await fixture.mount(edited);
  await expect(frame.locator("#nested-rule")).toHaveCSS("gap", "17px");
  expect(fixture.signatures).toHaveLength(2);
  const unrelated = structuredClone(edited);
  unrelated.assets.unused = { id: "unused", name: "Unused", dataUrl: "data:text/plain,unused", width: 0, height: 0 };
  await frame.locator("#draft").fill("Keep this draft");
  await frame.evaluate(() => { (window as any).previewState = "Keep this runtime"; });
  await fixture.mount(unrelated);
  await page.clock.runFor(100);
  expect(fixture.signatures).toHaveLength(2);
  await expect(frame.locator("#draft")).toHaveValue("Keep this draft");
  expect(await frame.evaluate(() => (window as any).previewState)).toBe("Keep this runtime");
  await page.clock.fastForward(await page.evaluate(() => (window as any).zipCssHarness.refreshMs));
  await expect(page.locator("#refresh-preview")).toBeVisible();
  expect(fixture.signatures).toHaveLength(2);
  await expect(frame.locator("#draft")).toHaveValue("Keep this draft");
  expect(await frame.evaluate(() => (window as any).previewState)).toBe("Keep this runtime");
  await page.locator("#refresh-preview").click();
  await expect(frame.locator("#background")).toHaveCSS("background-image", /sig=fixture-3/);
  await expect(frame.locator("#draft")).toHaveValue("");
  expect(await frame.evaluate(() => (window as any).previewState)).toBeUndefined();
  await expect(frame.locator("#nested-rule")).toHaveCSS("gap", "17px");
  await expect(page.locator("#refresh-preview")).toHaveCount(0);
  await page.evaluate(() => (window as any).zipCssHarness.unmount());
  await page.clock.fastForward(60 * 60 * 1000);
  expect(fixture.signatures).toHaveLength(3);
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("ZIP preview discards a delayed signer result after switching pages", async ({ page }) => {
  const fixture = await zipCssBrowser(page, "remote");
  fixture.control.holdSignatures = true;
  await fixture.mount();
  await expect.poll(() => fixture.signatures.length).toBe(1);
  await expect(page.locator("#preview")).toHaveAttribute("srcdoc", "");
  const next = structuredClone(fixture.doc);
  next.pages.p.rawHtml = next.pages.p.rawHtml!.replace("Original", "New page");
  fixture.control.holdSignatures = false;
  await fixture.mount(next);
  const frame = await previewFrame(page);
  await expect(frame.locator("#version")).toHaveText("New page");
  await expect(frame.locator("#background")).toHaveCSS("background-image", /sig=fixture-2/);
  fixture.signatures[0].release();
  await fixture.signatures[0].settled;
  // 現在のページを確かめる前に、解放したネットワークの応答と React の処理を済ませる。
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await expect(frame.locator("#version")).toHaveText("New page");
  await expect(frame.locator("#background")).toHaveCSS("background-image", /sig=fixture-2/);
  expect(await page.evaluate(() => (window as any).zipCssHarness.rendered.some((html: string) => html.includes("tsumu-zip-css:")))).toBe(false);
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("ZIP preview stays blank on signing failure and recovers after an explicit retry", async ({ page }) => {
  await page.clock.install();
  const fixture = await zipCssBrowser(page, "remote");
  fixture.control.failSignatures = true;
  await fixture.mount();
  await expect(page.locator("#preview-error")).not.toHaveText("");
  await expect(page.locator("#preview")).toHaveAttribute("srcdoc", "");
  expect(fixture.resources).toEqual([]);
  fixture.control.failSignatures = false;
  await page.clock.fastForward(30_000);
  expect(fixture.signatures).toHaveLength(1);
  await expect(page.locator("#preview")).toHaveAttribute("srcdoc", "");
  await page.locator("#refresh-preview").click();
  const frame = await previewFrame(page);
  await expect(page.locator("#preview-error")).toHaveText("");
  await expect(frame.locator("#nested-rule")).toHaveCSS("gap", "13px");
  await expect(frame.locator("#background")).toHaveCSS("background-image", /sig=fixture-2/);
  expect(fixture.signatures).toHaveLength(2);
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

for (const mode of ["local", "public", "raw-html"] as const) {
  test(`${mode} preview has no expiry notice or automatic iframe reload`, async ({ page }) => {
    await page.clock.install();
    const fixture = await zipCssBrowser(page, mode === "local" ? "local" : "remote");
    fixture.control.publicAssets = mode === "public";
    const doc = structuredClone(fixture.doc);
    if (mode === "raw-html") {
      // 生の HTML は、取り込んだ CSS を必要とせず、署名付きのアセットのリンクを使う。
      // 最初の署名の無い URL で無関係な画像が読み込まれないよう、アンカーを使う。
      const path = fixtureAsset(doc, "site/images/background.svg").path!;
      doc.pages.p.rawHtml = `<!doctype html><input id="draft"><div id="version">Raw HTML</div><a id="asset-link" href="/api/assets/file?path=${encodeURIComponent(path)}">Asset</a>`;
    }
    await fixture.mount(doc);
    const frame = await previewFrame(page);
    if (mode === "raw-html") await expect(frame.locator("#asset-link")).toHaveAttribute("href", /sig=fixture-1/);
    else await expect(frame.locator("#nested-rule")).toHaveCSS("gap", "13px");
    await frame.locator("#draft").fill("Keep local state");
    await frame.evaluate(() => { (window as any).previewState = "unchanged"; });
    const requests = fixture.signatures.length;
    await page.clock.fastForward(2 * 60 * 60 * 1000);
    await expect(page.locator("#refresh-preview")).toHaveCount(0);
    await expect(frame.locator("#draft")).toHaveValue("Keep local state");
    expect(await frame.evaluate(() => (window as any).previewState)).toBe("unchanged");
    expect(fixture.signatures).toHaveLength(requests);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test("reimporting identical ZIP files keeps source and reuses stored asset identities", async ({ page }) => {
  const fixture = await zipCssBrowser(page, "remote");
  const uploads = fixture.uploaded.size;
  const second = await fixture.reimport(fixture.archiveBase64);
  expect(fixture.uploaded.size).toBe(uploads);
  expect(second.pages.p.rawHtml).toBe(fixture.doc.pages.p.rawHtml);
  expect(second.pages.p.htmlZip?.assetIds).toEqual(fixture.doc.pages.p.htmlZip?.assetIds);
  expect(second.pages.p.rawHtml).toContain("integrity=\"sha256-");
  await fixture.mount(second);
  const frame = await previewFrame(page);
  await expect(frame.locator("#direct-image")).toHaveJSProperty("naturalWidth", 9);
  expect(fixture.errors).toEqual([]);
});

test("reimporting one changed file uploads only that file", async ({ page }) => {
  const fixture = await zipCssBrowser(page, "remote");
  const archive = await JSZip.loadAsync(Buffer.from(fixture.archiveBase64, "base64"));
  archive.file("site/images/direct.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6"><rect width="10" height="6" fill="red"/></svg>');
  const updated = await fixture.reimport(await archive.generateAsync({ type: "base64" }));
  expect(fixture.uploaded.size).toBe(fixture.doc.pages.p.htmlZip!.assetIds.length + 1);
  const before = new Map(fixture.doc.pages.p.htmlZip!.assetIds.map(id => [fixture.doc.assets[id].zip!.path, id]));
  const after = new Map(updated.pages.p.htmlZip!.assetIds.map(id => [updated.assets[id].zip!.path, id]));
  for (const [path, id] of before) {
    expect(after.get(path) === id).toBe(path !== "site/images/direct.svg");
  }
  expect(updated.pages.p.rawHtml).toBe(fixture.doc.pages.p.rawHtml);
  await fixture.mount(updated);
  const frame = await previewFrame(page);
  await expect(frame.locator("#direct-image")).toHaveJSProperty("naturalWidth", 10);
  expect(fixture.errors).toEqual([]);
});
