import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editorTitleBundle, editorTitleFixture } from "./helpers/editor-title";

test("editor layout owns one synchronous fallback title and suppresses inherited asynchronous title metadata", async () => {
  const { Layout, inheritedTitle, rootMetadata } = await editorTitleFixture();
  assert.equal(rootMetadata.title, "Tsumu", "other routes retain the shared title");
  assert.equal(inheritedTitle, "", "late metadata must not replace the editor's site name");
  const html = renderToStaticMarkup(createElement(Layout, null, createElement("div", null, "editor")));
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
  assert.match(html, /<title>Tsumu<\/title>/);
  assert.match(html, /<div>editor<\/div>/);
});

test("editor error boundary keeps the title layout mounted and reuses the existing recovery UI", () => {
  const error = readFileSync(new URL("../app/sites/[id]/error.tsx", import.meta.url), "utf8");
  assert.match(error, /["']use client["']/);
  assert.match(error, /export\s*\{\s*default\s*\}\s*from\s*["']\.\.\/\.\.\/error["']/);
});

test("browser fixture bundles the real site page and title layout without loading the editor's services", async () => {
  const bundle = await editorTitleBundle();
  assert.match(bundle, /finishMetadata/);
  assert.match(bundle, /data-editor-ready/);
});
