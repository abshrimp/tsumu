/**
 * JSX の書き出しで使う補助（ページ・アセットの参照、重なりの判定、スクリプト・リストの式、文字列の書き方）
 */

import type {
  DocNode,
  FilterCond,
  ImageRef,
  ListContent,
  ScriptOp,
  ScriptStep,
  SiteDoc,
} from "../types";
import { needsJsonType, sendsBody } from "../fetch-request";
import { hardNavPatterns, hasVars, KEEP_ESCAPES, matchesHardNav, pageHrefOf } from "../vars";
import { condGroups, type ListOp } from "../data";
import { resolveTag } from "../tags";
import { compileScripts, hasRunnableScripts, keepTokens, walkSteps } from "../script";
import { SELF_TARGET } from "../types";
import { type JsxContext } from "./render";

export function pageHref(ctx: JsxContext, pageId: string): string {
  const page = ctx.doc.pages[pageId];
  return page ? pageHrefOf(page) : "/";
}

export function assetPath(ctx: JsxContext, assetId: string): string {
  const name = ctx.assetNames.get(assetId);
  return name ? `/assets/${name}` : "";
}

/** 子ノードID → 親の children（ページ直下はページの children） */
const siblingCache = new WeakMap<SiteDoc, Map<string, { parent: string | null; list: string[] }>>();

function siblingsOf(doc: SiteDoc, id: string) {
  let map = siblingCache.get(doc);
  if (!map) {
    map = new Map();
    for (const page of Object.values(doc.pages)) {
      for (const cid of page.children) map.set(cid, { parent: null, list: page.children });
    }
    for (const n of Object.values(doc.nodes)) {
      for (const cid of n.children) map.set(cid, { parent: n.id, list: n.children });
    }
    siblingCache.set(doc, map);
  }
  return map.get(id) ?? null;
}

/**
 * 後ろの要素に重なりうる position を持つ（z-index が auto・0 = 後ろの要素と同じ層で重なる順が決まる）。
 * relative はずらしていなければ自分の場所にとどまるので含めない
 */
function isPositionedAuto(node: DocNode): boolean {
  if (isOwnLayer(node)) return false;
  return Object.values(node.styles).some((bp) => {
    const s = bp?.default;
    if (!s?.position || s.position === "static") return false;
    if (s.position !== "relative") return true;
    return ["top", "right", "bottom", "left"].some((k) => s[k] && parseFloat(s[k]) !== 0);
  });
}

/** position と 0 以外の z-index を持つ（中身はその要素の層に閉じ込められる） */
function isOwnLayer(node: DocNode): boolean {
  const styles = Object.values(node.styles).map((bp) => bp?.default);
  return (
    styles.some((s) => s?.position && s.position !== "static") &&
    styles.some((s) => {
      const z = parseFloat(s?.zIndex ?? "");
      return !Number.isNaN(z) && z !== 0;
    })
  );
}

/** 位置指定した要素か（absolute の子があると relative になる）= absolute の子はこの中に収まる */
function isContainer(doc: SiteDoc, node: DocNode): boolean {
  return (
    Object.values(node.styles).some((bp) => bp?.default?.position && bp.default.position !== "static") ||
    node.children.some((cid) =>
      Object.values(doc.nodes[cid]?.styles ?? {}).some((bp) => bp?.default?.position === "absolute")
    )
  );
}

function hasPositionedAuto(doc: SiteDoc, id: string, seen = new Set<string>()): boolean {
  const n = doc.nodes[id];
  if (!n || seen.has(id)) return false;
  seen.add(id);
  if (isOwnLayer(n)) return false;
  if (isPositionedAuto(n)) return true;
  // 位置指定した要素の中の absolute はその中に収まるので数えない
  if (isContainer(doc, n)) return false;
  return n.children.some((cid) => hasPositionedAuto(doc, cid, seen));
}

/** hasPositionedAuto と同じたどり方で、該当する要素を集める */
function collectPositionedAuto(doc: SiteDoc, id: string, out: Set<string>, seen = new Set<string>()) {
  const n = doc.nodes[id];
  if (!n || seen.has(id)) return;
  seen.add(id);
  if (isOwnLayer(n)) return;
  if (isPositionedAuto(n)) {
    out.add(id);
    return;
  }
  if (isContainer(doc, n)) return;
  for (const cid of n.children) collectPositionedAuto(doc, cid, out, seen);
}

/**
 * シャドウ付きSVGをiOS Safari向けに2倍で描いて縮める（crisp-svg）ときの実寸。対象外なら null。
 * 画像側に実寸が無ければアセットの実寸を使う
 */
export function crispSvgSize(doc: SiteDoc, node: DocNode): { width: number; height: number } | null {
  const img = node.image;
  const asset = img?.assetId ? doc.assets[img.assetId] : null;
  if (!img || !asset?.svgFilter || img.crispShadow === false) return null;
  const valid = (v: number | undefined) => (Number.isFinite(v) && v! > 0 ? v! : 0);
  const width = valid(img.width) && valid(img.height) ? img.width : asset.width;
  const height = valid(img.width) && valid(img.height) ? img.height : asset.height;
  return valid(width) && valid(height) ? { width, height } : null;
}

/**
 * crisp-svg の画像は transform を使うため、位置指定した要素（z-index: auto・0）と同じ層で描かれ、
 * 前にある位置指定の要素（画像に重ねた文字など）より前面に出てしまう。
 * エディタ（通常の画像）と同じ重なりにするため、同じ層で比べ合う位置指定の要素に z-index: 1 を付ける
 *（前後どちらも上げるので、位置指定の要素どうしの順番は変わらない）。書き出し用に複製した doc を書き換える
 */
export function raiseOverCrispSvg(doc: SiteDoc): void {
  const raise = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== "image" || !crispSvgSize(doc, node) || isPositionedAuto(node)) continue;
    let cur = node.id;
    // 親をたどる（壊れた文書の循環でも止まるよう、回数に上限を付ける）
    for (let depth = 0; depth < 200; depth++) {
      const sib = siblingsOf(doc, cur);
      if (!sib) break;
      for (const cid of sib.list) if (cid !== cur) collectPositionedAuto(doc, cid, raise);
      const parent = sib.parent ? doc.nodes[sib.parent] : null;
      // 位置指定した親の中身は親の順番で描かれるので、そこより外は比べなくてよい
      if (!parent || isContainer(doc, parent)) break;
      cur = parent.id;
    }
  }
  for (const id of raise) {
    const styles = doc.nodes[id].styles;
    const base = (styles.base ??= {});
    base.default ??= {};
    for (const bp of Object.values(styles)) {
      const s = bp?.default;
      if (!s) continue;
      const z = s.zIndex?.trim();
      if (z === undefined ? s === base.default : z === "auto" || parseFloat(z) === 0) s.zIndex = "1";
    }
  }
}

/**
 * スクリプトの data-scripts 属性（URL・値の {変数} は描画時に解決する。
 * 画面上で値が決まる変数・入力欄は {名前} のまま残し、ブラウザで置き換える）
 */
export function scriptsAttr(
  ctx: JsxContext,
  node: Pick<DocNode, "scripts">,
  skip?: Set<string>
): string {
  if (!hasRunnableScripts(node)) return "";
  const exprs: string[] = [];
  const compiled = compileScripts(
    node,
    (pageId) => pageHref(ctx, pageId),
    (str, kind) => {
      if (!hasVars(str)) return str;
      const fn = kind === "url" ? "interpolateUrl" : "interpolate";
      // 画面上の変数は {名前} のまま、文字としての「{」は「\{」のまま渡し、ランタイムが置き換える
      const keep = { ...keepTokens(str, ctx.liveNames), [KEEP_ESCAPES]: true };
      const base = ctx.varsExpr ?? "vars";
      // お手本の Proxy は無い名前を {名前} のまま・「\{」もそのまま返すので、展開せずに渡す
      const vars = ctx.inTemplate ? base : `{ ...${base}, ...${JSON.stringify(keep)} }`;
      exprs.push(`${fn}(${JSON.stringify(str)}, ${vars})`);
      return `__script_var_${exprs.length - 1}__`;
    },
    false,
    skip,
    (name) => {
      if (ctx.liveNames.has(name.split(".")[0])) return undefined;
      ctx.usesLookup = true;
      exprs.push(`lookupVar(${ctx.varsExpr ?? "vars"}, ${JSON.stringify(name)}) ?? null`);
      return `__script_var_${exprs.length - 1}__`;
    }
  );
  if (!compiled.length) return "";
  const json = JSON.stringify(compiled);
  if (!exprs.length) return ` data-scripts={${JSON.stringify(json)}}`;
  ctx.usesInterpolate = true;
  const code = json.replace(/"__script_var_(\d+)__"/g, (_, i) => exprs[Number(i)]);
  return ` data-scripts={JSON.stringify(${code})}`;
}

/** 自身を表示・切替するスクリプトを持つか（data-toggle-show が要る） */
export function showsSelf(node: DocNode): boolean {
  let found = false;
  for (const sc of node.scripts ?? []) {
    walkSteps(sc.steps, (st) => {
      if ((st.kind === "show" || st.kind === "toggle") && st.target === SELF_TARGET) {
        found = true;
      }
    });
  }
  return found;
}

/** 絞り込みの比較（ブラウザの cmp・エディタの matchOp と同じ規則）を生成コードにする */
function filterExpr(v: string, op: ScriptOp, w: string): string {
  switch (op) {
    case "neq":
      return `${v} !== ${w}`;
    case "contains":
      return `${v}.includes(${w})`;
    case "not-contains":
      return `!${v}.includes(${w})`;
    case "starts-with":
      return `${v}.startsWith(${w})`;
    case "ends-with":
      return `${v}.endsWith(${w})`;
    case "gt":
      return `parseFloat(${v}) > parseFloat(${w})`;
    case "lt":
      return `parseFloat(${v}) < parseFloat(${w})`;
    case "empty":
      return `${v} === ""`;
    case "not-empty":
      return `${v} !== ""`;
    case "in":
      return `${w}.split(",").some((x) => x.trim() === ${v})`;
    default:
      return `${v} === ${w}`;
  }
}

/** 項目の値を読む式（"address.city" のような入れ子の位置は lookupVar で読む） */
export function fieldExpr(item: string, field: string): string {
  return field.includes(".")
    ? `lookupVar(${item}, ${JSON.stringify(field)})`
    : `${item}[${JSON.stringify(field)}]`;
}

/** 絞り込みの条件式（item を項目とする。絞り込みが無ければ null） */
export function filterPredicate(ops: ListOp[], base: string): string | null {
  // 絞り込みは、並んだ順に「かつ」「または」でつないだ1つの条件にする
  const filters = ops.filter((o): o is Extract<ListOp, { kind: "filter" }> => o.kind === "filter");
  if (!filters.length) return null;
  const expr = (c: FilterCond) => {
    const w = hasVars(c.value)
      ? `interpolate(${JSON.stringify(c.value)}, ${base})`
      : JSON.stringify(c.value);
    return filterExpr(`String(${fieldExpr("item", c.field)} ?? "")`, c.op, w);
  };
  // 括弧は、優先順位が変わるところにだけ付ける
  const wrap = (parts: string[], op: string) =>
    parts.length > 1 ? `(${parts.join(` ${op} `)})` : parts[0];
  const one = (o: Extract<ListOp, { kind: "filter" }>) =>
    wrap(
      condGroups(o.conds).map((g) => wrap(g.map(expr), "&&")),
      "||"
    );
  return filters.reduce(
    (acc, o, i) => (i === 0 ? one(o) : `(${acc} ${o.join === "or" ? "||" : "&&"} ${one(o)})`),
    ""
  );
}

/**
 * 取得するURLのホストが {変数} や [slug] で決まるか（"{api}/items" や "https://{host}/"、"http://[slug]/"）。
 * 変数がURLのクエリ等から来ると、訪問者がサイトのサーバーに内部の宛先を取得させられる
 */
export function dynamicOrigin(url: string): boolean {
  return !/^https?:\/\/[^/?#{}\[\]@\\]+(?:[/?#]|$)/i.test(url.trim());
}

/** 取得ブロックのリクエストの設定を、生成コードの式にする（すべて既定なら null） */
export function fetchInitExpr(st: Extract<ScriptStep, { kind: "fetch" }>): string | null {
  const method = st.method && st.method !== "GET" ? st.method : undefined;
  const str = (v: string) => (hasVars(v) ? `interpolate(${JSON.stringify(v)}, vars)` : JSON.stringify(v));
  const headers = (st.headers ?? [])
    .filter((h) => h.name.trim())
    .map((h) => `${JSON.stringify(h.name.trim())}: ${str(h.value)}`);
  if (needsJsonType(st)) headers.push(`"Content-Type": "application/json"`);
  const body = sendsBody(method) && st.body?.trim()
    ? hasVars(st.body)
      ? `interpolateJson(${JSON.stringify(st.body)}, vars)`
      : JSON.stringify(st.body)
    : null;
  if (!method && !headers.length) return null;
  const parts = [
    method ? `method: ${JSON.stringify(method)}` : "",
    headers.length ? `headers: { ${headers.join(", ")} }` : "",
    body ? `body: ${body}` : "",
  ].filter(Boolean);
  return `{ ${parts.join(", ")} }`;
}

/**
 * 要素ごとのくり返しの中身（「項目として格納」と変数の「もし」）を生成コードにする。
 * item = くり返し中の要素（格納するたびに新しいまとまりにする）
 */
export function forEachBody(steps: ScriptStep[], array: string, indent: string): string {
  const scope = "{ ...vars, ...item }";
  const text = (t: string) => (hasVars(t) ? `interpolate(${JSON.stringify(t)}, ${scope})` : JSON.stringify(t));
  return steps
    .map((st) => {
      if (st.kind === "array-field" && st.array === array && st.field) {
        const one = /^\{([^{}\s"'<>`]+)\}$/.exec(st.value.trim());
        const v = one ? `lookupVar(${scope}, ${JSON.stringify(one[1])}) ?? null` : text(st.value);
        return `${indent}item = { ...item, ${JSON.stringify(st.field)}: ${v} };`;
      }
      if (st.kind === "if" && st.cond.subject === "var") {
        const cond = filterExpr(text(st.cond.left ?? ""), st.cond.op ?? "eq", text(st.cond.value ?? ""));
        const then = forEachBody(st.then, array, indent + "  ");
        const els = st.else?.length ? forEachBody(st.else, array, indent + "  ") : "";
        return `${indent}if (${cond}) {\n${then}\n${indent}}${els ? ` else {\n${els}\n${indent}}` : ""}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** リストで並べる項目の式（変数から一覧を取り出し、絞り込み・並べ替え・件数を適用） */
export function listItemsExpr(
  l: ListContent,
  base: string,
  from: string,
  ops: ListOp[]
): string {
  let code = `toItems(lookupVar(${base}, ${JSON.stringify(from)}))`;
  const pred = filterPredicate(ops, base);
  if (pred) code += `.filter((item) => ${pred})`;
  for (const o of ops) {
    if (o.kind === "filter") {
      continue;
    } else {
      // 数値どうしは数値で、それ以外は数字を数値として比べる文字列比較（エディタの compareValues と同じ）
      code += `.sort((a, b) => { const x = ${fieldExpr("a", o.field)}, y = ${fieldExpr("b", o.field)}; return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "ja", { numeric: true }))${o.dir === "desc" ? " * -1" : ""}; })`;
    }
  }
  if (l.limit && l.limit > 0) code += `.slice(0, ${l.limit})`;
  return code;
}

/** 要素かその中に、画面上で動くスクリプトがあるか */
export function hasScriptsInside(doc: SiteDoc, id: string, seen = new Set<string>()): boolean {
  const n = doc.nodes[id];
  if (!n || seen.has(id)) return false;
  seen.add(id);
  return hasRunnableScripts(n) || n.children.some((cid) => hasScriptsInside(doc, cid, seen));
}

/**
 * 画面上で値が決まる {変数} を、ブラウザで書き直す属性（data-live など）にする位置か。
 * ページ（vars）とコンポーネント・ローディング画面（{}）。リストの項目の中は項目ごとに値が変わるので除く
 */
export function livesHere(ctx: JsxContext): boolean {
  const base = ctx.varsExpr ?? "vars";
  return base === "vars" || base === "{}";
}

/** JSX の引用符属性は JavaScript の文字列ではない（バックスラッシュでエスケープできない）。 */
export function jsxHtmlString(value: string): string {
  const escapes: Record<string, string> = {
    '"': "&quot;", "<": "&lt;", ">": "&gt;", "\r": "&#13;", "\n": "&#10;", "\t": "&#9;",
  };
  return `"${value.replace(/["<>\r\n\t]/g, (char) => escapes[char])}"`;
}

/** 通常の入力値は &copy; なども文字列のまま保持する。 */
export function jsxString(value: string): string {
  return jsxHtmlString(value.replace(/&/g, "&amp;"));
}

/** サイト内の Next.js のページへのURLか（/ から始まり、リダイレクト・中継・HTMLページに当たらない） */
export function isNextPageUrl(ctx: JsxContext, url: string): boolean {
  return /^\/(?!\/)/.test(url) && !matchesHardNav(url, hardNavPatterns(Object.values(ctx.doc.pages)));
}

/** 表示するときの値で Link / a を選ぶリンク（{変数} 入りのURL用） */
export function smartLinkComponent(doc: SiteDoc): string {
  const patterns = hardNavPatterns(Object.values(doc.pages));
  return `import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

/** Next.js のページではないURL（リダイレクト・外部サイトの中継・HTMLページ） */
const HARD_NAV: RegExp[] = [${patterns.map((p) => `new RegExp(${JSON.stringify(p)})`).join(", ")}];

/**
 * サイト内のページ（/〜）は Link でページ遷移を速くし、外部URLや Next.js のページではないURLは
 * 通常のリンクにする（Link の先読みが別ドメインへ転送されると失敗するため）
 */
export default function SmartLink({ href, ...rest }: Omit<ComponentPropsWithoutRef<"a">, "href"> & { href: string }) {
  const internal = /^\\/(?!\\/)/.test(href) && !HARD_NAV.some((re) => re.test(href));
  return internal ? <Link href={href} {...rest} /> : <a href={href} {...rest} />;
}
`;
}

/** <p> の中に置くと、ブラウザが <p> を閉じてしまうタグ（HTML の構文解析の規則） */
const P_CLOSING_TAGS = new Set([
  "address", "article", "aside", "blockquote", "center", "dd", "details", "dialog", "dir", "div",
  "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "header", "hgroup", "hr", "li", "listing", "main", "menu", "nav", "ol", "p", "plaintext",
  "pre", "search", "section", "summary", "table", "ul", "xmp",
  // 中身が決まらない・ブロックで出すもの（コンポーネント・リスト・HTMLコード・埋め込み）
  "comp", "list", "SearchForm",
]);

/** 子孫に <p> の中に置けないタグで出す要素があるか */
export function hasBlockDescendant(doc: SiteDoc, node: DocNode, seen = new Set<string>([node.id])): boolean {
  return node.children.some((id) => {
    const child = doc.nodes[id];
    if (!child || seen.has(id)) return false;
    seen.add(id);
    if (child.type === "embed" || child.type === "code") return true;
    return P_CLOSING_TAGS.has(resolveTag(child, false)) || hasBlockDescendant(doc, child, seen);
  });
}

/** ImageRef → サイト内パス or 外部URL（アセットは public/assets/ に同梱される） */
export function imageRefSrc(
  assetNames: Map<string, string>,
  ref: ImageRef | null | undefined
): string | null {
  if (!ref) return null;
  if (ref.assetId && assetNames.has(ref.assetId)) {
    return `/assets/${assetNames.get(ref.assetId)}`;
  }
  return ref.url?.trim() || null;
}
