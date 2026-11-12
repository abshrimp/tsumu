/**
 * 変数のテンプレート: "{name}" と "[slug]" を値に置き換える。
 * 「\{」は変数ではなく、文字の「{」として扱う（\{name} → {name}）。
 * 生成したサイトにも、同じ働きのランタイム（lib/vars.ts）が出力される。
 */

import { NAVIGATION_RUNTIME } from "./url-policy";
import { tr } from "./i18n";
import { formatValueText } from "./value-text";

const TOKEN_RE = /\\\{|\{([^{}\s"'<>`]+)\}|\[slug\]/g;

/** 文字としての「{」の書き方 */
const ESCAPED_BRACE = "\\{";

/**
 * vars にこのキーがあれば、「\{」を「{」に戻さずに残す
 * （画面上でもう一度 {変数} を置き換える文字を作るとき。最後の置き換えで「{」に戻る）
 */
export const KEEP_ESCAPES = "\u0000keepEscapes";

export type Vars = Record<string, unknown>;

/**
 * 変数の値を取り出す。"images.0" や "meta.createdAt" のように、
 * 「.」で配列の何番目かや、入れ子の項目をたどれる（配列の "-1" は最後の要素）
 */
export function lookupVar(vars: Vars, name: string): unknown {
  const owns = (value: object, key: string | number) =>
    Object.prototype.hasOwnProperty.call(value, key);
  if (owns(vars, name)) return vars[name];
  let cur: unknown = vars;
  for (const key of name.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    const part = Array.isArray(cur) && key === "-1" ? cur.length - 1 : key;
    if (!owns(cur, part)) return undefined;
    cur = (cur as Record<string | number, unknown>)[part];
  }
  return cur;
}

/** 表示用の文字にする（配列は「, 」でつなぐ） */
export function varText(v: unknown): string {
  return formatValueText(v);
}

/** 通常の置換（未定義なら空文字） */
export function interpolate(template: string, vars: Vars): string {
  return template.replace(TOKEN_RE, (m, name) => {
    if (m === ESCAPED_BRACE) return vars[KEEP_ESCAPES] ? m : "{";
    return varText(lookupVar(vars, name ?? "slug"));
  });
}

/** URL 用の置換（値を encodeURIComponent する。先頭の変数が URL そのもの（https:// や / で始まる）なら、そのまま使う） */
export function interpolateUrl(template: string, vars: Vars): string {
  return template.replace(TOKEN_RE, (m, name, at: number) => {
    if (m === ESCAPED_BRACE) return vars[KEEP_ESCAPES] ? m : "{";
    const v = varText(lookupVar(vars, name ?? "slug"));
    return at === 0 && isWholeUrl(v) ? v : encodeURIComponent(v);
  });
}

/** 値が URL そのものか（リンク先の先頭に置いた変数を、エンコードせずに使う。// や data:text/html などは除く） */
function isWholeUrl(v: string): boolean {
  return (
    /^(?:https?:|mailto:|tel:|data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)[;,])/i.test(v) ||
    (v.charAt(0) === "/" && v.charAt(1) !== "/") ||
    v.charAt(0) === "#"
  );
}

/**
 * JSON の本文用の置換。文字列（"…"）の中の {変数} は、値を JSON 用にエスケープした文字にし、
 * 文字列の外の {変数} は、JSON として値かリストを挿入する（無ければ null）
 */
export function interpolateJson(template: string, vars: Vars): string {
  let out = "";
  let inString = false;
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (const m of template.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    const chunk = template.slice(last, at);
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === "\\") i++;
      else if (chunk[i] === '"') inString = !inString;
    }
    out += chunk;
    last = at + m[0].length;
    if (m[0] === ESCAPED_BRACE) {
      if (inString) {
        // 正しい JSON の文字列では、エスケープしたバックスラッシュを "\\\\" と書く。
        // トークンの照合がその最後のスラッシュを消費すると、不正な "\\{" のエスケープが残るため、
        // 対になるスラッシュも一緒に取り除く。
        let trailingSlashes = 0;
        while (trailingSlashes < chunk.length &&
          chunk[chunk.length - trailingSlashes - 1] === "\\") trailingSlashes++;
        if (trailingSlashes % 2 === 1) out = out.slice(0, -1);
      }
      out += "{";
      continue;
    }
    const v = lookupVar(vars, m[1] ?? "slug");
    out += inString ? JSON.stringify(varText(v)).slice(1, -1) : JSON.stringify(v === undefined ? null : v);
  }
  return out + template.slice(last);
}

/** テンプレートが、置き換える部分（変数や、文字としての「{」）を含むか */
export function hasVars(template: string | undefined | null): boolean {
  if (!template) return false;
  TOKEN_RE.lastIndex = 0;
  const found = TOKEN_RE.test(template);
  // matchAll などは lastIndex の位置から探し始めるため、0 に戻しておく
  TOKEN_RE.lastIndex = 0;
  return found;
}

/** テンプレートの中の変数名を列挙する（[slug] は "slug"） */
export function extractVars(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(TOKEN_RE)) {
    if (m[0] !== ESCAPED_BRACE) out.add(m[1] ?? "slug");
  }
  return [...out];
}

/** テキストを、{変数} のトークンとそれ以外に分ける（表示や編集での強調表示用） */
export function splitVarTokens(text: string): { text: string; name?: string }[] {
  const out: { text: string; name?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    // 文字としての「{」は、前後の文字と一緒に普通の文字にする
    if (m[0] === ESCAPED_BRACE) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: m[0], name: m[1] ?? "slug" });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/* ---------- 変数の予測変換 ---------- */

/** 「{」が無くても予測変換を表示する、変数名と一致した文字数 */
export const VAR_AUTO_MIN = 3;

export interface VarQuery {
  /** 置き換える範囲の先頭（カーソルの位置までを置き換える） */
  start: number;
  /** 入力済みの部分 */
  partial: string;
  /**
   * brace = 「{」を入力した / word = 変数名の先頭3文字以上と一致した /
   * manual = ショートカットで一覧を開いた
   */
  mode: "brace" | "word" | "manual";
}

const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$-]/.test(c);

/**
 * カーソルの直前の文字（before）から、予測変換の対象を探す。
 * 「{」の後ならその続きを、それ以外なら、直前の文字のうち変数名の先頭と一致する部分を使う
 * （英数字は、単語の途中からは一致させない）
 */
export function findVarQuery(
  before: string,
  names: string[],
  manual = false
): VarQuery | null {
  const m = /\{([^{}\s"'<>`]*)$/.exec(before);
  if (m) return { start: before.length - m[0].length, partial: m[1], mode: "brace" };
  const tail = (/[^\s{}"'<>`()\[\],、。「」]*$/.exec(before)?.[0] ?? "").slice(-40);
  const lower = names.map((n) => n.toLowerCase());
  const min = manual ? 1 : VAR_AUTO_MIN;
  for (let i = 0; i <= tail.length - min; i++) {
    if (i > 0 && isWordChar(tail[i - 1]) && isWordChar(tail[i])) continue;
    const part = tail.slice(i);
    const p = part.toLowerCase();
    if (lower.some((n) => n.startsWith(p))) {
      return {
        start: before.length - part.length,
        partial: part,
        mode: manual ? "manual" : "word",
      };
    }
  }
  return manual ? { start: before.length, partial: "", mode: "manual" } : null;
}

/**
 * 候補で置き換える範囲の終わり。「{」の途中で選んだときは、カーソルの後ろに残っている
 * 同じ {…} の続き（「s.出展カテゴリ}」など）も置き換える
 */
export function varQueryEnd(text: string, q: VarQuery, caret: number): number {
  if (q.mode !== "brace") return caret;
  const m = /^[^{}\s"'<>`]*\}/.exec(text.slice(caret));
  return m ? caret + m[0].length : caret;
}

/** 候補を並べる（先頭が一致するもの → 途中が一致するもの。word では先頭の一致だけ） */
export function matchVarNames(names: string[], q: VarQuery): string[] {
  const p = q.partial.toLowerCase();
  const pre = names.filter((n) => n.toLowerCase().startsWith(p));
  if (q.mode === "word" || !p) return pre;
  const mid = names.filter((n) => {
    const l = n.toLowerCase();
    return !l.startsWith(p) && l.includes(p);
  });
  return [...pre, ...mid];
}

/** 変数の一覧を開くショートカット（⌘/ ・ Ctrl+/ ・ Ctrl+Space） */
export function isVarListShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (e.altKey) return false;
  return (e.key === "/" && (e.metaKey || e.ctrlKey)) || (e.key === " " && e.ctrlKey);
}

/** ページの URL が [slug] のページか */
export function isSlugPage(slug: string): boolean {
  return slug.includes("[slug]");
}

/** Next.js のページとして配信しないページ（リダイレクト・外部のサイトの中継・HTML のページ） */
export function isHardNavPage(page: {
  redirectTo?: string;
  rewriteTo?: string;
  rawHtml?: string | null;
}): boolean {
  return page.redirectTo !== undefined || page.rewriteTo !== undefined || !!page.rawHtml?.trim();
}

/**
 * Next.js のページ遷移（Link・router.push）を使わず、ブラウザの通常の移動にする URL のパターン
 * （正規表現の文字列）。これらへの先読みやページ遷移は、リダイレクト先が別のドメインだと CORS で失敗する。
 * 外部のサイトの中継は、配下のパスも同じ先へ中継するため、配下も含める
 */
export function hardNavPatterns(pages: {
  slug: string;
  unpublished?: boolean;
  redirectTo?: string;
  rewriteTo?: string;
  rawHtml?: string | null;
}[]): string[] {
  return pages
    .filter((p) => !p.unpublished && isHardNavPage(p))
    .map((p) => {
      const route = p.slug.replace(/^\/+|\/+$/g, "");
      const path = route
        .split("/")
        .map((seg) =>
          /^\[\.\.\.[^\]]+\]$/.test(seg)
            ? ".+"
            : seg.replace(/\[[^\]]+\]/g, "\u0000").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\u0000/g, "[^/]+")
        )
        .join("/");
      const sub = p.rewriteTo !== undefined ? "(?:/.*)?" : "/?";
      return `^/${path}${route ? sub : ""}(?:[?#].*)?$`;
    });
}

/** URL（/ から始まるサイトの中のもの）が、hardNavPatterns のどれかに当たるか */
export function matchesHardNav(url: string, patterns: string[]): boolean {
  return /^\/(?!\/)/.test(url) && patterns.some((re) => new RegExp(re).test(url));
}

/** ページへのリンク先（"/blog?tab=news"） */
export function pageHrefOf(page: { slug: string; query?: string }): string {
  const path = `/${page.slug.replace(/^\/+|\/+$/g, "")}`;
  return page.query ? `${path}?${page.query}` : path;
}

/** 比べるためにクエリをそろえる（キーの順に並べ替える） */
export function normalizeQuery(query: string | undefined): string {
  const params = new URLSearchParams(query ?? "");
  params.sort();
  return params.toString();
}

/** ページのクエリを、変数として取り出す（プレビューや変数の候補用） */
export function pageQueryVars(query: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  try {
    for (const [k, v] of new URLSearchParams(query)) if (k) out[k] = v;
  } catch {
    // 不正なクエリは無視する
  }
  return out;
}

type PageUrlTarget = { id: string; slug: string; query?: string };

/**
 * ページの URL の変更に合わせて、直接入力した URL（"/blog" や "/blog/{id}"）を書き換える。
 * 対象でなければ null を返す。others は他のページ（[slug] のページへの誤った一致を避けるため）
 */
export function retargetPageUrl(
  url: string,
  before: PageUrlTarget,
  after: PageUrlTarget,
  others: PageUrlTarget[]
): string | null {
  const raw = url.trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const clean = (s: string) => s.replace(/^\/+|\/+$/g, "");
  const cut = raw.search(/[?#]/);
  const path = clean(cut < 0 ? raw : raw.slice(0, cut));
  const rest = cut < 0 ? "" : raw.slice(cut);
  const hashAt = rest.indexOf("#");
  const query = rest.startsWith("?") ? (hashAt < 0 ? rest.slice(1) : rest.slice(1, hashAt)) : "";
  const hash = hashAt < 0 ? "" : rest.slice(hashAt);

  const oldSlug = clean(before.slug);
  const newSlug = clean(after.slug);
  let newPath: string | null = null;
  if (!isSlugPage(oldSlug)) {
    if (path === oldSlug) newPath = newSlug;
  } else if (isSlugPage(newSlug)) {
    const at = oldSlug.indexOf("[slug]");
    const pre = oldSlug.slice(0, at);
    const post = oldSlug.slice(at + "[slug]".length);
    const seg =
      path.length > pre.length + post.length && path.startsWith(pre) && path.endsWith(post)
        ? path.slice(pre.length, path.length - post.length)
        : "";
    const taken = others.some((p) => p.id !== before.id && clean(p.slug) === path);
    if (seg && !seg.includes("/") && !taken) newPath = newSlug.replace("[slug]", seg);
  }
  if (newPath === null) return null;
  // 以前のクエリのまま（またはクエリが無い）なら新しいクエリにし、独自のクエリは残す
  const newQuery = query === (before.query ?? "") ? (after.query ?? "") : query;
  const next = `/${newPath}${newQuery ? `?${newQuery}` : ""}${hash}`;
  return next === raw ? null : next;
}

/** データソースの URL が {slug} を含むか */
export function urlHasSlug(url: string): boolean {
  return url.includes("{slug}");
}

/** [slug] の使い方が正しいか（独立した区切りとして1回だけ使う） */
export function validateSlugUsage(slug: string): string | null {
  const segs = slug.split("/").filter(Boolean);
  const slugSegs = segs.filter((s) => s === "[slug]");
  const badSegs = segs.filter((s) => /[\[\]]/.test(s) && s !== "[slug]");
  if (badSegs.length) {
    return tr("\"{p1}\" can't be used. Write the variable part as just [slug].", { p1: badSegs[0] });
  }
  if (slugSegs.length > 1) return tr("Only one [slug] is allowed");
  return null;
}

/** 生成したサイトに出力するランタイム */
export const VARS_RUNTIME = `export ${NAVIGATION_RUNTIME.replace("(value)", "(value: string): string")}

const TOKEN_RE = /\\\\\\{|\\{([^{}\\s"'<>\`]+)\\}|\\[slug\\]/g;
/** 文字としての「{」の書き方 */
const ESCAPED_BRACE = "\\\\{";
/** vars にこのキーがあれば「\\{」を残す（ブラウザでもう一度置き換える文字を作るとき） */
const KEEP_ESCAPES = "\\u0000keepEscapes";

export type Vars = Record<string, unknown>;

/**
 * 変数の値を取り出す。"images.0" や "meta.createdAt" のように
 * 「.」で配列の何番目・入れ子の項目をたどれる（配列の "-1" は最後の要素）
 */
export function lookupVar(vars: Vars, name: string): unknown {
  const owns = (value: object, key: string | number) =>
    Object.prototype.hasOwnProperty.call(value, key);
  if (owns(vars, name)) return vars[name];
  let cur: unknown = vars;
  for (const key of name.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    const part = Array.isArray(cur) && key === "-1" ? cur.length - 1 : key;
    if (!owns(cur, part)) return undefined;
    cur = (cur as Record<string | number, unknown>)[part];
  }
  return cur;
}

/** 表示用の文字にする（配列は「, 」でつなぐ） */
const formatValueText: (value: unknown, comparison?: boolean) => string = (${formatValueText.toString()});
export function varText(v: unknown): string { return formatValueText(v); }

/** "{name}" と "[slug]" を値に置き換える（未定義は空文字。「\\{」は文字の「{」） */
export function interpolate(template: string, vars: Vars): string {
  return template.replace(TOKEN_RE, (m, name) => {
    if (m === ESCAPED_BRACE) return vars[KEEP_ESCAPES] ? m : "{";
    return varText(lookupVar(vars, name ?? "slug"));
  });
}

/** URL用の置換（値をencodeURIComponent。先頭の変数がURLそのもの（https:// や / で始まる）ならそのまま使う） */
export function interpolateUrl(template: string, vars: Vars): string {
  return template.replace(TOKEN_RE, (m, name, at: number) => {
    if (m === ESCAPED_BRACE) return vars[KEEP_ESCAPES] ? m : "{";
    const v = varText(lookupVar(vars, name ?? "slug"));
    return at === 0 && isWholeUrl(v) ? v : encodeURIComponent(v);
  });
}

/** 値がURLそのものか（リンク先の先頭に置いた変数をエンコードせずに使う。// や data:text/html などは除く） */
function isWholeUrl(v: string): boolean {
  return (
    /^(?:https?:|mailto:|tel:|data:image\\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\\.microsoft\\.icon)[;,])/i.test(v) ||
    (v.charAt(0) === "/" && v.charAt(1) !== "/") ||
    v.charAt(0) === "#"
  );
}

/** JSON の本文用の置換（文字列の中は JSON 用にエスケープ、外は値そのものの JSON） */
export function interpolateJson(template: string, vars: Vars): string {
  let out = "";
  let inString = false;
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (const m of template.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    const chunk = template.slice(last, at);
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === "\\\\") i++;
      else if (chunk[i] === '"') inString = !inString;
    }
    out += chunk;
    last = at + m[0].length;
    if (m[0] === ESCAPED_BRACE) {
      if (inString) {
        // A valid JSON string writes an escaped backslash as "\\\\\\\\". The
        // token matcher consumes its final slash, leaving an invalid "\\\\{"
        // escape unless its paired slash is removed as well.
        let trailingSlashes = 0;
        while (trailingSlashes < chunk.length &&
          chunk[chunk.length - trailingSlashes - 1] === "\\\\") trailingSlashes++;
        if (trailingSlashes % 2 === 1) out = out.slice(0, -1);
      }
      out += "{";
      continue;
    }
    const v = lookupVar(vars, m[1] ?? "slug");
    out += inString ? JSON.stringify(varText(v)).slice(1, -1) : JSON.stringify(v === undefined ? null : v);
  }
  return out + template.slice(last);
}
`;
