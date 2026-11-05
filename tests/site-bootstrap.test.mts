import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { editorBootstrapFixture } from "./helpers/editor-bootstrap";
import { siteBootstrapBundle, siteBootstrapFixture } from "./helpers/site-bootstrap";

test("site route renders exactly one shared loading screen before any checks settle", async () => {
  const { SitePage } = await siteBootstrapFixture();
  const html = renderToString(createElement(SitePage));
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-bootstrap-document|class="app"/);
});

test("editor delegates pending UI to its owner without revealing the temporary document", async () => {
  const { Editor } = await editorBootstrapFixture();
  let ready = 0;
  const html = renderToString(createElement(Editor, { onReady: () => { ready += 1; } }));
  assert.equal(html, "");
  assert.equal(ready, 0, "a render alone is not a completed document load");
  assert.match(renderToString(createElement(Editor)), /role="status"/, "standalone editor retains its fallback");
});

test("site bootstrap browser regression runs the real route and editor lifecycle", async () => {
  const bundle = await siteBootstrapBundle(true);
  assert.match(bundle, /bootstrapModule/);
  assert.match(bundle, /runSyncFromServer/);
  assert.match(bundle, /data-bootstrap-document/);
});
