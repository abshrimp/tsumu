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
import { useDocumentConfirmation } from "../../lib/use-document-confirmation";
import { showConfirm } from "../../lib/dialog";
import { tr } from "../../lib/i18n";

/* ============ 要素追加 ============ */


export function AddTab() {
  const confirmDeletion = useDocumentConfirmation("component-deletion");
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
      ? tr("Inside body")
      : sel && point.parent.kind === "node" && point.parent.id === sel.id
      ? tr("Inside \"{name}\"", { name: sel.name })
      : sel && findParentOf(doc, sel.id)
        ? tr("After \"{name}\"", { name: sel.name })
      : editingComp
        ? tr("Inside component \"{name}\"", { name: editingComp.name })
        : tr("Top level of the page");
  const components = Object.values(doc.components ?? {});

  return (
    <div className="panel-body" data-tutorial="add-panel">
      <div className="add-sec" style={{ paddingBottom: 4 }}>
        <div className="insert-target" data-tutorial="insert-target">
          <div className="insert-target-row">
            <span className="insert-target-caption">{tr("Insert into")}</span>
            <Seg
              full={false}
              value={insertMode}
              options={[
                { value: "inside", label: tr("Inside"), title: tr("Adds to the end of the selected box (or after it, if it can't contain elements)") },
                { value: "after", label: tr("After"), title: tr("Adds right after the selected element, at the same level") },
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
                data-tip={tr("Click to insert, or drag onto the canvas")}
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
          {tr("Components")}
          <InfoTip text={tr("Right-click an element and choose \"Create component\". Use components for parts shared across pages, like headers.")} />
        </div>
        {components.length === 0 && (
          <p className="hint" style={{ margin: 0 }}>{tr("None yet")}</p>
        )}
        {components.map((c) => (
          <div key={c.id} className="add-row comp-row">
            <button
              className="comp-insert"
              data-tip={
                editingComp ? tr("Insert at the end of the page (exits component editing)") : tr("Insert at the target")
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
              data-tip={tr("Edit main component")}
              onClick={() => setEditingComponent(c.id)}
            >
              <Pencil size={12} />
            </button>
            <button
              className="layer-act is-active"
              data-tip={tr("Delete (also deletes every instance)")}
              onClick={async () => {
                if (
                  await confirmDeletion(() => showConfirm(tr("Every instance of this component placed on pages will also be deleted."), {
                    title: tr("Delete component \"{name}\"?", { name: c.name }),
                    okLabel: tr("Delete"),
                    danger: true,
                  }))
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
