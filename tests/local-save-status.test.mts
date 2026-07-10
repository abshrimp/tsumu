import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { localSaveStatusFixture } from "./helpers/local-save-status";

const { Footer, tr, useEditor } = await localSaveStatusFixture();

const messages = {
  local: {
    pending: "このブラウザへ保存中…",
    saved: "このブラウザにのみ保存",
    error: "このブラウザに保存できません",
  },
  error: {
    pending: "サーバーに保存できません（ブラウザへの保存を確認中…）",
    saved: "サーバーに保存できません（このブラウザには保存済み）",
    error: "サーバーにもこのブラウザにも保存できません",
  },
};

for (const cloudState of ["local", "error", "synced", "saving", "checking"] as const) {
  for (const localSaveState of ["pending", "saved", "error"] as const) {
    test(`${cloudState}/${localSaveState}: the footer reports the current browser save result`, () => {
      // SSRではZustandが初期スナップショットを読むので、検証用の初期値を指定する。
      Object.assign(useEditor.getInitialState(), { cloudState, savedAt: 1, cloudSavedAt: 1, cloudError: null });
      const html = renderToStaticMarkup(createElement(Footer, { localSaveState, onRetryLocalSave() {} }));
      const expected = cloudState === "local" || cloudState === "error"
        ? messages[cloudState][localSaveState]
        : cloudState === "synced" ? "サーバー保存済み"
        : cloudState === "saving" ? "サーバーへ保存中…" : "同期を確認中…";
      assert.ok(html.includes(tr(expected)), expected);
      if (localSaveState !== "saved") {
        assert.ok(!html.includes(tr(messages.local.saved)));
        assert.ok(!html.includes(tr(messages.error.saved)));
      }
    });
  }
}
