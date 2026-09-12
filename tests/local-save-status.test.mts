import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { localSaveStatusFixture } from "./helpers/local-save-status";

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
