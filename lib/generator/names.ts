/**
 * 書き出すクラス名・アセットのファイル名・コンポーネント名を、要素の名前から決める
 */

import type { SiteDoc } from "../types";

/* ---------- クラス名 ---------- */

/** 既定の日本語の要素名 → 読めるクラス名 */
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

/** 重複したときの続き番号を覚えておき、同じ名前の要素が多くても、先頭から探し直さない。 */
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

/** MIME タイプ（無ければ data URL の先頭）から拡張子を決める */
function extFromMime(mimeType?: string, dataUrl?: string): string {
  const mime = (mimeType || /^data:([^;,]+)/.exec(dataUrl ?? "")?.[1] || "")
    .toLowerCase()
    .trim();
  return MIME_EXT[mime] ?? "";
}

/**
 * アセットの出力ファイル名（public/assets/ の中）。
 * 同じ名前のファイルをアップロードしても上書きされないよう、一意にする
 */
export function buildAssetNames(doc: SiteDoc): Map<string, string> {
  // ZIP は、大文字と小文字を区別しないファイルシステムに展開されることが多い。
  // 元の綴りは保ち、大文字と小文字だけが違う名前には接尾辞を付ける。
  const allocate = nameAllocator();
  const map = new Map<string, string>();
  for (const asset of Object.values(doc.assets)) {
    // 公開 URL や CSS の url() でそのまま使えるよう、アップロード時と同じ規則で安全な名前にする
    //（表示名は日本語・空白・# などを含むことがある）。
    // 拡張子は別に扱う。「ロゴ.svg」→「-.svg」の先頭の記号を削ると拡張子まで消え、
    // 拡張子の無いファイルは application/octet-stream で配信されて、画像が表示されない
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
        // ファイル名の部分が255バイトまでのファイルシステムでも書き出したアセットのパスを使えるよう、
        // 拡張子と接尾辞の余地を残して切り詰める。
        .slice(0, 120)
        .replace(/[.-]+$/g, "") || "image";
    // Windows は、拡張子の有無にかかわらず、これらのデバイス名を予約している。
    // 書き出し全体を失敗させずに、有効なアップロード済みのアセットの名前を変える。
    const base = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(originalBase)
      ? "_" + originalBase : originalBase;
    map.set(asset.id, allocate(base, ext));
  }
  return map;
}

export function buildComponentNames(doc: SiteDoc): Map<string, string> {
  // ページやコンポーネントに生成する関数・import・型と衝突させない。
  const allocate = nameAllocator([
    "Page", "Image", "Link", "Fragment", "SmartLink", "SearchForm", "SiteLoadingScreen", "PageHtml",
    "Metadata", "Vars", "Item",
    // データの取得・リスト・ローディング画面で参照する、組み込みのオブジェクトと型。
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
      // ファイル名の255バイトの制限に、拡張子と、重複したときの番号の余地を残す。
      .slice(0, 120);
    if (!ident || /^\d/.test(ident)) ident = "Section";
    // コンポーネントのファイル名は、Linux だけでなく macOS や Windows でも区別できなければならない。
    // 有効な利用者のラベルで、移植できるパスかの検証を失敗させてはいけない。
    map.set(comp.id, allocate(ident));
  }
  return map;
}
