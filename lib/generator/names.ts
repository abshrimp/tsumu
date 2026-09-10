/**
 * 書き出すクラス名・アセットのファイル名・コンポーネント名を、要素の名前から決める
 */

import type { SiteDoc } from "../types";

/* ---------- クラス名 ---------- */

/** 既定の日本語要素名 → 読めるクラス名 */
const NAME_DICT: [RegExp, string][] = [
  [/^ボックス/, "box"],
  [/^テキスト(?!エリア)/, "text"],
  [/^見出し/, "heading"],
  [/^ボタン/, "button"],
  [/^画像/, "image"],
  [/^区切り線/, "divider"],
  [/^カスタムコード/, "code-block"],
  [/^アイコン/, "icon"],
  [/^インプット/, "input"],
  [/^入力欄/, "input"],
  [/^テキストエリア/, "textarea"],
  [/^選択肢/, "select"],
  [/^チェックボックス/, "checkbox"],
  [/^ラジオボタン/, "radio"],
  [/^スイッチ/, "switch"],
  [/^ファイル選択/, "file"],
  [/^動画/, "video"],
  [/^音声/, "audio"],
  [/^YouTube/, "youtube"],
  [/^Googleマップ/, "map"],
  [/^URL埋め込み/, "embed"],
  [/^ナビバー/, "navbar"],
  [/^ナビリンク/, "nav-links"],
  [/^ロゴ/, "logo"],
  [/^ヒーロー/, "hero"],
  [/^カードグリッド/, "card-grid"],
  [/^カード/, "card"],
  [/^フッター/, "footer"],
  [/^ヘッダー/, "header"],
];

/** 重複時の続き番号を保持し、同名要素が多くても先頭から探し直さない。 */
function nameAllocator(reserved: Iterable<string> = [], separator = "-", forbidden?: (name: string) => boolean) {
  const used = new Set(Array.from(reserved, (name) => name.toLowerCase()));
  const nextSuffix = new Map<string, number>();
  return (base: string, extension = ""): string => {
    const key = base.toLowerCase() + "\0" + extension.toLowerCase();
    let name = base + extension;
    let next = nextSuffix.get(key) ?? 2;
    while (used.has(name.toLowerCase()) || forbidden?.(name)) {
      name = base + separator + next++ + extension;
    }
    nextSuffix.set(key, next);
    used.add(name.toLowerCase());
    return name;
  };
}

export function buildClassNames(doc: SiteDoc): Map<string, string> {
  const allocate = nameAllocator();
  const map = new Map<string, string>();
  for (const node of Object.values(doc.nodes)) {
    let name0 = node.name;
    for (const [re, en] of NAME_DICT) {
      if (re.test(name0)) {
        name0 = en;
        break;
      }
    }
    let base = name0
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
    if (!base || /^\d/.test(base)) base = "el";
    map.set(node.id, allocate(base));
  }
  return map;
}

const MIME_EXT: Record<string, string> = {
  "image/svg+xml": ".svg",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "font/woff2": ".woff2",
  "font/woff": ".woff",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
  "text/css": ".css",
  "text/javascript": ".js",
  "application/javascript": ".js",
};

/** MIMEタイプ（無ければ dataURL の先頭）から拡張子を決める */
function extFromMime(mimeType?: string, dataUrl?: string): string {
  const mime = (mimeType || /^data:([^;,]+)/.exec(dataUrl ?? "")?.[1] || "")
    .toLowerCase()
    .trim();
  return MIME_EXT[mime] ?? "";
}

/**
 * アセットの出力ファイル名（public/assets/ 内）。
 * 同名ファイルをアップロードしても上書きされないよう一意化する
 */
export function buildAssetNames(doc: SiteDoc): Map<string, string> {
  // ZIPs are frequently extracted to case-insensitive filesystems. Keep the
  // original spelling, but assign a suffix when names differ only by case.
  const allocate = nameAllocator();
  const map = new Map<string, string>();
  for (const asset of Object.values(doc.assets)) {
    // 公開URL・CSSの url() でそのまま使えるよう、アップロード時と同じ規則で安全な名前にする
    //（表示名は日本語・空白・# などを含むことがある）
    // 拡張子は別に扱う。「ロゴ.svg」→「-.svg」の先頭記号を削ると拡張子まで消え、
    // 拡張子なしのファイルは application/octet-stream で配信されて画像が表示されない
    const raw = (asset.name || "").replace(/[^a-zA-Z0-9.\-_]/g, "-");
    const extMatch = /\.[a-zA-Z0-9]{1,5}$/.exec(raw);
    const safeExt =
      extMatch && !/^\.(?:x?html?|mhtml|shtml|xml)$/i.test(extMatch[0])
        ? extMatch[0]
        : null;
    const ext = safeExt ?? extFromMime(asset.mimeType, asset.dataUrl);
    const originalBase =
      (extMatch ? raw.slice(0, extMatch.index) : raw)
        .replace(/-{2,}/g, "-")
        .replace(/^[.-]+/, "")
        .replace(/\.+$/g, "")
        // Keep exported asset paths usable on filesystems with 255-byte
        // filename components, retaining room for extensions and suffixes.
        .slice(0, 120)
        .replace(/[.-]+$/g, "") || "image";
    // Windows reserves these device names with or without an extension.
    // Rename valid uploaded assets rather than failing the entire export.
    const base = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(originalBase)
      ? "_" + originalBase : originalBase;
    map.set(asset.id, allocate(base, ext));
  }
  return map;
}

export function buildComponentNames(doc: SiteDoc): Map<string, string> {
  // ページ・コンポーネントに生成する関数、import、型と衝突させない。
  const allocate = nameAllocator([
    "Page", "Image", "Link", "Fragment", "SmartLink", "SearchForm", "SiteLoadingScreen", "PageHtml",
    "Metadata", "Vars", "Item",
    // データ取得・リスト・ローディング画面で参照する組み込みオブジェクトと型。
    "Object", "Array", "Promise", "Record", "JSON", "Error", "Number", "String", "Boolean",
    "Proxy", "RegExp", "Math", "Date", "Set", "Map", "URL", "URLSearchParams", "RequestInit", "React",
  ], "", (name) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name));
  const map = new Map<string, string>();
  for (const comp of Object.values(doc.components ?? {})) {
    let base = comp.name;
    for (const [re, en] of NAME_DICT) {
      if (re.test(base)) {
        base = en;
        break;
      }
    }
    let ident = base
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("")
      // ファイル名の255バイト制限に、拡張子と重複時の番号の余地を残す。
      .slice(0, 120);
    if (!ident || /^\d/.test(ident)) ident = "Section";
    // Component filenames must remain distinct on macOS/Windows as well as
    // Linux. Valid user labels must not make portable-path validation fail.
    map.set(comp.id, allocate(ident));
  }
  return map;
}
