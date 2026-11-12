"use client";

import { assetUsage } from "../../lib/asset-usage";
export { assetUsage } from "../../lib/asset-usage";

import { cssUsesAssetUrl } from "@/lib/css-assets";

/**
 * アセットタブ（画像などの一覧・アップロード・使用量）
 */

import { ASSET_WINDOW_THRESHOLD, assetWindow } from "../../lib/asset-window";
import { assetDisplayKind, assetExtensionLabel, isVisualAsset, type AssetDisplayKind } from "../../lib/asset-display";
import { isEnterKey } from "../../lib/keys";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CloudUpload,
  Download,
  File as FileGeneric,
  FileArchive,
  FileCode,
  FileJson,
  FileText,
  FileType,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { insertPointFor, useEditor, type ParentRef } from "../../lib/store";
import { type Asset, type SiteDoc } from "../../lib/types";
import { currentSiteId, siteApi } from "../../lib/site";
import { otherBrowserDocs } from "../../lib/browser-doc-storage";
import {
  ASSET_DRAG_TYPE,
  assetKind,
  assetSrc,
  deleteRemoteAssetFiles,
  downloadAsset,
  nodeAssetSrc,
  replaceEmbeddedAsset,
  removePageAssetBackgrounds,
  uploadAsset,
  uploadStaticAsset,
  uploadEmbeddedAsset,
} from "../../lib/assets";
import { makeImage, makeMedia } from "../../lib/presets";
import { Icon } from "../icons";
import { userMessage } from "../../lib/errors";
import { showConfirm } from "../../lib/dialog";
import { tr } from "../../lib/i18n";
import { serverStatusSnapshot, useServerStatus, type AssetDeletion } from "../../lib/status";
import { computeStorageUsage, type StorageUsageResponse } from "../../lib/storage-usage";

/* ============ アセット ============ */

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** メディア以外のファイルは、壊れた画像としてではなく、見分けの付くファイルとして表示する。 */
function StaticAssetThumb({ asset, kind }: { asset: Asset; kind: AssetDisplayKind }) {
  const FileIcon = kind === "css" || kind === "javascript" ? FileCode
    : kind === "json" ? FileJson
    : kind === "font" ? FileType
    : kind === "document" ? FileText
    : kind === "archive" ? FileArchive : FileGeneric;
  return (
    <span className="asset-static-preview">
      <FileIcon size={25} strokeWidth={1.5} aria-hidden="true" />
      <span className="asset-static-extension">{assetExtensionLabel(asset)}</span>
    </span>
  );
}

function staticAssetLabel(kind: AssetDisplayKind): string {
  switch (kind) {
    case "css": return "CSS";
    case "javascript": return "JavaScript";
    case "font": return tr("Font");
    case "json": return "JSON";
    case "document": return tr("Document");
    case "archive": return tr("Archive");
    case "file": return tr("File");
    case "video": return tr("Video");
    case "audio": return tr("Audio");
    default: return tr("Image");
  }
}

const STATIC_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", mp4: "video/mp4",
  webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  css: "text/css", js: "text/javascript", mjs: "text/javascript",
  cjs: "text/javascript", json: "application/json", map: "application/json",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  eot: "application/vnd.ms-fontobject", pdf: "application/pdf",
  txt: "text/plain", html: "text/html", htm: "text/html",
  md: "text/markdown", xml: "application/xml", csv: "text/csv",
};

/** 使用量の元データを取得する（サーバーで数えられなければ、このブラウザに保存している他のサイトから数える） */
async function fetchStorageUsage(): Promise<StorageUsageResponse> {
  try {
    const res = await fetch(siteApi("/api/assets"));
    if (res.ok) return (await res.json()) as StorageUsageResponse;
  } catch {
    // 下のブラウザ内の保存から数える
  }
  const others = new Map<string, number | null>();
  for (const raw of await otherBrowserDocs(currentSiteId()).catch(() => [])) {
    try {
      const doc = JSON.parse(raw) as Pick<SiteDoc, "assets">;
      for (const a of Object.values(doc.assets ?? {})) {
        if (a.path) others.set(a.path, a.bytes ?? others.get(a.path) ?? null);
      }
    } catch {
      // 壊れた保存は数えない
    }
  }
  return { others: [...others].map(([path, bytes]) => ({ path, bytes })) };
}

/** 保存先（KV）があるときだけ使用量を表示する（無ければアセットはサイトの中に保存され、KV の容量は使わない） */
function StorageUsage() {
  const status = useServerStatus();
  return status?.assets ? <StorageUsageMeter deletion={status.assetDeletion ?? null} /> : null;
}

/**
 * サーバーに保存したアセットの使用量。保存先（KV）は全サイト共通のため、全サイトの合計を表示する。
 * Cloudflare では KV に置いたファイルの台帳（D1）から数えるため、削除待ちのファイルも含めて
 * KV の実際の使用量と一致する（台帳が揃うまでは、サイトが使っているファイルだけを数える）。
 */
function StorageUsageMeter({ deletion }: { deletion: AssetDeletion | null }) {
  const doc = useEditor((s) => s.doc);
  const [response, setResponse] = useState<StorageUsageResponse | null>(null);
  const own = Object.values(doc.assets).filter((a) => a.path);
  // 台帳はアップロードや削除で変わるため、このサイトのファイルが変わったら取得し直す（続けて変わった場合はまとめる）
  const ownKey = own.map((a) => a.path).sort().join("\n");
  const exact = !!response?.ledger?.complete;
  const loaded = response !== null;
  useEffect(() => {
    // 台帳が揃っていないときは、このサイトの分を編集中の内容から足すため、取得し直さない
    if (loaded && !exact) return;
    let alive = true;
    const timer = setTimeout(() => {
      void fetchStorageUsage().then((r) => {
        if (alive) setResponse(r);
      });
    }, loaded ? 1000 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownKey]);
  const usage = computeStorageUsage(response, own);
  /** Workers KV の無料枠（有料プランでも 1GB までは料金に含まれ、超えた分は従量課金） */
  const limit = 1024 * 1024 * 1024;
  const pct = Math.min(100, (usage.bytes / limit) * 100);
  const lines = [
    usage.exact
      ? tr("All sites: {files} files stored on the server{p2}", {
          files: usage.files,
          p2: usage.unknown ? tr(" ({unknown} with unknown size)", { unknown: usage.unknown }) : "",
        })
      : tr("All sites: {length} assets stored on the server ({own} in this site){p2}", {
          length: usage.files,
          own: own.length,
          p2: usage.unknown ? tr(" ({unknown} with unknown size)", { unknown: usage.unknown }) : "",
        }),
  ];
  if (usage.pendingCount && deletion?.mode === "scheduled") {
    lines.push(tr("{count} of them ({size}) are scheduled for deletion and will be removed from the server {days} days after they were deleted.", {
      count: usage.pendingCount, size: formatBytes(usage.pendingBytes), days: deletion.days,
    }));
  } else if (usage.pendingCount && deletion?.mode === "kept") {
    lines.push(tr("{count} deleted assets ({size}) remain on the server.", {
      count: usage.pendingCount, size: formatBytes(usage.pendingBytes),
    }));
  }
  if (response?.ledger && !usage.exact) {
    lines.push(tr("Until the weekly server-wide check finishes, only the files that sites use are counted."));
  }
  lines.push(tr("1 GB is the Workers KV free allowance. On a paid plan, storage beyond that is billed by usage."));
  return (
    <div className="storage-usage" data-tip={lines.join("\n")}>
      <div className="storage-bar">
        <div
          className="storage-fill"
          style={{
            width: `${Math.max(1, pct)}%`,
            background: pct > 90 ? "var(--danger)" : undefined,
          }}
        />
      </div>
      <span className="hint">
        {tr("Usage (all sites)")} {formatBytes(usage.bytes)} / {tr("{size} free", { size: formatBytes(limit) })}
      </span>
    </div>
  );
}

/** 連続した編集とアップロードを同じ取り消し単位に混ぜない。履歴や移行元が変わった場合は、待つのをやめる。 */
async function waitForAssetGesture(current: () => boolean) {
  while (current() && useEditor.getState().gestureActive) {
    await new Promise<void>((resolve) => {
      const unsubscribe = useEditor.subscribe(() => {
        if (current() && useEditor.getState().gestureActive) return;
        unsubscribe();
        resolve();
      });
    });
  }
}

/** アセット一覧のスクロール位置（他のタブを開いて戻ってきても保つ） */
let assetScrollTop = 0;

/** ID が同じでも、確認している間にファイルや ZIP の内容が差し替わったものは削除しない。 */
function sameAssetFile(current: Asset | undefined, approved: Asset): boolean {
  return !!current && current.id === approved.id && current.path === approved.path &&
    current.dataUrl === approved.dataUrl && JSON.stringify(current.zip) === JSON.stringify(approved.zip);
}

/**
 * 削除の確認で伝える、サーバーに保存したファイルの扱い。
 * Cloudflare はすぐには消さず、GC が days 日後に消す（ASSET_GC_ENABLED が無ければ消さない）。
 */
function serverFileNotice(deletion: AssetDeletion | null | undefined, several: boolean): string {
  if (deletion?.mode === "scheduled") {
    return tr("The file stored on the server will be deleted in {days} days. It is kept if you undo before then or if another site uses it.", { days: deletion.days });
  }
  if (deletion?.mode === "kept") return tr("The file stored on the server is kept, not deleted.");
  return several
    ? tr("The server permanently deletes files that no other saved site uses.")
    : tr("The server deletes this file if no other saved site uses it.");
}

/** 別の ID で残るアセットの保存先は消さず、同じファイルを二重に削除しない。 */
function deleteRemovedAssetFiles(removed: Asset[]) {
  const retained = new Set(Object.values(useEditor.getState().doc.assets).map((a) => a.path));
  const paths: string[] = [];
  for (const asset of removed) {
    if (!asset.path || retained.has(asset.path)) continue;
    retained.add(asset.path);
    paths.push(asset.path);
  }
  void deleteRemoteAssetFiles(paths);
}

export function AssetsTab() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const selection = useEditor((s) => s.selection);
  const updateDoc = useEditor((s) => s.updateDoc);
  const insertNodes = useEditor((s) => s.insertNodes);
  const updateNode = useEditor((s) => s.updateNode);
  const setLeftTab = useEditor((s) => s.setLeftTab);
  const [uploadCount, setUploadCount] = useState(0);
  const busy = uploadCount > 0;
  const errorRevision = useRef(0);
  const uploadMounted = useRef(false);
  useLayoutEffect(() => {
    uploadMounted.current = true;
    return () => { uploadMounted.current = false; };
  }, []);

  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const [viewport, setViewport] = useState({ width: 260, height: 600, top: assetScrollTop });
  const [focusedAsset, setFocusedAsset] = useState<string | null>(null);
  const [draggedAsset, setDraggedAsset] = useState<string | null>(null);
  const focusRequest = useRef<{ id: string; last: boolean } | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setViewport((v) => {
      const width = list.clientWidth || v.width;
      const height = list.clientHeight || v.height;
      return width === v.width && height === v.height ? v : { ...v, width, height };
    });
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(list);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    if (listRef.current) listRef.current.scrollTop = assetScrollTop;
    return () => { mounted.current = false; };
  }, []);

  /** 別のサイトや文書への移動、履歴の操作、パネルを閉じた後には、古い確認の結果を反映しない。 */
  const removalScope = () => {
    const site = currentSiteId();
    const history = useEditor.getState().historyRevision;
    return () => mounted.current && currentSiteId() === site && useEditor.getState().historyRevision === history;
  };

  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  // 右クリックの「アセットを表示」: 検索を解除してそのアセットまでスクロールし、少しの間だけ目立たせる
  const revealAssetId = useEditor((s) => s.revealAssetId);
  const revealAsset = useEditor((s) => s.revealAsset);
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => {
    if (!revealAssetId) return;
    setQuery("");
    setRevealed(revealAssetId);
    revealAsset(null);
  }, [revealAssetId, revealAsset]);
  useEffect(() => {
    if (!revealed) return;
    const t = window.setTimeout(() => setRevealed(null), 1600);
    return () => window.clearTimeout(t);
  }, [revealed]);

  /** 名前を変える（空なら元のまま。拡張子が消えた場合は、元の拡張子を付け直す） */
  const renameAsset = (asset: Asset, raw: string) => {
    let name = raw.trim();
    if (!name || name === asset.name) return;
    const ext = /\.[A-Za-z0-9]+$/.exec(asset.name)?.[0];
    if (ext && !/\.[A-Za-z0-9]+$/.test(name)) name += ext;
    updateDoc((d) => {
      const a = d.assets[asset.id];
      if (a) a.name = name;
    });
  };

  // タブを閉じても、追加と移行は続ける。古い処理で、新しい処理の表示を上書きしない。
  const beginUpload = () => {
    const revision = ++errorRevision.current;
    const history = useEditor.getState().historyRevision;
    setUploadCount((count) => count + 1);
    setError(null);
    const historyChanged = () => useEditor.getState().historyRevision !== history;
    return {
      historyChanged,
      current: () => uploadMounted.current && errorRevision.current === revision && !historyChanged(),
      finish: () => { if (uploadMounted.current) setUploadCount((count) => count - 1); },
    };
  };

  const download = async (asset: Asset) => {
    const revision = ++errorRevision.current;
    const inScope = removalScope();
    const src = assetSrc(asset);
    setError(null);
    try {
      await downloadAsset(asset);
    } catch {
      const latest = useEditor.getState().doc.assets[asset.id];
      // 新しい操作、文書やファイルの差し替え、パネルを閉じた後には、古い失敗を表示しない。
      if (inScope() && errorRevision.current === revision && latest && assetSrc(latest) === src) {
        setError(tr("Could not download the asset."));
      }
    }
  };

  const assets = useMemo(() => Object.values(doc.assets), [doc.assets]);
  const usage = useMemo(() => assetUsage(doc), [doc]);
  const usedBy = (asset: Asset) => usage.get(asset.id) ?? 0;
  const unused = useMemo(() => assets.filter((a) => !usage.has(a.id)), [assets, usage]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => q ? assets.filter((a) => a.name.toLowerCase().includes(q)) : assets, [assets, q]);
  const windowed = shown.length > ASSET_WINDOW_THRESHOLD;
  const pinnedIndices = [focusedAsset, renaming, draggedAsset].map((id) => id ? shown.findIndex((a) => a.id === id) : -1);
  const layout = assetWindow(shown.length, viewport.width, viewport.height, viewport.top, pinnedIndices);
  const visible = windowed ? layout.indices.map((index) => ({ asset: shown[index], index }))
    : shown.map((asset, index) => ({ asset, index }));
  const scrollToAsset = (index: number, center = true) => {
    const list = listRef.current;
    if (!list) return;
    const rowTop = Math.floor(index / 2) * layout.rowHeight;
    const desired = center ? rowTop - (viewport.height - layout.rowHeight) / 2
      : rowTop < list.scrollTop ? rowTop : Math.max(list.scrollTop, rowTop + layout.rowHeight - viewport.height);
    const top = Math.max(0, Math.min(desired, layout.totalHeight - viewport.height));
    list.scrollTop = top;
    assetScrollTop = top;
    setViewport((v) => v.top === top ? v : { ...v, top });
  };
  useLayoutEffect(() => {
    // 検索・削除・パネルの幅の変更があっても、表示する範囲を実際の一覧の範囲に収める。
    const list = listRef.current;
    if (!list || !windowed) return;
    list.scrollTop = layout.top;
    assetScrollTop = layout.top;
  }, [windowed, layout.top, layout.totalHeight, viewport.width]);
  useLayoutEffect(() => {
    if (!revealed) return;
    const index = shown.findIndex((a) => a.id === revealed);
    if (index < 0) return;
    if (windowed) scrollToAsset(index);
    else listRef.current?.querySelector(`[data-asset-id="${CSS.escape(revealed)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [revealed, shown, windowed, layout.rowHeight]);
  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    const card = listRef.current?.querySelector(`[data-asset-id="${CSS.escape(request.id)}"]`);
    const controls = card?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)");
    const control = request.last ? controls?.[controls.length - 1] : controls?.[0];
    control?.focus({ preventScroll: true });
  }, [visible]);
  const changeQuery = (value: string) => {
    setQuery(value);
    if (listRef.current) listRef.current.scrollTop = 0;
    assetScrollTop = 0;
    setViewport((v) => v.top === 0 ? v : { ...v, top: 0 });
  };

  /** どこからも使われていないアセットをまとめて削除する */
  const removeUnused = async () => {
    if (!unused.length) return;
    const current = removalScope();
    if (
      !(await showConfirm(serverFileNotice(serverStatusSnapshot()?.assetDeletion, true), {
        title: tr("Delete {length} unused assets?", { length: unused.length }),
        okLabel: tr("Delete"),
        danger: true,
      }))
    ) {
      return;
    }
    if (!current()) return;
    const removed: Asset[] = [];
    updateDoc((d) => {
      // 確認待ちの共同編集の変更も含め、最新の文書で使用状況を調べ直す。削除するのは確認したものだけ。
      const usage = assetUsage(d);
      for (const a of unused) {
        if (usage.has(a.id) || !sameAssetFile(d.assets[a.id], a)) continue;
        delete d.assets[a.id];
        removed.push(a);
      }
    });
    deleteRemovedAssetFiles(removed);
  };

  const upload = async (files: FileList | File[]) => {
    const request = beginUpload();
    try {
      let fellBack = false;
      for (const file of Array.from(files)) {
        const type = assetDisplayKind({ name: file.name, mimeType: file.type });
        // HTML や XML の完全な文書は、静的なアセットの保存先ではなく、サイトの HTML の取り込みで扱う
        //（アップロードの API は、実行可能な文書を受け付けない）。
        if (/\.(?:html?|xml)$/i.test(file.name)) continue;
        if (!isVisualAsset({ name: file.name, mimeType: file.type }) &&
            !["css", "javascript", "font", "json", "document"].includes(type)) continue;
        const ext = file.name.split(".").at(-1)?.toLowerCase() ?? "";
        const mime = !file.type || file.type === "application/octet-stream"
          ? STATIC_MIME[ext] || file.type || "application/octet-stream" : file.type;
        const normalized = file.type === mime ? file : new File([file], file.name, { type: mime });
        const asset = isVisualAsset({ name: file.name, mimeType: mime })
          ? await uploadAsset(normalized) : await uploadStaticAsset(normalized);
        if (!asset.path) fellBack = true;
        await waitForAssetGesture(() => !request.historyChanged());
        // 元に戻す・やり直す操作や文書の置き換えの後も、アップロードが完了したファイルは残し、やり直せる編集は消さない。
        if (request.historyChanged()) useEditor.getState().retainUploadedAssets([asset]);
        else updateDoc((d) => void (d.assets[asset.id] = asset));
      }
      if (fellBack && request.current()) {
        setError(
          tr("Couldn't save to the server, so it was saved in this browser. Check the save status at the bottom of the screen.")
        );
      }
    } catch (e) {
      if (request.current()) setError(userMessage(e, tr("Couldn't upload")));
    } finally {
      request.finish();
    }
  };

  /** ブラウザ内（data URL）のアセットを、サーバーへ移す */
  const migrateAsset = async (asset: Asset) => {
    if (!asset.dataUrl) return;
    const request = beginUpload();
    const current = () => {
      const latest = useEditor.getState().doc.assets[asset.id];
      return !request.historyChanged() && latest?.dataUrl === asset.dataUrl && latest?.path === asset.path;
    };
    try {
      const path = await uploadEmbeddedAsset(asset);
      // 待っている間に履歴や同じ ID のファイルが変わったら、古い内容に戻さない。
      if (!current()) return;
      if (!path) {
        if (!request.current()) return;
        setError(
          tr("Can't save to the server yet. Check the save status at the bottom of the screen.")
        );
        return;
      }
      await waitForAssetGesture(current);
      if (!current()) return;
      // 使っている要素の src と、背景画像などのスタイルも差し替える
      updateDoc((d) => replaceEmbeddedAsset(d, asset.id, path));
    } catch (e) {
      if (request.current()) setError(userMessage(e, tr("Couldn't move it to the server")));
    } finally {
      request.finish();
    }
  };

  /** クリック: 選択中の要素が画像ならその画像を差し替え、そうでなければ新しく挿入する */
  const useAsset = (asset: Asset) => {
    const sel = selection ? doc.nodes[selection] : null;
    const kind = assetKind(asset);
    if (!isVisualAsset(asset)) {
      void download(asset);
      return;
    }
    // 何も選んでいなければ、編集中のコンポーネント（無ければページ）の末尾に入れる
    const editingComp = editingComponentId ? doc.components?.[editingComponentId] : null;
    const fallback: ParentRef = editingComp
      ? { kind: "node", id: editingComp.rootId }
      : { kind: "page", id: activePageId };
    if (kind === "image" && sel?.type === "image" && sel.image) {
      updateNode(sel.id, {
        image: {
          ...sel.image,
          src: nodeAssetSrc(asset),
          assetId: asset.id, assetSuffix: undefined,
          width: asset.width,
          height: asset.height,
        },
      });
      return;
    }
    if (kind !== "image" && sel?.type === "media" && sel.media?.kind === kind) {
      updateNode(sel.id, {
        media: { ...sel.media, src: nodeAssetSrc(asset), assetId: asset.id, assetSuffix: undefined, sources: undefined },
      });
      return;
    }
    if (kind !== "image") {
      const node = makeMedia(kind);
      node.name = asset.name;
      node.media = { ...node.media!, src: nodeAssetSrc(asset), assetId: asset.id, assetSuffix: undefined };
      const target = insertPointFor(doc, selection, fallback, useEditor.getState().insertMode);
      insertNodes([node], node.id, target.parent, target.index);
      setLeftTab("layers");
      return;
    }
    const node = makeImage();
    node.name = asset.name;
    node.image = {
      src: nodeAssetSrc(asset),
      alt: "",
      width: asset.width,
      height: asset.height,
      assetId: asset.id, assetSuffix: undefined,
    };
    const target = insertPointFor(doc, selection, fallback, useEditor.getState().insertMode);
    insertNodes([node], node.id, target.parent, target.index);
    setLeftTab("layers");
  };

  const removeAsset = async (asset: Asset) => {
    const used = usedBy(asset);
    const current = removalScope();
    const notice = asset.path ? serverFileNotice(serverStatusSnapshot()?.assetDeletion, false) : "";
    if (
      !(await showConfirm(
        used
          ? tr("Used in {used} places. It will also be removed from the elements that use it. ", { used }) + notice
          : notice,
        { title: tr("Delete \"{name}\"?", { name: asset.name }), okLabel: tr("Delete"), danger: true }
      ))
    ) {
      return;
    }
    if (!current() || !sameAssetFile(useEditor.getState().doc.assets[asset.id], asset)) return;
    // 未使用だと確認した後に使われ始めた場合、その参照を外すことまでは承認されていない。
    if (!used && assetUsage(useEditor.getState().doc).has(asset.id)) return;
    updateDoc((d) => {
      const src = assetSrc(asset);
      for (const node of Object.values(d.nodes)) {
        if (node.image?.assetId === asset.id) {
          node.image.assetId = undefined;
          node.image.assetSuffix = undefined;
          node.image.src = "";
        }
        if (node.media?.assetId === asset.id) {
          node.media.assetId = undefined;
          node.media.assetSuffix = undefined;
          node.media.src = "";
        }
        for (const source of node.media?.sources ?? []) {
          if (source.assetId === asset.id) {
            source.assetId = undefined;
            source.assetSuffix = undefined;
            source.src = "";
          }
        }
        if (src) {
          for (const bp of Object.values(node.styles)) {
            for (const styles of Object.values(bp)) {
              if (!styles) continue;
              for (const [prop, value] of Object.entries(styles)) {
                if (cssUsesAssetUrl(value, src)) delete styles[prop];
              }
            }
          }
        }
      }
      if (d.favicon?.assetId === asset.id) d.favicon = null;
      if (d.appleTouchIcon?.assetId === asset.id) d.appleTouchIcon = null;
      if (d.ogImage?.assetId === asset.id) d.ogImage = null;
      if (d.pwa?.icon?.assetId === asset.id) d.pwa.icon = null;
      for (const page of Object.values(d.pages)) {
        if (page.ogImage?.assetId === asset.id) page.ogImage = null;
      }
      removePageAssetBackgrounds(d, asset);
      delete d.assets[asset.id];
    });
    deleteRemovedAssetFiles([asset]);
  };

  return (
    <div
      className="asset-panel"
      data-tutorial="assets-panel"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer.files);
        }
      }}
    >
      <div className="asset-head">
        <div className="add-sec">
          <button
            className={`asset-drop${dragOver ? " is-over" : ""}`}
            data-tutorial="asset-upload"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ImagePlus size={16} />
            )}
            {busy ? tr("Uploading…") : tr("Add files (or drop them here)")}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*,audio/*,.css,.js,.mjs,.cjs,.json,.map,.woff,.woff2,.ttf,.otf,.eot,.pdf,.txt,.md,.csv"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
          {error && (
            <p
              className="hint"
              style={{ color: "var(--danger)", marginBottom: 0 }}
            >
              {error}
            </p>
          )}
        </div>

        {assets.length > 0 && (
          <div className="asset-tools">
            <label className="asset-search">
              <Search size={13} />
              <input
                type="search"
                placeholder={tr("Search assets")}
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") changeQuery("");
                }}
              />
              {query && (
                <button
                  type="button"
                  className="asset-search-clear"
                  aria-label={tr("Clear search")}
                  onClick={() => changeQuery("")}
                >
                  <X size={12} />
                </button>
              )}
            </label>
            <div className="asset-count">
              <span>
                {q ? tr("{length} / {length2}", { length: shown.length, length2: assets.length }) : tr("{length} items", { length: assets.length })}
                {unused.length > 0 && tr(" · {length} unused", { length: unused.length })}
              </span>
              {unused.length > 0 && (
                <button
                  type="button"
                  className="asset-clean"
                  onClick={removeUnused}
                  data-tip={tr("Delete assets not used in any page, site setting or style")}
                >
                  <Trash2 size={12} />
                  {tr("Delete unused")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div
        ref={listRef}
        className="panel-body"
        onScroll={(e) => {
          assetScrollTop = e.currentTarget.scrollTop;
          const top = assetScrollTop;
          setViewport((v) => v.top === top ? v : { ...v, top });
        }}
      >
        {assets.length === 0 ? (
          <div className="panel-empty">
            {tr("No assets yet.")}
            <br />
            {tr("Uploaded files will appear here.")}
          </div>
        ) : (
          shown.length === 0 ? (
            <div className="panel-empty">{tr("No assets match \"{p1}\"", { p1: query.trim() })}</div>
          ) : (
          <>
          {windowed && <span className="asset-focus-edge" role="group" tabIndex={pinnedIndices[0] >= 0 ? -1 : 0} aria-label={tr("Assets")}
            onFocus={() => {
              focusRequest.current = { id: shown[0].id, last: false };
              setFocusedAsset(shown[0].id);
              scrollToAsset(0, false);
            }} />}
          <div
            className={`asset-grid${windowed ? " is-windowed" : ""}`}
            role="list"
            style={windowed ? { height: layout.totalHeight } : undefined}
            onFocusCapture={(e) => {
              const card = (e.target as HTMLElement).closest<HTMLElement>("[data-asset-id]");
              setFocusedAsset(card?.dataset.assetId ?? null);
            }}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedAsset(null);
            }}
            onKeyDownCapture={(e) => {
              if (!windowed || e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
              const target = e.target as HTMLElement;
              const card = target.closest<HTMLElement>("[data-asset-id]");
              if (!card) return;
              const controls = card.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)");
              if (target !== (e.shiftKey ? controls[0] : controls[controls.length - 1])) return;
              const index = shown.findIndex((a) => a.id === card.dataset.assetId) + (e.shiftKey ? -1 : 1);
              if (index < 0 || index >= shown.length) return;
              // DOM にまだ無い隣のカードにも、Tab / Shift+Tab で順番に移動できるようにする。
              e.preventDefault();
              const id = shown[index].id;
              focusRequest.current = { id, last: e.shiftKey };
              setFocusedAsset(id);
              scrollToAsset(index, false);
            }}
          >
            {visible.map(({ asset, index }) => {
              const used = usedBy(asset);
              const kind = assetDisplayKind(asset);
              return (
                <div
                  key={asset.id}
                  className={`asset-card${revealed === asset.id ? " is-revealed" : ""}`}
                  data-asset-id={asset.id}
                  role="listitem"
                  aria-posinset={index + 1}
                  aria-setsize={shown.length}
                  style={windowed ? {
                    top: Math.floor(index / 2) * layout.rowHeight,
                    left: index % 2 ? "calc(50% + 5px)" : 12,
                  } : undefined}
                >
                <button
                  className={`asset-thumb${isVisualAsset(asset) ? "" : " is-static"}`}
                  aria-label={!isVisualAsset(asset) ? tr("Download file") + ": " + asset.name : undefined}
                  draggable={kind === "image"}
                  data-tip={
                    !isVisualAsset(asset) ? tr("Download file")
                      : selection && doc.nodes[selection]?.type === "image" && kind === "image"
                        ? tr("Apply to selected image")
                        : kind === "image" ? tr("Click to insert, or drag onto the canvas")
                        : tr("Insert into page")
                  }
                  onClick={() => useAsset(asset)}
                  onDragStart={(e) => {
                    if (kind !== "image") return;
                    e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
                    e.dataTransfer.effectAllowed = "copy";
                    setDraggedAsset(asset.id);
                  }}
                  onDragEnd={() => setDraggedAsset(null)}
                >
                  {kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetSrc(asset)}
                      alt={asset.name}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  ) : kind === "video" || kind === "audio" ? (
                    <Icon name={kind === "video" ? "video" : "audio"} size={24} />
                  ) : (
                    <StaticAssetThumb asset={asset} kind={kind} />
                  )}
                </button>
                <div className="asset-meta">
                  {renaming === asset.id ? (
                    <input
                      className="asset-rename"
                      autoFocus
                      defaultValue={asset.name}
                      onFocus={(e) => {
                        // 拡張子の手前までを選ぶ
                        const dot = e.target.value.lastIndexOf(".");
                        e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
                      }}
                      onBlur={(e) => {
                        renameAsset(asset, e.target.value);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                        if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") {
                          focusRequest.current = { id: asset.id, last: false };
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="asset-name"
                      title={tr("{name} (double-click to rename)", { name: asset.name })}
                      onDoubleClick={() => setRenaming(asset.id)}
                    >
                      {asset.name}
                    </span>
                  )}
                  <span className="asset-dim">
                    {kind === "image"
                      ? (asset.width && asset.height ? `${asset.width}×${asset.height}` : tr("Image"))
                      : staticAssetLabel(kind)}
                    {asset.bytes !== undefined && ` · ${formatBytes(asset.bytes)}`}
                    {used > 0 && tr(" · used in {used}", { used })}
                    {!asset.path && tr(" · this browser only")}
                  </span>
                </div>
                {!asset.path && (
                  <button
                    className="layer-act is-active asset-del"
                    style={{ right: 56 }}
                    data-tip={tr("Upload to server")}
                    aria-label={tr("Upload to server")}
                    disabled={busy}
                    onClick={() => void migrateAsset(asset)}
                  >
                    <CloudUpload size={12} />
                  </button>
                )}
                <button
                  className="layer-act is-active asset-del"
                  style={{ right: !asset.path ? 82 : 56 }}
                  data-tip={tr("Rename")}
                  aria-label={tr("Rename")}
                  onClick={() => setRenaming(asset.id)}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="layer-act is-active asset-del"
                  style={{ right: 30 }}
                  data-tip={tr("Download")}
                  aria-label={tr("Download")}
                  onClick={() => void download(asset)}
                >
                  <Download size={12} />
                </button>
                <button
                  className="layer-act is-active asset-del"
                  data-tip={tr("Delete")}
                  aria-label={tr("Delete")}
                  onClick={() => removeAsset(asset)}
                >
                  <Icon name="trash" size={12} />
                </button>
                </div>
              );
            })}
          </div>
          {windowed && <span className="asset-focus-edge" role="group" tabIndex={pinnedIndices[0] >= 0 ? -1 : 0} aria-label={tr("Assets")}
            onFocus={() => {
              const index = shown.length - 1;
              focusRequest.current = { id: shown[index].id, last: true };
              setFocusedAsset(shown[index].id);
              scrollToAsset(index, false);
            }} />}
          </>
          )
        )}
      </div>
      <StorageUsage />
    </div>
  );
}
