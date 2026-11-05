import assert from "node:assert/strict";
import { test } from "node:test";
import { toSingleHtmlProject } from "../lib/generator/single-html";

test("single HTML never includes untrusted Content-Type as HTML attribute syntax", async () => {
  const project = await toSingleHtmlProject({
    files: {
      "index.html": '<!doctype html><html><body><img src="./assets/remote.png"></body></html>',
    },
    binaries: {},
    remoteAssets: { "assets/remote.png": "assets/upload-id" },
  }, async () => new Response(Uint8Array.from([1, 2, 3]), {
    headers: {
      // This used to break out of src="data:..." and create an onerror handler.
      "Content-Type": 'image/png" onerror="globalThis.__tsumuInjected=1" fake="',
    },
  }));
  const html = project.files["index.html"];
  assert.match(html, /<img src="data:image\/png;base64,AQID">/);
  assert.doesNotMatch(html, /onerror=|fake=|__tsumuInjected/);
});

test("single HTML does not interpret tags or style text inside inline scripts", async () => {
  const authoredScript = [
    "window.template = '<img src=\"./missing.png\" style=\"background:url(./missing-bg.png)\">';",
    "window.styleText = 'style=\"background:url(./missing-css.png)\"';",
    "window.linkText = '<link rel=\"stylesheet\" href=\"./missing.css\">';",
  ].join("\n");
  const project = await toSingleHtmlProject({
    files: {
      "index.html": [
        "<!doctype html><html><head></head><body>",
        "<script>", authoredScript, "</script>",
        '<img src="./assets/pixel.png" style="background:url(./assets/pixel.png)">',
        "</body></html>",
      ].join("\n"),
    },
    binaries: { "assets/pixel.png": "AQID" },
    remoteAssets: {},
  });
  const html = project.files["index.html"];
  assert.ok(html.includes(authoredScript), "authored script content must remain byte-for-byte identical");
  assert.match(html, /<img src="data:image\/png;base64,AQID" style="background:url\(&quot;data:image\/png;base64,AQID&quot;\)">/);
  assert.equal((html.match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
});

test("single HTML leaves comments and textarea raw text untouched", async () => {
  const comment = '<!-- <img src="./missing.png"> <script src="./missing.js"></script> -->';
  const rawText = '<textarea><img src="./missing-textarea.png"><script src="./missing-textarea.js"></script></textarea>';
  const project = await toSingleHtmlProject({
    files: { "index.html": '<!doctype html><html><body>' + comment + rawText + "</body></html>" },
    binaries: {},
    remoteAssets: {},
  });
  assert.ok(project.files["index.html"].includes(comment));
  assert.ok(project.files["index.html"].includes(rawText));
});
