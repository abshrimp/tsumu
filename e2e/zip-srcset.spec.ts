import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";

const inline = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="blue"/></svg>');
const archiveImage = '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="5"><rect width="7" height="5" fill="red"/></svg>';
const source = `<!doctype html><html><head>
  <link id="responsive-link" rel="alternate" imagesrcset="images/photo,wide.svg 1x">
</head><body>
  <img id="inline" srcset="${inline} 1x">
  <img id="archive" srcset="images/photo,wide.svg 1x">
  <picture><source srcset="images/photo,wide.svg 1x"><img id="picture" src="${inline}"></picture>
  <img id="mixed" srcset="${inline} 1x, images/photo,wide.svg 2x">
</body></html>`;
const bundle = build({
  stdin: {
    contents: `
import JSZip from "jszip";
import { readHtmlZip } from "./lib/html-zip";
window.importFixture = async () => {
  const zip = new JSZip();
  zip.file("site/index.html", ${JSON.stringify(source)});
  zip.file("site/images/photo,wide.svg", ${JSON.stringify(archiveImage)});
  const result = await readHtmlZip(await zip.generateAsync({ type: "uint8array" }));
  const frame = document.createElement("iframe");
  frame.id = "imported";
  frame.srcdoc = result.html;
  document.body.append(frame);
  return { html: result.html, assets: result.assets };
};`,
    resolveDir: resolve("."), loader: "ts", sourcefile: "zip-srcset-fixture.ts",
  },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
}).then(result => result.outputFiles[0].text);

for (const storage of ["local", "remote"] as const) {
  test(`ZIP srcset ${storage}: data URLs and comma filenames survive native import and decode`, async ({ page }) => {
    const errors: string[] = [];
    const unexpected: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\//, async route => {
      const url = new URL(route.request().url());
      if (url.origin === "https://srcset.test" && url.pathname === "/") {
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><link rel="icon" href="data:,">' });
      }
      if (url.origin === "https://srcset.test" && url.pathname === "/api/assets" && route.request().method() === "POST") {
        return storage === "local"
          ? route.fulfill({ status: 503, json: { error: "Local fixture" } })
          : route.fulfill({ json: { path: "assets/uploaded.svg" } });
      }
      if (url.origin === "https://srcset.test" && url.pathname === "/api/assets/file" && url.searchParams.get("path") === "assets/uploaded.svg") {
        return route.fulfill({ contentType: "image/svg+xml", body: archiveImage });
      }
      unexpected.push(url.href);
      return route.abort();
    });
    await page.goto("https://srcset.test/");
    await page.addScriptTag({ content: await bundle });
    const imported = await page.evaluate(async () => (window as any).importFixture());
    const frame = page.frameLocator("#imported");
    const mapped = storage === "local" ? imported.assets[0].dataUrl : "/api/assets/file?path=assets%2Fuploaded.svg";
    await expect(frame.locator("#inline")).toHaveAttribute("srcset", `${inline} 1x`);
    await expect(frame.locator("#archive")).toHaveAttribute("srcset", `${mapped} 1x`);
    await expect(frame.locator("#responsive-link")).toHaveAttribute("imagesrcset", `${mapped} 1x`);
    await expect(frame.locator("source")).toHaveAttribute("srcset", `${mapped} 1x`);
    await expect(frame.locator("#mixed")).toHaveAttribute("srcset", `${inline} 1x, ${mapped} 2x`);
    for (const [id, width, height] of [["inline", 3, 2], ["archive", 7, 5], ["picture", 7, 5]] as const) {
      expect(await frame.locator(`#${id}`).evaluate(async (element: HTMLImageElement) => {
        await element.decode();
        return [element.naturalWidth, element.naturalHeight];
      })).toEqual([width, height]);
    }
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });
}
