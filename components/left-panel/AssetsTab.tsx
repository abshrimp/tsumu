"use client";

/**
 * アセットタブ（画像などの一覧・アップロード・使用量）
 */

import { isEnterKey } from "../../lib/keys";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CloudUpload,
  Download,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { insertPointFor, useEditor, type ParentRef } from "../../lib/store";
import { type Asset, type SiteDoc } from "../../lib/types";
import { otherLocalDocs, siteApi } from "../../lib/site";
import {
  ASSET_DRAG_TYPE,
  assetKind,
  assetSrc,
  deleteAssetRemote,
  downloadAsset,
  nodeAssetSrc,
  replaceEmbeddedAsset,
  uploadAsset,
  uploadEmbeddedAsset,
} from "../../lib/assets";
import { makeImage, makeMedia } from "../../lib/presets";
import { Icon } from "../icons";
import { userMessage } from "../../lib/errors";
import { showConfirm } from "../../lib/dialog";
import { tr } from "../../lib/i18n";
import { useServerStatus } from "../../lib/status";

/* ============ アセット ============ */

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** ほかのサイトが使っているサーバー保存のファイル（path → bytes）。開いている間に1回だけ取りに行く */
let otherSitesUsage: Promise<Map<string, number | null>> | null = null;

function loadOtherSitesUsage(): Promise<Map<string, number | null>> {
  otherSitesUsage ??= (async () => {
    const map = new Map<string, number | null>();
    try {
      const res = await fetch(siteApi("/api/assets"));
      if (res.ok) {
        const data = (await res.json()) as { others?: { path: string; bytes: number | null }[] };
        for (const o of data.others ?? []) map.set(o.path, o.bytes);
        return map;
      }
    } catch {
      // サーバーで数えられなければ、このブラウザに保存しているほかのサイトから数える
    }
    for (const raw of otherLocalDocs()) {
      try {
        const doc = JSON.parse(raw) as Pick<SiteDoc, "assets">;
        for (const a of Object.values(doc.assets ?? {})) {
          if (a.path) map.set(a.path, a.bytes ?? map.get(a.path) ?? null);
        }
      } catch {
        // 壊れた保存は数えない
      }
    }
    return map;
  })();
  return otherSitesUsage;
}

/** 保存先（KV）があるときだけ使用量を出す（無ければアセットはサイトの中に保存され、KVの容量は使わない） */
function StorageUsage() {
  const status = useServerStatus();
  return status?.assets ? <StorageUsageMeter /> : null;
}

/**
 * サーバー保存済みアセットの使用量。保存先（KV）は全サイト共通なので、全サイトの合計を出す
 * （docに記録したbytesから算出し、同じファイルは1回だけ数える。KVのlistを使わずに表示できる）
 */
function StorageUsageMeter() {
  const doc = useEditor((s) => s.doc);
  const [others, setOthers] = useState<Map<string, number | null> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadOtherSitesUsage().then((m) => {
      if (alive) setOthers(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  const files = new Map<string, number | null>(others ?? []);
  const own = Object.values(doc.assets).filter((a) => a.path);
  for (const a of own) files.set(a.path!, a.bytes ?? files.get(a.path!) ?? null);
  let total = 0;
  let unknown = 0;
  for (const b of files.values()) {
    if (b === null) unknown++;
    else total += b;
  }
  /** Workers KV の無料枠（有料プランでも 1GB までは料金に含まれ、超えた分は従量課金） */
  const limit = 1024 * 1024 * 1024;
  const pct = Math.min(100, (total / limit) * 100);
  return (
    <div
      className="storage-usage"
      data-tip={
        tr("全サイトの合計: サーバーに保存したアセット {length}件（このサイト {own}件）{p2}", {
          length: files.size,
          own: own.length,
          p2: unknown ? tr("（うち{unknown}件はサイズ不明）", { unknown }) : "",
        }) +
        "\n" +
        tr("1GB は Workers KV の無料枠です。有料プランでは超えた分が従量課金になります。")
      }
    >
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
        {tr("使用量（全サイト）")} {formatBytes(total)} / {tr("無料枠 {size}", { size: formatBytes(limit) })}
      </span>
    </div>
  );
}

/**
 * アセットごとの使用箇所数。画像・動画要素、背景などのスタイル、サイト・ページ設定に加え、
 * スクリプトや HTML などに URL・ID が書かれているものも「使用中」として数える
 * （未使用の一括削除で消してしまわないよう、判定は控えめにする）。
 */
function assetUsage(doc: SiteDoc): Map<string, number> {
  const usage = new Map<string, number>();
  const add = (id: string | undefined | null) => {
    if (id && doc.assets[id]) usage.set(id, (usage.get(id) ?? 0) + 1);
  };
  const bySrc = Object.values(doc.assets)
    .map((a) => [a.id, assetSrc(a)] as const)
    .filter(([, src]) => !!src);
  for (const node of Object.values(doc.nodes)) {
    add(node.image?.assetId);
    add(node.media?.assetId);
    const hits = new Set<string>();
    for (const bp of Object.values(node.styles)) {
      for (const styles of Object.values(bp)) {
        for (const value of Object.values(styles ?? {})) {
          if (!value.includes("url(")) continue;
          for (const [id, src] of bySrc) if (value.includes(src)) hits.add(id);
        }
      }
    }
    hits.forEach(add);
  }
  add(doc.favicon?.assetId);
  add(doc.appleTouchIcon?.assetId);
  add(doc.ogImage?.assetId);
  add(doc.pwa?.icon?.assetId);
  for (const page of Object.values(doc.pages)) add(page.ogImage?.assetId);

  // それ以外（スクリプト・埋め込みHTMLなど）に URL や ID が書かれていれば使用中とみなす
  const { assets: _assets, ...rest } = doc;
  void _assets;
  const text = JSON.stringify(rest);
  for (const a of Object.values(doc.assets)) {
    if (usage.has(a.id)) continue;
    const src = assetSrc(a);
    if (text.includes(a.id) || (src && text.includes(src))) usage.set(a.id, 1);
  }
  return usage;
}

/** アセット一覧のスクロール位置（他のタブを開いて戻ってきても保つ） */
let assetScrollTop = 0;

export function AssetsTab() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const selection = useEditor((s) => s.selection);
  const updateDoc = useEditor((s) => s.updateDoc);
  const insertNodes = useEditor((s) => s.insertNodes);
  const updateNode = useEditor((s) => s.updateNode);
  const setLeftTab = useEditor((s) => s.setLeftTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = assetScrollTop;
  }, []);

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
    document
      .querySelector(`[data-asset-id="${CSS.escape(revealed)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
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

  const assets = Object.values(doc.assets);
  const usage = useMemo(() => assetUsage(doc), [doc]);
  const usedBy = (asset: Asset) => usage.get(asset.id) ?? 0;
  const unused = assets.filter((a) => !usage.has(a.id));
  const q = query.trim().toLowerCase();
  const shown = q ? assets.filter((a) => a.name.toLowerCase().includes(q)) : assets;

  /** どこからも使われていないアセットをまとめて削除する */
  const removeUnused = async () => {
    if (!unused.length) return;
    if (
      !(await showConfirm(tr("サーバーに保存したファイルも削除され、元に戻せません。"), {
        title: tr("使用していないアセット {length}件を削除しますか？", { length: unused.length }),
        okLabel: tr("削除"),
        danger: true,
      }))
    ) {
      return;
    }
    updateDoc((d) => {
      for (const a of unused) delete d.assets[a.id];
    });
    for (const a of unused) void deleteAssetRemote(a);
  };

  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    setError(null);
    try {
      let fellBack = false;
      for (const file of Array.from(files)) {
        if (!/^(image|video|audio)\//.test(file.type)) continue;
        const asset = await uploadAsset(file);
        if (!asset.path) fellBack = true;
        updateDoc((d) => void (d.assets[asset.id] = asset));
      }
      if (fellBack) {
        setError(
          tr("サーバーに保存できないため、このブラウザ内に保存しました。画面下の保存状態を確認してください。")
        );
      }
    } catch (e) {
      setError(userMessage(e, tr("アップロードできませんでした")));
    } finally {
      setBusy(false);
    }
  };

  /** ローカル（dataURL）のアセットをサーバーへ移行する */
  const migrateAsset = async (asset: Asset) => {
    if (!asset.dataUrl) return;
    setBusy(true);
    setError(null);
    try {
      const path = await uploadEmbeddedAsset(asset);
      if (!path) {
        setError(
          tr("まだサーバーに保存できません。画面下の保存状態を確認してください。")
        );
        return;
      }
      // 使っている要素の src と、背景画像などのスタイルも差し替える
      updateDoc((d) => replaceEmbeddedAsset(d, asset.id, path));
    } catch (e) {
      setError(userMessage(e, tr("サーバーへ移せませんでした")));
    } finally {
      setBusy(false);
    }
  };

  /** クリック: 選択中が画像ならその画像を差し替え、そうでなければ新規挿入 */
  const useAsset = (asset: Asset) => {
    const sel = selection ? doc.nodes[selection] : null;
    const kind = assetKind(asset);
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
          assetId: asset.id,
          width: asset.width,
          height: asset.height,
        },
      });
      return;
    }
    if (kind !== "image" && sel?.type === "media" && sel.media?.kind === kind) {
      updateNode(sel.id, {
        media: { ...sel.media, src: nodeAssetSrc(asset), assetId: asset.id },
      });
      return;
    }
    if (kind !== "image") {
      const node = makeMedia(kind);
      node.name = asset.name;
      node.media = { ...node.media!, src: nodeAssetSrc(asset), assetId: asset.id };
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
      assetId: asset.id,
    };
    const target = insertPointFor(doc, selection, fallback, useEditor.getState().insertMode);
    insertNodes([node], node.id, target.parent, target.index);
    setLeftTab("layers");
  };

  const removeAsset = async (asset: Asset) => {
    const used = usedBy(asset);
    if (
      !(await showConfirm(
        used
          ? tr("{used}箇所で使用中です。使っている要素からも外して削除します。サーバーのファイルも削除されます。", { used })
          : tr("サーバーに保存したファイルも削除されます。"),
        { title: tr("「{name}」を削除しますか？", { name: asset.name }), okLabel: tr("削除"), danger: true }
      ))
    ) {
      return;
    }
    updateDoc((d) => {
      const src = assetSrc(asset);
      for (const node of Object.values(d.nodes)) {
        if (node.image?.assetId === asset.id) {
          node.image.assetId = undefined;
          node.image.src = "";
        }
        if (node.media?.assetId === asset.id) {
          node.media.assetId = undefined;
          node.media.src = "";
        }
        if (src) {
          for (const bp of Object.values(node.styles)) {
            for (const styles of Object.values(bp)) {
              if (!styles) continue;
              for (const [prop, value] of Object.entries(styles)) {
                if (value.includes(src)) delete styles[prop];
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
      delete d.assets[asset.id];
    });
    void deleteAssetRemote(asset);
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
            accept="image/*,video/*,audio/*"
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
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
              />
              {query && (
                <button
                  type="button"
                  className="asset-search-clear"
                  aria-label={tr("検索をクリア")}
                  onClick={() => setQuery("")}
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
          <div className="asset-grid">
            {shown.map((asset) => {
              const used = usedBy(asset);
              const kind = assetKind(asset);
              return (
                <div
                  key={asset.id}
                  className={`asset-card${revealed === asset.id ? " is-revealed" : ""}`}
                  data-asset-id={asset.id}
                >
                <button
                  className="asset-thumb"
                  draggable={kind === "image"}
                  data-tip={
                    selection && doc.nodes[selection]?.type === "image"
                      ? tr("選択中の画像に適用")
                      : kind === "image"
                        ? tr("クリックで挿入・キャンバスへドラッグでも置けます")
                        : tr("ページに挿入")
                  }
                  onClick={() => useAsset(asset)}
                  onDragStart={(e) => {
                    if (kind !== "image") return;
                    e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  {kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetSrc(asset)}
                      alt={asset.name}
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <Icon name={kind === "video" ? "video" : "audio"} size={24} />
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
                        if (e.key === "Escape") setRenaming(null);
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
                    {kind === "image" ? `${asset.width}×${asset.height}` : kind === "video" ? tr("動画") : tr("音声")}
                    {used > 0 && tr(" · {used}箇所", { used })}
                    {!asset.path && tr(" · このブラウザのみ")}
                  </span>
                </div>
                {!asset.path && (
                  <button
                    className="layer-act is-active asset-del"
                    style={{ right: 56 }}
                    data-tip={tr("サーバーへアップロード")}
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
                  onClick={() => void downloadAsset(asset)}
                >
                  <Download size={12} />
                </button>
                <button
                  className="layer-act is-active asset-del"
                  data-tip={tr("削除")}
                  onClick={() => removeAsset(asset)}
                >
                  <Icon name="trash" size={12} />
                </button>
                </div>
              );
            })}
          </div>
          )
        )}
      </div>
      <StorageUsage />
    </div>
  );
}
