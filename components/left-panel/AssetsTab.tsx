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
  deleteAssetRemote,
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
import { loadServerStatus, useServerStatus, type AssetDeletion } from "../../lib/status";
import { computeStorageUsage, type StorageUsageResponse } from "../../lib/storage-usage";

/* ============ アセット ============ */

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Non-media files are shown as identifiable files, never as broken images. */
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
    case "font": return tr("フォント");
    case "json": return "JSON";
    case "document": return tr("文書");
    case "archive": return tr("圧縮ファイル");
    case "file": return tr("ファイル");
    case "video": return tr("動画");
    case "audio": return tr("音声");
    default: return tr("画像");
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

/** 使用量の元データを取りに行く（サーバーで数えられなければ、このブラウザに保存しているほかのサイトから数える） */
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

/** 保存先（KV）があるときだけ使用量を出す（無ければアセットはサイトの中に保存され、KVの容量は使わない） */
function StorageUsage() {
  const status = useServerStatus();
  return status?.assets ? <StorageUsageMeter deletion={status.assetDeletion ?? null} /> : null;
}

/**
 * サーバー保存済みアセットの使用量。保存先（KV）は全サイト共通なので、全サイトの合計を出す。
 * Cloudflare では KV に置いたファイルの台帳（D1）から数えるので、削除待ちのファイルも含めて
 * KV の実際の使用量と一致する（台帳が揃うまでは、サイトが使っているファイルだけを数える）。
 */
function StorageUsageMeter({ deletion }: { deletion: AssetDeletion | null }) {
  const doc = useEditor((s) => s.doc);
  const [response, setResponse] = useState<StorageUsageResponse | null>(null);
  const own = Object.values(doc.assets).filter((a) => a.path);
  // 台帳はアップロード・削除で変わるので、このサイトのファイルが変わったら取り直す（連続した変更はまとめる）
  const ownKey = own.map((a) => a.path).sort().join("\n");
  const exact = !!response?.ledger?.complete;
  const loaded = response !== null;
  useEffect(() => {
    // 台帳が揃っていないときは、このサイトの分を編集中の内容から足すので取り直さない
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
      ? tr("全サイトの合計: サーバーに保存したファイル {files}件{p2}", {
          files: usage.files,
          p2: usage.unknown ? tr("（うち{unknown}件はサイズ不明）", { unknown: usage.unknown }) : "",
        })
      : tr("全サイトの合計: サーバーに保存したアセット {length}件（このサイト {own}件）{p2}", {
          length: usage.files,
          own: own.length,
          p2: usage.unknown ? tr("（うち{unknown}件はサイズ不明）", { unknown: usage.unknown }) : "",
        }),
  ];
  if (usage.pendingCount && deletion?.mode === "scheduled") {
    lines.push(tr("うち削除予定 {count}件（{size}）は、削除から{days}日後にサーバーから消えます。", {
      count: usage.pendingCount, size: formatBytes(usage.pendingBytes), days: deletion.days,
    }));
  } else if (usage.pendingCount && deletion?.mode === "kept") {
    lines.push(tr("うち削除したアセット {count}件（{size}）が、サーバーに残っています。", {
      count: usage.pendingCount, size: formatBytes(usage.pendingBytes),
    }));
  }
  if (response?.ledger && !usage.exact) {
    lines.push(tr("サーバー全体の確認（週1回）が終わるまでは、サイトで使っているファイルだけを数えています。"));
  }
  lines.push(tr("1GB は Workers KV の無料枠です。有料プランでは超えた分が従量課金になります。"));
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
        {tr("使用量（全サイト）")} {formatBytes(usage.bytes)} / {tr("無料枠 {size}", { size: formatBytes(limit) })}
      </span>
    </div>
  );
}

/** 連続編集とアップロードのUndoを混ぜず、履歴や移行元が変わった場合は待機を終える。 */
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

/** 同じIDでも、確認中にファイルやZIPの内容が差し替わったものは削除しない。 */
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
    return tr("サーバーに保存したファイルは{days}日後に削除されます（それまでに元に戻すか、ほかのサイトで使っていれば残ります）。", { days: deletion.days });
  }
  if (deletion?.mode === "kept") return tr("サーバーに保存したファイルは削除されずに残ります。");
  return several
    ? tr("サーバーに保存したファイルも削除され、元に戻せません。")
    : tr("サーバーに保存したファイルも削除されます。");
}

/** 別IDで残るアセットの保存先を守り、同じファイルを二重に削除しない。 */
function deleteRemovedAssetFiles(removed: Asset[]) {
  const retained = new Set(Object.values(useEditor.getState().doc.assets).map((a) => a.path));
  for (const asset of removed) {
    if (!asset.path || retained.has(asset.path)) continue;
    retained.add(asset.path);
    void deleteAssetRemote(asset);
  }
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

  /** 別サイト・文書への移動、履歴操作、パネルを閉じた後に古い確認を反映しない。 */
  const removalScope = () => {
    const site = currentSiteId();
    const history = useEditor.getState().historyRevision;
    return () => mounted.current && currentSiteId() === site && useEditor.getState().historyRevision === history;
  };

  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  // 右クリックの「アセットを表示」: 検索を外してそのアセットまでスクロールし、少しのあいだ目立たせる
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

  /** 名前を変える（空なら元のまま。拡張子が消えたら元の拡張子を付け直す） */
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

  // タブを閉じても追加・移行は続ける。古い処理で新しい処理の表示を上書きしない。
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
      // 新しい操作、文書・ファイルの差し替え、パネルを閉じた後に古い失敗を表示しない。
      if (inScope() && errorRevision.current === revision && latest && assetSrc(latest) === src) {
        setError(tr("アセットをダウンロードできませんでした"));
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
    // 検索・削除・パネル幅の変更でも、表示領域を実際の一覧の範囲に収める。
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
      !(await showConfirm(serverFileNotice((await loadServerStatus())?.assetDeletion, true), {
        title: tr("使用していないアセット {length}件を削除しますか？", { length: unused.length }),
        okLabel: tr("削除"),
        danger: true,
      }))
    ) {
      return;
    }
    if (!current()) return;
    const removed: Asset[] = [];
    updateDoc((d) => {
      // 確認待ちの共同編集を含め、最新の文書で使用状況を調べ直す。対象は確認したものだけ。
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
        // Full HTML/XML documents belong to the site's HTML import path, not
        // static asset storage (the upload API rejects executable documents).
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
        // Undo/Redoや文書置換後も完了したファイルを残し、やり直す編集は消さない。
        if (request.historyChanged()) useEditor.getState().retainUploadedAssets([asset]);
        else updateDoc((d) => void (d.assets[asset.id] = asset));
      }
      if (fellBack && request.current()) {
        setError(
          tr("サーバーに保存できないため、このブラウザ内に保存しました。画面下の保存状態を確認してください。")
        );
      }
    } catch (e) {
      if (request.current()) setError(userMessage(e, tr("アップロードできませんでした")));
    } finally {
      request.finish();
    }
  };

  /** ローカル（dataURL）のアセットをサーバーへ移行する */
  const migrateAsset = async (asset: Asset) => {
    if (!asset.dataUrl) return;
    const request = beginUpload();
    const current = () => {
      const latest = useEditor.getState().doc.assets[asset.id];
      return !request.historyChanged() && latest?.dataUrl === asset.dataUrl && latest?.path === asset.path;
    };
    try {
      const path = await uploadEmbeddedAsset(asset);
      // 待機中に履歴・同じIDのファイルが変わったら、古い内容へ差し戻さない。
      if (!current()) return;
      if (!path) {
        if (!request.current()) return;
        setError(
          tr("まだサーバーに保存できません。画面下の保存状態を確認してください。")
        );
        return;
      }
      await waitForAssetGesture(current);
      if (!current()) return;
      // 使っている要素の src と、背景画像などのスタイルも差し替える
      updateDoc((d) => replaceEmbeddedAsset(d, asset.id, path));
    } catch (e) {
      if (request.current()) setError(userMessage(e, tr("サーバーへ移せませんでした")));
    } finally {
      request.finish();
    }
  };

  /** クリック: 選択中が画像ならその画像を差し替え、そうでなければ新規挿入 */
  const useAsset = (asset: Asset) => {
    const sel = selection ? doc.nodes[selection] : null;
    const kind = assetKind(asset);
    if (!isVisualAsset(asset)) {
      void download(asset);
      return;
    }
    // 何も選んでいなければ、編集中のコンポーネント（なければページ）の末尾へ
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
    const notice = asset.path ? serverFileNotice((await loadServerStatus())?.assetDeletion, false) : "";
    if (
      !(await showConfirm(
        used
          ? tr("{used}箇所で使用中です。使っている要素からも外して削除します。", { used }) + notice
          : notice,
        { title: tr("「{name}」を削除しますか？", { name: asset.name }), okLabel: tr("削除"), danger: true }
      ))
    ) {
      return;
    }
    if (!current() || !sameAssetFile(useEditor.getState().doc.assets[asset.id], asset)) return;
    // 未使用として確認した後に使われ始めた場合、参照を外すことまでは承認されていない。
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
            {busy ? tr("アップロード中…") : tr("ファイルを追加（ドロップでも追加できます）")}
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
                placeholder={tr("アセットを検索")}
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
                  aria-label={tr("検索をクリア")}
                  onClick={() => changeQuery("")}
                >
                  <X size={12} />
                </button>
              )}
            </label>
            <div className="asset-count">
              <span>
                {q ? tr("{length} / {length2}件", { length: shown.length, length2: assets.length }) : tr("{length}件", { length: assets.length })}
                {unused.length > 0 && tr(" · 未使用 {length}件", { length: unused.length })}
              </span>
              {unused.length > 0 && (
                <button
                  type="button"
                  className="asset-clean"
                  onClick={removeUnused}
                  data-tip={tr("ページ・サイト設定・スタイルのどこにも使われていないアセットを削除")}
                >
                  <Trash2 size={12} />
                  {tr("未使用を削除")}
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
            {tr("アセットがありません。")}
            <br />
            {tr("ファイルをアップロードすると、ここに表示されます。")}
          </div>
        ) : (
          shown.length === 0 ? (
            <div className="panel-empty">{tr("「{p1}」に一致するアセットはありません", { p1: query.trim() })}</div>
          ) : (
          <>
          {windowed && <span className="asset-focus-edge" role="group" tabIndex={pinnedIndices[0] >= 0 ? -1 : 0} aria-label={tr("アセット")}
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
              // DOMにまだ無い隣のカードにも、従来どおりTab/Shift+Tabで順番に移動する。
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
                  aria-label={!isVisualAsset(asset) ? tr("ファイルをダウンロード") + ": " + asset.name : undefined}
                  draggable={kind === "image"}
                  data-tip={
                    !isVisualAsset(asset) ? tr("ファイルをダウンロード")
                      : selection && doc.nodes[selection]?.type === "image" && kind === "image"
                        ? tr("選択中の画像に適用")
                        : kind === "image" ? tr("クリックで挿入・キャンバスへドラッグでも置けます")
                        : tr("ページに挿入")
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
                      title={tr("{name}（ダブルクリックで名前を変更）", { name: asset.name })}
                      onDoubleClick={() => setRenaming(asset.id)}
                    >
                      {asset.name}
                    </span>
                  )}
                  <span className="asset-dim">
                    {kind === "image"
                      ? (asset.width && asset.height ? `${asset.width}×${asset.height}` : tr("画像"))
                      : staticAssetLabel(kind)}
                    {asset.bytes !== undefined && ` · ${formatBytes(asset.bytes)}`}
                    {used > 0 && tr(" · {used}箇所", { used })}
                    {!asset.path && tr(" · このブラウザのみ")}
                  </span>
                </div>
                {!asset.path && (
                  <button
                    className="layer-act is-active asset-del"
                    style={{ right: 56 }}
                    data-tip={tr("サーバーへアップロード")}
                    aria-label={tr("サーバーへアップロード")}
                    disabled={busy}
                    onClick={() => void migrateAsset(asset)}
                  >
                    <CloudUpload size={12} />
                  </button>
                )}
                <button
                  className="layer-act is-active asset-del"
                  style={{ right: !asset.path ? 82 : 56 }}
                  data-tip={tr("名前を変更")}
                  aria-label={tr("名前を変更")}
                  onClick={() => setRenaming(asset.id)}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="layer-act is-active asset-del"
                  style={{ right: 30 }}
                  data-tip={tr("ダウンロード")}
                  aria-label={tr("ダウンロード")}
                  onClick={() => void download(asset)}
                >
                  <Download size={12} />
                </button>
                <button
                  className="layer-act is-active asset-del"
                  data-tip={tr("削除")}
                  aria-label={tr("削除")}
                  onClick={() => removeAsset(asset)}
                >
                  <Icon name="trash" size={12} />
                </button>
                </div>
              );
            })}
          </div>
          {windowed && <span className="asset-focus-edge" role="group" tabIndex={pinnedIndices[0] >= 0 ? -1 : 0} aria-label={tr("アセット")}
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
