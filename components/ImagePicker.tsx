"use client";

import { isEnterKey } from "../lib/keys";
import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ImagePlus, Images, LoaderCircle, Music, Search, Upload, Video, X } from "lucide-react";
import { useEditor } from "../lib/store";
import type { Asset, ImageRef } from "../lib/types";
import { assetKind, assetSrc, uploadAsset } from "../lib/assets";
import { userMessage } from "../lib/errors";
import { showAlert } from "../lib/dialog";
import { tr } from "../lib/i18n";

/**
 * URL直接入力 or アセットから選択できる画像入力。
 * OGP画像・favicon・背景画像などで使う。
 */
export default function ImagePicker({
  value,
  onChange,
  placeholder = "https://",
}: {
  value: ImageRef | null | undefined;
  onChange: (v: ImageRef | null) => void;
  placeholder?: string;
}) {
  const doc = useEditor((s) => s.doc);
  const updateDoc = useEditor((s) => s.updateDoc);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const asset = value?.assetId ? doc.assets[value.assetId] : null;
  const previewSrc = asset ? assetSrc(asset) : value?.url?.trim() || null;

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const a = await uploadAsset(file);
      updateDoc((d) => void (d.assets[a.id] = a));
      onChange({ assetId: a.id });
      setOpen(false);
    } catch (e) {
      void showAlert(userMessage(e, tr("アップロードできませんでした")), { title: tr("アップロードできませんでした") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="img-pick">
      <div className="img-pick-row">
        <button
          type="button"
          className={`img-pick-thumb${open ? " is-open" : ""}`}
          aria-label={tr("アセットから選択")}
          aria-expanded={open}
          data-tip={tr("アセットから選択")}
          onClick={() => setOpen(!open)}
        >
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewSrc} alt="" />
          ) : (
            <ImagePlus size={13} />
          )}
        </button>
        {asset ? (
          <button
            type="button"
            className={`img-pick-asset${open ? " is-open" : ""}`}
            aria-expanded={open}
            data-tip={tr("クリックで別の画像を選択")}
            onClick={() => setOpen(!open)}
          >
            <span>{asset.name}</span>
            <ChevronDown size={12} className="img-pick-chev" />
          </button>
        ) : (
          <input
            key={value?.url ?? "_"}
            className="input"
            defaultValue={value?.url ?? ""}
            placeholder={placeholder}
            onBlur={(e) => {
              const url = e.target.value.trim();
              onChange(url ? { url } : null);
            }}
            onKeyDown={(e) => {
              if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
            }}
          />
        )}
        {!asset && (
          <button
            type="button"
            className={`icon-btn${open ? " is-on" : ""}`}
            aria-label={tr("アセットから選択")}
            data-tip={tr("アセットから選択")}
            onClick={() => setOpen(!open)}
          >
            <Images size={13} />
          </button>
        )}
        {(asset || value?.url) && (
          <button
            type="button"
            className="icon-btn"
            data-tip={tr("クリア")}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {open && (
        <AssetGrid
          kind="image"
          selectedId={value?.assetId}
          onPick={(a) => {
            onChange({ assetId: a.id });
            setOpen(false);
          }}
          lead={
            <>
              <button
                type="button"
                className="img-pick-cell is-upload"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                data-tip={tr("新しい画像をアップロード")}
              >
                {busy ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </>
          }
        />
      )}
    </div>
  );
}

/**
 * アセットの一覧から選ぶグリッド（名前で絞り込める）。
 * lead = 先頭に置くセル（アップロードなど）
 */
export function AssetGrid({
  kind,
  selectedId,
  onPick,
  lead,
  emptyText = tr("アセットがありません。左パネルの「アセット」から追加してください。"),
}: {
  kind: "image" | "video" | "audio";
  selectedId?: string;
  onPick: (asset: Asset) => void;
  lead?: ReactNode;
  emptyText?: string;
}) {
  const doc = useEditor((s) => s.doc);
  const [query, setQuery] = useState("");
  const all = Object.values(doc.assets).filter((a) => assetKind(a) === kind);
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((a) => a.name.toLowerCase().includes(q)) : all;
  return (
    <div className="asset-pick">
      {all.length > 4 && (
        <label className="asset-search asset-pick-search">
          <Search size={13} />
          <input
            type="search"
            autoFocus
            placeholder={tr("アセットを検索")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (isEnterKey(e) && shown.length === 1) onPick(shown[0]);
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
      )}
      <div className="img-pick-grid">
        {!q && lead}
        {shown.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`img-pick-cell${kind === "image" ? "" : " is-media"}${selectedId === a.id ? " is-sel" : ""}`}
            data-tip={a.name}
            onClick={() => onPick(a)}
          >
            {kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetSrc(a)} alt={a.name} loading="lazy" />
            ) : (
              <>
                {kind === "video" ? <Video size={18} /> : <Music size={18} />}
                <span>{a.name}</span>
              </>
            )}
          </button>
        ))}
        {!shown.length && (
          <span className="hint" style={{ gridColumn: lead && !q ? "2 / -1" : "1 / -1", alignSelf: "center", textAlign: "center" }}>
            {q ? tr("「{p1}」に一致するアセットはありません", { p1: query.trim() }) : emptyText}
          </span>
        )}
      </div>
    </div>
  );
}
