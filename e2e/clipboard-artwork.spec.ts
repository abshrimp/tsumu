import { expect, test, type Page } from "@playwright/test";
import { editorBootstrapBundle } from "../tests/helpers/editor-bootstrap";
import { makeBox } from "../lib/presets";

let bundle: string;
test.beforeAll(async () => { bundle = await editorBootstrapBundle(true); });
test.beforeEach(async ({ page }) => {
  await page.route("http://clipboard-artwork.test/**", (route) => route.request().url().endsWith("/")
    ? route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' })
    : route.fulfill({ status: 503, body: "{}" }));
  await page.goto("http://clipboard-artwork.test/");
  await page.evaluate(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  await page.addScriptTag({ content: bundle });
  await expect(page.locator(".app")).toBeVisible();
  await page.evaluate((box) => {
    const s = (window as any).pasteEditor.getState();
    s.replaceDoc({ siteName: "Clipboard", assets: {}, pageOrder: ["p", "q"], pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: ["c"] },
    }, nodes: Object.fromEntries(["a", "b", "c", "root"].map((id) => [id, { ...box, id }])),
    components: { comp: { id: "comp", name: "Component", rootId: "root" } } });
    s.setActivePage("p"); s.select(null);
    (window as any).uploads = [];
    const fetch = window.fetch;
    window.fetch = async (url, options) => {
      if (String(url) !== "/api/assets") return fetch(url, options);
      return new Promise((resolve) => (window as any).uploads.push({
        file: (options!.body as FormData).get("file"),
        finish: (ok = true) => resolve(Response.json(ok ? { path: `assets/paste-${(window as any).uploads.length}.svg` } : { error: "upload failed" }, { status: ok ? 200 : 400 })),
      }));
    };
  }, makeBox());
});
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><script>bad()</script><rect width="24" height="12" onclick="bad()"/></svg>';
async function paste(page: Page, delayed = false, svg = artwork) {
  await page.evaluate(({ delayed, svg }) => {
    const file = new File([svg], "art.svg", { type: "image/svg+xml" });
    if (delayed) {
      const text = File.prototype.text;
      File.prototype.text = function () {
        File.prototype.text = text;
        return new Promise((resolve) => { (window as any).decode = async () => resolve(await text.call(this)); });
      };
    }
    const data = new DataTransfer(); data.items.add(file);
    // Firefox は、自分で作った ClipboardEvent には空の保存領域を作る。本番の貼り付けの
    // リスナーが読むプロパティを通して、準備した実際の File を渡す。
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    document.body.dispatchEvent(event);
  }, { delayed, svg });
}
async function uploads(page: Page, count: number) { await expect.poll(() => page.evaluate(() => (window as any).uploads.length)).toBe(count); }
async function finish(page: Page, index = 0, ok = true) { await page.evaluate(({ index, ok }) => (window as any).uploads[index].finish(ok), { index, ok }); }
async function snapshot(page: Page) { return page.evaluate(() => {
  const s = (window as any).pasteEditor.getState();
  return { doc: s.doc, selection: s.selection, past: s.past.length, future: s.future.length, gesture: s.gestureActive };
}); }
async function settled(page: Page, count = 1) { await expect.poll(async () => Object.keys((await snapshot(page)).doc.assets).length).toBe(count); }

test("SVG paste preserves sanitized artwork, dimensions and styling in one Undo/Redo action", async ({ page }) => {
  const before = await snapshot(page);
  await paste(page); await uploads(page, 1);
  const source = await page.evaluate(() => (window as any).uploads[0].file.text());
  expect(source).not.toMatch(/script|onclick|bad\(/);
  await finish(page); await settled(page);
  const after = await snapshot(page); const node = after.doc.nodes[after.selection];
  expect(node.name).toBe("貼り付けたSVG"); expect(node.image.width).toBe(24); expect(node.image.height).toBe(12);
  expect(node.styles.base.default).toMatchObject({ width: "24px", maxWidth: "100%", borderRadius: "0px" });
  expect(after.past).toBe(1);
  await page.evaluate(() => (window as any).pasteEditor.getState().undo()); expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.evaluate(() => (window as any).pasteEditor.getState().redo()); expect((await snapshot(page)).doc).toEqual(after.doc);
});

test("external SVG paste is not intercepted by an earlier internal copy shortcut", async ({ page }) => {
  const prevented = await page.evaluate(() => {
    const s = (window as any).pasteEditor.getState();
    s.copyNode("a");
    const event = new KeyboardEvent("keydown", {
      key: "v", metaKey: true, bubbles: true, cancelable: true,
    });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await paste(page);
  await uploads(page, 1);
  await finish(page);
  await settled(page);
  const after = await snapshot(page);
  expect(after.doc.pages.p.children).toHaveLength(3);
  expect(after.doc.nodes[after.selection].name).toBe("貼り付けたSVG");
});

test("empty native clipboard may fall back to the internal node copy", async ({ page }) => {
  const result = await page.evaluate(() => {
    const s = (window as any).pasteEditor.getState();
    s.copyNode("a");
    const data = new DataTransfer();
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(result).toBe(true);
  await expect.poll(async () => (await snapshot(page)).doc.pages.p.children.length).toBe(3);
  await uploads(page, 0);
});


for (const linkAttr of ["href", "xlink:href"] as const) {
  test(`Figma SVG using <use ${linkAttr}> is still visible after sanitization`, async ({ page }) => {
    // Figma は、SVG の <use> で defs の中のパスや画像の要素を描画することがある。
    // 貼り付けには成功しても <use> が取り除かれると、空のアセットになる。
    const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="12" viewBox="0 0 24 12"><defs><rect id="figma-shape" width="24" height="12" fill="#00cc44"/></defs><use ${linkAttr}="#figma-shape"/></svg>`;
    await paste(page, false, source);
    await uploads(page, 1);
    const rendered = await page.evaluate(async () => {
      const file = (window as any).uploads[0].file as File;
      const xml = await file.text();
      const objectUrl = URL.createObjectURL(file);
      try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 24; canvas.height = 12;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        return { xml, width: image.naturalWidth, height: image.naturalHeight, pixel: Array.from(ctx.getImageData(10, 5, 1, 1).data) };
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    });
    expect(rendered.xml).toMatch(/<use\b/);
    expect(rendered.width).toBe(24);
    expect(rendered.height).toBe(12);
    expect(rendered.pixel[1]).toBeGreaterThan(80);
    expect(rendered.pixel[3]).toBe(255);
    await finish(page); await settled(page);
    const after = await snapshot(page);
    expect(after.doc.nodes[after.selection].name).toBe("貼り付けたSVG");
  });
}

test("SVG <use> keeps only internal ID references", async ({ page }) => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><defs><rect id="safe" width="24" height="12" fill="blue"/></defs><use href="#safe"/><use href="https://evil.test/vector.svg#safe"/><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>';
  await paste(page, false, source);
  await uploads(page, 1);
  const cleaned = await page.evaluate(() => (window as any).uploads[0].file.text());
  expect(cleaned.match(/<use\b/g)).toHaveLength(1);
  expect(cleaned).toContain('href="#safe"');
  expect(cleaned).not.toMatch(/evil\.test|data:image\/svg\+xml/);
  await finish(page); await settled(page);
});

test("SVG paste rejects DTD declarations and entity expansion", async ({ page }) => {
  const malicious = '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>';
  await paste(page, false, malicious);
  await expect(page.getByText("SVGデータが壊れています", { exact: true })).toBeVisible();
  await uploads(page, 0);
});

test("SVG paste strips root events, script nodes and remote style references", async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12" onload="alert(1)"><script>alert(1)</script><rect style="fill:url(https://evil.test/x.svg)" width="20" height="10"/></svg>';
  await paste(page, false, svg);
  await uploads(page, 1);
  const cleaned = await page.evaluate(() => (window as any).uploads[0].file.text());
  expect(cleaned).not.toMatch(/onload|<script|alert\(|https:\/\/evil\.test/i);
  expect(cleaned).toMatch(/<rect\b/i);
  await finish(page);
  await settled(page);
});

for (const delay of ["decode", "upload"]) for (const change of ["page", "selection", "component", "undo", "delete", "unmount"]) {
  test(`${change} during ${delay} preserves the original intent and newer history`, async ({ page }) => {
    await page.evaluate(() => (window as any).pasteEditor.getState().updateNode("b", { name: "Manual edit" }));
    await paste(page, delay === "decode"); if (delay === "upload") await uploads(page, 1);
    await page.evaluate((change) => {
      const s = (window as any).pasteEditor.getState();
      if (change === "page") { s.setActivePage("q"); s.select("c"); }
      if (change === "selection") s.select("b");
      if (change === "component") s.setEditingComponent("comp");
      if (change === "undo") s.undo();
      if (change === "delete") s.deletePage("p");
      if (change === "unmount") (window as any).unmountPasteEditor();
    }, change);
    const before = await snapshot(page);
    const canceled = ["undo", "delete", "unmount"].includes(change);
    if (delay === "decode") await page.evaluate(() => (window as any).decode());
    if (!canceled || delay === "upload") { await uploads(page, 1); await finish(page); await settled(page); }
    else { await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 30))); await uploads(page, 0); }
    const after = await snapshot(page);
    expect(after.selection).toBe(before.selection); expect(after.future).toBe(before.future);
    expect(after.doc.pages.q.children).toEqual(["c"]);
    if (canceled) { expect({ ...after.doc, assets: {} }).toEqual({ ...before.doc, assets: {} }); expect(after.past).toBe(before.past); }
    else expect(after.doc.pages.p.children).toHaveLength(3);
  });
}

for (const olderFirst of [true, false]) test(`overlapping pastes keep independent history and newest notices (${olderFirst})`, async ({ page }) => {
  await paste(page); await uploads(page, 1); await paste(page); await uploads(page, 2);
  await finish(page, olderFirst ? 0 : 1); await settled(page);
  const first = await snapshot(page);
  if (olderFirst) expect(first.selection).toBeNull();
  await finish(page, olderFirst ? 1 : 0); await settled(page, 2);
  const after = await snapshot(page); expect(after.doc.pages.p.children).toHaveLength(4); expect(after.past).toBe(2);
  if (!olderFirst) expect(after.selection).toBe(first.selection);
});

test("older failed paste cannot replace a newer success notice; current failures remain visible", async ({ page }) => {
  await paste(page); await uploads(page, 1); await paste(page); await uploads(page, 2);
  await finish(page, 1); await settled(page); await finish(page, 0, false);
  await expect(page.getByText("SVGをベクター画像として貼り付けました")).toBeVisible();
  await paste(page); await uploads(page, 3); await finish(page, 2, false);
  await expect(page.getByText("貼り付けできませんでした", { exact: true })).toBeVisible();
  expect((await snapshot(page)).past).toBe(1);
});

test("paste waits for a manual gesture and remains a separate history step", async ({ page }) => {
  await paste(page); await uploads(page, 1);
  await page.evaluate(() => { const s = (window as any).pasteEditor.getState(); s.beginGesture(); s.setStyleProps("a", { paddingLeft: "20px" }); });
  await finish(page); await page.waitForTimeout(50);
  const edited = await snapshot(page); expect(edited.gesture).toBe(true); expect(edited.doc.pages.p.children).toHaveLength(2);
  await page.evaluate(() => (window as any).pasteEditor.getState().endGesture()); await settled(page);
  expect((await snapshot(page)).past).toBe(2);
  await page.evaluate(() => (window as any).pasteEditor.getState().undo()); expect((await snapshot(page)).doc).toEqual(edited.doc);
});
