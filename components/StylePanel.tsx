"use client";

import { useMemo } from "react";
import { Focus, MousePointer2, MousePointerClick, Pointer } from "lucide-react";
import { useEditor } from "../lib/store";
import { showConfirm } from "../lib/dialog";
import type { DocNode, StyleState } from "../lib/types";
import { BP_INFO, getProp, clearedValue, STATE_INFO, STATE_ORDER } from "../lib/style";
import { Dropdown, InspectorCtx, type Inspector } from "./controls";
import { tr } from "../lib/i18n";
import { BackgroundSec, BorderSec } from "./style-panel/BackgroundSec";
import { AppearanceSec, ImageSec, SelectionSec, SpacingSec } from "./style-panel/BoxSec";
import { EffectsSec } from "./style-panel/EffectsSec";
import { FieldStyleSec } from "./style-panel/FieldStyleSec";
import { LayoutSec } from "./style-panel/LayoutSec";
import { MotionSec } from "./style-panel/MotionSec";
import { PositionSec } from "./style-panel/PositionSec";
import { TypographySec, inheritedPropValue } from "./style-panel/TypographySec";
import { CustomCssSec, TEXT_SPLIT_PROPS, VisibilitySec } from "./style-panel/VisibilitySec";

/** いま編集しているスタイルがどのデバイスに反映されるかを示す */
function BpScopeChip({ style }: { style?: React.CSSProperties }) {
  const breakpoint = useEditor((s) => s.breakpoint);
  const info = BP_INFO[breakpoint];
  return (
    <span
      className={`bp-chip${breakpoint === "base" ? "" : " is-override"}`}
      style={style}
      data-tip={tr("変更は{scope}", { scope: info.scope })}
    >
      {breakpoint === "base" ? tr("全デバイス共通") : tr("{label}用", { label: info.label })}
    </span>
  );
}

/** 全ページ共通のbodyを、通常の要素と同じ操作感で編集する。 */
export function BodyStylePanel() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const breakpoint = useEditor((s) => s.breakpoint);
  const updateDoc = useEditor((s) => s.updateDoc);
  const checkpoint = useEditor((s) => s.checkpoint);

  const bodyNode: DocNode = useMemo(
    () => ({
      id: "__body__",
      type: "box",
      name: "body",
      semantic: "div",
      text: null,
      link: null,
      children: [],
      styles: doc.pages[activePageId]?.bodyStyles ?? {},
    }),
    [doc.pages, activePageId]
  );

  const setBodyProps = (
    props: Record<string, string | null>,
    transient = false
  ) => {
    updateDoc(
      (draft) => {
        const page = draft.pages[activePageId];
        if (!page) return;
        const styles = (page.bodyStyles ??= {});
        const bpStyles = (styles[breakpoint] ??= {});
        const map = (bpStyles.default ??= {});
        for (const [key, value] of Object.entries(props)) {
          // 空文字は「未設定」として消す（空の値が設定済みの色だけ付けて残らないように）
          if (value === null || value === "") delete map[key];
          else map[key] = value;
        }
      },
      { history: !transient }
    );
  };

  const insp: Inspector = useMemo(
    () => ({
      get: (prop) => getProp(bodyNode, breakpoint, "default", prop),
      set: (props) => setBodyProps(props),
      cleared: (prop) => clearedValue(bodyNode, breakpoint, "default", prop),
      setTransient: (props) => setBodyProps(props, true),
      checkpoint,
    }),
    [bodyNode, breakpoint, checkpoint]
  );

  return (
    <InspectorCtx.Provider value={insp}>
      <div className="state-bar">
        <strong style={{ fontSize: 11 }}>
          {tr("body（{name}）", { name: doc.pages[activePageId]?.name ?? "" })}
        </strong>
        <BpScopeChip style={{ marginLeft: "auto" }} />
      </div>
      <div className="panel-body">
        <LayoutSec />
        <SpacingSec />
        <AppearanceSec />
        <TypographySec node={bodyNode} />
        <BackgroundSec />
        <BorderSec />
        <EffectsSec />
      </div>
    </InspectorCtx.Provider>
  );
}

export default function StylePanel({ nodeId }: { nodeId: string }) {
  const doc = useEditor((s) => s.doc);
  const breakpoint = useEditor((s) => s.breakpoint);
  const styleState = useEditor((s) => s.styleState);
  const setStyleState = useEditor((s) => s.setStyleState);
  const setStyleProps = useEditor((s) => s.setStyleProps);
  const checkpoint = useEditor((s) => s.checkpoint);

  const node = doc.nodes[nodeId];

  const insp: Inspector = useMemo(
    () => ({
      get: (prop) =>
        getProp(node, breakpoint, styleState, prop, (p) => inheritedPropValue(doc, nodeId, breakpoint, styleState, p)),
      cleared: (prop) => clearedValue(node, breakpoint, styleState, prop),
      set: (props) => {
        // テキストの一部だけが選択されていた場合は span 分割を提案する
        const s = useEditor.getState();
        const sel = s.textSel;
        if (
          sel &&
          sel.nodeId === nodeId &&
          Object.keys(props).some((p) => TEXT_SPLIT_PROPS.has(p))
        ) {
          void showConfirm(
            tr("選んだ部分だけのスタイルを変えるには、その部分を別のテキストとして分割します。分割しますか？\n（分割しない場合は、テキスト全体に適用します）"),
            { title: tr("選んだ部分だけに適用"), okLabel: tr("分割して適用"), cancelLabel: tr("全体に適用") }
          ).then((ok) => {
            const st = useEditor.getState();
            if (ok && st.splitTextSpan(sel.nodeId, sel.start, sel.end, sel.text, props)) return;
            st.setTextSel(null);
            setStyleProps(nodeId, props);
          });
          return;
        }
        setStyleProps(nodeId, props);
      },
      setTransient: (props) => setStyleProps(nodeId, props, { transient: true }),
      checkpoint,
    }),
    [doc, node, breakpoint, styleState, nodeId, setStyleProps, checkpoint]
  );

  if (!node) return null;

  return (
    <InspectorCtx.Provider value={insp}>
      <div className="state-bar" data-tutorial="style-state">
        <span className="grp-label" style={{ flex: "none" }}>
          {tr("状態")}
        </span>
        <div style={{ flex: 1 }}>
          <Dropdown
            value={styleState}
            options={STATE_ORDER.map((s) => ({
              value: s,
              label: STATE_INFO[s].label,
              icon: {
                default: <MousePointer2 size={13} />,
                hover: <Pointer size={13} />,
                active: <MousePointerClick size={13} />,
                focus: <Focus size={13} />,
              }[s],
            }))}
            onChange={(v) => setStyleState(v as StyleState)}
          />
        </div>
        <BpScopeChip />
      </div>
      <div className="panel-body">
        <VisibilitySec node={node} />
        <PositionSec />
        <LayoutSec />
        {(node.type === "image" || node.media?.kind === "video") && <ImageSec />}
        <SpacingSec />
        <AppearanceSec />
        <TypographySec node={node} />
        <BackgroundSec />
        <BorderSec />
        <SelectionSec />
        {node.type === "field" && <FieldStyleSec node={node} />}
        <EffectsSec />
        <MotionSec node={node} />
        <CustomCssSec node={node} />
      </div>
    </InspectorCtx.Provider>
  );
}
