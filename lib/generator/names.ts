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

export function buildClassNames(doc: SiteDoc): Map<string, string> {
  const used = new Set<string>();
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
    let name = base;
    let i = 2;
    while (used.has(name)) name = `${base}-${i++}`;
    used.add(name);
    map.set(node.id, name);
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
  const used = new Set<string>();
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
    const base =
      (extMatch ? raw.slice(0, extMatch.index) : raw)
        .replace(/-{2,}/g, "-")
        .replace(/^[.-]+/, "") || "image";
    let name = `${base}${ext}`;
    if (used.has(name)) {
      let i = 2;
      while (used.has(`${base}-${i}${ext}`)) i++;
      name = `${base}-${i}${ext}`;
    }
    used.add(name);
    map.set(asset.id, name);
  }
  return map;
}

export function buildComponentNames(doc: SiteDoc): Map<string, string> {
  // ページ・コンポーネントに生成する関数、import、型と衝突させない。
  const used = new Set<string>([
    "Page", "Image", "Link", "Fragment", "SmartLink", "SearchForm", "SiteLoadingScreen", "PageHtml",
    "Metadata", "Vars", "Item",
    // データ取得・リスト・ローディング画面で参照する組み込みオブジェクトと型。
    "Object", "Array", "Promise", "Record", "JSON", "Error", "Number", "String", "Boolean",
    "Proxy", "RegExp", "Math", "Date", "Set", "Map", "URL", "URLSearchParams", "RequestInit", "React",
  ]);
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
      .join("");
    if (!ident || /^\d/.test(ident)) ident = "Section";
    let name = ident;
    let i = 2;
    while (used.has(name)) name = `${ident}${i++}`;
    used.add(name);
    map.set(comp.id, name);
  }
  return map;
}
