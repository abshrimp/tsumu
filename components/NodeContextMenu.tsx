"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpLeft,
  ClipboardPaste,
  Component,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  FolderSearch,
  LayoutList,
  Lock,
  LockOpen,
  PackageOpen,
  Pencil,
  Scissors,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { assetSrc } from "../lib/assets";
import { componentOf, findParentOf, useEditor } from "../lib/store";
import type { DocNode, SiteDoc } from "../lib/types";
import { hideToggleLabel, isHiddenAt } from "../lib/style";
import { glyphs } from "./Glyph";
import { tr } from "../lib/i18n";
import { readClipMirror } from "../lib/clip-transfer";

/* ---------- 要素の右クリックメニュー（キャンバス・レイヤー共通） ---------- */

/** 画像・動画・音声の要素が使っているアセット（assetId が無ければ src が同じもの） */
function assetIdOf(doc: SiteDoc, node: DocNode): string | null {
  const ref = node.image ?? node.media;
  if (!ref) return null;
  if (ref.assetId && doc.assets[ref.assetId]) return ref.assetId;
  if (!ref.src) return null;
  return Object.values(doc.assets).find((a) => assetSrc(a) === ref.src)?.id ?? null;
}

export interface CtxMenuState {
  x: number;
  y: number;
  nodeId: string | null;
}

export type CtxMenuItem =
  | {
      key: string;
      label: string;
      icon: React.ReactNode;
      kbd?: string;
      danger?: boolean;
      disabled?: boolean;
      onClick: () => void;
    }
  | "sep";

export default function NodeContextMenu({
  menu,
  onClose,
  extra,
}: {
  menu: CtxMenuState;
  onClose: () => void;
  /** 先頭に追加する項目（レイヤーの「名前を変更」など） */
  extra?: CtxMenuItem[];
}) {
  const doc = useEditor((s) => s.doc);
  const clipboard = useEditor((s) => s.clipboard);
  // 最後にコピーした要素（ほかのサイト・タブでコピーしたものも含む。アセットなどを添えた控え）
  const copied = useMemo(() => readClipMirror(), []);
  const breakpoint = useEditor((s) => s.breakpoint);

  const node = menu.nodeId ? doc.nodes[menu.nodeId] : null;
  const hiddenHere = !!node && isHiddenAt(node, breakpoint);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const s = () => useEditor.getState();

  const items: CtxMenuItem[] = [];

  if (extra?.length) items.push(...extra, "sep");

  if (node) {
    if (node.type === "instance" && node.componentId) {
      const cid = node.componentId;
      items.push(
        {
          key: "edit-comp",
          label: tr("コンポーネントを編集"),
          icon: <Pencil size={14} />,
          onClick: run(() => s().setEditingComponent(cid)),
        },
        {
          key: "detach",
          label: tr("インスタンスを解除"),
          icon: <PackageOpen size={14} />,
          onClick: run(() => s().detachInstance(node.id)),
        },
        "sep"
      );
    } else if (node.type === "box" && !componentOf(doc, node.id)) {
      items.push(
        {
          key: "make-comp",
          label: tr("コンポーネント化"),
          icon: <Component size={14} />,
          onClick: run(() => s().createComponent(node.id)),
        },
        {
          key: "make-list",
          label: tr("リスト化"),
          icon: <LayoutList size={14} />,
          onClick: run(() => s().createList(node.id)),
        },
        "sep"
      );
    }
    const assetId = assetIdOf(doc, node);
    if (assetId) {
      items.push(
        {
          key: "reveal-asset",
          label: tr("アセットを表示"),
          icon: <FolderSearch size={14} />,
          onClick: run(() => s().revealAsset(assetId)),
        },
        "sep"
      );
    }
    if (node.type === "box" && node.children.length === 0) {
      items.push(
        {
          key: "edit",
          label: tr("テキストを編集"),
          icon: <TextCursorInput size={14} />,
          kbd: "Enter",
          onClick: run(() => s().setEditingText(node.id)),
        },
        "sep"
      );
    }
    items.push(
      {
        key: "copy",
        label: tr("コピー"),
        icon: <Copy size={14} />,
        kbd: "⌘C",
        onClick: run(() => s().copyNode(node.id)),
      },
      {
        key: "cut",
        label: tr("切り取り"),
        icon: <Scissors size={14} />,
        kbd: "⌘X",
        // ロック中の要素は消せない（コピーだけされて残るのを防ぐ）
        disabled: !!node.locked,
        onClick: run(() => {
          const st = s();
          st.copyNode(node.id);
          st.deleteNodes(
            st.selectedIds.length > 1 && st.selectedIds.includes(node.id) ? st.selectedIds : [node.id]
          );
        }),
      },
      {
        key: "dup",
        label: tr("複製"),
        icon: <CopyPlus size={14} />,
        kbd: "⌘D",
        onClick: run(() => {
          const st = s();
          st.duplicateNodes(
            st.selectedIds.length > 1 && st.selectedIds.includes(node.id) ? st.selectedIds : [node.id]
          );
        }),
      }
    );
  }

  if (clipboard || copied) {
    items.push({
      key: "paste",
      label: tr("貼り付け"),
      icon: <ClipboardPaste size={14} />,
      kbd: "⌘V",
      onClick: run(() => s().pasteClipboard(copied ?? undefined)),
    });
  }

  if (node) {
    const parent = findParentOf(doc, node.id);
    const siblings = parent
      ? parent.kind === "page"
        ? doc.pages[parent.id]?.children ?? []
        : doc.nodes[parent.id]?.children ?? []
      : [];
    const idx = siblings.indexOf(node.id);
    items.push("sep");
    if (parent) {
      items.push(
        {
          key: "up",
          label: tr("前へ移動"),
          icon: <ArrowUp size={14} />,
          disabled: idx <= 0,
          onClick: run(() => s().moveNode(node.id, parent, idx - 1)),
        },
        {
          key: "down",
          label: tr("後ろへ移動"),
          icon: <ArrowDown size={14} />,
          disabled: idx < 0 || idx >= siblings.length - 1,
          // moveNode の index は移動前の並びでの位置
          onClick: run(() => s().moveNode(node.id, parent, idx + 2)),
        }
      );
    }
    if (parent?.kind === "node") {
      items.push({
        key: "parent",
        label: tr("親を選択"),
        icon: <ArrowUpLeft size={14} />,
        kbd: "⇧Enter",
        onClick: run(() => s().select(parent.id)),
      });
    }
    items.push(
      "sep",
      {
        key: "hide",
        label: hideToggleLabel(hiddenHere, breakpoint),
        icon: hiddenHere ? <Eye size={14} /> : <EyeOff size={14} />,
        onClick: run(() => s().toggleHiddenHere(node.id)),
      },
      {
        key: "lock",
        label: node.locked ? tr("ロック解除") : tr("ロック"),
        icon: node.locked ? <LockOpen size={14} /> : <Lock size={14} />,
        onClick: run(() => s().updateNode(node.id, { locked: !node.locked })),
      },
      "sep",
      {
        key: "del",
        label: node.locked ? tr("削除（ロック中）") : tr("削除"),
        icon: <Trash2 size={14} />,
        kbd: "Del",
        danger: true,
        disabled: !!node.locked,
        // 複数選んでいる要素の上で開いたときは、選んでいる要素をまとめて消す
        onClick: run(() => {
          const st = s();
          st.deleteNodes(
            st.selectedIds.length > 1 && st.selectedIds.includes(node.id) ? st.selectedIds : [node.id]
          );
        }),
      }
    );
  }

  return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />;
}

/** 右クリックメニューの見た目と閉じ方（要素・ページ一覧で共通。画面からはみ出さないよう位置を直す） */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: CtxMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onClose, { once: true });
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // 画面からはみ出さないよう、実寸を測って位置を調整
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top =
      y + r.height > window.innerHeight - 8
        ? Math.max(8, y - r.height)
        : y;
    setPos({ left, top });
  }, [x, y]);

  // 先頭・末尾・連続の区切り線を除く
  const cleaned = items.filter(
    (it, i, arr) =>
      it !== "sep" || (i > 0 && i < arr.length - 1 && arr[i - 1] !== "sep")
  );
  if (!cleaned.some((it) => it !== "sep")) return null;

  // 親に transform があっても画面の位置に出るよう、body の直下に描く
  return createPortal(
    <div
      ref={ref}
      className="dd-menu ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      {cleaned.map((it, i) =>
        it === "sep" ? (
          <div key={`sep-${i}`} className="ctx-sep" />
        ) : (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            className={`dd-item${it.danger ? " is-danger" : ""}`}
            onClick={it.onClick}
          >
            <span className="dd-icon">{it.icon}</span>
            <span className="dd-col">{it.label}</span>
            {it.kbd && <span className="ctx-kbd">{glyphs(it.kbd)}</span>}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
