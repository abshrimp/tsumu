"use client";

import { useEffect, useState } from "react";
import { useEditor } from "../lib/store";
import { BODY_NODE_ID } from "../lib/types";
import StylePanel, { BodyStylePanel } from "./StylePanel";
import SettingsPanel from "./SettingsPanel";
import PagePanel from "./PagePanel";
import { tr } from "../lib/i18n";
import { useComments } from "../lib/comment-store";

export default function RightPanel() {
  const selection = useEditor((s) => s.selection);
  const breakpoint = useEditor((s) => s.breakpoint);
  const pageTheme = useEditor((s) => s.pageTheme);
  const selectedType = useEditor((s) =>
    s.selection ? s.doc.nodes[s.selection]?.type ?? null : null
  );
  const tab = useEditor((s) => s.rightTab);
  const setTab = useEditor((s) => s.setRightTab);

  const commenting = useComments((s) => s.active);
  const mode = useEditor((s) => s.mode);
  const [CommentsPanelComp, setCommentsPanelComp] = useState<typeof import("./Comments").CommentsPanel | null>(null);

  useEffect(() => {
    if (!commenting || mode !== "design" || CommentsPanelComp) return;
    let active = true;
    void import("./Comments").then((mod) => {
      if (active) setCommentsPanelComp(() => mod.CommentsPanel);
    });
    return () => { active = false; };
  }, [commenting, mode, CommentsPanelComp]);

  return (
    // 画面幅別・ダークモード別のスタイルを、通常の編集と区別できるようオレンジにする。
    <aside
      className={`panel-r${breakpoint === "base" ? "" : " is-bp"}${pageTheme === "dark" ? " is-dark" : ""}`}
      data-tutorial="inspector"
      onContextMenu={(e) => {
        // 右クリックは項目のリセットなどに使うため、ブラウザのメニューは表示しない
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
        CommentsPanelComp ? <CommentsPanelComp /> : null
      ) : selection === BODY_NODE_ID ? (
        <>
          <div className="tabs">
            <button className="tab is-on">{tr("Style")}</button>
          </div>
          <BodyStylePanel />
        </>
      ) : selectedType && selection ? (
        selectedType === "instance" ? (
          <>
            <div className="tabs">
              <button className="tab is-on">{tr("Settings")}</button>
            </div>
            <SettingsPanel nodeId={selection} />
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
                {tr("Style")}
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
                {tr("Settings")}
              </button>
            </div>
            {tab === "style" ? (
              <StylePanel nodeId={selection} />
            ) : (
              <SettingsPanel nodeId={selection} />
            )}
          </>
        )
      ) : (
        <PagePanel />
      )}
    </aside>
  );
}
