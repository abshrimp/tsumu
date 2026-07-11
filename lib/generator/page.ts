/**
 * ページ1枚分のファイル（page.tsx と、URLの値で切り替えるページ）の書き出し
 */

import type { DocNode, ScriptStep, SiteDoc } from "../types";
import { pageLangOf, siteLangOf } from "../site-lang";
import { fieldVarNames } from "../fields";
import { sendsBody } from "../fetch-request";
import { extractVars, hasVars, pageQueryVars } from "../vars";
import {
  filterConds,
  idVarNodesOf,
  ITEM_VALUE,
  listFromOf,
  nodeTextTemplate,
  pagePlan,
  previewDataVars,
  primaryDataStep,
  setVarSource,
} from "../data";
import { resolveTag } from "../tags";
import { walkSteps } from "../script";
import { DEFAULT_DATA_REVALIDATE } from "../types";
import {
  dynamicOrigin,
  fetchInitExpr,
  filterPredicate,
  forEachBody,
  imageRefSrc,
  jsxString,
  scriptsAttr,
} from "./render-helpers";
import { renderNode, type JsxContext } from "./render";
import { RUNNABLE_SCRIPT } from "./templates";

/** クエリを比較用にそろえる（キー順に並べ替え） */
export function normalizeQuery(query: string | undefined): string {
  const params = new URLSearchParams(query ?? "");
  params.sort();
  return params.toString();
}

/**
 * 同じURLをクエリで分けたページの振り分け（page.tsx）。
 * クエリが一致するページのうち、条件の多いものを表示する。
 * どれにも一致しなければクエリなしのページ、なければ先頭のページ。
 */
export function queryDispatcherFile(queries: (string | undefined)[]): string {
  const imports = queries
    .map((_, i) => `import * as p${i} from "./_q/p${i}";`)
    .join("\n");
  const entries = queries
    .map((q, i) => {
      const query: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(q ?? "")) if (k) query[k] = v;
      return `  { query: ${JSON.stringify(query)}, mod: p${i} as unknown as Variant["mod"] },`;
    })
    .join("\n");
  return `import type { Metadata } from "next";
import type { ReactNode } from "react";
${imports}

type Props = {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
type Variant = {
  query: Record<string, string>;
  mod: {
    default: (props: Props) => ReactNode | Promise<ReactNode>;
    metadata?: Metadata;
    generateMetadata?: (props: Props) => Promise<Metadata>;
  };
};

const variants: Variant[] = [
${entries}
];

// クエリで表示するページが変わるため、毎リクエスト振り分ける
export const dynamic = "force-dynamic";

async function pick(props: Props): Promise<Variant["mod"]> {
  const sp = await props.searchParams;
  let best = variants[0];
  let score = -1;
  for (const v of variants) {
    const keys = Object.keys(v.query);
    const ok = keys.every((k) => {
      const value = sp[k];
      return (Array.isArray(value) ? value[0] : value) === v.query[k];
    });
    if (ok && keys.length > score) {
      best = v;
      score = keys.length;
    }
  }
  return best.mod;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const mod = await pick(props);
  return mod.generateMetadata ? mod.generateMetadata(props) : (mod.metadata ?? {});
}

export default async function Page(props: Props) {
  const mod = await pick(props);
  return mod.default(props);
}
`;
}

export function generatePageFile(
  ctx: JsxContext,
  pageId: string,
  opts: { notFound?: boolean } = {}
): string {
  const doc = ctx.doc;
  const page = doc.pages[pageId];
  const slug = page.slug.replace(/^\/+|\/+$/g, "");
  const isSlugPg = slug.includes("[slug]");
  // not-found.tsx は params / searchParams / metadata を持てない
  const nf = !!opts.notFound;
  ctx.usesImage = false;
  ctx.usesLink = false;
  ctx.usesSmartLink = false;
  ctx.usesFragment = false;
  ctx.usesSearchForm = false;
  ctx.usesInterpolate = false;
  ctx.usesLookup = false;
  ctx.usesTemplate = false;
  ctx.usesPageHtml = false;
  ctx.inTemplate = false;
  ctx.usedComponents = new Set();
  ctx.varsExpr = "vars";
  const plan = pagePlan(doc, pageId);
  ctx.liveNames = new Set(plan.clientVars);
  for (const n of idVarNodesOf(doc, pageId)) if (n.type === "field") fieldVarNames(n).forEach((v) => ctx.liveNames.add(v));

  // ページ内のリスト（コンポーネント内は未対応）と、ページを開いたときに取得するデータ
  const listNodes: { node: DocNode; from: string }[] = [];
  const listSeen = new Set<string>();
  const walkLists = (id: string) => {
    const n = doc.nodes[id];
    if (!n || listSeen.has(id)) return;
    listSeen.add(id);
    const from = n.type === "list" && n.list ? listFromOf(n) : undefined;
    if (from) listNodes.push({ node: n, from });
    n.children.forEach(walkLists);
  };
  page.children.forEach(walkLists);
  ctx.listOps = plan.listOps;
  ctx.listVars = new Map(
    listNodes.map((l, i) => [
      l.node.id,
      { ivar: `iv${i}`, from: l.from, client: plan.clientVars.has(l.from.split(".")[0]) },
    ])
  );
  const loads = nf ? [] : plan.steps.filter((st) => st.kind !== "fetch" || st.url.trim());
  /** [slug]ページのメタデータ・404判定に使うデータ */
  const primary = nf ? null : (primaryDataStep(doc, pageId)?.step ?? null);

  const rendered = page.children
    .map((id) => renderNode(ctx, id, "      ", true))
    .join("\n");
  // ページ専用コード（先頭 / 末尾）。display:contents でレイアウトに影響させない。
  // 計測タグなど動くスクリプトがあれば、ページ遷移で表示したときにも動かす（PageHtml）
  const htmlFrag = (html: string) => {
    if (!RUNNABLE_SCRIPT.test(html)) {
      return `      <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(html)} }} />`;
    }
    ctx.usesPageHtml = true;
    return `      <PageHtml html={${JSON.stringify(html)}} />`;
  };
  const topHtml = page.customTopHtml?.trim();
  const endHtml = page.customEndHtml?.trim();
  const parts = [
    // 「このページ」のスクリプト（データの取得以外）はページの目印に載せて動かす
    `      <span hidden data-page-body=${jsxString(page.id)}${nf ? "" : scriptsAttr(ctx, { scripts: page.pageScripts }, plan.serverIds)} />`,
    topHtml ? htmlFrag(topHtml) : null,
    rendered,
    endHtml ? htmlFrag(endHtml) : null,
  ]
    .filter(Boolean)
    .join("\n");
  // サイトと違う言語のページは、中身を lang 付きの要素で包む（<html lang> は全ページ共通のレイアウトにあり、
  // ページごとに変えるとページを作り置けなくなるため）。display: contents でレイアウトは変えない
  const lang = pageLangOf(doc, page);
  const body =
    lang === siteLangOf(doc)
      ? parts
      : `      <div lang=${jsxString(lang)} style={{ display: "contents" }}>\n${parts.replace(/^/gm, "  ")}\n      </div>`;

  const needsVars =
    loads.length > 0 ||
    listNodes.length > 0 ||
    isSlugPg ||
    ctx.usesInterpolate;

  const imports: string[] = nf
    ? []
    : ['import type { Metadata } from "next";'];
  if (loads.length) imports.push('import { fetchPublic, readTextLimited } from "@/lib/safe-fetch";');
  if (isSlugPg && primary)
    imports.push('import { notFound } from "next/navigation";');
  const reactImports = [
    ...(ctx.usesFragment ? ["Fragment"] : []),
    ...(loads.length ? ["cache"] : []),
  ];
  if (reactImports.length) imports.push(`import { ${reactImports.join(", ")} } from "react";`);
  if (ctx.usesLink) imports.push('import Link from "next/link";');
  if (ctx.usesSmartLink) imports.push('import SmartLink from "@/components/SmartLink";');
  if (ctx.usesImage) imports.push('import Image from "next/image";');
  if (ctx.usesSearchForm)
    imports.push('import SearchForm from "@/components/SearchForm";');
  if (ctx.usesPageHtml) imports.push('import PageHtml from "@/components/PageHtml";');
  if (needsVars)
    imports.push(
      `import { safeNavigationUrl, interpolate, interpolateUrl${loads.some((st) => st.kind === "fetch" && !!fetchInitExpr(st)?.includes("interpolateJson(")) ? ", interpolateJson" : ""}${listNodes.length || ctx.usesLookup || loads.some((st) => st.kind === "array-find" || st.kind === "array-field" || st.kind === "for-each" || st.kind === "join" || st.kind === "count" || st.kind === "set-var") ? ", lookupVar" : ""}${loads.some((st) => st.kind === "join") ? ", varText" : ""} } from "@/lib/vars";`
    );
  for (const compId of ctx.usedComponents) {
    const name = ctx.componentNames.get(compId)!;
    imports.push(`import ${name} from "@/components/${name}";`);
  }

  const metadata: string[] = [
    `  title: ${JSON.stringify(page.title || page.name)},`,
  ];
  if (page.description)
    metadata.push(`  description: ${JSON.stringify(page.description)},`);
  if (page.noindex) metadata.push(`  robots: { index: false, follow: false },`);

  const ogSrc =
    imageRefSrc(ctx.assetNames, page.ogImage) ??
    imageRefSrc(ctx.assetNames, doc.ogImage);
  if (ogSrc) {
    const ogParts = [
      `    title: ${JSON.stringify(page.title || page.name)},`,
      page.description
        ? `    description: ${JSON.stringify(page.description)},`
        : null,
      `    images: [${JSON.stringify(ogSrc)}],`,
    ].filter(Boolean);
    metadata.push(`  openGraph: {\n${ogParts.join("\n")}\n  },`);
    metadata.push(`  twitter: { card: "summary_large_image" },`);
  }

  if (!needsVars) {
    return `${imports.length ? imports.join("\n") + "\n\n" : ""}${
      nf
        ? ""
        : `export const metadata: Metadata = {\n${metadata.join("\n")}\n};\n\n`
    }export default function Page() {
  return (
    <>
${body}
    </>
  );
}
`;
  }

  /* ---- データを使うページ: 一定時間ごとに作り直す（ISR）か、毎リクエスト取得 ---- */

  // URL のクエリをサーバー側で使うページ（検索フォームの送信先など）は作り置きできない
  const revalidate = nf ? 0 : dataRevalidateOf(doc);
  const cacheable =
    revalidate > 0 && !pageHasSearchForm(doc, pageId) && !pageReadsQuery(doc, pageId, plan);
  // Cloudflare Workers（OpenNext）は追加の設定（R2・キュー）なしでは ISR の作り直しが動かないため、
  // ページは毎回描画し、取得したJSONだけを Cloudflare のキャッシュに置く
  const edgeCache = cacheable && doc.hosting === "cloudflare";
  const isr = cacheable && !edgeCache;

  const helpers: string[] = [];
  if (loads.length) {
    helpers.push(`/** 同じリクエスト内（メタデータとページ本体）では、同じURLを1回だけ取得する */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
${
      isr
        ? `const fetchJson = cache(async (url: string, init?: string, origin?: string): Promise<any> => {
  if (!safeRequestOrigin(url, init, origin)) return null;
  const res = await fetchPublic(url, { ...(init ? JSON.parse(init) : {}), next: { revalidate: ${revalidate} } });${
    isSlugPg && primary
      ? `
  // 見つからないときはデータ無しにする（中心のデータが無ければページを404にする）
  if (res.status === 404 || res.status === 410) return null;`
      : ""
  }
  // 取得に失敗したら作り直しをやめ、前に作ったページを配信し続ける
  if (!res.ok) throw new Error(\`データの取得に失敗しました（\${res.status}）\`);
  return JSON.parse(await readTextLimited(res, 5 * 1024 * 1024));
});`
        : edgeCache
          ? `const fetchJson = cache(async (url: string, init?: string, origin?: string): Promise<any> => {
  try {
    if (!safeRequestOrigin(url, init, origin)) return null;
    // Cloudflare のキャッシュに ${revalidate}秒だけ置く（独自ドメインで有効。ほかの環境では毎回取得）
    const req: RequestInit & { cf?: Record<string, unknown> } = {
      ...(init ? JSON.parse(init) : {}),
      ...(!init ? { cf: { cacheTtl: ${revalidate}, cacheEverything: true } } : { cache: "no-store" as const }),
    };
    if (!safeRequestOrigin(url, init, origin)) return null;
    const res = await fetchPublic(url, req);
    return res.ok ? JSON.parse(await readTextLimited(res, 5 * 1024 * 1024)) : null;
  } catch {
    return null;
  }
});`
          : `const fetchJson = cache(async (url: string, init?: string, origin?: string): Promise<any> => {
  try {
    if (!safeRequestOrigin(url, init, origin)) return null;
    const res = await fetchPublic(url, { ...(init ? JSON.parse(init) : {}), cache: "no-store" });
    return res.ok ? JSON.parse(await readTextLimited(res, 5 * 1024 * 1024)) : null;
  } catch {
    return null;
  }
});`
    }

${loads.some((st) => st.kind === "array-find" || st.kind === "join") ? `/** "products.0" のような位置を掘る（配列の "-1" は最後の要素） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dig(v: any, path: string[]): unknown {
  for (const k of path) v = Array.isArray(v) && k === "-1" ? v[v.length - 1] : v?.[k];
  return v ?? null;
}

` : ""}${loads.some((st) => st.kind === "array-find") ? `/** 一覧から field が key の1件を探す（URLの値はエンコードされていることがある） */
function findIn(list: unknown, field: string, key: string): unknown {
  if (!Array.isArray(list)) return null;
  const path = field.split(".");
  return (
    list.find((item) => {
      const v = String(dig(item, path) ?? "");
      return v === key || encodeURIComponent(v) === key;
    }) ?? null
  );
}

` : ""}${loads.some((st) => st.kind === "join") ? `/** 配列の要素（まとまりなら path の値）を区切り文字でつなぐ */
function joinArray(v: unknown, path: string[], sep: string): string {
  if (!Array.isArray(v)) return varText(v);
  return v
    .map((x) => (path.length && x && typeof x === "object" ? dig(x, path) : x))
    .map((x) => (x == null || typeof x === "object" ? "" : String(x)))
    .filter((x) => x !== "")
    .join(sep);
}

` : ""}${loads.some((st) => st.kind === "array-field") ? `/** 配列の各要素に項目 field を足す（{名前} だけなら値をそのまま、ほかは文字にして入れる） */
function withItemField(v: unknown, field: string, tpl: string, vars: Vars): unknown {
  if (!Array.isArray(v)) return v;
  const one = /^\\{([^{}\\s"'<>\`]+)\\}$/.exec(tpl.trim());
  return v.map((x) => {
    if (x == null || Array.isArray(x)) return x;
    const item = typeof x === "object" ? (x as Vars) : { ${JSON.stringify(ITEM_VALUE)}: x };
    const scope = { ...vars, ...item };
    return { ...item, [field]: one ? (lookupVar(scope, one[1]) ?? null) : interpolate(tpl, scope) };
  });
}

` : ""}${loads.some((st) => (st.kind === "array-field" || st.kind === "for-each") && st.array.includes(".")) ? `/** "記事.tags" のような入れ子の位置に、途中を複製して値を入れる */
function setIn(cur: unknown, keys: string[], value: unknown): unknown {
  if (!keys.length) return value;
  const [k, ...rest] = keys;
  if (Array.isArray(cur)) {
    const copy = cur.slice();
    copy[Number(k)] = setIn(cur[Number(k)], rest, value);
    return copy;
  }
  const obj = cur && typeof cur === "object" ? (cur as Vars) : {};
  return { ...obj, [k]: setIn(obj[k], rest, value) };
}

` : ""}${loads.some((st) => st.kind === "split") ? `/** 文字列を区切り文字で分解する（前後の空白を除き、空の要素は捨てる） */
function splitText(text: string, sep: string): string[] {
  return text
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
}

` : ""}/** 認証情報や本文のある取得は、編集時に決めたオリジンに限る。 */
function safeRequestOrigin(url: string, init?: string, origin?: string): boolean {
  try { return !!url && (!init || (!!origin && new URL(url).origin === origin)); }
  catch { return false; }
}

/** スクリプト「ページを開いたとき」のデータのブロックを上から順に実行する */
async function loadData(vars: Vars) {
${loads
  .map((st) => {
    const path = (p: string) =>
      JSON.stringify(
        p
          .split(".")
          .map((k) => k.trim())
          .filter(Boolean)
      );
    switch (st.kind) {
      case "fetch": {
        if (!st.as) return "";
        // メソッド・ヘッダー・本文（キャッシュのキーにするため、文字にして渡す）
        const init = fetchInitExpr(st);
        const url = `interpolateUrl(${JSON.stringify(st.url.trim())}, vars)`;
        // すべての取得先を接続時・転送時にも検査する。資格情報は変数で決まるホストへ送らない。
        // 読めないURL（ホストに空白があるなど）は書き出しを止めず、資格情報を送らない側に倒す
        let origin: string | undefined;
        try {
          origin = !dynamicOrigin(st.url) ? new URL(st.url.trim()).origin : undefined;
        } catch {
          origin = undefined;
        }
        return `  vars[${JSON.stringify(st.as)}] = await fetchJson(${url}${init ? `, JSON.stringify(${init}), ${JSON.stringify(origin) ?? "undefined"}` : ""});`;
      }
      case "split":
        return st.into
          ? `  vars[${JSON.stringify(st.into)}] = splitText(interpolate(${JSON.stringify(st.source)}, vars), ${JSON.stringify(st.sep || ",")});`
          : "";
      case "array-find":
        return st.into && st.array && st.field
          ? `  vars[${JSON.stringify(st.into)}] = findIn(lookupVar(vars, ${JSON.stringify(st.array)}), ${JSON.stringify(st.field)}, interpolate(${JSON.stringify(st.value)}, vars));`
          : "";
      case "count": {
        if (!st.into || !st.array) return "";
        // それまでに絞り込んでいれば、絞り込み後の件数
        const pred = filterPredicate(plan.countFilters.get(st.id) ?? [], "vars");
        const items = pred
          ? `v.map((x) => (x != null && typeof x === "object" ? x : { ${JSON.stringify(ITEM_VALUE)}: x })).filter((item) => ${pred}).length`
          : "v.length";
        return `  vars[${JSON.stringify(st.into)}] = ((v) => (Array.isArray(v) ? ${items} : 0))(lookupVar(vars, ${JSON.stringify(st.array)}));`;
      }
      case "array-field": {
        if (!st.array || !st.field) return "";
        const val = `withItemField(lookupVar(vars, ${JSON.stringify(st.array)}), ${JSON.stringify(st.field)}, ${JSON.stringify(st.value)}, vars)`;
        if (!st.array.includes(".")) return `  vars[${JSON.stringify(st.array)}] = ${val};`;
        const [root, ...rest] = st.array.split(".");
        return `  if (${JSON.stringify(st.array)} in vars) vars[${JSON.stringify(st.array)}] = ${val};\n  else vars[${JSON.stringify(root)}] = setIn(vars[${JSON.stringify(root)}], ${JSON.stringify(rest)}, ${val});`;
      }
      case "for-each": {
        const body = st.array ? forEachBody(st.then, st.array, "    ") : "";
        if (!body) return "";
        const val = `((v) => (Array.isArray(v) ? v.map((x) => {
    if (x == null || Array.isArray(x)) return x;
    const start: Vars = typeof x === "object" ? (x as Vars) : { ${JSON.stringify(ITEM_VALUE)}: x };
    let item = start;
${body}
    return item === start ? x : item;
  }) : v))(lookupVar(vars, ${JSON.stringify(st.array)}))`;
        if (!st.array.includes(".")) return `  vars[${JSON.stringify(st.array)}] = ${val};`;
        const [root, ...rest] = st.array.split(".");
        return `  if (${JSON.stringify(st.array)} in vars) vars[${JSON.stringify(st.array)}] = ${val};\n  else vars[${JSON.stringify(root)}] = setIn(vars[${JSON.stringify(root)}], ${JSON.stringify(rest)}, ${val});`;
      }
      case "set-var": {
        const from = setVarSource(st);
        return st.into && from
          ? `  vars[${JSON.stringify(st.into)}] = lookupVar(vars, ${JSON.stringify(from)}) ?? null;`
          : "";
      }
      case "join":
        return st.into && st.array
          ? `  vars[${JSON.stringify(st.into)}] = joinArray(lookupVar(vars, ${JSON.stringify(st.array)}), ${path(st.field ?? "")}, ${JSON.stringify(st.sep)});`
          : "";
    }
  })
  .filter(Boolean)
  .join("\n")}
}`);
  }
  if (listNodes.some((l) => !ctx.listVars?.get(l.node.id)?.client)) {
    helpers.push(`/** リストで並べる項目にする（オブジェクトはそのまま、文字や数値は {${ITEM_VALUE}} に入れる） */
function toItems(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): Item[] =>
    x == null || Array.isArray(x) ? [] : typeof x === "object" ? [x as Item] : [{ ${JSON.stringify(ITEM_VALUE)}: x }]
  );
}`);
  }
  if (ctx.usesTemplate) {
    helpers.push(`/** ブラウザで並べるリストのお手本用: ページの変数に無い {名前} はそのまま残す */
function templateVars(vars: Vars): Vars {
  return new Proxy(vars, {
    has: () => true,
    // 文字としての「{」は「\\{」のまま残し、複製するときに置き換える
    get: (t, k) =>
      typeof k !== "string" ? undefined : k === "\\u0000keepEscapes" ? true : k in t ? t[k] : \`{\${k}}\`,
  });
}`);
  }

  const paramSig = [
    isSlugPg ? "params" : null,
    isr ? null : "searchParams",
  ]
    .filter(Boolean)
    .join(",\n  ");
  const paramTypes = [
    isSlugPg ? "params: Promise<{ slug: string }>;" : null,
    isr ? null : "searchParams: Promise<Record<string, string | string[] | undefined>>;",
  ]
    .filter(Boolean)
    .join("\n  ");
  const fnParams = nf || (isr && !isSlugPg)
    ? ""
    : `{
  ${paramSig},
}: {
  ${paramTypes}
}`;

  // ID付きテキスト要素の内容を {ID} 変数にする（リスト内は項目ごとのため除外）
  const textVarNodes = idVarNodesOf(doc, pageId).filter(
    (n) => n.type !== "field"
  );
  const textVarsPrep = textVarNodes
    .map((n) => {
      const tpl = nodeTextTemplate(doc, n);
      return hasVars(tpl)
        ? `  vars[${JSON.stringify(n.attrId)}] = interpolate(${JSON.stringify(tpl)}, vars);`
        : `  vars[${JSON.stringify(n.attrId)}] = ${JSON.stringify(tpl)};`;
    })
    .join("\n");

  // ページの変数（URLのクエリ → [slug] → ID付きテキスト）。メタデータも同じ値でデータを取得する
  const varsPrep = nf
    ? `  const vars: Vars = {};
${textVarsPrep ? textVarsPrep + "\n" : ""}`
    : `  const vars: Vars = {};
${
        isr
          ? ""
          : `  const sp = await searchParams;
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") vars[k] = v;
  }
`
      }${isSlugPg ? `  // URLの [slug] は、同じ名前のクエリより優先する\n  const { slug } = await params;\n  vars.slug = slug;\n` : ""}${textVarsPrep ? textVarsPrep + "\n" : ""}`;

  // メタデータ: [slug]ページは最初のデータからタイトルを引く
  let metaBlock = nf
    ? ""
    : `export const metadata: Metadata = {
${metadata.join("\n")}
};`;
  if (isSlugPg && primary) {
    // タイトルに使う項目は、エディタで取得した見本から探す
    const sample = previewDataVars(doc, pageId)[primary.into];
    const titleField =
      (sample && typeof sample === "object" && !Array.isArray(sample)
        ? Object.keys(sample).find((f) => /^(title|name|タイトル|名前)$/i.test(f))
        : null) ?? null;
    const key = JSON.stringify(primary.into);
    const fallbackTitle = JSON.stringify(page.title || page.name);
    const hasExtraMeta = Boolean(page.description || page.noindex || ogSrc);
    if (!hasExtraMeta) {
      metaBlock = `export async function generateMetadata(${fnParams}): Promise<Metadata> {
${varsPrep}  await loadData(vars);
  const data = vars[${key}] as Item | null;
  ${
    titleField
      ? `if (data) return { title: String(data[${JSON.stringify(titleField)}] ?? "") };
  `
      : ""
  }return { title: ${fallbackTitle} };
}`;
    } else {
      const titleExpr = titleField
        ? `data ? String(data[${JSON.stringify(titleField)}] ?? "") : ${fallbackTitle}`
        : fallbackTitle;
      const descVal = page.description ? JSON.stringify(page.description) : null;
      const dynParts: string[] = [`    title,`];
      if (descVal) dynParts.push(`    description: ${descVal},`);
      if (page.noindex) dynParts.push(`    robots: { index: false, follow: false },`);
      if (ogSrc) {
        const ogParts = [
          `      title,`,
          descVal ? `      description: ${descVal},` : null,
          `      images: [${JSON.stringify(ogSrc)}],`,
        ].filter(Boolean);
        dynParts.push(`    openGraph: {\n${ogParts.join("\n")}\n    },`);
        dynParts.push(`    twitter: { card: "summary_large_image" },`);
      }
      metaBlock = `export async function generateMetadata(${fnParams}): Promise<Metadata> {
${varsPrep}  await loadData(vars);
  const data = vars[${key}] as Item | null;
  const title = ${titleExpr};
  return {
${dynParts.join("\n")}
  };
}`;
    }
  }

  // ページを開いたときのデータを取得（[slug]ページは中心のデータが無ければ404）。
  // ID付きテキストはデータを使うこともあるため、取得後に作り直す
  const dataPrep = loads.length
    ? [
        "  await loadData(vars);",
        primary ? `  if (!vars[${JSON.stringify(primary.into)}]) notFound();` : "",
        textVarsPrep,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return `${imports.length ? imports.join("\n") + "\n\n" : ""}${
    nf
      ? ""
      : isr
        ? `// ${revalidate}秒ごとにJSONを取得し直してページを作り直す（その間は作ったページを配信する）
export const revalidate = ${revalidate};

`
        : edgeCache
          ? `// ページはアクセスのたびに描画し、JSONは Cloudflare のキャッシュから${revalidate}秒ごとに取り直す
export const dynamic = "force-dynamic";

`
          : `// JSONを毎リクエスト取得し、常に最新の内容を配信する
export const dynamic = "force-dynamic";

`
  }type Item = Record<string, unknown>;
type Vars = Record<string, unknown>;

${helpers.join("\n\n")}
${metaBlock ? "\n" + metaBlock + "\n" : ""}
export default async function Page(${fnParams}) {
${varsPrep}${dataPrep ? dataPrep + "\n" : ""}  return (
    <>
${body}
    </>
  );
}
`;
}


/**
 * ページに検索フォームがあるか（コンポーネントの中も見る）。
 * 送信した値は URL のクエリで届くので、ページはアクセスごとに作る
 */
function pageHasSearchForm(doc: SiteDoc, pageId: string): boolean {
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const n = doc.nodes[id];
    if (!n) return false;
    if (n.type === "instance") {
      const comp = doc.components?.[n.componentId ?? ""];
      return !!comp && walk(comp.rootId);
    }
    return resolveTag(n, false) === "form" || n.children.some(walk);
  };
  return doc.pages[pageId]?.children.some(walk) ?? false;
}

/** JSONを取得するページを作り直す間隔（秒。0 = アクセスのたびに取得） */
function dataRevalidateOf(doc: SiteDoc): number {
  const n = doc.dataRevalidate ?? DEFAULT_DATA_REVALIDATE;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * ページを配信する前（サーバー側）に URL のクエリの値を使うか。
 * 使うページはアクセスごとに作る必要があり、作り置き（ISR）にできない
 */
function pageReadsQuery(doc: SiteDoc, pageId: string, plan: ReturnType<typeof pagePlan>): boolean {
  const page = doc.pages[pageId];
  if (Object.keys(pageQueryVars(page.query)).length) return true;

  // ページ内で値が決まる名前（スクリプトで作る変数・ID付きテキスト・[slug]）
  const known = new Set<string>(["slug"]);
  const itemKeys = new Set<string>([ITEM_VALUE]);
  const addItemKeys = (v: unknown, inArray: boolean, depth: number) => {
    if (v == null || typeof v !== "object" || depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => addItemKeys(x, true, depth + 1));
    for (const [k, x] of Object.entries(v)) {
      if (inArray) itemKeys.add(k);
      addItemKeys(x, false, depth + 1);
    }
  };
  const addDefined = (steps: ScriptStep[]) => {
    for (const st of steps) {
      if (st.kind === "fetch") {
        if (st.as) known.add(st.as);
        addItemKeys(st.sample, false, 0);
      }
      if (
        (st.kind === "array-field" || st.kind === "array-find" || st.kind === "join" || st.kind === "sort-array") &&
        st.field
      ) {
        itemKeys.add(st.field.split(".")[0]);
      }
      if (st.kind === "filter-array") {
        for (const c of filterConds(st)) itemKeys.add(c.field.split(".")[0]);
      }
      if ("into" in st && st.into) known.add(st.into);
      if (st.kind === "if") {
        addDefined(st.then);
        if (st.else) addDefined(st.else);
      } else if (st.kind === "repeat" || st.kind === "for-each") addDefined(st.then);
    }
  };
  for (const s of [...(page.pageScripts ?? []), ...(page.scripts ?? [])]) addDefined(s.steps);
  for (const n of idVarNodesOf(doc, pageId)) {
    if (n.type === "field") fieldVarNames(n).forEach((v) => known.add(v));
    else if (n.attrId) known.add(n.attrId);
  }

  const unknown = (str: string | undefined, inList: boolean) =>
    !!str &&
    extractVars(str).some((name) => {
      const root = name.split(".")[0];
      return !known.has(root) && !(inList && itemKeys.has(root));
    });

  // サーバー側で動くデータのブロック・リストの絞り込み
  for (const st of plan.steps) {
    if (
      st.kind === "fetch" &&
      (unknown(st.url, false) ||
        (st.headers ?? []).some((h) => unknown(h.name, false) || unknown(h.value, false)) ||
        (sendsBody(st.method) && unknown(st.body, false)))
    ) {
      return true;
    }
    if ("value" in st && unknown(st.value, false)) return true;
    if (st.kind === "split" && unknown(st.source, false)) return true;
    if (st.kind === "for-each") {
      // 中では要素の項目も使える
      let found = false;
      walkSteps(st.then, (x) => {
        if (x.kind === "array-field" && unknown(x.value, true)) found = true;
        if (x.kind === "if" && (unknown(x.cond.left, true) || unknown(x.cond.value, true))) found = true;
      });
      if (found) return true;
    }
  }
  for (const ops of plan.listOps.values()) {
    for (const op of ops) {
      if (op.kind === "filter" && op.conds.some((c) => unknown(c.value, false))) return true;
    }
  }
  // サーバー側で描く要素（スクリプトはブラウザで動くので対象外）
  const seen = new Set<string>();
  const walk = (id: string, inList: boolean): boolean => {
    const n = doc.nodes[id];
    if (!n || seen.has(id)) return false;
    seen.add(id);
    const f = n.field;
    if (
      unknown(n.text?.content, inList) ||
      unknown(n.image?.src, inList) ||
      (n.link?.kind === "url" && unknown(n.link.url, inList)) ||
      (f &&
        (unknown(f.label, inList) ||
          unknown(f.defaultValue, inList) ||
          unknown(f.placeholder, inList) ||
          unknown(f.min, inList) ||
          unknown(f.max, inList) ||
          unknown(f.step, inList) ||
          unknown(f.accept, inList) ||
          (f.options ?? []).some((o) => unknown(o, inList))))
    ) {
      return true;
    }
    const childInList = inList || n.type === "list";
    if (n.type === "instance") {
      const comp = doc.components?.[n.componentId ?? ""];
      if (comp && walk(comp.rootId, childInList)) return true;
    }
    return n.children.some((cid) => walk(cid, childInList));
  };
  return page.children.some((id) => walk(id, false));
}

/**
 * ページURLから app/ の下のフォルダ名を作る。「_」で始まるフォルダは Next.js では
 * 非公開フォルダ（URLにならない）なので、URLの「_」を表す %5F で始める
 */
export function routeDir(slug: string): string {
  return slug
    .split("/")
    // 「.」「..」の区切りや使えない文字は、プロジェクトの外を指すパスにしない（AI・取り込んだデータの URL も通る）
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map((seg) => seg.replace(/[^A-Za-z0-9._~\-\[\]]/g, "-"))
    .map((seg) => (seg.startsWith("_") ? `%5F${seg.slice(1)}` : seg))
    .join("/");
}

/**
 * リンクの中のリンクを「クリックしたとき → 開く」のスクリプトにする（doc を書き換える）。
 * <a> の中に <a> は置けず、ブラウザが外側のリンクを途中で閉じるため、サーバーの HTML と
 * React の描画が食い違う（ハイドレーションエラー）。リンクの中でクリックのスクリプトを持つ要素は、
 * ランタイムが外側のリンクを開かずに動かす。コンポーネントは、リンクの中で使われていれば変える
 */
export function unnestLinks(doc: SiteDoc) {
  const nested = new Set<string>();
  const seen = new Set<string>();
  const walk = (id: string, inLink: boolean) => {
    const key = `${id}\n${inLink}`;
    if (seen.has(key)) return;
    seen.add(key);
    const n = doc.nodes[id];
    if (!n) return;
    if (n.type === "instance") {
      const comp = doc.components?.[n.componentId ?? ""];
      if (comp) walk(comp.rootId, inLink);
      return;
    }
    if (n.link && inLink) nested.add(id);
    n.children.forEach((cid) => walk(cid, inLink || !!n.link));
  };
  for (const page of Object.values(doc.pages)) page.children.forEach((id) => walk(id, false));
  for (const comp of Object.values(doc.components ?? {})) walk(comp.rootId, false);
  for (const id of nested) {
    const n = doc.nodes[id];
    const l = n.link!;
    const newTab = l.newTab ? { newTab: true } : {};
    // 行き先は <a> の href と同じ（ページ未選択は URL、URL も空なら #）
    const step: ScriptStep =
      l.kind === "page" && l.pageId
        ? { id: `${id}_link`, kind: "open-page", pageId: l.pageId, ...newTab }
        : { id: `${id}_link`, kind: "open-url", url: l.url || "#", ...newTab };
    n.scripts = [
      { id: `${id}_link`, trigger: "click", steps: [step], pos: l.pos ?? { x: 0, y: 0 } },
      ...(n.scripts ?? []),
    ];
    n.link = null;
  }
}
