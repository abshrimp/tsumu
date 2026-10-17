"use client";

/**
 * ページタブ（ページ・フォルダの作成・並べ替え・設定）
 */

import { isEnterKey } from "../../lib/keys";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Folder,
  FolderOpen,
  FolderInput,
  FolderPlus,
  ListChecks,
  Pencil,
  Send,
  Trash2,
  X,
  CopyPlus,
  Eye,
  EyeOff,
  FileInput,
} from "lucide-react";
import { useEditor } from "../../lib/store";
import { Icon } from "../icons";
import { ContextMenu, type CtxMenuItem } from "../NodeContextMenu";
import CopyToSiteModal from "../CopyToSite";
import { Dropdown } from "../controls";
import { showConfirm } from "../../lib/dialog";
import { tr } from "../../lib/i18n";
import { useDragAutoScroll } from "./drag";
import { storageKey } from "../../lib/storage-keys";

/* ============ ページ ============ */

/** 閉じているフォルダ（ブラウザごとに覚える。ほかの編集者の表示には影響しない） */
const FOLDERS_CLOSED_KEY = storageKey("page-folders-closed-v1");

function loadClosedFolders(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FOLDERS_CLOSED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

/** ページ一覧のドラッグ中の状態 */
type PageDrag =
  | { kind: "page"; id: string }
  | { kind: "folder"; id: string };

/** 落とす位置（ページの前後 / フォルダの中・前後 / フォルダの外の末尾） */
type PageDrop =
  | { kind: "page"; id: string; after: boolean }
  | { kind: "folder"; id: string; pos: "before" | "inside" | "after" }
  | { kind: "loose" };

export function PagesTab() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const addPage = useEditor((s) => s.addPage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const updatePage = useEditor((s) => s.updatePage);
  const placePage = useEditor((s) => s.placePage);
  const addPageFolder = useEditor((s) => s.addPageFolder);
  const renamePageFolder = useEditor((s) => s.renamePageFolder);
  const deletePageFolder = useEditor((s) => s.deletePageFolder);
  const moveFolder = useEditor((s) => s.moveFolder);
  const deletePages = useEditor((s) => s.deletePages);
  const movePagesToFolder = useEditor((s) => s.movePagesToFolder);
  const updateDoc = useEditor((s) => s.updateDoc);
  const select = useEditor((s) => s.select);
  const [drag, setDrag] = useState<PageDrag | null>(null);
  /** 複数選択したページ（フォルダへの整理・一括削除用。開いているページとは別） */
  const [picked, setPicked] = useState<string[]>([]);
  /** 選択モード（チェックボックスを出す）。⌘/Shift+クリックでも選べる */
  const [picking, setPicking] = useState(false);
  /** Shift+クリックで範囲を選ぶときの起点 */
  const pickAnchor = useRef<string | null>(null);
  const [drop, setDrop] = useState<PageDrop | null>(null);
  const [closed, setClosed] = useState<Set<string>>(loadClosedFolders);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** ページの右クリックメニュー */
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null);
  /** ほかのサイトへコピーするページ（ダイアログを開いている間） */
  const [copyIds, setCopyIds] = useState<string[] | null>(null);
  const autoScroll = useDragAutoScroll();

  const folders = doc.pageFolders ?? [];
  const folderIds = new Set(folders.map((f) => f.id));
  const folderOf = (pageId: string) => {
    const f = doc.pages[pageId]?.folderId;
    return f && folderIds.has(f) ? f : null;
  };
  const loose = doc.pageOrder.filter((id) => !folderOf(id));
  const inFolder = (folderId: string) => doc.pageOrder.filter((id) => folderOf(id) === folderId);
  const loadingPage =
    doc.loadingScreen?.enabled && doc.loadingScreen.pageId
      ? doc.pages[doc.loadingScreen.pageId]
      : null;

  const toggleFolder = (id: string, open?: boolean) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (open ?? next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(FOLDERS_CLOSED_KEY, JSON.stringify([...next]));
      } catch {
        // 保存できなくても開閉はできる
      }
      return next;
    });

  // 開いているページを含むフォルダは開いておく（ページを選んだのに見えない、とならないように）
  const activeFolder = doc.pages[activePageId]?.folderId;
  useEffect(() => {
    if (activeFolder && closed.has(activeFolder)) toggleFolder(activeFolder, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder]);

  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  const applyDrop = () => {
    if (!drag || !drop) return;
    if (drag.kind === "page") {
      // 選んでいるページをつかんだら、選んだページをまとめて動かす
      if (livePicked.length > 1 && livePicked.includes(drag.id)) {
        if (drop.kind === "page") {
          if (livePicked.includes(drop.id)) return;
          movePagesToFolder(livePicked, folderOf(drop.id), drop.after ? { after: drop.id } : { before: drop.id });
        } else if (drop.kind === "folder") {
          movePagesToFolder(livePicked, drop.id);
          toggleFolder(drop.id, true);
        } else {
          movePagesToFolder(livePicked, null);
        }
        return;
      }
      if (drop.kind === "page") {
        if (drop.id === drag.id) return;
        placePage(drag.id, folderOf(drop.id), drop.after ? { after: drop.id } : { before: drop.id });
      } else if (drop.kind === "folder") {
        placePage(drag.id, drop.id);
        toggleFolder(drop.id, true);
      } else {
        placePage(drag.id, null);
      }
      return;
    }
    // フォルダの並べ替え（フォルダの行の前後にだけ落とせる）
    if (drop.kind === "folder" && drop.pos !== "inside" && drop.id !== drag.id) {
      const index = folders.findIndex((f) => f.id === drop.id) + (drop.pos === "after" ? 1 : 0);
      moveFolder(drag.id, index);
    }
  };

  const openPage = (id: string) => {
    setActivePage(id);
    select(null);
  };

  // 消えたページは選択から外す（ほかの人の削除・元に戻すなど）
  const livePicked = picked.filter((id) => doc.pages[id] && doc.pageOrder.includes(id));
  const selecting = picking || livePicked.length > 0;
  const endPicking = () => {
    setPicked([]);
    setPicking(false);
    pickAnchor.current = null;
  };

  // 画面に並んでいる順（閉じたフォルダの中も含む。範囲選択に使う）
  const visibleOrder = [...loose, ...folders.flatMap((f) => inFolder(f.id))];

  /** 行のクリック: ⌘/Ctrl で1件ずつ、Shift で範囲を選ぶ。選択モード中は普通のクリックでも選ぶ */
  const clickPage = (e: React.MouseEvent, id: string) => {
    const toggle = e.metaKey || e.ctrlKey || (selecting && !e.shiftKey);
    if (e.shiftKey) {
      const from = pickAnchor.current ?? activePageId;
      const a = visibleOrder.indexOf(from);
      const b = visibleOrder.indexOf(id);
      const range = a < 0 || b < 0 ? [id] : visibleOrder.slice(Math.min(a, b), Math.max(a, b) + 1);
      setPicked((prev) => [...new Set([...prev.filter((p) => doc.pages[p]), ...range])]);
      pickAnchor.current ??= from;
      return;
    }
    if (toggle) {
      setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
      pickAnchor.current = id;
      return;
    }
    openPage(id);
  };

  // Esc で選択を解除する
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop, .dd-menu")) endPicking();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  const bulkDelete = async () => {
    const ids = livePicked;
    if (!ids.length) return;
    const all = ids.length >= doc.pageOrder.length;
    if (
      !(await showConfirm(
        all
          ? tr("ページを0にはできないため、先頭の1ページは残します。ほかのページの要素もすべて削除されます（「元に戻す」で戻せます）。")
          : tr("ページの要素もすべて削除されます（「元に戻す」で戻せます）。"),
        {
          title: tr("{n}ページを削除しますか？", { n: all ? ids.length - 1 : ids.length }),
          okLabel: tr("削除"),
          danger: true,
        }
      ))
    ) {
      return;
    }
    deletePages(ids);
    endPicking();
  };

  const bulkPublish = (publish: boolean) =>
    updateDoc((d) => {
      for (const id of livePicked) {
        const p = d.pages[id];
        if (!p) continue;
        if (publish) delete p.unpublished;
        else p.unpublished = true;
      }
    });

  /** 右クリックしたページの操作。選んでいるページの上で開いたときは、選んでいるページすべてに効く */
  const pageMenuItems = (id: string): CtxMenuItem[] => {
    const ids = livePicked.length > 1 && livePicked.includes(id) ? livePicked : [id];
    const many = ids.length > 1;
    const allUnpublished = ids.every((x) => doc.pages[x]?.unpublished);
    const close = () => setCtx(null);
    const run = (fn: () => void) => () => {
      close();
      fn();
    };
    return [
      ...(many
        ? []
        : [
            { key: "open", label: tr("開く"), icon: <FileInput size={14} />, onClick: run(() => openPage(id)) },
            "sep" as const,
          ]),
      {
        key: "dup",
        label: many ? tr("{n}ページを複製", { n: ids.length }) : tr("複製"),
        icon: <CopyPlus size={14} />,
        onClick: run(() => {
          // 下から複製すると、それぞれの複製が元のすぐ後ろに並ぶ
          for (const x of [...ids].reverse()) duplicatePage(x);
        }),
      },
      {
        key: "copy-site",
        label: many ? tr("{n}ページをほかのサイトへコピー…", { n: ids.length }) : tr("ほかのサイトへコピー…"),
        icon: <Send size={14} />,
        onClick: run(() => setCopyIds(ids)),
      },
      "sep",
      {
        key: "publish",
        label: allUnpublished ? tr("公開する") : tr("非公開にする（下書き）"),
        icon: allUnpublished ? <Eye size={14} /> : <EyeOff size={14} />,
        onClick: run(() =>
          updateDoc((d) => {
            for (const x of ids) {
              const pg = d.pages[x];
              if (!pg) continue;
              if (allUnpublished) delete pg.unpublished;
              else pg.unpublished = true;
            }
          })
        ),
      },
      ...(selecting
        ? []
        : [
            {
              key: "pick",
              label: tr("選択"),
              icon: <ListChecks size={14} />,
              onClick: run(() => {
                setPicked([id]);
                pickAnchor.current = id;
              }),
            },
          ]),
      "sep",
      {
        key: "del",
        label: many ? tr("{n}ページを削除", { n: ids.length }) : tr("削除"),
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: doc.pageOrder.length <= 1,
        onClick: run(async () => {
          const all = ids.length >= doc.pageOrder.length;
          if (
            await showConfirm(
              all
                ? tr("ページを0にはできないため、先頭の1ページは残します。ほかのページの要素もすべて削除されます（「元に戻す」で戻せます）。")
                : tr("ページの要素もすべて削除されます（「元に戻す」で戻せます）。"),
              {
                title: many
                  ? tr("{n}ページを削除しますか？", { n: all ? ids.length - 1 : ids.length })
                  : tr("ページ「{name}」を削除しますか？", { name: doc.pages[id]?.name ?? "" }),
                okLabel: tr("削除"),
                danger: true,
              }
            )
          ) {
            deletePages(ids);
            if (many) endPicking();
          }
        }),
      },
    ];
  };

  const pageRow = (id: string, nested: boolean) => {
    const p = doc.pages[id];
    const over = drop?.kind === "page" && drop.id === id && drag?.kind === "page" && drag.id !== id;
    return (
      <div
        key={id}
        className={`page-row${id === activePageId ? " is-on" : ""}${
          p.unpublished ? " is-unpublished" : ""
        }${
          drag?.kind === "page" && (drag.id === id || (livePicked.includes(drag.id) && livePicked.includes(id)))
            ? " is-dragging"
            : ""
        }${nested ? " is-nested" : ""}${livePicked.includes(id) ? " is-picked" : ""}`}
        aria-selected={selecting ? livePicked.includes(id) : undefined}
        style={
          {
            position: "relative",
            "--acts": p.unpublished ? 1 : 0,
          } as CSSProperties
        }
        draggable
        onClick={(e) => clickPage(e, id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtx({ x: e.clientX, y: e.clientY, id });
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.stopPropagation();
          setDrag({ kind: "page", id });
        }}
        onDragOver={(e) => {
          if (drag?.kind !== "page") return;
          e.preventDefault();
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const after = e.clientY - r.top >= r.height / 2;
          if (drop?.kind !== "page" || drop.id !== id || drop.after !== after) {
            setDrop({ kind: "page", id, after });
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          applyDrop();
          endDrag();
        }}
        onDragEnd={endDrag}
      >
        {over && drop?.kind === "page" && (
          <div className="drop-line" style={drop.after ? { bottom: -1 } : { top: -1 }} />
        )}
        {selecting ? (
          <input
            type="checkbox"
            className="page-pick"
            checked={livePicked.includes(id)}
            aria-label={tr("「{name}」を選ぶ", { name: p.name })}
            onClick={(e) => e.stopPropagation()}
            onChange={() => {
              setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
              pickAnchor.current = id;
            }}
          />
        ) : (
          <Icon name="page" size={13} />
        )}
        <span
          className="page-label"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {p.name}{" "}
          <span className="page-slug">
            /{p.slug}
            {p.query ? `?${p.query}` : ""}
          </span>
        </span>
        <div className="row-acts">
          <button
            className="row-act"
            data-tip={tr("複製")}
            onClick={(e) => {
              e.stopPropagation();
              duplicatePage(id);
            }}
          >
            <Icon name="copy" size={12} />
          </button>
          {doc.pageOrder.length > 1 && (
            <button
              className="row-act is-danger"
              data-tip={tr("削除")}
              onClick={async (e) => {
                e.stopPropagation();
                if (
                  await showConfirm(tr("ページの要素もすべて削除されます（「元に戻す」で戻せます）。"), {
                    title: tr("ページ「{name}」を削除しますか？", { name: p.name }),
                    okLabel: tr("削除"),
                    danger: true,
                  })
                ) {
                  deletePage(id);
                }
              }}
            >
              <Icon name="trash" size={12} />
            </button>
          )}
          <button
            className={`row-act${p.unpublished ? " is-on" : ""}`}
            data-tip={p.unpublished ? tr("公開する") : tr("非公開にする（下書き）")}
            onClick={(e) => {
              e.stopPropagation();
              updatePage(id, { unpublished: !p.unpublished });
            }}
          >
            <Icon name={p.unpublished ? "eyeOff" : "eye"} size={12} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`pages-tab${selecting ? " is-selecting" : ""}`} data-tutorial="pages-panel">
      {/* 追加ボタンは一覧の長さに関係なく常に見えるよう、スクロールしない上部に置く */}
      {selecting ? (
        <div className="pages-toolbar is-bulk">
          <button className="icon-btn" aria-label={tr("選択をやめる")} data-tip={tr("選択をやめる（Esc）")} onClick={endPicking}>
            <X size={14} />
          </button>
          <span className="pages-count">{tr("{n}件を選択", { n: livePicked.length })}</span>
          <div className="pages-bulk-acts">
            <Dropdown
              value=""
              trigger={<FolderInput size={14} />}
              title={tr("フォルダへ移動")}
              menuWidth={200}
              options={[
                { value: "__loose__", label: tr("フォルダの外"), icon: <Icon name="page" size={13} /> },
                ...folders.map((f) => ({ value: f.id, label: f.name, icon: <Folder size={13} /> })),
                { value: "__new__", label: tr("新しいフォルダ"), icon: <FolderPlus size={13} /> },
              ]}
              onChange={(v) => {
                if (!livePicked.length) return;
                if (v === "__new__") {
                  const id = addPageFolder();
                  movePagesToFolder(livePicked, id);
                  setRenaming(id);
                } else {
                  movePagesToFolder(livePicked, v === "__loose__" ? null : v);
                  if (v !== "__loose__") toggleFolder(v, true);
                }
              }}
            />
            <Dropdown
              value=""
              trigger={<Icon name="eye" size={13} />}
              title={tr("公開・非公開")}
              menuWidth={190}
              options={[
                { value: "on", label: tr("公開する"), icon: <Icon name="eye" size={13} /> },
                { value: "off", label: tr("非公開にする（下書き）"), icon: <Icon name="eyeOff" size={13} /> },
              ]}
              onChange={(v) => bulkPublish(v === "on")}
            />
            <button
              className="icon-btn"
              aria-label={tr("選んだページをほかのサイトへコピー")}
              data-tip={tr("選んだページをほかのサイトへコピー")}
              disabled={!livePicked.length}
              onClick={() => setCopyIds(livePicked)}
            >
              <Send size={13} />
            </button>
            <button
              className="icon-btn is-danger"
              aria-label={tr("選んだページを削除")}
              data-tip={tr("選んだページを削除")}
              disabled={!livePicked.length}
              onClick={() => void bulkDelete()}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        </div>
      ) : (
      <div className="pages-toolbar">
        <span className="pages-count">{doc.pageOrder.length}{tr("ページ")}</span>
        <button
          className="icon-btn"
          aria-label={tr("ページを選ぶ")}
          data-tip={tr("複数のページを選んで、まとめてフォルダへ移動・削除します（⌘クリック・Shiftクリックでも選べます）")}
          onClick={() => setPicking(true)}
        >
          <ListChecks size={14} />
        </button>
        <button
          className="icon-btn"
          data-tutorial="add-folder-button"
          aria-label={tr("フォルダを作る")}
          data-tip={tr("フォルダを作る（ページの整理用。URLには影響しません）")}
          onClick={() => {
            const id = addPageFolder();
            setRenaming(id);
          }}
        >
          <FolderPlus size={14} />
        </button>
        <button
          className="btn btn-sm"
          data-tutorial="add-page-button"
          onClick={() => addPage()}
        >
          <Icon name="plus" size={12} />
          {tr("ページを追加")}
        </button>
      </div>
      )}
      <div
        className={`panel-body${drop?.kind === "loose" && drag?.kind === "page" ? " is-file-over" : ""}`}
        onDragOverCapture={(e) => {
          if (drag) autoScroll(e);
        }}
        onDragOver={(e) => {
          // 行の外（一覧の下の空き）= フォルダの外の末尾
          if (drag?.kind !== "page") return;
          e.preventDefault();
          if (drop?.kind !== "loose") setDrop({ kind: "loose" });
        }}
        onDrop={(e) => {
          e.preventDefault();
          applyDrop();
          endDrag();
        }}
      >
        <div style={{ padding: "4px 0 40px" }}>
          {loadingPage && (
            <div
              className={`page-row${loadingPage.id === activePageId ? " is-on" : ""}`}
              onClick={() => openPage(loadingPage.id)}
            >
              <Icon name="loader" size={13} />
              <span className="page-label" style={{ flex: 1 }}>
                {tr("ローディング画面")}
              </span>
            </div>
          )}
          {loose.map((id) => pageRow(id, false))}
          {folders.map((f) => {
            const pages = inFolder(f.id);
            const isClosed = closed.has(f.id);
            const target = drop?.kind === "folder" && drop.id === f.id ? drop.pos : null;
            const hasActive = pages.includes(activePageId);
            return (
              <div key={f.id} className="page-folder">
                <div
                  className={`page-row folder-row${target === "inside" ? " drop-inside" : ""}${
                    drag?.kind === "folder" && drag.id === f.id ? " is-dragging" : ""
                  }${isClosed && hasActive ? " has-active" : ""}`}
                  style={{ position: "relative", "--acts": 0 } as CSSProperties}
                  draggable={renaming !== f.id}
                  onClick={() => toggleFolder(f.id)}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDrag({ kind: "folder", id: f.id });
                  }}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    const y = (e.clientY - r.top) / r.height;
                    // ページはフォルダの中へ、フォルダはフォルダの前後へ
                    const pos: "before" | "inside" | "after" =
                      drag.kind === "page" ? "inside" : y < 0.5 ? "before" : "after";
                    if (drop?.kind !== "folder" || drop.id !== f.id || drop.pos !== pos) {
                      setDrop({ kind: "folder", id: f.id, pos });
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    applyDrop();
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                >
                  {target === "before" && <div className="drop-line" style={{ top: -1 }} />}
                  {target === "after" && <div className="drop-line" style={{ bottom: -1 }} />}
                  <span className="layer-caret">
                    <Icon
                      name="chevron"
                      size={11}
                      style={{
                        transform: isClosed ? "none" : "rotate(90deg)",
                        transition: "transform 120ms",
                      }}
                    />
                  </span>
                  {isClosed ? <Folder size={13} /> : <FolderOpen size={13} />}
                  {renaming === f.id ? (
                    <input
                      className="folder-rename"
                      autoFocus
                      defaultValue={f.name}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        renamePageFolder(f.id, e.target.value);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <span
                      className="page-label folder-name"
                      title={tr("ダブルクリックで名前を変更")}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenaming(f.id);
                      }}
                    >
                      {f.name}
                    </span>
                  )}
                  <span className="folder-count">{pages.length}</span>
                  <div className="row-acts">
                    <button
                      className="row-act"
                      data-tip={tr("このフォルダにページを追加")}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFolder(f.id, true);
                        addPage(f.id);
                      }}
                    >
                      <Icon name="plus" size={12} />
                    </button>
                    <button
                      className="row-act"
                      data-tip={tr("名前を変更")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(f.id);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="row-act is-danger"
                      data-tip={tr("フォルダを削除（中のページはフォルダの外へ出ます）")}
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePageFolder(f.id);
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
                {!isClosed && (
                  <div className="folder-pages">
                    {pages.map((id) => pageRow(id, true))}
                    {!pages.length && (
                      <div className="folder-empty">{tr("ページをここへドラッグして入れられます")}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {ctx && doc.pages[ctx.id] && (
        <ContextMenu x={ctx.x} y={ctx.y} items={pageMenuItems(ctx.id)} onClose={() => setCtx(null)} />
      )}
      {copyIds && <CopyToSiteModal pageIds={copyIds} onClose={() => setCopyIds(null)} />}
    </div>
  );
}
