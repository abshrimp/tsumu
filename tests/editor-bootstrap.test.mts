import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { editorBootstrapFixture } from "./helpers/editor-bootstrap";

test("the real editor initially renders the shared loading screen, not its temporary document", async () => {
  const { Editor, useEditor } = await editorBootstrapFixture();
  useEditor.getState().updateDoc((doc: any) => { doc.siteName = "Temporary default document"; });
  const html = renderToString(createElement(Editor));
  assert.match(html, /class="boot"/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /class="app"|data-bootstrap-document|Temporary default document/);
});
