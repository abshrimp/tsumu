/**
 * ページ1枚分のファイル（page.tsx と、URL の値で切り替えるページ）の書き出し
 */

import type { DocNode, Page, ScriptStep, SiteDoc } from "../types";
import { pageLangOf, siteLangOf } from "../site-lang";
import { fieldVarNames } from "../fields";
import { sendsBody } from "../fetch-request";
import { extractVars, hasVars, interpolate, pageQueryVars } from "../vars";
import { pageQueryConditions } from "../page-query";
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
import { compileScripts, matchVariableWrites } from "../script";
import { DEFAULT_DATA_REVALIDATE } from "../types";
import {
  dynamicOrigin,
  fetchInitExpr,
  imageRefSrc,
  jsxString,
  scriptsAttr,
  hasListsInside,
} from "./render-helpers";
import { renderNode, type JsxContext } from "./render";
import { cssValue } from "./css";
import { RUNNABLE_SCRIPT } from "./templates";
import { deferRunnableScripts } from "./defer-scripts";
import { codeLiteral } from "./code-literal";
import { parseValueLiteral } from "../value-semantics";

export { normalizeQuery } from "../vars";

/** ページの import と、プロジェクトのファイルの出力で共有する。 */
export function writesNestedPageValue(step: ScriptStep): boolean {
  return (step.kind === "fetch" ? step.as : "into" in step ? step.into : "")?.includes(".") ?? false;
}

export function needsPageStepRunner(step: ScriptStep): boolean {
  return step.kind === "for-each" || step.kind === "if" || step.kind === "repeat" ||
    step.kind === "set-list-item" || step.kind === "remove-list-item";
}

/** 同じパスのページを配信時の判定順にまとめ、各ページの位置をIDで引けるようにする。 */
export function indexQueryVariants(pages: readonly Page[]) {
  const groups = new Map<string, Page[]>();
  for (const page of pages) {
    if (page.redirectTo !== undefined || page.rewriteTo !== undefined || page.rawHtml?.trim() ||
        page.slug.replace(/^\/+|\/+$/g, "") === "404") continue;
    const dir = routeDir(page.slug);
    const group = groups.get(dir);
    if (group) group.push(page);
    else groups.set(dir, [page]);
  }
  const variants = new Map<string, { index: number; group: Page[] }>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((page, index) => variants.set(page.id, { index, group }));
  }
  return variants;
}

/**
 * 同じ URL をクエリで分けたページの振り分け（page.tsx）。
 * クエリが一致するページのうち、条件の多いものを表示する。
 * どれにも一致しなければクエリの無いページを、それも無ければ先頭のページを表示する。
 */
export function queryDispatcherFile(queries: (string | undefined)[]): string {
  const imports = queries
    .map((_, i) => `import * as p${i} from "./_q/p${i}";`)
    .join("\n");
  const entries = queries
    .map((q, i) => `  { query: ${codeLiteral(pageQueryConditions(q))}, mod: p${i} as unknown as Variant["mod"] },`)
    .join("\n");
  return `import type { Metadata } from "next";
import type { ReactNode } from "react";
${imports}

type Props = {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
type Variant = {
  query: [string, string][];
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
    const ok = v.query.every(([key, expected]) => {
      const value = sp[key];
      return (Array.isArray(value) ? value[0] : value) === expected;
    });
    if (ok && v.query.length > score) {
      best = v;
      score = v.query.length;
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
  // not-found.tsx は params・searchParams・metadata を持てない
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
  const idVarNodes = idVarNodesOf(doc, pageId);
  const plan = pagePlan(doc, pageId, idVarNodes);
  const writes = new Set([...plan.clientAssignmentPaths, ...plan.clientListTargets]);
  for (const n of idVarNodes) if (n.type === "field") fieldVarNames(n).forEach((v) => writes.add(v));
  const loads = nf ? [] : plan.steps.filter((st) => st.kind !== "fetch" || st.url.trim());
  const fetchedRoots = new Set(loads.flatMap(step => step.kind === "fetch" && step.as ? [step.as.split(".")[0]] : []));
  const seedPaths = new Set([...plan.clientListTargets].filter(path => fetchedRoots.has(path.split(".")[0])));
  // ブラウザが持つ既存の変数のルートには、-1 のような配列の別名も含まれる。
  // 絞り込むのは取得したルートだけで、手を付けていない隣の値はサーバーに残す。
  for (const root of plan.clientVars) if (!fetchedRoots.has(root)) writes.add(root);
  const isLivePath = matchVariableWrites(writes, plan.clientAssignmentPaths);
  ctx.isLive = (name, usage) => {
    if (!isLivePath(name, usage)) return false;
    // 書き換えられる取得したリストの親をスクリプトが明示的に読む場合は、
    // 元の構造と項目を持った親のオブジェクトや配列が必要になる。
    if (fetchedRoots.has(name.split(".")[0])) seedPaths.add(name);
    return true;
  };

  // リストを含む部品は、ページごとの配列・項目・ブラウザの変数の範囲で展開する。
  ctx.inlineComponents = new Set(Object.values(doc.components ?? {})
    .filter((comp) => hasListsInside(doc, comp.rootId)).map((comp) => comp.id));
  // 部品の中も含むリストと、ページを開いたときに取得するデータ
  const listNodes: { node: DocNode; from: string }[] = [];
  const listSeen = new Set<string>();
  const walkLists = (id: string) => {
    const n = doc.nodes[id];
    if (!n || listSeen.has(id)) return;
    listSeen.add(id);
    if (n.type === "instance") {
      const comp = doc.components?.[n.componentId ?? ""];
      if (comp) walkLists(comp.rootId);
      return;
    }
    const from = n.type === "list" && n.list ? listFromOf(n) : undefined;
    if (from) listNodes.push({ node: n, from });
    n.children.forEach(walkLists);
  };
  page.children.forEach(walkLists);
  ctx.listOps = plan.listOps;
  ctx.listVars = new Map(
    listNodes.map((l, i) => [
      l.node.id,
      { ivar: `iv${i}`, from: l.from, client: ctx.isLive(l.from) },
    ])
  );
  const hasPurePageControls = loads.some(needsPageStepRunner);
  /** [slug]ページのメタデータ・404判定に使うデータ */
  const primary = nf ? null : (primaryDataStep(doc, pageId, plan.steps)?.step ?? null);

  const rendered = page.children
    .map((id) => renderNode(ctx, id, "      ", true))
    .join("\n");
  // ページ専用のコード（先頭 / 末尾）。display: contents でレイアウトに影響させない。
  // 計測タグなど動くスクリプトがあれば、ページの遷移で表示したときにも動かす（PageHtml）
  const htmlFrag = (html: string) => {
    if (!RUNNABLE_SCRIPT.test(html)) {
      return `      <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: ${codeLiteral(html)} }} />`;
    }
    ctx.usesPageHtml = true;
    return `      <PageHtml html={${codeLiteral(html)}} staticHtml={${codeLiteral(deferRunnableScripts(html))}} />`;
  };
  // 取り込んだ HTML の断片は、Tsumu の一時的な保存先のアセットを参照していることがある。
  // デプロイした後も動くよう、そのパスを書き出したアセットに書き換える。
  const topHtml = page.customTopHtml?.trim()
    ? cssValue(doc, "rawHtml", page.customTopHtml.trim(), ctx.assetNames) : "";
  const endHtml = page.customEndHtml?.trim()
    ? cssValue(doc, "rawHtml", page.customEndHtml.trim(), ctx.assetNames) : "";
  const pageScripts = nf ? "" : scriptsAttr(ctx, { scripts: page.pageScripts }, plan.serverIds);
  // 親はすべての子孫を含んでいるため、その値は1回だけ出力する。
  const fetchedListTargets = [...seedPaths].filter(path => {
    for (let end = path.indexOf("."); end >= 0; end = path.indexOf(".", end + 1)) {
      if (seedPaths.has(path.slice(0, end))) return false;
    }
    return true;
  });
  const aliasSeeds = [...seedPaths, ...writes].some(path => path.split(".").includes("-1")) && fetchedListTargets.length > 0;
  const seedValues = aliasSeeds
    ? `listSeedEntries(vars, ${codeLiteral(fetchedListTargets)})`
    : `${codeLiteral(fetchedListTargets)}.map(path => [path, lookupVar(vars, path)])`;
  const listSeeds = fetchedListTargets.length ? ` data-list-seeds={JSON.stringify(${seedValues})}` : "";
  if (listSeeds) ctx.usesLookup = true;
  const parts = [
    // 「このページ」のスクリプト（データの取得以外）はページの目印に載せて動かす
    `      <span hidden data-page-body=${jsxString(page.id)}${listSeeds}${pageScripts} />`,
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
  if (loads.some((st) => st.kind === "transform") || hasPurePageControls)
    imports.push('import { evaluateValueRecipe as __evalValueRecipe } from "@/lib/value-recipe";');
  const stepImports = [
    ...(hasPurePageControls ? ["runPurePageSteps as __runPurePageSteps"] : []),
    ...(loads.some(writesNestedPageValue) ? ["writePageValue"] : []),
  ];
  if (stepImports.length) imports.push(`import { ${stepImports.join(", ")} } from "@/lib/page-load-steps";`);
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
      `import { safeNavigationUrl, interpolate, interpolateUrl${loads.some((st) => st.kind === "fetch" && !!fetchInitExpr(st)?.includes("interpolateJson(")) ? ", interpolateJson" : ""}${listNodes.length || ctx.usesLookup || hasPurePageControls || loads.some((st) => st.kind === "set-var" || st.kind === "transform") ? ", lookupVar" : ""} } from "@/lib/vars";`
    );
  for (const compId of ctx.usedComponents) {
    const name = ctx.componentNames.get(compId)!;
    imports.push(`import ${name} from "@/components/${name}";`);
  }

  const metadata: string[] = [
    `  title: ${codeLiteral(page.title || page.name)},`,
  ];
  if (page.description)
    metadata.push(`  description: ${codeLiteral(page.description)},`);
  if (page.noindex) metadata.push(`  robots: { index: false, follow: false },`);

  const ogSrc =
    imageRefSrc(ctx.assetNames, page.ogImage) ??
    imageRefSrc(ctx.assetNames, doc.ogImage);
  if (ogSrc) {
    const ogParts = [
      `    siteName: ${codeLiteral(doc.siteName)},`,
      `    title: ${codeLiteral(page.title || page.name)},`,
      page.description
        ? `    description: ${codeLiteral(page.description)},`
        : null,
      `    images: [${codeLiteral(ogSrc)}],`,
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

  /* ---- データを使うページ: 一定時間ごとに作り直す（ISR）か、リクエストのたびに取得する ---- */

  // URL のクエリをサーバー側で使うページ（検索フォームの送信先など）は、作り置きできない
  const revalidate = nf ? 0 : dataRevalidateOf(doc);
  const cacheable =
    revalidate > 0 && !pageHasSearchForm(doc, pageId) && !pageReadsQuery(doc, pageId, plan, idVarNodes);
  // Cloudflare Workers（OpenNext）は追加の設定（R2・キュー）なしでは ISR の作り直しが動かないため、
  // ページは毎回描画し、取得したJSONだけを Cloudflare のキャッシュに置く
  const edgeCache = cacheable && doc.hosting === "cloudflare";
  const isr = cacheable && !edgeCache;

  const assignData = (name: string, expr: string) => name.includes(".")
    ? `writePageValue(vars, ${codeLiteral(name)}, ${expr});` : `vars[${codeLiteral(name)}] = ${expr};`;
  const helpers: string[] = [];
  // 一部だけを渡した配列にも、-1 のための実際の長さと、その後の書き込みのための
  // 正規の番号が必要になる。使う項目とは別に、形を送る。
  if (aliasSeeds) helpers.push(`function listSeedEntries(vars: Vars, paths: string[]) {
  const arrays = new Map<string, number>();
  const values = new Map<string, unknown>();
  for (const path of paths) {
    let value: unknown = vars;
    const keys: string[] = [];
    const parts = path.split(".");
    for (const part of parts) {
      if (value === null || typeof value !== "object") break;
      let key = part;
      if (Array.isArray(value)) {
        arrays.set(keys.join("."), value.length);
        if (key === "length") break;
        if (key === "-1") key = String(value.length - 1);
      }
      if (!Object.prototype.hasOwnProperty.call(value, key)) break;
      keys.push(key);
      value = (value as Record<string, unknown>)[key];
      if (keys.length === parts.length) values.set(keys.join("."), value);
    }
  }
  return [...Array.from(arrays, ([path, length]) => [path, length, true]), ...values];
}`);

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

/** 認証情報や本文のある取得は、編集時に決めたオリジンに限る。 */
function safeRequestOrigin(url: string, init?: string, origin?: string): boolean {
  try { return !!url && (!init || (!!origin && new URL(url).origin === origin)); }
  catch { return false; }
}

/** スクリプト「ページを開いたとき」のデータのブロックを上から順に実行する */
async function loadData(vars: Vars) {
${loads
  .map((st) => {
    switch (st.kind) {
      case "fetch": {
        if (!st.as) return "";
        // メソッド・ヘッダー・本文（キャッシュのキーにするため、文字列にして渡す）
        const init = fetchInitExpr(st);
        const url = `interpolateUrl(${codeLiteral(st.url.trim())}, vars)`;
        // すべての取得先を、接続時と転送時にも検査する。資格情報は、変数で決まるホストへは送らない。
        // 読めない URL（ホストに空白があるなど）でも書き出しは止めず、資格情報を送らない側に倒す
        let origin: string | undefined;
        try {
          origin = !dynamicOrigin(st.url) ? new URL(st.url.trim()).origin : undefined;
        } catch {
          origin = undefined;
        }
        const request = `await fetchJson(${url}${init ? `, JSON.stringify(${init}), ${origin === undefined ? "undefined" : codeLiteral(origin)}` : ""})`;
        return "  " + assignData(st.as, request);
      }
      case "for-each":
      case "if":
      case "repeat":
      case "set-list-item":
      case "remove-list-item":
        return `  if (!__runPurePageSteps(${codeLiteral([st])}, vars, lookupVar, interpolate, __evalValueRecipe)) console.warn("Page-load script exceeded execution limits");`;
      case "transform":
        if (!st.into || !st.source) return "";
        return `  {
    const result = __evalValueRecipe(lookupVar(vars, ${codeLiteral(st.source)}), [${codeLiteral(st.transform)}], vars);
    if (result.kind === "value") ${assignData(st.into, "result.value")}
    else if (result.kind === "missing") ${assignData(st.into, "undefined")}
  }`;
      case "set-var": {
        if (!st.into) return "";
        const from = setVarSource(st);
        if (from) return "  " + assignData(st.into, `lookupVar(vars, ${codeLiteral(from)}) ?? null`);
        if (!extractVars(st.value).length) {
          const literal = interpolate(st.value, {});
          // JSON のまとまり（それ自身のキーも含む）と単一の値の型は、サーバー側に残す。
          const expression = parseValueLiteral(literal) === literal
            ? codeLiteral(literal) : `JSON.parse(${codeLiteral(literal)})`;
          return "  " + assignData(st.into, expression);
        }
        return "";
      }
    }
  })
  .filter(Boolean)
  .join("\n")}
}`);
  }
  if (listNodes.some((l) => !ctx.listVars?.get(l.node.id)?.client)) {
    helpers.push(`/** リストで並べる項目にする（オブジェクトはそのまま、文字や数値は {${ITEM_VALUE}} に入れる） */
function toItems(v: unknown): Item[] {
  if (!v || typeof v !== "object") return [];
  return Object.values(v).map((x): Item =>
    x && typeof x === "object" && !Array.isArray(x) ? x as Item : { [${codeLiteral(ITEM_VALUE)}]: x }
  );
}`);
  }
  if (ctx.usesTemplate) {
    helpers.push(`/** ブラウザで並べるリストのお手本用: ページの変数に無い {名前} はそのまま残す */
function templateVars(vars: Vars): Vars {
  return new Proxy(vars, {
    has: () => true,
    // lookupVar deliberately reads only own keys. Expose virtual own-key
    // descriptors for template placeholders without weakening JSON safety.
    getOwnPropertyDescriptor: (t, k) => Reflect.getOwnPropertyDescriptor(t, k) ??
      (typeof k === "string"
        ? { configurable: true, enumerable: false, writable: true, value: "{" + k + "}" }
        : undefined),
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
  const textVarNodes = idVarNodes.filter(
    (n) => n.type !== "field"
  );
  const textVarsPrep = textVarNodes
    .map((n) => {
      const tpl = nodeTextTemplate(doc, n);
      return hasVars(tpl)
        ? `  vars[${codeLiteral(n.attrId)}] = interpolate(${codeLiteral(tpl)}, vars);`
        : `  vars[${codeLiteral(n.attrId)}] = ${codeLiteral(tpl)};`;
    })
    .join("\n");

  // ページの変数（URL のクエリ → [slug] → ID 付きのテキスト）。メタデータも同じ値でデータを取得する
  const varsPrep = nf
    ? `  const vars: Vars = Object.create(null);
${textVarsPrep ? textVarsPrep + "\n" : ""}`
    : `  const vars: Vars = Object.create(null);
${
        isr
          ? ""
          : `  const sp = await searchParams;
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") vars[k] = v;
  }
`
      }${isSlugPg ? `  // URLの [slug] は、同じ名前のクエリより優先する\n  const { slug } = await params;\n  vars.slug = slug;\n` : ""}${textVarsPrep ? textVarsPrep + "\n" : ""}`;

  // メタデータ: [slug] のページは、最初のデータからタイトルを引く
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
    const key = codeLiteral(primary.into);
    const fallbackTitle = codeLiteral(page.title || page.name);
    const hasExtraMeta = Boolean(page.description || page.noindex || ogSrc);
    if (!hasExtraMeta) {
      metaBlock = `export async function generateMetadata(${fnParams}): Promise<Metadata> {
${varsPrep}  await loadData(vars);
  const data = vars[${key}] as Item | null;
  ${
    titleField
      ? `if (data) return { title: String(data[${codeLiteral(titleField)}] ?? "") };
  `
      : ""
  }return { title: ${fallbackTitle} };
}`;
    } else {
      const titleExpr = titleField
        ? `data ? String(data[${codeLiteral(titleField)}] ?? "") : ${fallbackTitle}`
        : fallbackTitle;
      const descVal = page.description ? codeLiteral(page.description) : null;
      const dynParts: string[] = [`    title,`];
      if (descVal) dynParts.push(`    description: ${descVal},`);
      if (page.noindex) dynParts.push(`    robots: { index: false, follow: false },`);
      if (ogSrc) {
        const ogParts = [
          `      siteName: ${codeLiteral(doc.siteName)},`,
          `      title,`,
          descVal ? `      description: ${descVal},` : null,
          `      images: [${codeLiteral(ogSrc)}],`,
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

  // ページを開いたときのデータを取得する（[slug] のページは、中心のデータが無ければ 404）。
  // ID 付きのテキストはデータを使うこともあるため、取得した後に作り直す
  const dataPrep = loads.length
    ? [
        "  await loadData(vars);",
        primary ? `  if (!vars[${codeLiteral(primary.into)}]) notFound();` : "",
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
 * 送信した値は URL のクエリで届くため、ページはアクセスのたびに作る
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

/** JSON を取得するページを作り直す間隔（秒。0 = アクセスのたびに取得） */
function dataRevalidateOf(doc: SiteDoc): number {
  const n = doc.dataRevalidate ?? DEFAULT_DATA_REVALIDATE;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * ページを配信する前（サーバー側）に、URL のクエリの値を使うか。
 * 使うページはアクセスのたびに作る必要があり、作り置き（ISR）にできない
 */
function pageReadsQuery(doc: SiteDoc, pageId: string, plan: ReturnType<typeof pagePlan>, idVarNodes: DocNode[]): boolean {
  const page = doc.pages[pageId];
  if (Object.keys(pageQueryVars(page.query)).length) return true;

  // ページ内で値が決まる名前（スクリプトで作る変数・ID 付きのテキスト・[slug]）
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
        addItemKeys(st.preview?.sample, false, 0);
      }
      if (st.kind === "list-display") {
        if (st.field) itemKeys.add(st.field.split(".")[0]);
        if (st.mode === "filter") for (const cond of filterConds(st)) itemKeys.add(cond.field.split(".")[0]);
      }
      if ("into" in st && st.into) known.add(st.into);
      if (st.kind === "if") {
        addDefined(st.then);
        if (st.else) addDefined(st.else);
      } else if (st.kind === "repeat" || st.kind === "for-each") addDefined(st.then);
    }
  };
  for (const s of [...(page.pageScripts ?? []), ...(page.scripts ?? [])]) addDefined(s.steps);
  for (const n of idVarNodes) {
    if (n.type === "field") fieldVarNames(n).forEach((v) => known.add(v));
    else if (n.attrId) known.add(n.attrId);
  }

  const unknown = (str: string | undefined, inList: boolean, keepClient = false) =>
    !!str &&
    extractVars(str).some((name) => {
      const root = name.split(".")[0];
      return !known.has(root) && !(inList && itemKeys.has(root)) && !(keepClient && plan.clientVars.has(root));
    });

  // ブラウザで実行するスクリプトも、属性を作るときに変数を解決する。
  // コンパイラと同じ値を調べ、条件分岐やくり返しの中のクエリも見落とさない。
  const scriptsReadQuery = (node: Pick<DocNode, "scripts">, inList: boolean, skip?: Set<string>) => {
    let reads = false;
    compileScripts(node, () => "", (value, _kind, item) => {
      if (!item && unknown(value, inList, true)) reads = true;
      return value;
    }, false, skip, (name, item) => {
      if (!item && unknown(`{${name}}`, inList, true)) reads = true;
      return undefined;
    });
    return reads;
  };
  if (scriptsReadQuery({ scripts: page.pageScripts }, false, plan.serverIds)) return true;

  // サーバー側で動くデータのブロックと、リストの絞り込み
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
    if (st.kind === "transform" && unknown(`{${st.source}}`, false)) return true;
  }
  for (const ops of plan.listOps.values()) {
    for (const op of ops) {
      if (op.kind === "filter" && op.conds.some((c) => unknown(c.value, false))) return true;
    }
  }
  // サーバー側で描画する要素（スクリプトはブラウザで動くため、対象外）
  const seen = new Set<string>();
  const walk = (id: string, inList: boolean): boolean => {
    const n = doc.nodes[id];
    if (!n || seen.has(id)) return false;
    seen.add(id);
    const f = n.field;
    if (scriptsReadQuery(n, inList)) return true;
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
          (f.options ?? []).some((o) => unknown(o.label, inList) || unknown(o.value, inList))))
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
 * ページの URL から、app/ の下のフォルダ名を作る。「_」で始まるフォルダは Next.js では
 * 非公開のフォルダ（URL にならない）になるため、URL の「_」を表す %5F で始める
 */
export function routeDir(slug: string): string {
  return slug
    .split("/")
    // 「.」「..」の区切りや使えない文字で、プロジェクトの外を指すパスを作らない（AI や取り込んだデータの URL もここを通る）
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map((seg) => seg.replace(/[^A-Za-z0-9._~\-\[\]]/g, "-"))
    .map((seg) => (seg.startsWith("_") ? `%5F${seg.slice(1)}` : seg))
    .join("/");
}

/**
 * リンクの中のリンクを、「クリックしたとき → 開く」のスクリプトにする（doc を書き換える）。
 * <a> の中には <a> を置けず、ブラウザが外側のリンクを途中で閉じるため、サーバーの HTML と
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
    // 行き先は <a> の href と同じ（ページが未選択なら URL、URL も空なら #）
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
