"use client";

import { useEditor } from "../lib/store";
import { BODY_NODE_ID } from "../lib/types";
import StylePanel, { BodyStylePanel } from "./StylePanel";
import SettingsPanel from "./SettingsPanel";
import PagePanel from "./PagePanel";
import { tr } from "../lib/i18n";
import { useComments } from "../lib/comment-store";
import { CommentsPanel } from "./Comments";

export default function RightPanel() {
  const selection = useEditor((s) => s.selection);
  const breakpoint = useEditor((s) => s.breakpoint);
  const doc = useEditor((s) => s.doc);
  const tab = useEditor((s) => s.rightTab);
  const setTab = useEditor((s) => s.setRightTab);

  const commenting = useComments((s) => s.active);
  const mode = useEditor((s) => s.mode);

  const node = selection ? doc.nodes[selection] : null;
  return (
    // パソコン以外の画面幅で編集しているときは、変更済みの色を青ではなくオレンジにする
    //（その画面幅だけの変更だと分かるように）
    <aside
      className={`panel-r${breakpoint === "base" ? "" : " is-bp"}`}
      data-tutorial="inspector"
      onContextMenu={(e) => {
        // 右クリックは項目のリセットなどに使うため、ブラウザのメニューは出さない
        //（文字の入力欄だけは、コピー・貼り付けのメニューを残す）
        const t = e.target as HTMLElement;
        const editable =
          (t.tagName === "INPUT" &&
            !["checkbox", "radio", "range", "color", "button", "submit"].includes(
              (t as HTMLInputElement).type
            )) ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable;
        if (!editable) e.preventDefault();
      }}
    >
      {commenting && mode === "design" ? (
        <CommentsPanel />
      ) : selection === BODY_NODE_ID ? (
        <>
          <div className="tabs">
            <button className="tab is-on">{tr("スタイル")}</button>
          </div>
          <BodyStylePanel />
        </>
      ) : node ? (
        node.type === "instance" ? (
          <>
            <div className="tabs">
              <button className="tab is-on">{tr("設定")}</button>
            </div>
            <SettingsPanel nodeId={node.id} />
          </>
        ) : (
          <>
            <div className="tabs">
              <button
                className={`tab${tab === "style" ? " is-on" : ""}`}
                data-tutorial="right-tab-style"
                onClick={() => {
                  setTab("style");
                  window.dispatchEvent(
                    new CustomEvent("tutorial-ui-change", {
                      detail: { rightTab: "style" },
                    })
                  );
                }}
              >
                {tr("スタイル")}
              </button>
              <button
                className={`tab${tab === "settings" ? " is-on" : ""}`}
                data-tutorial="right-tab-settings"
                onClick={() => {
                  setTab("settings");
                  window.dispatchEvent(
                    new CustomEvent("tutorial-ui-change", {
                      detail: { rightTab: "settings" },
                    })
                  );
                }}
              >
                {tr("設定")}
              </button>
            </div>
            {tab === "style" ? (
              <StylePanel nodeId={node.id} />
            ) : (
              <SettingsPanel nodeId={node.id} />
            )}
          </>
        )
      ) : (
        <PagePanel />
      )}
    </aside>
  );
}
