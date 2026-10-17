"use client";

/**
 * 要素の追加タブ
 */

import { ArrowDownToLine, CornerDownRight, FileText, Component, Pencil } from "lucide-react";
import {
  findParentOf,
  insertPointFor,
  useEditor,
  type InsertMode,
  type ParentRef,
} from "../../lib/store";
import { BODY_NODE_ID, type DocNode } from "../../lib/types";
import { ELEMENT_DRAG_TYPE, ELEMENT_SECTIONS, normalizeMade } from "../../lib/elements";
import { Icon } from "../icons";
import { InfoTip, Seg } from "../controls";
import { showConfirm } from "../../lib/dialog";
import { tr } from "../../lib/i18n";

/* ============ 要素追加 ============ */


export function AddTab() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const selection = useEditor((s) => s.selection);
  const insertNodes = useEditor((s) => s.insertNodes);
  const setLeftTab = useEditor((s) => s.setLeftTab);
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const setEditingComponent = useEditor((s) => s.setEditingComponent);
  const insertInstance = useEditor((s) => s.insertInstance);
  const deleteComponent = useEditor((s) => s.deleteComponent);

  const editingComp = editingComponentId
    ? doc.components?.[editingComponentId]
    : null;
  const fallbackTarget: ParentRef = editingComp
    ? { kind: "node", id: editingComp.rootId }
    : { kind: "page", id: activePageId };

  const insertMode = useEditor((s) => s.insertMode);
  const setInsertMode = useEditor((s) => s.setInsertMode);
  const insertTarget = () => insertPointFor(doc, selection, fallbackTarget, insertMode);

  const insertOne = (made: DocNode | { root: DocNode; nodes: DocNode[] }) => {
    const { root, nodes } = normalizeMade(made);
    const target = insertTarget();
    insertNodes(nodes, root.id, target.parent, target.index);
    setLeftTab("layers");
  };

  const sel = selection ? doc.nodes[selection] : null;
  const point = insertTarget();
  /** 挿入先の種類（見出しのアイコンを変える） */
  const targetKind: "inside" | "after" | "root" =
    selection === BODY_NODE_ID || !sel
      ? "root"
      : point.parent.kind === "node" && point.parent.id === sel.id
        ? "inside"
        : "after";
  const TargetIcon = targetKind === "inside" ? CornerDownRight : targetKind === "after" ? ArrowDownToLine : FileText;
  const targetLabel =
    selection === BODY_NODE_ID
      ? tr("bodyの中")
      : sel && point.parent.kind === "node" && point.parent.id === sel.id
      ? tr("「{name}」の中", { name: sel.name })
      : sel && findParentOf(doc, sel.id)
        ? tr("「{name}」の後", { name: sel.name })
      : editingComp
        ? tr("コンポーネント「{name}」の中", { name: editingComp.name })
        : tr("ページ直下");
  const components = Object.values(doc.components ?? {});

  return (
    <div className="panel-body" data-tutorial="add-panel">
      <div className="add-sec" style={{ paddingBottom: 4 }}>
        <div className="insert-target" data-tutorial="insert-target">
          <div className="insert-target-row">
            <span className="insert-target-caption">{tr("挿入先")}</span>
            <Seg
              full={false}
              value={insertMode}
              options={[
                { value: "inside", label: tr("中へ"), title: tr("選んだボックスの中の最後に追加します（中に入れられない要素なら後ろ）") },
                { value: "after", label: tr("後ろへ"), title: tr("選んだ要素のすぐ後ろに、同じ階層の要素として追加します") },
              ]}
              onChange={(v) => setInsertMode(v as InsertMode)}
            />
          </div>
          <div className={`insert-target-where is-${targetKind}`} title={targetLabel}>
            <TargetIcon size={13} />
            <span>{targetLabel}</span>
          </div>
        </div>
      </div>
      {ELEMENT_SECTIONS.map((sec) => (
        <div key={sec.title} className="add-sec">
          <div className="add-title">{sec.title}</div>
          <div className="add-grid">
            {sec.items.map((el) => (
              <button
                key={el.key}
                className="add-item"
                data-tutorial={`add-element-${el.key}`}
                draggable
                data-tip={tr("クリックで挿入・キャンバスへドラッグでも置けます")}
                onClick={() => insertOne(el.make())}
                onDragStart={(e) => {
                  e.dataTransfer.setData(ELEMENT_DRAG_TYPE, el.key);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <Icon name={el.icon} size={18} />
                <span>{el.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="add-sec" data-tutorial="add-components">
        <div className="add-title">
          {tr("コンポーネント")}
          <InfoTip text={tr("要素を右クリックして「コンポーネント化」で作れます。ヘッダーなど、複数のページで使い回す部品に使います。")} />
        </div>
        {components.length === 0 && (
          <p className="hint" style={{ margin: 0 }}>{tr("まだありません")}</p>
        )}
        {components.map((c) => (
          <div key={c.id} className="add-row comp-row">
            <button
              className="comp-insert"
              data-tip={
                editingComp ? tr("ページの末尾に挿入（コンポーネントの編集を終えます）") : tr("挿入先に挿入")
              }
              onClick={() => {
                insertInstance(c.id);
                setLeftTab("layers");
              }}
            >
              <Component size={14} />
              {c.name}
            </button>
            <button
              className="layer-act is-active"
              data-tip={tr("マスターを編集")}
              onClick={() => setEditingComponent(c.id)}
            >
              <Pencil size={12} />
            </button>
            <button
              className="layer-act is-active"
              data-tip={tr("削除（すべてのインスタンスも削除）")}
              onClick={async () => {
                if (
                  await showConfirm(tr("ページに置いた、このコンポーネントの使用箇所（インスタンス）もすべて削除されます。"), {
                    title: tr("コンポーネント「{name}」を削除しますか？", { name: c.name }),
                    okLabel: tr("削除"),
                    danger: true,
                  })
                ) {
                  deleteComponent(c.id);
                }
              }}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
