"use client";

import { useMemo } from "react";
import { Focus, MousePointer2, MousePointerClick, Pointer } from "lucide-react";
import { useEditor, type EditorStore } from "../lib/store";
import { showConfirm } from "../lib/dialog";
import { usePendingImport } from "../lib/use-pending-import";
import type { DocNode, StyleState } from "../lib/types";
import { BP_INFO, getProp, clearedValue, STATE_INFO, STATE_ORDER } from "../lib/style";
import { customStatesForNode } from "../lib/custom-states";
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

/** 部分的な書式の確認で対象にする、編集位置と本文。名前や余白などの無関係な変更は含めない。 */
function textStyleScope(s: EditorStore, nodeId: string): string {
  const node = s.doc.nodes[nodeId];
  return JSON.stringify([
    s.activePageId, s.editingComponentId, s.mode, s.rightTab,
    nodeId, s.selection, s.selectedIds, s.breakpoint, s.styleState,
    node?.type, node?.text?.content, node?.children,
  ]);
}

/** いま編集しているスタイルが、どのデバイスに反映されるかを示す */
function BpScopeChip({ style }: { style?: React.CSSProperties }) {
  const breakpoint = useEditor((s) => s.breakpoint);
  const info = BP_INFO[breakpoint];
  return (
    <span
      className={`bp-chip${breakpoint === "base" ? "" : " is-override"}`}
      style={style}
      data-tip={tr("{scope}", { scope: info.scope })}
    >
      {breakpoint === "base" ? tr("All devices") : tr("For {label}", { label: info.label })}
    </span>
  );
}

/** 全ページ共通の body を、通常の要素と同じ操作で編集する。 */
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
          // 空文字は「未設定」として消す（値が空なのに、設定済みの色だけが付いて残らないように）
          if (value === null || value === "") delete map[key];
          else map[key] = value;
        }
      },
      { history: !transient }
    );
  };

  const insp: Inspector = useMemo(
    () => ({
      editTarget: JSON.stringify(["body", activePageId, breakpoint]),
      get: (prop) => getProp(bodyNode, breakpoint, "default", prop),
      set: (props) => setBodyProps(props),
      cleared: (prop) => clearedValue(bodyNode, breakpoint, "default", prop),
      setTransient: (props) => setBodyProps(props, true),
      checkpoint,
    }),
    [bodyNode, activePageId, breakpoint, checkpoint]
  );

  return (
    <InspectorCtx.Provider value={insp}>
      <div className="state-bar">
        <strong style={{ fontSize: 11 }}>
          {tr("body ({name})", { name: doc.pages[activePageId]?.name ?? "" })}
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
  const selectedIds = useEditor((s) => s.selectedIds);
  const setStyleState = useEditor((s) => s.setStyleState);
  const setStyleProps = useEditor((s) => s.setStyleProps);
  const checkpoint = useEditor((s) => s.checkpoint);

  const node = doc.nodes[nodeId];
  const scope = useEditor((s) => textStyleScope(s, nodeId));
  const pending = usePendingImport(scope);

  const insp: Inspector = useMemo(
    () => ({
      editTarget: JSON.stringify([nodeId, breakpoint, styleState, selectedIds]),
      get: (prop) =>
        getProp(node, breakpoint, styleState, prop, (p) => inheritedPropValue(doc, nodeId, breakpoint, styleState, p)),
      cleared: (prop) => clearedValue(node, breakpoint, styleState, prop),
      set: (props) => {
        // テキストの一部だけを選択していた場合は、span に分けることを提案する
        const s = useEditor.getState();
        const sel = s.textSel;
        if (
          sel &&
          sel.nodeId === nodeId &&
          Object.keys(props).some((p) => TEXT_SPLIT_PROPS.has(p))
        ) {
          const request = pending.begin();
          void showConfirm(
            tr("To style only the selected part, it needs to be split into a separate text element. Split it?\n(If not, the style applies to the whole text.)"),
            { title: tr("Apply to selection only"), okLabel: tr("Split and apply"), cancelLabel: tr("Apply to all") }
          ).then((ok) => {
            try {
              const st = useEditor.getState();
              const currentSel = st.textSel;
              // 再描画の前の更新も検出する。無効になった部分選択を、別の文字や全文に適用しない。
              if (
                !request.current() || textStyleScope(st, nodeId) !== scope ||
                !currentSel || currentSel.nodeId !== sel.nodeId ||
                currentSel.start !== sel.start || currentSel.end !== sel.end || currentSel.text !== sel.text
              ) return;
              if (ok) {
                st.splitTextSpan(sel.nodeId, sel.start, sel.end, sel.text, props);
              } else {
                st.setTextSel(null);
                setStyleProps(nodeId, props);
              }
            } finally {
              request.finish();
            }
          });
          return;
        }
        setStyleProps(nodeId, props);
      },
      setTransient: (props) => setStyleProps(nodeId, props, { transient: true }),
      checkpoint,
    }),
    [doc, node, breakpoint, styleState, selectedIds, nodeId, setStyleProps, checkpoint, scope, pending]
  );

  if (!node) return null;

  return (
    <InspectorCtx.Provider value={insp}>
      <div className="state-bar" data-tutorial="style-state">
        <span className="grp-label" style={{ flex: "none" }}>
          {tr("State")}
        </span>
        <div style={{ flex: 1 }}>
          <Dropdown
            value={styleState}
            options={[...STATE_ORDER.map((s) => ({
              value: s,
              label: STATE_INFO[s].label,
              icon: {
                default: <MousePointer2 size={13} />,
                hover: <Pointer size={13} />,
                active: <MousePointerClick size={13} />,
                focus: <Focus size={13} />,
              }[s],
            })),
            ...customStatesForNode(doc, nodeId).map((state) => ({
              value: state,
              label: state.slice("custom:".length),
            }))]}
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
