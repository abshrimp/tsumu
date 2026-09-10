"use client";

/**
 * カスタムCSSと、画面幅ごとの表示・非表示
 */

import { useEditor } from "../../lib/store";
import type { DocNode } from "../../lib/types";
import { BP_INFO, BP_ORDER, bpIconKind, isHiddenAt } from "../../lib/style";
import { Icon } from "../icons";
import { CommitTextarea } from "../controls";
import { tr } from "../../lib/i18n";
import { Sec } from "./shared";

/* ---------- カスタムCSS ---------- */

export function CustomCssSec({ node }: { node: DocNode }) {
  const updateTargets = useEditor((s) => s.updateTargets);
  return (
    <Sec
      title={tr("Custom CSS")}
      info={tr("Write CSS that always applies to this element.")}
      defaultOpen={!!node.customCss}
      tutorialTarget="style-css"
      help="look-custom-css"
    >
      <CommitTextarea
        key={`${node.id}-css`}
        className="textarea mono"
        rows={6}
        value={node.customCss ?? ""}
        placeholder={"clip-path: circle(50%);\nscroll-margin-top: 80px;"}
        spellCheck={false}
        onCommit={(v) => {
          const css = v.trim() || undefined;
          // 値を変えていなければ、複数選択中の他の要素のCSSを上書きしない
          if (css === (node.customCss || undefined)) return;
          updateTargets(node.id, (n) => {
            n.customCss = css;
          });
        }}
      />
    </Sec>
  );
}

/* ---------- パネル本体 ---------- */

/** テキストの一部選択時に span 分割の対象となるプロパティ */
export const TEXT_SPLIT_PROPS = new Set([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "fontStyle",
  "textDecoration",
  "textTransform",
  "textShadow",
]);

/** ブレークポイントのアイコン名（幅から選ぶ） */
const BP_ICON_NAME = { monitor: "desktop", tablet: "tablet", mobileL: "mobileL", mobile: "mobile" } as const;

/**
 * デバイスごとの表示・非表示。スタイルと違って上下のデバイスに波及せず、
 * 押したデバイスだけが切り替わる
 */
export function VisibilitySec({ node }: { node: DocNode }) {
  const breakpoint = useEditor((s) => s.breakpoint);
  const setHiddenAt = useEditor((s) => s.setHiddenAt);
  const hiddenHere = isHiddenAt(node, breakpoint);
  return (
    <div className="sec vis-sec" data-tutorial="style-visibility">
      <div className="vis-head">
        <span className="grp-label">{tr("Show on devices")}</span>
        <div className="vis-toggles">
          {BP_ORDER.map((bp) => {
            const shown = !isHiddenAt(node, bp);
            return (
              <button
                key={bp}
                className={`vis-btn${shown ? " is-on" : ""}${
                  bp === breakpoint ? " is-current" : ""
                }`}
                aria-pressed={shown}
                aria-label={tr("View as {label}", { label: BP_INFO[bp].label })}
                data-tip={
                  shown
                    ? tr("{label}: shown (click to hide)", { label: BP_INFO[bp].label })
                    : tr("{label}: hidden (click to show)", { label: BP_INFO[bp].label })
                }
                onClick={() => setHiddenAt(node.id, bp, shown)}
              >
                <Icon name={BP_ICON_NAME[bpIconKind(bp)]} size={14} />
              </button>
            );
          })}
        </div>
      </div>
      {hiddenHere && (
        <p className="hint vis-note">
          {tr("Hidden on {label}, so it isn't shown on the canvas", { label: BP_INFO[breakpoint].label })}
        </p>
      )}
    </div>
  );
}
