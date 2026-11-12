"use client";

/**
 * ページタブ（ページとフォルダの作成・並べ替え・設定）
 */

import { isEnterKey } from "../../lib/keys";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import type { PageFolder } from "../../lib/types";
import { useEditor } from "../../lib/store";
import { useDocumentConfirmation } from "../../lib/use-document-confirmation";
import { Icon } from "../icons";
import { ContextMenu, type CtxMenuItem } from "../NodeContextMenu";
import CopyToSiteModal from "../CopyToSite";
import { Dropdown } from "../controls";
import { showConfirm } from "../../lib/dialog";
import { tr } from "../../lib/i18n";
import { useDragAutoScroll } from "./drag";
import { storageKey } from "../../lib/storage-keys";

/* ============ ページ ============ */

const EMPTY_FOLDERS: PageFolder[] = [];
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

/** ドロップする位置（ページの前後 / フォルダの中・前後 / フォルダの外の末尾） */
type PageDrop =
  | { kind: "page"; id: string; after: boolean }
  | { kind: "folder"; id: string; pos: "before" | "inside" | "after" }
  | { kind: "loose" };

export function PagesTab() {
  const confirmDeletion = useDocumentConfirmation("page-deletion");
  const pages = useEditor((s) => s.doc.pages);
  const pageOrder = useEditor((s) => s.doc.pageOrder);
  const folders = useEditor((s) => s.doc.pageFolders ?? EMPTY_FOLDERS);
  const loadingScreen = useEditor((s) => s.doc.loadingScreen);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const addPage = useEditor((s) => s.addPage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const duplicatePages = useEditor((s) => s.duplicatePages);
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
  /** 複数選択したページ（フォルダへの整理や一括削除に使う。開いているページとは別） */
  const [picked, setPicked] = useState<string[]>([]);
  /** 選択モード（チェックボックスを表示する）。⌘/Shift+クリックでも選べる */
  const [picking, setPicking] = useState(false);
  /** Shift+クリックで範囲を選ぶときの起点 */
  const pickAnchor = useRef<string | null>(null);
  const [drop, setDrop] = useState<PageDrop | null>(null);
  const [closed, setClosed] = useState<Set<string>>(loadClosedFolders);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** ページの右クリックメニュー */
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null);
  /** 他のサイトへコピーするページ（ダイアログを開いている間） */
  const [copyIds, setCopyIds] = useState<string[] | null>(null);
  const autoScroll = useDragAutoScroll();

  const { loose, byFolder } = useMemo(() => {
    const loose: string[] = [];
    const byFolder = new Map<string, string[]>();
    for (const folder of folders) byFolder.set(folder.id, []);
    for (const id of pageOrder) {
      const folder = pages[id]?.folderId;
      const group = folder ? byFolder.get(folder) : undefined;
      (group ?? loose).push(id);
    }
    return { loose, byFolder };
  }, [folders, pageOrder, pages]);
  const folderOf = (id: string) => {
    const folder = pages[id]?.folderId;
    return folder && byFolder.has(folder) ? folder : null;
  };
  const loadingPage =
    loadingScreen?.enabled && loadingScreen.pageId ? pages[loadingScreen.pageId] : null;

  const toggleFolder = (id: string, open?: boolean) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (open ?? next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(FOLDERS_CLOSED_KEY, JSON.stringify([...next]));
      } catch {
        // 保存できなくても、開閉はできる
      }
      return next;
    });

  // 開いているページを含むフォルダは開いておく（ページを選んだのに見えない、とならないように）
  const activeFolder = pages[activePageId]?.folderId;
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
      if (livePicked.length > 1 && pickedIds.has(drag.id)) {
        if (drop.kind === "page") {
          if (pickedIds.has(drop.id)) return;
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
    // フォルダの並べ替え（フォルダの行の前後にだけドロップできる）
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
  const livePicked = useMemo(() => {
    if (!picked.length) return picked;
    const ordered = new Set(pageOrder);
    return picked.filter((id) => pages[id] && ordered.has(id));
  }, [picked, pages, pageOrder]);
  const pickedIds = useMemo(() => new Set(livePicked), [livePicked]);
  const selecting = picking || livePicked.length > 0;
  const endPicking = () => {
    setPicked([]);
    setPicking(false);
    pickAnchor.current = null;
  };

  /** 行のクリック: ⌘/Ctrl で1件ずつ、Shift で範囲を選ぶ。選択モード中は普通のクリックでも選ぶ */
  const clickPage = (e: React.MouseEvent, id: string) => {
    const toggle = e.metaKey || e.ctrlKey || (selecting && !e.shiftKey);
    if (e.shiftKey) {
      // 閉じたフォルダの中も含め、一覧の表示順に範囲選択する。
      const visibleOrder = loose.concat(Array.from(byFolder.values()).flat());
      const from = pickAnchor.current ?? activePageId;
      const a = visibleOrder.indexOf(from);
      const b = visibleOrder.indexOf(id);
      const range = a < 0 || b < 0 ? [id] : visibleOrder.slice(Math.min(a, b), Math.max(a, b) + 1);
      setPicked((prev) => [...new Set([...prev.filter((p) => pages[p]), ...range])]);
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
    const all = ids.length >= pageOrder.length;
    if (
      !(await confirmDeletion(() => showConfirm(
        all
          ? tr("A site needs at least one page, so the first page is kept. All elements on the other pages are deleted too (Undo brings them back).")
          : tr("All elements on the page will be deleted too (you can undo this)."),
        {
          title: tr("Delete {n} pages?", { n: all ? ids.length - 1 : ids.length }),
          okLabel: tr("Delete"),
          danger: true,
        }
      )))
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

  /** 右クリックしたページの操作。選んでいるページの上で開いたときは、選んでいるすべてのページに適用する */
  const pageMenuItems = (id: string): CtxMenuItem[] => {
    const ids = livePicked.length > 1 && pickedIds.has(id) ? livePicked : [id];
    const many = ids.length > 1;
    const allUnpublished = ids.every((x) => pages[x]?.unpublished);
    const close = () => setCtx(null);
    const run = (fn: () => void) => () => {
      close();
      fn();
    };
    return [
      ...(many
        ? []
        : [
            { key: "open", label: tr("Open"), icon: <FileInput size={14} />, onClick: run(() => openPage(id)) },
            "sep" as const,
          ]),
      {
        key: "dup",
        label: many ? tr("Duplicate {n} pages", { n: ids.length }) : tr("Duplicate"),
        icon: <CopyPlus size={14} />,
        onClick: run(() => duplicatePages(ids)),
      },
      {
        key: "copy-site",
        label: many ? tr("Copy {n} pages to another site…", { n: ids.length }) : tr("Copy to another site…"),
        icon: <Send size={14} />,
        onClick: run(() => setCopyIds(ids)),
      },
      "sep",
      {
        key: "publish",
        label: allUnpublished ? tr("Publish", "publish_variant_1") : tr("Unpublish (draft)"),
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
              label: tr("Select"),
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
        label: many ? tr("Delete {n} pages", { n: ids.length }) : tr("Delete"),
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: pageOrder.length <= 1,
        onClick: run(async () => {
          const all = ids.length >= pageOrder.length;
          if (
            await confirmDeletion(() => showConfirm(
              all
                ? tr("A site needs at least one page, so the first page is kept. All elements on the other pages are deleted too (Undo brings them back).")
                : tr("All elements on the page will be deleted too (you can undo this)."),
              {
                title: many
                  ? tr("Delete {n} pages?", { n: all ? ids.length - 1 : ids.length })
                  : tr("Delete page \"{name}\"?", { name: pages[id]?.name ?? "" }),
                okLabel: tr("Delete"),
                danger: true,
              }
            ))
          ) {
            deletePages(ids);
            if (many) endPicking();
          }
        }),
      },
    ];
  };

  const pageRow = (id: string, nested: boolean) => {
    const p = pages[id];
    const over = drop?.kind === "page" && drop.id === id && drag?.kind === "page" && drag.id !== id;
    return (
      <div
        key={id}
        className={`page-row${id === activePageId ? " is-on" : ""}${
          p.unpublished ? " is-unpublished" : ""
        }${
          drag?.kind === "page" && (drag.id === id || (pickedIds.has(drag.id) && pickedIds.has(id)))
            ? " is-dragging"
            : ""
        }${nested ? " is-nested" : ""}${pickedIds.has(id) ? " is-picked" : ""}`}
        aria-selected={selecting ? pickedIds.has(id) : undefined}
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
            checked={pickedIds.has(id)}
            aria-label={tr("Select \"{name}\"", { name: p.name })}
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
            data-tip={tr("Duplicate")}
            onClick={(e) => {
              e.stopPropagation();
              duplicatePage(id);
            }}
          >
            <Icon name="copy" size={12} />
          </button>
          {pageOrder.length > 1 && (
            <button
              className="row-act is-danger"
              data-tip={tr("Delete")}
              onClick={async (e) => {
                e.stopPropagation();
                if (
                  await confirmDeletion(() => showConfirm(tr("All elements on the page will be deleted too (you can undo this)."), {
                    title: tr("Delete page \"{name}\"?", { name: p.name }),
                    okLabel: tr("Delete"),
                    danger: true,
                  }))
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
            data-tip={p.unpublished ? tr("Publish", "publish_variant_1") : tr("Unpublish (draft)")}
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
          <button className="icon-btn" aria-label={tr("Stop selecting")} data-tip={tr("Stop selecting (Esc)")} onClick={endPicking}>
            <X size={14} />
          </button>
          <span className="pages-count">{tr("{n} selected", { n: livePicked.length })}</span>
          <div className="pages-bulk-acts">
            <Dropdown
              value=""
              trigger={<FolderInput size={14} />}
              title={tr("Move to folder")}
              menuWidth={200}
              options={[
                { value: "__loose__", label: tr("Outside folders"), icon: <Icon name="page" size={13} /> },
                ...folders.map((f) => ({ value: f.id, label: f.name, icon: <Folder size={13} /> })),
                { value: "__new__", label: tr("New folder", "new_folder_variant_1"), icon: <FolderPlus size={13} /> },
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
              title={tr("Publish / unpublish")}
              menuWidth={190}
              options={[
                { value: "on", label: tr("Publish", "publish_variant_1"), icon: <Icon name="eye" size={13} /> },
                { value: "off", label: tr("Unpublish (draft)"), icon: <Icon name="eyeOff" size={13} /> },
              ]}
              onChange={(v) => bulkPublish(v === "on")}
            />
            <button
              className="icon-btn"
              aria-label={tr("Copy the selected pages to another site")}
              data-tip={tr("Copy the selected pages to another site")}
              disabled={!livePicked.length}
              onClick={() => setCopyIds(livePicked)}
            >
              <Send size={13} />
            </button>
            <button
              className="icon-btn is-danger"
              aria-label={tr("Delete selected pages")}
              data-tip={tr("Delete selected pages")}
              disabled={!livePicked.length}
              onClick={() => void bulkDelete()}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        </div>
      ) : (
      <div className="pages-toolbar">
        <span className="pages-count">{pageOrder.length}{tr("Pages")}</span>
        <button
          className="icon-btn"
          aria-label={tr("Select pages")}
          data-tip={tr("Select several pages to move to a folder or delete together (⌘-click and Shift-click work too)")}
          onClick={() => setPicking(true)}
        >
          <ListChecks size={14} />
        </button>
        <button
          className="icon-btn"
          data-tutorial="add-folder-button"
          aria-label={tr("New folder")}
          data-tip={tr("New folder (for organizing pages; doesn't affect URLs)")}
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
          {tr("Add page")}
        </button>
      </div>
      )}
      <div
        className={`panel-body${drop?.kind === "loose" && drag?.kind === "page" ? " is-file-over" : ""}`}
        onDragOverCapture={(e) => {
          if (drag) autoScroll(e);
        }}
        onDragOver={(e) => {
          // 行の外（一覧の下の空いた領域）= フォルダの外の末尾
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
                {tr("Loading screen")}
              </span>
            </div>
          )}
          {loose.map((id) => pageRow(id, false))}
          {folders.map((f) => {
            const pages = byFolder.get(f.id)!;
            const isClosed = closed.has(f.id);
            const target = drop?.kind === "folder" && drop.id === f.id ? drop.pos : null;
            const hasActive = isClosed && activeFolder === f.id && pages.includes(activePageId);
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
                      title={tr("Double-click to rename")}
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
                      data-tip={tr("Add a page to this folder")}
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
                      data-tip={tr("Rename")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(f.id);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="row-act is-danger"
                      data-tip={tr("Delete folder (its pages move out of the folder)")}
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
                      <div className="folder-empty">{tr("Drag pages here")}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {ctx && pages[ctx.id] && (
        <ContextMenu x={ctx.x} y={ctx.y} items={pageMenuItems(ctx.id)} onClose={() => setCtx(null)} />
      )}
      {copyIds && <CopyToSiteModal pageIds={copyIds} onClose={() => setCopyIds(null)} />}
    </div>
  );
}
