import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { createElement } from "react";
import { renderToString, renderToStaticMarkup } from "react-dom/server";
import { editorBootstrapFixture } from "./helpers/editor-bootstrap";
import { siteBootstrapFixture } from "./helpers/site-bootstrap";
import { readFileSync } from "node:fs";
import { editorTitleFixture } from "./helpers/editor-title";
import { localSaveStatusFixture } from "./helpers/local-save-status";
import { savedTimeLabel } from "../lib/time";

describe("editor-bootstrap", () => {
  test("the real editor initially renders the shared loading screen, not its temporary document", async () => {
    const { Editor, useEditor } = await editorBootstrapFixture();
    useEditor.getState().updateDoc((doc: any) => { doc.siteName = "Temporary default document"; });
    const html = renderToString(createElement(Editor));
    assert.match(html, /class="boot"/);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /class="app"|data-bootstrap-document|Temporary default document/);
  });
});

describe("site-bootstrap", () => {
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
});

describe("editor-title", () => {
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
});

await describe("local-save-status", async () => {
  const { Footer, tr, useEditor } = await localSaveStatusFixture();

  const messages = {
    local: {
      pending: "Saving in this browser…",
      saved: "Saved in this browser only",
      error: "Couldn't save in this browser",
      deleted: "Browser save location deleted",
    },
    error: {
      pending: "Couldn't save to server (checking browser save…)",
      saved: "Couldn't save to server (saved in this browser)",
      error: "Couldn't save to the server or in this browser",
      deleted: "Couldn't save to server (browser save location deleted)",
    },
  };

  for (const cloudState of ["local", "error", "synced", "saving", "checking"] as const) {
    for (const localSaveState of ["pending", "saved", "error", "deleted"] as const) {
      test(`${cloudState}/${localSaveState}: the footer reports the current browser save result`, () => {
        // SSR では Zustand が初期のスナップショットを読むため、検証用の初期値を指定する。
        Object.assign(useEditor.getInitialState(), { cloudState, savedAt: 1, cloudSavedAt: 1, cloudError: null });
        const html = renderToStaticMarkup(createElement(Footer, { localSaveState, onRetryLocalSave() {} })).replaceAll("&#x27;", "'").replaceAll("&#39;", "'");
        const expected = cloudState === "local" || cloudState === "error"
          ? messages[cloudState][localSaveState]
          : cloudState === "synced" ? "Saved to server"
          : cloudState === "saving" ? "Saving to server…" : "Checking sync…";
        assert.ok(html.includes(tr(expected)), expected);
        if (localSaveState !== "saved") {
          assert.ok(!html.includes(tr(messages.local.saved)));
          assert.ok(!html.includes(tr(messages.error.saved)));
        }
      });
    }
  }
});

describe("saved-time-label", () => {
  const at = (text: string) => new Date(text).getTime();

  test("a save within 24 hours shows its time, marked with the day when it was not today", () => {
    const now = at("2026-11-17T10:00:00");
    assert.equal(savedTimeLabel(at("2026-11-17T09:05:03"), now, "ja"), "9:05:03");
    assert.equal(savedTimeLabel(at("2026-11-16T23:10:00"), now, "ja"), "昨日 23:10");
    assert.equal(savedTimeLabel(at("2026-11-16T23:10:00"), now, "en"), "yesterday 11:10 PM");
  });

  test("a save older than 24 hours shows how many calendar days ago it was", () => {
    const now = at("2026-11-17T10:00:00");
    assert.equal(savedTimeLabel(at("2026-11-16T09:59:00"), now, "ja"), "昨日");
    assert.equal(savedTimeLabel(at("2026-11-15T23:00:00"), now, "ja"), "一昨日");
    assert.equal(savedTimeLabel(at("2026-11-14T12:00:00"), now, "ja"), "3 日前");
    assert.equal(savedTimeLabel(at("2026-11-16T09:59:00"), now, "en"), "yesterday");
    assert.equal(savedTimeLabel(at("2026-11-14T12:00:00"), now, "en"), "3 days ago");
    // 0:30 の時点で2日前の 23:00 は、25時間半前でも暦の上では「一昨日」。
    assert.equal(savedTimeLabel(at("2026-11-15T23:00:00"), at("2026-11-17T00:30:00"), "ja"), "一昨日");
  });

  test("older saves fall back to weeks, months and years", () => {
    const now = at("2026-11-17T10:00:00");
    assert.equal(savedTimeLabel(at("2026-11-08T10:00:00"), now, "ja"), "先週");
    assert.equal(savedTimeLabel(at("2026-10-01T10:00:00"), now, "ja"), "先月");
    assert.equal(savedTimeLabel(at("2024-11-01T10:00:00"), now, "ja"), "2 年前");
  });
});
