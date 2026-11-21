import { test } from "node:test";
import assert from "node:assert/strict";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { prepareExportProject } from "../lib/export-formats";
import { createInitialDoc } from "../lib/presets";

const noNetwork = async () => { throw new Error("Unexpected external request"); };

test("single HTML embeds bundled social metadata but keeps external images", async () => {
  const project = await toSingleHtmlProject({
    files: { "index.html": '<html><head>' +
      '<meta property="og:image" content="/assets/social.png">' +
      '<meta name="twitter:image" content="./assets/social.png">' +
      '<meta property="og:image:secure_url" content="/assets/social.png">' +
      '<meta itemprop="image" content="/assets/social.png">' +
      '<meta property="og:image" content="https://example.com/social.png">' +
      '<meta property="og:image" content="/missing.png">' +
      '</head><body></body></html>' },
    binaries: { "assets/social.png": "AQID" }, remoteAssets: {},
  }, noNetwork);
  const html = project.files["index.html"];
  assert.match(html, /property="og:image" content="data:image\/png;base64,AQID"/);
  assert.match(html, /name="twitter:image" content="data:image\/png;base64,AQID"/);
  assert.match(html, /property="og:image:secure_url" content="data:image\/png;base64,AQID"/);
  assert.match(html, /itemprop="image" content="data:image\/png;base64,AQID"/);
  assert.match(html, /content="https:\/\/example\.com\/social\.png"/);
  assert.match(html, /content="\/missing\.png"/);
  assert.deepEqual(project.binaries, {});
});

test("single HTML removes script preload hints while preserving embedded scripts", async () => {
  const project = await toSingleHtmlProject({
    files: { "index.html": '<html><head>' +
      '<link rel="preload" as="script" href="/scripts.js">' +
      '<link rel="modulepreload" href="/entry.mjs">' +
      '</head><body><script src="/scripts.js" defer></script>' +
      '<script type="module" src="/entry.mjs"></script></body></html>',
      "scripts.js": "window.scriptLoaded = true;",
      "entry.mjs": "export const initialized = true;",
    },
    binaries: {}, remoteAssets: {},
  }, noNetwork);
  const html = project.files["index.html"];
  assert.doesNotMatch(html, /rel="(?:preload|modulepreload)"/);
  assert.match(html, /<script[^>]*src="data:text\/javascript(?:;charset=utf-8)?;base64,/);
  assert.match(html, /<script type="module" src="data:text\/javascript;base64,/);
});

test("single HTML export embeds a configured local Open Graph image", async () => {
  const doc = createInitialDoc();
  // A single-HTML export intentionally contains one page; exclude the preset 404 page.
  doc.pageOrder = doc.pageOrder.filter(id => doc.pages[id].slug !== "404");
  doc.assets.social = { id: "social", name: "social.png", mimeType: "image/png",
    width: 1, height: 1, dataUrl: "data:image/png;base64,AQID" };
  doc.ogImage = { assetId: "social" };
  const project = await prepareExportProject(doc, {
    framework: "single-html", language: "javascript", style: "css",
    scope: "page", pageId: doc.pageOrder[0],
  });
  assert.match(project.files["index.html"], /property="og:image" content="data:image\/png;base64,AQID"/);
});
