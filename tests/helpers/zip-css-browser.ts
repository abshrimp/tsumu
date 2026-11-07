import { buildSync, transformSync } from "esbuild";
import JSZip from "jszip";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { generateProject } from "../../lib/generator";
import type { Asset, SiteDoc } from "../../lib/types";

// Original, synthetic TrueType font: only X, a rectangle with a 1000-unit advance.
// The font is deliberately valid so the browser must decode it, not accept a fake fetch.
const PROBE_FONT = "AAEAAAAKAIAAAwAgT1MvMkU3R2wAAAEoAAAAYGNtYXAADACrAAABkAAAADRnbHlmVT97EgAAAcwAAAAaaGVhZFtJpQAAAACsAAAANmhoZWEH0QROAAAA5AAAACRobXR4BEwAAAAAAYgAAAAGbG9jYQANAAAAAAHEAAAABm1heHAABAAGAAABCAAAACBuYW1lHKYFLwAAAegAAAF9cG9zdAA/AAAAAANoAAAAJgABAAAAAQAAZ9m3RF8PPPUAAwPoAAAAAHwlsIAAAAAAfCWwgABkAAADhAMgAAAAAwACAAAAAAAAAAEAAAPoAAAAAAPoAGQAZAOEAAEAAAAAAAAAAAAAAAAAAAABAAEAAAACAAQAAQAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwPoAZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAAFgAWAPoAAAAAAPoAAAAAAAAAAAAAAAAAAAAAAAgAAAD6AAAAGQAAAAAAAIAAAADAAAAFAADAAEAAAAUAAQAIAAAAAQABAABAAAAWP//AAAAWP///6kAAQAAAAAAAAAAAA0AAAABAGQAAAOEAyAAAwAAMyERIWQDIPzgAyAAAAAAAAAMAJYAAQAAAAAAAQAPAAAAAQAAAAAAAgAHAA8AAQAAAAAAAwAVABYAAQAAAAAABAAXACsAAQAAAAAABQALAEIAAQAAAAAABgAVABYAAwABBAkAAQAeAE0AAwABBAkAAgAOAGsAAwABBAkAAwAqAHkAAwABBAkABAAuAKMAAwABBAkABQAWANEAAwABBAkABgAqAHlUc3VtdSBDU1MgUHJvYmVSZWd1bGFyVHN1bXVDU1NQcm9iZS1SZWd1bGFyVHN1bXUgQ1NTIFByb2JlIFJlZ3VsYXJWZXJzaW9uIDEuMABUAHMAdQBtAHUAIABDAFMAUwAgAFAAcgBvAGIAZQBSAGUAZwB1AGwAYQByAFQAcwB1AG0AdQBDAFMAUwBQAHIAbwBiAGUALQBSAGUAZwB1AGwAYQByAFQAcwB1AG0AdQAgAEMAUwBTACAAUAByAG8AYgBlACAAUgBlAGcAdQBsAGEAcgBWAGUAcgBzAGkAbwBuACAAMQAuADAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAOwAA";

const fixtureFiles: Record<string, string | Buffer> = {
  "site/index.html": `<!doctype html><html><head>
    <link rel="icon" href="data:,">
    <link id="main-sheet" rel="stylesheet" href="css/main.css?version=3#sheet" media="screen" title="Base" integrity="sha256-not-the-rewritten-css">
    <link id="namespace-sheet" rel="stylesheet" href="css/namespaces.css" media="screen">
    <link id="print-sheet" rel="stylesheet" href="css/print.css" media="print">
    <link id="disabled-sheet" rel="stylesheet" href="css/disabled.css" disabled>
    <link id="alternate-sheet" rel="alternate stylesheet" href="css/alternate.css" title="Alternate">
    <style>#inline-raw-query { background-image:url("images/background.svg?quot;"); }</style>
  </head><body>
    <div id="version">Original</div><input id="draft" aria-label="Draft"><div id="nested-rule">Nested import</div>
    <div id="import-order">Import order</div><div id="namespace-scope">HTML namespace</div>
    <svg width="7" height="5"><defs><filter id="identity"><feGaussianBlur stdDeviation="0" /></filter></defs><rect id="svg-rect" width="7" height="5" filter="url(#identity)" /></svg>
    <div id="background"></div><div id="external-resource">External resources</div><span id="font">X</span>
    <style-card><div id="inline-custom" style='background-image:url("images/background.svg")'></div></style-card>
    <div id="inline-double" style='background-image:url("images/background.svg")'></div>
    <div id="inline-single" style="background-image:url('images/background.svg')"></div>
    <div id="inline-unquoted" style="background-image:url(images/background.svg)"></div>
    <div id="inline-query" style='background-image:url("images/background.svg?v=1&amp;theme=dark#paint")'></div>
    <div id="inline-fragment" style='background-image:url("images/background.svg#paint")'></div>
    <div id="inline-numeric" style="background-image:url(&#34;images/background.svg&#34;)"></div>
    <div id="inline-image-set" style='background-image:image-set("images/background.svg" 1x)'></div>
    <div id="inline-raw-query"></div>
    <img id="direct-image" src="images/direct.svg?cache=5#direct" alt="Fixture">
    <div id="print-only">Print</div><div id="disabled-only">Disabled</div>
    <div id="alternate-only">Alternate</div><div id="blocked-import">False condition</div>
    <script>window.zipCssLiteral = "url(images/not-an-asset.svg)";</script>
  </body></html>`,
  "site/css/main.css": `@charset "UTF-8";
    @layer low, high;
    @import "nested/theme.css?theme=1#nested" layer(low) supports(display: grid) screen;
    @import url("order.css?order=1") layer(low) screen;
    @import "nested/theme.css?again=1" layer(high) screen;
    @import "never.css" supports(display: zip-invalid-value) screen;
    @import "//zip-cdn.test/external.css";
    #external-resource { background-image: url("/shared/external.svg"); }
    #font { display: inline-block; font: 40px "Tsumu CSS Probe", monospace; }
  `,
  "site/css/nested/theme.css": `@import "../deep/font.css?rev=2#font-sheet";
    #nested-rule { display: grid; gap: 13px; }
    #import-order { color: rgb(11, 22, 33); }
    #background { width: 7px; height: 5px; background-image: url("../../images/background.svg?cache=4#paint"); }
  `,
  "site/css/deep/font.css": `@font-face {
    font-family: "Tsumu CSS Probe";
    src: url("../../fonts/probe.ttf?font=2#face") format("truetype");
  }`,
  // Keep namespace ordering separate from layer-order tests: only imports precede it.
  "site/css/namespaces.css": `@import "nested/namespace.css";
    @namespace h url("http://www.w3.org/1999/xhtml");
    h|div#namespace-scope { color: rgb(12, 34, 56); }`,
  "site/css/nested/namespace.css": `@namespace h url("http://www.w3.org/2000/svg");
    h|rect { fill: rgb(24, 57, 91); }`,
  "site/css/order.css": "#import-order { color: rgb(91, 92, 93); }",
  "site/css/never.css": "#blocked-import { color: rgb(101, 102, 103); }",
  "site/css/print.css": "#print-only { border-top: 7px solid rgb(61, 62, 63); }",
  "site/css/disabled.css": "#disabled-only { color: rgb(31, 41, 51); }",
  "site/css/alternate.css": "#alternate-only { color: rgb(71, 81, 91); }",
  "site/images/background.svg": '<svg xmlns="http://www.w3.org/2000/svg" id="paint" width="7" height="5"><rect width="7" height="5" fill="#123456"/></svg>',
  "site/images/direct.svg": '<svg xmlns="http://www.w3.org/2000/svg" id="direct" width="9" height="6"><rect width="9" height="6" fill="#abcdef"/></svg>',
  "site/fonts/probe.ttf": Buffer.from(PROBE_FONT, "base64"),
};

/** Use the actual importer and React hook, not a copy of the CSS transformation. */
export const zipCssBrowserBundle = buildSync({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { createRoot } from "react-dom/client";
      import { readHtmlZip } from "./lib/html-zip";
      import { useHtmlPreview } from "./components/canvas/useHtmlPreview";
      import { HTML_PREVIEW_REFRESH_MS } from "./components/canvas/useHtmlPreview";
      let root;
      function Preview({ doc }) {
        const { html, error, needsRefresh, refreshing, refresh } = useHtmlPreview(doc.pages.p.rawHtml, doc.assets);
        return createElement("div", null,
          createElement("output", { id: "preview-error" }, error || ""),
          (needsRefresh || error) && createElement("button", {
            id: "refresh-preview", onClick: refresh, disabled: refreshing,
          }, "Refresh preview (resets preview state)"),
          createElement("iframe", {
            id: "preview", sandbox: "allow-scripts allow-forms allow-popups",
            srcDoc: html, style: { width: "900px", height: "600px" },
          }));
      }
      const rendered = [];
      new MutationObserver(() => {
        const frame = document.querySelector("#preview");
        if (frame) rendered.push(frame.getAttribute("srcdoc") || "");
      }).observe(document.getElementById("app"), { childList: true, subtree: true, attributes: true });
      window.zipCssHarness = {
        rendered, refreshMs: HTML_PREVIEW_REFRESH_MS,
        async importZip(base64) {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const imported = await readHtmlZip(bytes);
          return {
            siteName: "ZIP CSS", nodes: {}, pageOrder: ["p"],
            assets: Object.fromEntries(imported.assets.map((asset) => [asset.id, asset])),
            pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: [], rawHtml: imported.html } },
          };
        },
        mount(doc) {
          root ||= createRoot(document.getElementById("app"));
          root.render(createElement(Preview, { doc }));
        },
        unmount() { root?.unmount(); root = undefined; },
      };
    `,
    loader: "tsx", sourcefile: "zip-css-browser.tsx", resolveDir: resolve(__dirname, "../.."),
  },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
}).outputFiles[0].text;

type Uploaded = { name: string; mimeType: string; body: Buffer };
export type Signature = { paths: string[]; token: string; release: () => void; settled: Promise<void> };

/** Every HTTP request is intercepted; neither editor accounts nor the network are used. */
export async function zipCssBrowser(page: Page, storage: "local" | "remote") {
  const uploaded = new Map<string, Uploaded>();
  const signatures: Signature[] = [];
  const resources: { url: string; cookie: string | undefined; origin: string | undefined }[] = [];
  const exportedRequests: string[] = [];
  const externalRequests: string[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  const control = { holdSignatures: false, failSignatures: false, publicAssets: false };
  let exported: Awaited<ReturnType<typeof renderZipExport>> | undefined;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().addCookies([{ name: "editor-session", value: "synthetic-not-authentication", url: "https://zip-editor.test", sameSite: "Strict" }]);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === "https://zip-cdn.test" && url.pathname === "/external.css") {
      externalRequests.push(url.href);
      return route.fulfill({ contentType: "text/css", body: "#external-resource{color:rgb(80,90,100)}" });
    }
    if (["https://zip-editor.test", "https://zip-export.test"].includes(url.origin) && url.pathname === "/shared/external.svg") {
      externalRequests.push(url.href);
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="4"><rect width="11" height="4" fill="red"/></svg>' });
    }
    if (url.origin === "https://zip-editor.test" && url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><link rel="icon" href="data:,"><div id="app"></div>' });
    }
    if (url.origin === "https://zip-editor.test" && url.pathname === "/api/assets" && request.method() === "POST") {
      if (storage === "local") return route.fulfill({ status: 503, json: { error: "No storage in fixture" } });
      const form = await new Response(new Uint8Array(request.postDataBuffer()!), { headers: { "content-type": request.headers()["content-type"] } }).formData();
      const file = form.get("file") as File;
      const path = `assets/random-storage/${uploaded.size + 1}/${file.name}`;
      uploaded.set(path, { name: file.name, mimeType: file.type, body: Buffer.from(await file.arrayBuffer()) });
      return route.fulfill({ json: { path } });
    }
    if (url.origin === "https://zip-editor.test" && url.pathname === "/api/assets/sign" && request.method() === "POST") {
      const paths = request.postDataJSON().paths as string[];
      let release = () => {};
      const gate = new Promise<void>((done) => { release = done; });
      let finish = () => {};
      const settled = new Promise<void>((done) => { finish = done; });
      const signature = { paths, token: `fixture-${signatures.length + 1}`, release, settled };
      signatures.push(signature);
      if (control.holdSignatures) await gate;
      try {
        if (control.failSignatures) return await route.fulfill({ status: 503, json: { error: "Fixture signer unavailable" } });
        const expires = await page.evaluate(() => Date.now() + 60 * 60 * 1000);
        const urls = Object.fromEntries(paths.map((path) => [path, `/api/assets/file?path=${encodeURIComponent(path)}${control.publicAssets ? "" : `&exp=${expires}&sig=${signature.token}`}`]));
        // A previous hook invocation may abort while its response is deliberately delayed.
        await route.fulfill({ json: { urls } }).catch((error) => {
          if (!request.failure()) throw error;
        });
      } finally { finish(); }
      return;
    }
    if (url.origin === "https://zip-editor.test" && url.pathname === "/api/assets/file") {
      resources.push({ url: url.href, cookie: request.headers().cookie, origin: request.headers().origin });
      const asset = uploaded.get(url.searchParams.get("path") ?? "");
      if (asset && (control.publicAssets || /^fixture-\d+$/.test(url.searchParams.get("sig") ?? "")) && !request.headers().cookie) {
        return route.fulfill({ contentType: asset.mimeType, body: asset.body, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }
    if (url.origin === "https://zip-export.test" && exported) {
      exportedRequests.push(url.href);
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: exported.html });
      const path = `public${decodeURIComponent(url.pathname)}`;
      const text = exported.files[path];
      const remote = uploaded.get(exported.remoteAssets[path]);
      const binary = exported.binaries[path];
      if (text !== undefined || remote || binary) {
        const extension = url.pathname.split(".").pop();
        const mimeType = remote?.mimeType ?? ({ css: "text/css", svg: "image/svg+xml", ttf: "font/ttf" }[extension ?? ""] ?? "application/octet-stream");
        return route.fulfill({ contentType: mimeType, body: text ?? remote?.body ?? Buffer.from(binary, "base64") });
      }
    }
    unexpected.push(request.url());
    return route.fulfill({ status: 404, body: "Unexpected fixture request" });
  });
  await page.goto("https://zip-editor.test/");
  await page.addScriptTag({ content: zipCssBrowserBundle });
  const zip = new JSZip();
  for (const [name, source] of Object.entries(fixtureFiles)) zip.file(name, source);
  const base64 = await zip.generateAsync({ type: "base64" });
  const doc = await page.evaluate((input) => (window as any).zipCssHarness.importZip(input), base64) as SiteDoc;
  return {
    doc, uploaded, signatures, resources, exportedRequests, externalRequests, unexpected, errors, control,
    mount: (next: SiteDoc = doc) => page.evaluate((input) => (window as any).zipCssHarness.mount(input), next),
    async openExport() {
      exported = await renderZipExport(doc);
      await page.goto("https://zip-export.test/");
      return exported;
    },
  };
}

/** Execute the actual generated Route Handler, then serve its public files verbatim. */
export async function renderZipExport(doc: SiteDoc) {
  const output = generateProject(doc);
  const code = transformSync(output.files["app/route.ts"], { loader: "ts", format: "cjs" }).code;
  const mod = { exports: {} as { GET: () => Response } };
  new Function("module", "exports", code)(mod, mod.exports);
  return { ...output, html: await mod.exports.GET().text() };
}

export function fixtureAsset(doc: SiteDoc, path: string): Asset {
  const asset = Object.values(doc.assets).find((item) => item.zip?.path === path);
  if (!asset) throw new Error(`Missing fixture asset: ${path}`);
  return asset;
}
