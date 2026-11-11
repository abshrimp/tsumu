"use client";

/**
 * レイヤー（要素の階層）タブ
 */

import { isEnterKey } from "../../lib/keys";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LoaderCircle, Pencil } from "lucide-react";
import { ancestorsOf, collectSubtreeIds, useEditor } from "../../lib/store";
import { BODY_NODE_ID } from "../../lib/types";
import { canContainElements, resolveTag } from "../../lib/tags";
import { useImageDrop } from "../../lib/image-drop";
import { Icon } from "../icons";
import { BP_INFO, BP_ORDER, hideToggleLabel, isHiddenAt } from "../../lib/style";
import NodeContextMenu, { type CtxMenuState } from "../NodeContextMenu";
import { tr } from "../../lib/i18n";
import {
  NO_DRAG,
  isFileDrag,
  layerDropPoint,
  layerIndent,
  useDragAutoScroll,
  type DragState,
  type DropPos,
} from "./drag";
import { storageKey } from "../../lib/storage-keys";
import { layerWindow, LAYER_ROW_HEIGHT, visibleLayerRows } from "../../lib/layers-visible";

function LayerRow({
  id,
  depth,
  isTop,
  visibleIds,
  drag,
  setDrag,
  collapsed,
  toggleCollapsed,
}: {
  id: string;
  depth: number;
  isTop: boolean;
  /** Complete visual order, including rows outside the mounted window. */
  visibleIds: readonly string[];
  drag: DragState;
  setDrag: (d: DragState) => void;
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (id: string) => void;
}) {
  const doc = useEditor((s) => s.doc);
  const selectedIds = useEditor((s) => s.selectedIds);
  const select = useEditor((s) => s.select);
  const toggleSelection = useEditor((s) => s.toggleSelection);
  const selectMany = useEditor((s) => s.selectMany);
  const updateNode = useEditor((s) => s.updateNode);
  const moveNodes = useEditor((s) => s.moveNodes);
  const breakpoint = useEditor((s) => s.breakpoint);
  const toggleHiddenHere = useEditor((s) => s.toggleHiddenHere);
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<CtxMenuState | null>(null);

  const node = doc.nodes[id];
  if (!node) return null;

  const hiddenHere = isHiddenAt(node, breakpoint);
  // 表示中のデバイスでは見えているが、別のデバイスでは隠れている
  const hiddenElsewhere = hiddenHere
    ? []
    : BP_ORDER.filter((b) => isHiddenAt(node, b));

  const tag = resolveTag(node, isTop);
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(id);
  const isOver = drag.overId === id;
  const isDragging = drag.dragIds.includes(id);

  const handleDrop = () => {
    const { dragIds, pos } = drag;
    if (!dragIds.length || !pos || drag.blockedIds.has(id)) return;
    const point = layerDropPoint(doc, id, pos);
    if (point) moveNodes(dragIds, point.parent, point.index);
  };

  return (
    <>
      <div
        className={`layer-row${selectedIds.includes(id) ? " is-sel" : ""}${
          hiddenHere ? " is-hidden" : ""
        }${isDragging ? " is-dragging" : ""}${
          isOver && drag.pos === "inside" ? " drop-inside" : ""
        }`}
        data-layer={id}
        data-tutorial={selectedIds.includes(id) ? "layer-selected" : undefined}
        style={
          {
            paddingLeft: layerIndent(depth),
            // ホバー外でも見せるボタンの分だけ右余白を確保（左のロックがオンなら2つ分）
            "--acts": node.locked ? 2 : hiddenHere || hiddenElsewhere.length ? 1 : 0,
          } as CSSProperties
        }
        draggable={!renaming && !node.locked}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            toggleSelection(id);
            return;
          }
          // Shift: 主選択からクリックした行まで、表示中の行を範囲選択
          const anchor = useEditor.getState().selection;
          // Virtualization only mounts nearby rows: select across the full visible
          // hierarchy, including rows currently outside the viewport.
          const rows = e.shiftKey ? visibleIds : [];
          const from = anchor ? rows.indexOf(anchor) : -1;
          const to = rows.indexOf(id);
          if (from < 0 || to < 0) {
            select(id);
            return;
          }
          const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1);
          selectMany(range, anchor!);
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          // 複数選択中の要素をつかんだら、選択中の要素をまとめて動かす
          // ロック中の要素は動かさない
          const dragIds =
            selectedIds.length > 1 && selectedIds.includes(id)
              ? selectedIds.filter((x) => x !== BODY_NODE_ID && doc.nodes[x] && !doc.nodes[x].locked)
              : [id];
          setDrag({
            dragIds,
            blockedIds: collectSubtreeIds(doc, dragIds),
            overId: null,
            pos: null,
          });
        }}
        onDragOver={(e) => {
          const files = isFileDrag(e);
          if (!files && (!drag.dragIds.length || drag.blockedIds.has(id))) return;
          e.preventDefault();
          if (files) e.dataTransfer.dropEffect = "copy";
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const y = (e.clientY - r.top) / r.height;
          // 中へ入れられるのはコンテナとして出力されるボックスのみ（キャンバスと同条件）
          let pos: DropPos =
            canContainElements(node)
              ? y < 0.3
                ? "before"
                : y > 0.7
                  ? "after"
                  : "inside"
              : y < 0.5
                ? "before"
                : "after";
          // 展開中のコンテナの下端は、見た目どおり先頭の子の前に入れる
          if (pos === "after" && hasChildren && !isCollapsed) pos = "start";
          if (drag.overId !== id || drag.pos !== pos || drag.files !== files) {
            setDrag({ ...drag, overId: id, pos, files });
          }
        }}
        onDrop={(e) => {
          // ファイルはパネル側でアップロードして、この行の位置へ挿入する
          if (isFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          handleDrop();
          setDrag(NO_DRAG);
        }}
        onDragEnd={() => setDrag(NO_DRAG)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selectedIds.includes(id)) select(id);
          setMenu({ x: e.clientX, y: e.clientY, nodeId: id });
        }}
      >
        {/* 線の左端 = 入る階層の字下げ位置 */}
        {isOver && drag.pos === "before" && (
          <div className="drop-line" style={{ top: -1, left: layerIndent(depth) }} />
        )}
        {isOver && drag.pos === "after" && (
          <div className="drop-line" style={{ bottom: -1, left: layerIndent(depth) }} />
        )}
        {isOver && drag.pos === "start" && (
          <div
            className="drop-line"
            style={{ bottom: -1, left: layerIndent(depth + 1) }}
          />
        )}
        <span
          className="layer-caret"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleCollapsed(id);
          }}
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
        >
          <Icon
            name="chevron"
            size={11}
            style={{
              transform: isCollapsed ? "none" : "rotate(90deg)",
              transition: "transform 120ms",
            }}
          />
        </span>
        <span className="layer-name" onDoubleClick={() => setRenaming(true)}>
          {renaming ? (
            <input
              autoFocus
              defaultValue={node.name}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                updateNode(id, { name: e.target.value.trim() || node.name });
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            node.name
          )}
        </span>
        <span className="layer-tag">{tag}</span>
        {/* 操作ボタンは行の右端に固定した枠へ重ねて置く。
            ホバーで出ても名前やタグを押し出さず、ボタン同士の位置も変わらない */}
        <div className="row-acts">
          <button
            className={`row-act${node.locked ? " is-on" : ""}`}
            data-tip={node.locked ? tr("ロック解除") : tr("ロック")}
            onClick={(e) => {
              e.stopPropagation();
              updateNode(id, { locked: !node.locked });
            }}
          >
            <Icon name={node.locked ? "lock" : "unlock"} size={12} />
          </button>
          <button
            className={`row-act${
              hiddenHere ? " is-on" : hiddenElsewhere.length ? " is-partial" : ""
            }`}
            data-tip={
              hiddenElsewhere.length
                ? tr("{p1}では非表示 ― クリックで{p2}", { p1: hiddenElsewhere.map((b) => BP_INFO[b].label).join(tr("・")), p2: hideToggleLabel(false, breakpoint) })
                : hideToggleLabel(hiddenHere, breakpoint)
            }
            onClick={(e) => {
              e.stopPropagation();
              toggleHiddenHere(id);
            }}
          >
            {/* 別デバイスでだけ非表示のときは、普段は薄い目閉じを出し、行ホバーで操作用の目に切り替える */}
            <Icon
              name={hiddenHere || hiddenElsewhere.length ? "eyeOff" : "eye"}
              size={12}
              className="row-act-idle"
            />
            {hiddenElsewhere.length > 0 && (
              <Icon name="eye" size={12} className="row-act-hover" />
            )}
          </button>
        </div>
      </div>
      {menu && (
        <NodeContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          extra={[
            {
              key: "rename",
              label: tr("名前を変更"),
              icon: <Pencil size={14} />,
              onClick: () => {
                setMenu(null);
                setRenaming(true);
              },
            },
            ...(hasChildren
              ? [
                  {
                    key: "fold",
                    label: isCollapsed ? tr("展開") : tr("折りたたむ"),
                    icon: (
                      <Icon
                        name="chevron"
                        size={13}
                        style={{ transform: isCollapsed ? "rotate(90deg)" : "none" }}
                      />
                    ),
                    onClick: () => {
                      setMenu(null);
                      toggleCollapsed(id);
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}

export function LayersTab() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const moveNodes = useEditor((s) => s.moveNodes);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const [drag, setDrag] = useState<DragState>(NO_DRAG);
  const { uploading, dropFiles } = useImageDrop();
  const autoScroll = useDragAutoScroll();
  // 折りたたみはページ（編集中のコンポーネント）ごとに覚えておく。
  // タブを切り替えてこのパネルが作り直されても、閉じた状態のまま戻る
  const collapseKey = editingComponentId ? `c:${editingComponentId}` : activePageId;
  const [collapsedState, setCollapsedState] = useState(() => ({
    key: collapseKey,
    set: loadCollapsed(collapseKey),
  }));
  const collapsed =
    collapsedState.key === collapseKey ? collapsedState.set : loadCollapsed(collapseKey);
  // 更新関数は React が2回呼ぶことがあるため、副作用（保存）は持たせない
  const setCollapsed = (fn: (prev: Set<string>) => Set<string>) =>
    setCollapsedState((st) => {
      const prev = st.key === collapseKey ? st.set : loadCollapsed(collapseKey);
      const next = fn(prev);
      return next === prev && st.key === collapseKey ? st : { key: collapseKey, set: next };
    });
  useEffect(() => {
    if (loadCollapsed(collapsedState.key) !== collapsedState.set) {
      saveCollapsed(collapsedState.key, collapsedState.set);
    }
  }, [collapsedState]);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const editingComp = editingComponentId ? doc.components?.[editingComponentId] : null;
  const rootIds = editingComp
    ? [editingComp.rootId]
    : (doc.pages[activePageId]?.children ?? []);
  const page = doc.pages[activePageId];

  const visibleLayers = useMemo(
    () => visibleLayerRows(
      doc,
      editingComponentId || !collapsed.has(BODY_NODE_ID) ? rootIds : [],
      collapsed,
      editingComp ? 0 : 1,
      !editingComp,
    ),
    // rootIds and editingComp are derived from these document and UI values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, activePageId, editingComponentId, collapsed]
  );
  const visibleIds = useMemo(() => visibleLayers.map((row) => row.id), [visibleLayers]);
  const [windowRange, setWindowRange] = useState({ start: 0, end: 48 });
  const editingMaster = !!editingComp;

  // The outer panel owns scrolling. Account for the body row and any headers
  // before converting its scrollTop to a row index.
  const updateViewport = useCallback(() => {
    const panel = panelRef.current;
    const list = listRef.current;
    if (!panel || !list) return;
    const listTop = list.getBoundingClientRect().top -
      panel.getBoundingClientRect().top + panel.scrollTop + 6 +
      (editingMaster ? 0 : LAYER_ROW_HEIGHT);
    const next = layerWindow(visibleLayers.length, panel.scrollTop - listTop, panel.clientHeight);
    setWindowRange((prev) =>
      prev.start === next.start && prev.end === next.end ? prev : next);
  }, [editingMaster, visibleLayers.length]);

  useLayoutEffect(() => {
    updateViewport();
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(updateViewport);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [updateViewport, uploading]);

  const scrolledSelection = useRef<string | null>(revealedSelection);
  useLayoutEffect(() => {
    if (!selection || scrolledSelection.current === selection) return;
    const index = visibleIds.indexOf(selection);
    const panel = panelRef.current;
    const list = listRef.current;
    if (index < 0 || !panel || !list) return;
    const listTop = list.getBoundingClientRect().top -
      panel.getBoundingClientRect().top + panel.scrollTop + 6 +
      (editingMaster ? 0 : LAYER_ROW_HEIGHT);
    const rowTop = listTop + index * LAYER_ROW_HEIGHT;
    const rowBottom = rowTop + LAYER_ROW_HEIGHT;
    if (rowTop < panel.scrollTop) panel.scrollTop = rowTop;
    else if (rowBottom > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = rowBottom - panel.clientHeight;
    }
    scrolledSelection.current = selection;
    updateViewport();
  }, [selection, visibleIds, editingMaster, updateViewport]);

  // 要素を選択したら、折りたたまれた祖先を展開して行が見える位置までスクロールする
  //（パネルを開き直しただけのときは、同じ選択でもう一度展開しない）
  useEffect(() => {
    if (!selection) return;
    if (revealedSelection === selection) return;
    revealedSelection = selection;
    const doc = useEditor.getState().doc;
    if (!doc.nodes[selection]) return;
    const hidden = [BODY_NODE_ID, ...ancestorsOf(doc, selection)];
    setCollapsed((prev) =>
      hidden.some((id) => prev.has(id))
        ? new Set([...prev].filter((id) => !hidden.includes(id)))
        : prev
    );
  }, [selection]);

  if (!page) return null;

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className={`panel-body${drag.files && !drag.overId ? " is-file-over" : ""}`}
      ref={panelRef}
      onScroll={updateViewport}
      data-tutorial="layers-panel"
      // 行は dragover を止めるので、パネルでは先に受け取ってスクロールする
      onDragOverCapture={(e) => {
        if (drag.dragIds.length || isFileDrag(e)) autoScroll(e);
      }}
      onDragOver={(e) => {
        if (isFileDrag(e)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!drag.files || drag.overId) setDrag({ ...NO_DRAG, files: true });
          return;
        }
        if (!drag.dragIds.length) return;
        e.preventDefault();
        // 落とせる行の外（空き領域・動かしている行の上）では挿入線を消す
        if (drag.overId) setDrag({ ...drag, overId: null, pos: null });
      }}
      onDragLeave={(e) => {
        if (drag.files && !e.currentTarget.contains(e.relatedTarget as Node)) {
          setDrag(NO_DRAG);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (isFileDrag(e)) {
          // 行の上 = その位置へ、空き領域 = 末尾へ
          const point =
            (drag.overId && drag.pos && layerDropPoint(doc, drag.overId, drag.pos)) ||
            (editingComp
              ? { parent: { kind: "node" as const, id: editingComp.rootId } }
              : { parent: { kind: "page" as const, id: activePageId } });
          setDrag(NO_DRAG);
          void dropFiles(e.dataTransfer.files, point);
          return;
        }
        // 空き領域へのドロップ = ページ直下の末尾へ
        if (drag.dragIds.length && !drag.overId && !editingComp) {
          moveNodes(
            drag.dragIds,
            { kind: "page", id: activePageId },
            page.children.length
          );
        }
        setDrag(NO_DRAG);
      }}
    >
      {editingComp && (
        <div className="hint" style={{ padding: "8px 12px 0" }}>
          {tr("コンポーネント「{name}」を編集中", { name: editingComp.name })}
        </div>
      )}
      {uploading && (
        <div className="hint layer-uploading">
          <LoaderCircle size={13} className="spin" />
          {tr("アップロード中…")}
        </div>
      )}
      <div ref={listRef} style={{ padding: "6px 0 40px" }}>
        {!editingComp && (
          <div
            className={`layer-row${selection === BODY_NODE_ID ? " is-sel" : ""}`}
            style={{ paddingLeft: 8 }}
            onClick={() => select(BODY_NODE_ID)}
          >
            <span
              className="layer-caret"
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapsed(BODY_NODE_ID);
              }}
            >
              <Icon
                name="chevron"
                size={11}
                style={{
                  transform: collapsed.has(BODY_NODE_ID) ? "none" : "rotate(90deg)",
                  transition: "transform 120ms",
                }}
              />
            </span>
            <span className="layer-name">body</span>
            <span className="layer-tag">body</span>
          </div>
        )}
        {rootIds.length === 0 && !collapsed.has(BODY_NODE_ID) && (
          <div className="panel-empty">
            {tr("要素がありません。")}
            <br />
            {tr("「追加」タブから置けます。")}
          </div>
        )}
        {visibleLayers.length > 0 && (
          <>
            <div aria-hidden="true" style={{ height: windowRange.start * LAYER_ROW_HEIGHT }} />
            {visibleLayers.slice(windowRange.start, windowRange.end).map((row) => (
              <LayerRow
                key={row.id}
                id={row.id}
                depth={row.depth}
                isTop={row.isTop}
                visibleIds={visibleIds}
                drag={drag}
                setDrag={setDrag}
                collapsed={collapsed}
                toggleCollapsed={toggleCollapsed}
              />
            ))}
            <div aria-hidden="true" style={{
              height: Math.max(0, visibleLayers.length - windowRange.end) * LAYER_ROW_HEIGHT,
            }} />
          </>
        )}
      </div>
    </div>
  );
}

/* ============ レイヤーの折りたたみ（ページごとに保存） ============ */

const COLLAPSED_KEY = storageKey("collapsed-v1");
const collapsedCache = new Map<string, Set<string>>();
/** 最後に「祖先を展開して見せた」選択（パネルを開き直したときに再展開しない） */
let revealedSelection: string | null = null;

function loadCollapsed(key: string): Set<string> {
  const hit = collapsedCache.get(key);
  if (hit) return hit;
  let set = new Set<string>();
  try {
    const all = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "{}") as Record<string, string[]>;
    if (Array.isArray(all[key])) set = new Set(all[key]);
  } catch {
    // 読めなければ全部開いた状態
  }
  collapsedCache.set(key, set);
  return set;
}

function saveCollapsed(key: string, set: Set<string>) {
  collapsedCache.set(key, set);
  try {
    const all = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "{}") as Record<string, string[]>;
    if (set.size) all[key] = [...set];
    else delete all[key];
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(all));
  } catch {
    // 保存できなくても折りたたみ自体は動く
  }
}
