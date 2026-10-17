import type {
  DocNode,
  ListContent,
  FilterCond,
  ScriptOp,
  ScriptStep,
  SiteDoc,
} from "./types";
import {
  extractVars,
  interpolate,
  isRegexQuantifier,
  isSlugPage,
  lookupVar,
  pageQueryVars,
  urlHasSlug,
  varText,
} from "./vars";
import { fieldStateNotes, fieldVarName, fieldVarNames, isRadioItem } from "./fields";
import { tr, trc } from "./i18n";

/** "data.items" のようなパスでオブジェクトを掘る（配列の "-1" は最後の要素） */
export function digPath(root: unknown, path: string | undefined): unknown {
  if (!path?.trim()) return root;
  let cur = root;
  for (const raw of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    const key = raw.trim();
    cur = Array.isArray(cur) && key === "-1"
      ? cur[cur.length - 1]
      : (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** 文字や数値の配列をリストで並べるとき、各要素を入れる項目名（{値}） */
export const ITEM_VALUE = "値";

/** リストで並べる項目にする（オブジェクトはそのまま、文字や数値は {値} に入れる） */
export function toListItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const out: Record<string, unknown>[] = [];
  for (const x of value) {
    if (x == null || Array.isArray(x)) continue;
    out.push(typeof x === "object" ? (x as Record<string, unknown>) : { [ITEM_VALUE]: x });
  }
  return out;
}

/** 文字列を区切り文字で分解する（前後の空白を除き、空の要素は捨てる） */
export function splitText(text: string, sep: string): string[] {
  return text
    .split(sep || ",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 一覧の項目名（先頭10件にある項目をすべて） */
export function detectFields(items: Record<string, unknown>[]): string[] {
  const fields = new Set<string>();
  for (const item of items.slice(0, 10)) {
    for (const key of Object.keys(item)) fields.add(key);
  }
  return [...fields];
}

/**
 * 絞り込みの比較（スクリプトの「配列を絞り込む」。ブラウザの cmp・書き出しの filterExpr と同じ規則）
 */
export function matchOp(v: string, op: ScriptOp | undefined, w: string): boolean {
  switch (op) {
    case "neq":
      return v !== w;
    case "contains":
      return v.includes(w);
    case "not-contains":
      return !v.includes(w);
    case "starts-with":
      return v.startsWith(w);
    case "ends-with":
      return v.endsWith(w);
    case "gt":
      return parseFloat(v) > parseFloat(w);
    case "lt":
      return parseFloat(v) < parseFloat(w);
    case "empty":
      return v === "";
    case "not-empty":
      return v !== "";
    case "in":
      return w.split(",").some((x) => x.trim() === v);
    default:
      return v === w;
  }
}

/**
 * 並べ替えの比較。数値どうしは数値で、それ以外は数字を数値として比べる文字列比較
 * （ブラウザの renderList・書き出しの sortExpr と同じ規則）
 */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), "ja", { numeric: true });
}

/** 「配列を絞り込む」の条件（最初の条件 + 「かつ」「または」の条件。項目未選択は除く） */
export function filterConds(
  st: Extract<ScriptStep, { kind: "filter-array" }>
): FilterCond[] {
  return [{ field: st.field, op: st.op, value: st.value }, ...(st.or ?? [])].filter(
    (c) => c.field
  );
}

/** 条件を「かつ」でつないだ組に分ける（組のどれか1つを満たせばよい） */
export function condGroups<T extends { and?: boolean }>(conds: T[]): T[][] {
  const out: T[][] = [];
  conds.forEach((c, i) => {
    if (i > 0 && c.and) out[out.length - 1].push(c);
    else out.push([c]);
  });
  return out;
}

/** リストの項目に適用する絞り込み・並べ替え（ページを開いたときのスクリプトから決まる分） */
export type ListOp =
  /**
   * conds（「かつ」でつないだ組）のどれか1つを満たす項目を残す。
   * 複数の絞り込みは並んだ順に join（かつ / または）でつなぐ
   */
  | { kind: "filter"; conds: FilterCond[]; no?: number; join?: "and" | "or" }
  | { kind: "sort"; field: string; dir: "asc" | "desc" };

/** 絞り込み（value の {変数} は解決済み）だけを項目配列に適用 */
export function filterItems(
  items: Record<string, unknown>[],
  ops: ListOp[]
): Record<string, unknown>[] {
  // 絞り込みは、並んだ順に「かつ」「または」でつないだ1つの条件にする
  const filters = ops.filter((o): o is Extract<ListOp, { kind: "filter" }> => o.kind === "filter");
  if (!filters.length) return items;
  const pass = (o: Extract<ListOp, { kind: "filter" }>, item: Record<string, unknown>) =>
    condGroups(o.conds).some((g) =>
      g.every((c) =>
        matchOp(String(keyOfItem(item, c.field) ?? ""), c.op, c.value)
      )
    );
  return items.filter((item) =>
    filters.reduce<boolean>(
      (acc, o, i) => (i === 0 ? pass(o, item) : o.join === "or" ? acc || pass(o, item) : acc && pass(o, item)),
      true
    )
  );
}

/** 絞り込み・並べ替え（value の {変数} は解決済み）と表示件数を項目配列に適用 */
export function applyList(
  items: Record<string, unknown>[],
  list: ListContent,
  ops: ListOp[] = []
): Record<string, unknown>[] {
  let out = filterItems(items, ops);
  for (const o of ops) {
    if (o.kind === "filter") {
      continue;
    } else {
      const dir = o.dir === "desc" ? -1 : 1;
      out = [...out].sort(
        (a, b) => compareValues(keyOfItem(a, o.field), keyOfItem(b, o.field)) * dir
      );
    }
  }
  if (list.limit && list.limit > 0) out = out.slice(0, list.limit);
  return out;
}

/**
 * ノードのテキストテンプレート。span分割された親は
 * 自身の内容（空）に直下の子spanのテキストを連結して返す
 */
export function nodeTextTemplate(doc: SiteDoc, node: DocNode): string {
  let out = node.text?.content ?? "";
  if (node.text) {
    for (const cid of node.children) {
      const c = doc.nodes[cid];
      if (c?.text?.content) out += c.text.content;
    }
  }
  return out;
}

/**
 * ページ内のID付き要素が提供する {変数}
 * （フォーム部品は入力値、テキストを持つ要素はその内容。
 * リスト内のテキストは項目ごとに変わるため対象外）
 */
export function idVarNodesOf(doc: SiteDoc, pageId: string): DocNode[] {
  const out: DocNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string, inList: boolean) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = doc.nodes[id];
    if (!n) return;
    if (n.type === "instance") {
      const comp = doc.components?.[n.componentId ?? ""];
      if (comp) walk(comp.rootId, inList);
      return;
    }
    if (n.type === "field" && fieldVarNames(n).length) out.push(n);
    else if (n.attrId && n.type !== "field" && !inList && nodeTextTemplate(doc, n)) out.push(n);
    n.children.forEach((c) => walk(c, inList || n.type === "list"));
  };
  doc.pages[pageId]?.children.forEach((c) => walk(c, false));
  return out;
}

/** ID付きの要素が提供する変数の名前（ラジオはグループ名があればそれ） */
export function idVarName(n: DocNode): string {
  return n.type === "field" ? fieldVarName(n) : (n.attrId ?? "");
}

/**
 * ノードの位置で使える {変数} 名の候補
 * （slug / 取得したデータ / 属するリストの項目 / ページ内のID付き要素）
 */
export function varNamesAt(
  doc: SiteDoc,
  pageId: string,
  nodeId: string
): string[] {
  const page = doc.pages[pageId];
  const names: string[] = [];
  if (page && isSlugPage(page.slug)) names.push("slug");
  names.push(...Object.keys(pageQueryVars(page?.query)));
  const { item, pageVars } = scopeAt(doc, pageId, nodeId);
  if (item) names.push(...Object.keys(item));
  names.push(...Object.keys(namedVars(pageVars)));
  for (const n of idVarNodesOf(doc, pageId)) names.push(...(n.type === "field" ? fieldVarNames(n) : [idVarName(n)]));
  // スクリプトで作る変数（「もし」の中など、画面上で値が決まるものも含む）
  names.push(...scriptVarNames(doc, pageId));
  return [...new Set(names)];
}

/** ページのスクリプトで作る変数・配列の名前（ブロックの入れ子の中も含む） */
export function scriptVarNames(doc: SiteDoc, pageId: string): string[] {
  return [...dataVarNames(doc, pageId)].filter((n) => n !== ITEM_VALUE && n !== "slug");
}

/** 「変数を探す」で見せる、変数のまとまり */
export interface VarGroup {
  key: "item" | "data" | "url" | "element" | "script" | "state";
  /** 「変数を探す」で「詳細」を開いたときだけ出す */
  advanced?: boolean;
  label: string;
  /** 変数名 → 見本の値（undefined = 見本なし） */
  vars: Record<string, unknown>;
  /** 見本が無い変数に添える説明 */
  notes?: Record<string, string>;
}

/** 要素の位置で使える変数を、出どころごとにまとめる（値は見本） */
export function varGroupsAt(doc: SiteDoc, pageId: string, nodeId: string): VarGroup[] {
  const page = doc.pages[pageId];
  const { item, pageVars } = scopeAt(doc, pageId, nodeId);
  const groups: VarGroup[] = [];
  if (item && Object.keys(item).length) {
    groups.push({ key: "item", label: tr("リストの項目（1件ずつ変わる）"), vars: item });
  }
  const data = namedVars(pageVars);
  if (Object.keys(data).length) {
    groups.push({ key: "data", label: tr("取得したデータ・変数"), vars: data });
  }
  const url: Record<string, unknown> = {};
  const notes: Record<string, string> = {};
  if (page && isSlugPage(page.slug)) {
    url.slug = undefined;
    notes.slug = tr("ページURLの [slug] の部分");
  }
  for (const [k, v] of Object.entries(pageQueryVars(page?.query))) url[k] = v;
  if (Object.keys(url).length) groups.push({ key: "url", label: tr("ページのURL"), vars: url, notes });
  const els: Record<string, unknown> = {};
  const elNotes: Record<string, string> = {};
  for (const n of idVarNodesOf(doc, pageId)) {
    if (n.type === "field") {
      const name = idVarName(n);
      if (name) {
        els[name] = undefined;
        elNotes[name] =
          n.field?.kind === "checkbox"
            ? tr("チェックしているとき true、していないとき false")
            : n.field?.kind === "radio"
              ? tr("グループで選んだラジオボタンの値")
              : tr("入力欄に入力された値");
      }
      if (isRadioItem(n)) {
        els[n.attrId!] = undefined;
        elNotes[n.attrId!] = tr("このラジオボタンを選んでいるとき true");
      }
    } else {
      els[n.attrId!] = nodeTextTemplate(doc, n);
    }
  }
  if (Object.keys(els).length) {
    groups.push({ key: "element", label: tr("ID付きの要素"), vars: els, notes: elNotes });
  }
  // 入力欄の状態（{ID.checked} など）
  const states = fieldStateNotes(idVarNodesOf(doc, pageId).filter((n) => n.type === "field"), tr);
  if (Object.keys(states).length) {
    groups.push({
      key: "state",
      advanced: true,
      label: tr("入力欄の状態"),
      vars: Object.fromEntries(Object.keys(states).map((k) => [k, undefined])),
      notes: states,
    });
  }
  const known = new Set(groups.flatMap((g) => Object.keys(g.vars)));
  const made = scriptVarNames(doc, pageId).filter((n) => !known.has(n));
  if (made.length) {
    groups.push({
      key: "script",
      label: tr("スクリプトで作る変数（サイトを動かしたときに値が決まる）"),
      vars: Object.fromEntries(made.map((n) => [n, undefined])),
      notes: Object.fromEntries(made.map((n) => [n, tr("動かしたときに値が入ります")])),
    });
  }
  return groups;
}

/** 予測変換に添える、変数の値の見本（短い文字。分からなければ無し） */
export function varSamplesAt(
  doc: SiteDoc,
  pageId: string,
  nodeId: string
): Record<string, string> {
  const describe = (v: unknown): string => {
    if (Array.isArray(v)) return tr("{length}件のリスト", { length: v.length });
    if (v && typeof v === "object") return tr("項目のまとまり");
    const t = varText(v).replace(/\s+/g, " ");
    return t.length > 28 ? `${t.slice(0, 28)}…` : t;
  };
  const out: Record<string, string> = { ...pageQueryVars(doc.pages[pageId]?.query) };
  const { item, pageVars } = scopeAt(doc, pageId, nodeId);
  for (const [k, v] of Object.entries({ ...namedVars(pageVars), ...item })) {
    out[k] = describe(v);
  }
  for (const n of idVarNodesOf(doc, pageId)) {
    const name = idVarName(n);
    if (name) {
      out[name] ??=
        n.type !== "field" ? describe(nodeTextTemplate(doc, n)) : n.field?.kind === "checkbox" ? "true / false" : tr("入力欄の値");
    }
    if (isRadioItem(n)) out[n.attrId!] ??= "true / false";
  }
  for (const n of scriptVarNames(doc, pageId)) out[n] ??= tr("スクリプトで作る変数");
  return out;
}

/* ---------- ページで取得するデータ（スクリプトのデータのブロック） ---------- */

/** ページを配信する前（サーバー側）にだけ動くブロック（データの取得） */
export type DataStep = Extract<ScriptStep, { kind: "fetch" }>;
/** 入力がサーバー側でそろえばページを配信する前に、そうでなければ画面上で動くブロック */
export type HybridStep = Extract<
  ScriptStep,
  { kind: "split" | "array-find" | "array-field" | "join" | "count" }
>;
export type ForEachStep = Extract<ScriptStep, { kind: "for-each" }>;
export type SetVarStep = Extract<ScriptStep, { kind: "set-var" }>;
/** ページを配信する前に実行するブロック */
export type ServerStep = DataStep | HybridStep | ForEachStep | SetVarStep;

/** 「［{名前}］を変数［］とする」の {名前}（値が {名前} 1つだけでなければ null） */
export function setVarSource(st: SetVarStep): string | null {
  const m = /^\{([^{}]+)\}$/.exec(st.value.trim());
  return m ? m[1].trim() : null;
}
export type FetchStep = Extract<ScriptStep, { kind: "fetch" }>;

/** データのブロックか（ページを配信する前に動き、画面上のスクリプトには含めない） */
export function isDataStep(st: ScriptStep): st is DataStep {
  return st.kind === "fetch";
}

const HYBRID_KINDS = new Set<string>([
  "split",
  "array-find",
  "array-field",
  "join",
  "count",
]);

export function isHybridStep(st: ScriptStep): st is HybridStep {
  return HYBRID_KINDS.has(st.kind);
}

/**
 * 要素ごとのくり返しを配信前に動かせるか。
 * 中のブロックが、同じ配列への「項目として格納」と変数を比べる「もし」だけで、
 * 画面上で値が決まる変数を使わないこと
 */
function forEachOnServer(st: ForEachStep, isClient: (name: string) => boolean): boolean {
  const usesClient = (s: string | undefined) => !!s && extractVars(s).some(isClient);
  const ok = (steps: ScriptStep[]): boolean =>
    steps.every((x) =>
      x.kind === "array-field"
        ? x.array === st.array && !usesClient(x.value)
        : x.kind === "if"
          ? x.cond.subject === "var" &&
            !usesClient(x.cond.left) &&
            !usesClient(x.cond.value) &&
            ok(x.then) &&
            ok(x.else ?? [])
          : false
    );
  return ok(st.then);
}

/**
 * 配列の要素ごとに、中の「項目として格納」「もし」を動かした新しい配列（配列でなければそのまま）。
 * 中では要素の項目と変数を {名前} で使える
 */
export function forEachItems(
  value: unknown,
  st: ForEachStep,
  vars: Record<string, unknown>
): unknown {
  if (!Array.isArray(value)) return value;
  const run = (steps: ScriptStep[], item: Record<string, unknown>): Record<string, unknown> => {
    for (const x of steps) {
      const scope = { ...vars, ...item };
      if (x.kind === "array-field" && x.array === st.array && x.field) {
        const single = /^\{([^{}\s"'<>`]+)\}$/.exec(x.value.trim());
        item = {
          ...item,
          [x.field]: single ? (lookupVar(scope, single[1]) ?? null) : interpolate(x.value, scope),
        };
      } else if (x.kind === "if" && x.cond.subject === "var") {
        const hit = matchOp(
          interpolate(x.cond.left ?? "", scope),
          x.cond.op,
          interpolate(x.cond.value ?? "", scope)
        );
        const branch = hit ? x.then : x.else;
        if (branch) item = run(branch, item);
      }
    }
    return item;
  };
  return value.map((x) => {
    if (x == null || Array.isArray(x)) return x;
    const item = typeof x === "object" ? (x as Record<string, unknown>) : { [ITEM_VALUE]: x };
    const out = run(st.then, item);
    return out === item ? x : out;
  });
}

/** 変数名に使えない文字を落とす（{ } . 空白 引用符など） */
export function cleanVarName(name: string): string {
  return name.replace(/[\s{}.,"'<>`\[\]()#]/g, "");
}

const rootName = (name: string) => name.split(".")[0];

function walkAll(steps: ScriptStep[], fn: (st: ScriptStep) => void) {
  for (const st of steps) {
    fn(st);
    if (st.kind === "if") {
      walkAll(st.then, fn);
      if (st.else) walkAll(st.else, fn);
    } else if (st.kind === "repeat" || st.kind === "for-each") {
      walkAll(st.then, fn);
    }
  }
}

/** ページ内の要素のスクリプトと、ページのスクリプトすべて */
function scriptsInPage(doc: SiteDoc, pageId: string): ScriptStep[][] {
  const page = doc.pages[pageId];
  const out: ScriptStep[][] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = doc.nodes[id];
    if (!n) return;
    if (n.type === "instance") {
      const comp = doc.components?.[n.componentId ?? ""];
      if (comp) walk(comp.rootId);
      return;
    }
    for (const s of n.scripts ?? []) out.push(s.steps);
    n.children.forEach(walk);
  };
  page?.children.forEach(walk);
  for (const s of [...(page?.pageScripts ?? []), ...(page?.scripts ?? [])]) out.push(s.steps);
  return out;
}

export interface PagePlan {
  /** ページを開いたときに、配信する前に実行するブロック（実行順） */
  steps: ServerStep[];
  /** steps のうち、画面上のスクリプトから除く分岐ブロック（分解・配列の〜）のID */
  serverIds: Set<string>;
  /** 画面上（ブラウザ）で値が決まる変数・配列の名前 */
  clientVars: Set<string>;
  /**
   * 配列の名前 → 配信する前にリストへ適用する絞り込み・並べ替え（実行順。value は未解決）。
   * 該当するブロックのIDは serverIds にも入る
   */
  listOps: Map<string, ListOp[]>;
  /**
   * 配信する前に動く「配列の件数」のID → その時点で配列にかかっている絞り込み
   * （件数は絞り込み後の数にする）
   */
  countFilters: Map<string, Extract<ListOp, { kind: "filter" }>[]>;
}

/**
 * ページのデータのブロックを、配信する前に動くものと画面上で動くものに分ける。
 * 「このページ｜ページを開いたとき」の直下にあるデータのブロックだけが配信前に動き、
 * 分解・配列の〜は、使う値がストレージや入力欄によらなければ配信前に動く
 */
export function pagePlan(doc: SiteDoc, pageId: string): PagePlan {
  const page = doc.pages[pageId];
  const loadRoot = new Set<ScriptStep>();
  for (const s of page?.pageScripts ?? []) {
    if (s.trigger === "load") s.steps.forEach((st) => loadRoot.add(st));
  }
  const clientVars = new Set<string>();
  const fieldIds = new Set(
    idVarNodesOf(doc, pageId)
      .filter((n) => n.type === "field")
      .flatMap((n) => fieldVarNames(n))
  );
  for (const steps of scriptsInPage(doc, pageId)) {
    walkAll(steps, (st) => {
      if ((st.kind === "store-load" || st.kind === "list-edit" || st.kind === "calc" || st.kind === "replace") && st.into) {
        clientVars.add(st.into);
      }
      // 「ページを開いたとき」の直下で {名前} だけを入れるものは、配信前に動くかを後で決める
      if (st.kind === "set-var" && st.into && !(loadRoot.has(st) && setVarSource(st))) {
        clientVars.add(st.into);
      }
      if (isHybridStep(st) && !loadRoot.has(st) && "into" in st && st.into) clientVars.add(st.into);
    });
  }
  const isClient = (name: string) => clientVars.has(rootName(name)) || fieldIds.has(rootName(name));
  // 「ページを開いたとき」の直下以外でも絞り込み・並べ替えをする配列は、
  // 後から解除・変更できるよう画面上で扱う
  const dynamicArrays = new Set<string>();
  for (const steps of scriptsInPage(doc, pageId)) {
    walkAll(steps, (st) => {
      if (
        (st.kind === "filter-array" || st.kind === "unfilter-array" || st.kind === "sort-array") &&
        !loadRoot.has(st)
      ) {
        dynamicArrays.add(st.array);
      }
    });
  }
  const steps: ServerStep[] = [];
  const serverIds = new Set<string>();
  const listOps = new Map<string, ListOp[]>();
  const countFilters = new Map<string, Extract<ListOp, { kind: "filter" }>[]>();
  // 同じ番号の絞り込みはもう一度動かすと置き換わる
  const addOp = (array: string, op: ListOp) => {
    const cur = listOps.get(array) ?? [];
    const i =
      op.kind === "filter" && op.no !== undefined
        ? cur.findIndex((o) => o.kind === "filter" && o.no === op.no)
        : -1;
    listOps.set(array, i >= 0 ? cur.map((o, j) => (j === i ? op : o)) : [...cur, op]);
  };
  for (const s of page?.pageScripts ?? []) {
    if (s.trigger !== "load") continue;
    for (const st of s.steps) {
      if (isDataStep(st)) {
        steps.push(st);
      } else if (isHybridStep(st)) {
        const client =
          st.kind === "split"
            ? extractVars(st.source).some(isClient)
            : !st.array ||
              isClient(st.array) ||
              ((st.kind === "array-find" || st.kind === "array-field") &&
                extractVars(st.value).some(isClient)) ||
              // 画面上で絞り込む配列の件数は、絞り込みが動いた後に画面上で数える
              (st.kind === "count" && dynamicArrays.has(st.array));
        if (client) {
          if ("into" in st && st.into) clientVars.add(st.into);
        } else {
          steps.push(st);
          serverIds.add(st.id);
          if (st.kind === "count") {
            const fs = (listOps.get(st.array) ?? []).filter(
              (o): o is Extract<ListOp, { kind: "filter" }> => o.kind === "filter"
            );
            if (fs.length) countFilters.set(st.id, fs);
          }
        }
      } else if (st.kind === "set-var") {
        // {名前} だけで、その値が配信前にそろい、ほかで画面上から書き換えなければ配信前に動く
        const src = setVarSource(st);
        if (!st.into || !src) continue;
        if (isClient(src) || clientVars.has(st.into)) {
          clientVars.add(st.into);
        } else {
          steps.push(st);
          serverIds.add(st.id);
        }
      } else if (st.kind === "for-each") {
        // 中が「項目として格納」と変数の「もし」だけで、値が配信前にそろえば配信前に動く
        if (st.array && !isClient(st.array) && forEachOnServer(st, isClient)) {
          steps.push(st);
          serverIds.add(st.id);
        }
      } else if (
        (st.kind === "filter-array" || st.kind === "sort-array") &&
        st.array &&
        st.field &&
        !isClient(st.array) &&
        !dynamicArrays.has(st.array) &&
        !(
          st.kind === "filter-array" &&
          filterConds(st).some((c) => extractVars(c.value).some(isClient))
        )
      ) {
        addOp(
          st.array,
          st.kind === "filter-array"
            ? { kind: "filter", conds: filterConds(st), no: st.no, join: st.join }
            : { kind: "sort", field: st.field, dir: st.dir }
        );
        serverIds.add(st.id);
      } else if (
        st.kind === "unfilter-array" &&
        st.array &&
        !isClient(st.array) &&
        !dynamicArrays.has(st.array)
      ) {
        // 配信前に解除まで済む（番号を指定すればその絞り込みだけ、なければすべて）
        const cur = listOps.get(st.array) ?? [];
        listOps.set(
          st.array,
          cur.filter((o) => o.kind !== "filter" || (st.no !== undefined && o.no !== st.no))
        );
        serverIds.add(st.id);
      }
    }
  }
  return { steps, serverIds, clientVars, listOps, countFilters };
}

/**
 * ページを開いたときに配信する前に実行するブロック（実行順）。
 * 「このページ｜ページを開いたとき」の直下にあるものだけが動く
 */
export function pageDataSteps(doc: SiteDoc, pageId: string): ServerStep[] {
  return pagePlan(doc, pageId).steps;
}

/** ブロックが作る変数・配列・取得したデータの名前 */
export function stepOutName(st: ScriptStep): string | null {
  if (st.kind === "fetch") return st.as || null;
  if ("into" in st) return st.into || null;
  return null;
}

/** ページのスクリプトで使っている変数名（名前の重複チェック用） */
export function dataVarNames(doc: SiteDoc, pageId: string, exceptStepId?: string): Set<string> {
  const out = new Set<string>(["slug", ITEM_VALUE]);
  for (const steps of scriptsInPage(doc, pageId)) {
    walkAll(steps, (st) => {
      const name = st.id === exceptStepId ? null : stepOutName(st);
      if (name) out.add(name);
    });
  }
  return out;
}

/** 名前の候補を、ページ内の既存の変数と重ならないようにする */
export function uniqueVarName(doc: SiteDoc, pageId: string, base: string, exceptStepId?: string): string {
  const used = dataVarNames(doc, pageId, exceptStepId);
  const stem = cleanVarName(base) || trc("変数名", "データ");
  let name = stem;
  for (let i = 2; used.has(name); i++) name = `${stem}${i}`;
  return name;
}

/** ページの配列（「分解して配列［］とする」や、一覧を入れた変数） */
export interface PageArray {
  name: string;
  /** 画面上（ブラウザ）で値が決まる配列か */
  client: boolean;
}

export function pageArrays(doc: SiteDoc, pageId: string): PageArray[] {
  const { clientVars } = pagePlan(doc, pageId);
  const out: PageArray[] = [];
  const seen = new Set<string>();
  for (const steps of scriptsInPage(doc, pageId)) {
    walkAll(steps, (st) => {
      if (st.kind === "split" && st.into && !seen.has(st.into)) {
        seen.add(st.into);
        out.push({ name: st.into, client: clientVars.has(st.into) });
      }
    });
  }
  // 「［{配列}］を変数［］とする」で配列をそのまま入れた変数も配列として扱う
  const copies: { name: string; src: string }[] = [];
  for (const steps of scriptsInPage(doc, pageId)) {
    walkAll(steps, (st) => {
      const src = st.kind === "set-var" && st.into ? setVarSource(st) : null;
      if (src) copies.push({ name: (st as SetVarStep).into, src });
    });
  }
  if (copies.length) {
    let samples: Record<string, unknown> | null = null;
    const isArray = (name: string) =>
      seen.has(name) ||
      // 見本に値が無いもの（取得し直す前に増えた項目など）も、配列かもしれないので選べるようにする
      sampleArray(doc, pageId, (samples ??= previewDataVars(doc, pageId)), name) !== null;
    // 変数から変数へ入れ直した場合もたどる
    for (let added = true; added; ) {
      added = false;
      for (const c of copies) {
        if (seen.has(c.name) || !isArray(c.src)) continue;
        seen.add(c.name);
        out.push({ name: c.name, client: clientVars.has(c.name) });
        added = true;
      }
    }
  }
  return out;
}

/** 取得したデータの名前（ページのスクリプトの「データを取得して［］とする」） */
export function fetchNames(doc: SiteDoc, pageId: string): string[] {
  const out: string[] = [];
  for (const s of doc.pages[pageId]?.pageScripts ?? []) {
    for (const st of s.steps) if (st.kind === "fetch" && st.as) out.push(st.as);
  }
  return out;
}

/** リストが並べる配列 */
export function listFromOf(node: DocNode): string | undefined {
  return node.list?.from || undefined;
}

/** 取得結果を見本として保存できる大きさにする（配列は先頭だけ） */
export function trimSample(
  value: unknown,
  max = 20,
  depth = 0,
  /** 切り詰めた配列の元の件数を、位置（"items" / "data.0.tags"）ごとに記録する */
  totals?: Record<string, number>,
  path = ""
): unknown {
  if (value == null || typeof value !== "object" || depth > 8) return value;
  const at = (k: string) => (path ? `${path}.${k}` : k);
  if (Array.isArray(value)) {
    if (totals && value.length > max) totals[path] = value.length;
    return value.slice(0, max).map((v, i) => trimSample(v, max, depth + 1, totals, at(String(i))));
  }
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, trimSample(v, max, depth + 1, totals, at(k))])
  );
}

/** 取得したJSONを見本にする（切り詰めた配列の元の件数も返す） */
export function makeSample(json: unknown): { sample: unknown; totals?: Record<string, number> } {
  const totals: Record<string, number> = {};
  const sample = trimSample(json, 20, 0, totals);
  return { sample, ...(Object.keys(totals).length ? { totals } : {}) };
}

/**
 * [slug]ページの中心になるデータ（無ければ404・タイトルに使う）。
 * 「配列の要素のうち、項目が {slug} のもの」→ {slug} を含むURLから取得したデータを入れた変数、
 * の順で最初のもの
 */
export type PrimaryStep = Extract<HybridStep, { kind: "array-find" }> | SetVarStep;

export function primaryDataStep(doc: SiteDoc, pageId: string): { step: PrimaryStep } | null {
  const page = doc.pages[pageId];
  if (!page || !isSlugPage(page.slug)) return null;
  const all = pageDataSteps(doc, pageId);
  for (const st of all) {
    if (st.kind === "array-find" && st.into && st.array && st.field && st.value.includes("{slug}")) {
      return { step: st };
    }
  }
  const slugFetches = new Set(
    all.filter((st) => st.kind === "fetch" && st.as && urlHasSlug(st.url)).map((st) => (st as FetchStep).as!)
  );
  for (const st of all) {
    const src = st.kind === "set-var" && st.into ? setVarSource(st) : null;
    if (src && slugFetches.has(rootName(src))) return { step: st as SetVarStep };
  }
  return null;
}

/**
 * [slug]ページの中心のデータが「〜のうち、項目が {slug} のもの」を探すとき、
 * 探す元の一覧と、見分ける項目（プレビューバーで項目を選ぶのに使う）
 */
export function primaryCandidates(
  doc: SiteDoc,
  pageId: string,
  live?: Record<string, unknown>
): { field: string; items: Record<string, unknown>[] } | null {
  const step = primaryDataStep(doc, pageId)?.step;
  if (step?.kind === "array-find") {
    const vars = previewDataVars(doc, pageId, { live, index: 0 });
    return { field: step.field, items: toItems(lookupVar(vars, step.array)) };
  }
  return null;
}

/** 一覧の1件の、見分ける項目の値（"category.slug" のような位置も使える） */
export function keyOfItem(item: Record<string, unknown>, field: string): unknown {
  return field in item ? item[field] : digPath(item, field);
}

/** 「探す」ブロックの照合（URLの値はエンコードされていることがある） */
export function sameKey(value: unknown, key: string): boolean {
  const v = String(value ?? "");
  return v === key || encodeURIComponent(v) === key;
}

/** オブジェクトの配列だけを一覧の項目として取り出す */
export function toItems(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (x): x is Record<string, unknown> =>
          x != null && typeof x === "object" && !Array.isArray(x)
      )
    : [];
}

export interface PreviewOpts {
  /** 中心になるデータで表示する項目の番号（プレビューバー） */
  index?: number;
  /** ページURLの [slug] の値 */
  slug?: string;
  /** 再取得したデータ（取得ブロックのID → JSON） */
  live?: Record<string, unknown>;
  /** 再取得したデータで切り詰めた配列の元の件数（取得ブロックのID → 位置 → 件数） */
  liveTotals?: Record<string, Record<string, number>>;
  /** {変数} の解決に使うページの変数（クエリ・入力値など） */
  vars?: Record<string, unknown>;
}

/** エディタで表示する、ページの変数の値（保存した見本でデータのブロックを順に実行する） */
export function previewDataVars(
  doc: SiteDoc,
  pageId: string,
  opts: PreviewOpts = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const primary = primaryDataStep(doc, pageId)?.step;
  const scope = () => ({ ...opts.vars, slug: opts.slug, ...out });
  // 見本は配列を先頭だけに切り詰めているため、変数がどの取得データのどこから来たかを覚えておき、
  // 件数は元の件数（sampleTotals）で答える
  type Origin = { totals?: Record<string, number>; path: string };
  const origins: Record<string, Origin> = {};
  const join = (a: string, b: string) => (a && b ? `${a}.${b}` : a || b);
  const originOf = (name: string): Origin | null => {
    const [root, ...rest] = name.split(".");
    const o = origins[root];
    return o ? { totals: o.totals, path: join(o.path, rest.join(".")) } : null;
  };
  const plan = pagePlan(doc, pageId);
  for (const st of plan.steps) {
    switch (st.kind) {
      case "fetch":
        if (st.as) {
          out[st.as] = opts.live?.[st.id] ?? st.sample ?? null;
          origins[st.as] = {
            totals: opts.live?.[st.id] !== undefined ? opts.liveTotals?.[st.id] : st.sampleTotals,
            path: "",
          };
        }
        break;
      case "split":
        if (st.into) out[st.into] = splitText(interpolate(st.source, scope()), st.sep);
        break;
      case "array-find": {
        if (!st.into) break;
        const items = toItems(lookupVar(scope(), st.array));
        if (st === primary) {
          out[st.into] =
            (opts.index ?? 0) < 0
              ? null
              : (items[Math.max(0, Math.min(opts.index ?? 0, items.length - 1))] ?? null);
        } else {
          const key = interpolate(st.value, scope());
          out[st.into] =
            (st.field && items.find((it) => sameKey(keyOfItem(it, st.field), key))) || null;
        }
        break;
      }
      case "join":
        if (st.into) out[st.into] = joinArray(lookupVar(scope(), st.array), st.field, st.sep);
        break;
      case "set-var": {
        const src = setVarSource(st);
        if (!st.into || !src) break;
        out[st.into] = lookupVar(scope(), src) ?? null;
        const o = originOf(src);
        if (o) origins[st.into] = o;
        break;
      }
      case "array-field":
        if (st.array && st.field) {
          const vars = scope();
          setVarPath(out, st.array, withItemField(lookupVar(vars, st.array), st.field, st.value, vars));
        }
        break;
      case "for-each": {
        const vars = scope();
        setVarPath(out, st.array, forEachItems(lookupVar(vars, st.array), st, vars));
        break;
      }
      case "count": {
        const v = lookupVar(scope(), st.array);
        const fs = plan.countFilters.get(st.id);
        if (fs && Array.isArray(v)) {
          // 絞り込み後の件数（見本は切り詰めているので、見本のうちで当てはまる数）
          const resolved = fs.map((f) => ({
            ...f,
            conds: f.conds.map((c) => ({ ...c, value: interpolate(c.value, scope()) })),
          }));
          if (st.into) out[st.into] = filterItems(toListItems(v), resolved).length;
          break;
        }
        const o = originOf(st.array);
        const total = o?.totals?.[o.path];
        if (st.into) out[st.into] = Array.isArray(v) ? (total ?? v.length) : 0;
        break;
      }
    }
  }
  // 「［{名前}］を変数［］とする」は画面上で動くが、見本ではそのまま入れておく
  //（リストの項目・変数の候補に中身を出すため。変数から変数へ入れ直した場合もたどる）
  const copies: { into: string; src: string }[] = [];
  for (const steps of scriptsInPage(doc, pageId)) {
    walkAll(steps, (st) => {
      const src = st.kind === "set-var" && st.into && !(st.into in out) ? setVarSource(st) : null;
      if (src) copies.push({ into: (st as SetVarStep).into, src });
    });
  }
  for (let added = true; added; ) {
    added = false;
    for (const c of copies) {
      if (c.into in out) continue;
      const v = lookupVar(scope(), c.src);
      if (v === undefined) continue;
      out[c.into] = v;
      added = true;
    }
  }
  return out;
}

/**
 * 配列の各要素に、template の値を項目 field として入れた新しい配列（配列でなければそのまま）。
 * template では要素の項目と変数を {名前} で使える（{名前} だけなら値をそのまま入れる）
 */
export function withItemField(
  value: unknown,
  field: string,
  template: string,
  vars: Record<string, unknown>
): unknown {
  if (!Array.isArray(value)) return value;
  const single = /^\{([^{}\s"'<>`]+)\}$/.exec(template.trim());
  return value.map((x) => {
    if (x == null || Array.isArray(x)) return x;
    const item =
      typeof x === "object" ? (x as Record<string, unknown>) : { [ITEM_VALUE]: x };
    const scope = { ...vars, ...item };
    const v = single ? (lookupVar(scope, single[1]) ?? null) : interpolate(template, scope);
    return { ...item, [field]: v };
  });
}

/** 変数に値を入れる（"記事.tags" のような入れ子は、元の値を変えずに途中を複製して入れる） */
export function setVarPath(vars: Record<string, unknown>, name: string, value: unknown) {
  if (name in vars || !name.includes(".")) {
    vars[name] = value;
    return;
  }
  const put = (cur: unknown, keys: string[]): unknown => {
    if (!keys.length) return value;
    const [k, ...rest] = keys;
    if (Array.isArray(cur)) {
      const copy = cur.slice();
      copy[Number(k)] = put(cur[Number(k)], rest);
      return copy;
    }
    const obj = cur && typeof cur === "object" ? (cur as Record<string, unknown>) : {};
    return { ...obj, [k]: put(obj[k], rest) };
  };
  const [root, ...rest] = name.split(".");
  vars[root] = put(vars[root], rest);
}

/** 配列の要素（まとまりなら field の値）を区切り文字でつなぐ */
export function joinArray(value: unknown, field: string | undefined, sep: string): string {
  if (!Array.isArray(value)) return varText(value);
  return value
    .map((x) => {
      const v = field && x && typeof x === "object" ? digPath(x, field) : x;
      return v == null || typeof v === "object" ? "" : String(v);
    })
    .filter((x) => x !== "")
    .join(sep);
}

/** {名前} で書ける変数だけにする（「#」で始まる内部の変数を除く） */
export function namedVars(vars: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(vars).filter(([k]) => !k.startsWith("#")));
}

/** 祖先（自身含む）のリスト要素を、外側から順に返す */
function listChainOf(doc: SiteDoc, nodeId: string): DocNode[] {
  const parentOf = (id: string): string | null => {
    for (const n of Object.values(doc.nodes)) {
      if (n.children.includes(id)) return n.id;
    }
    return null;
  };
  const out: DocNode[] = [];
  let cur: string | null = nodeId;
  while (cur) {
    const node = doc.nodes[cur];
    if (node?.type === "list" && node.list) out.unshift(node);
    cur = parentOf(cur);
  }
  return out;
}

/**
 * ノードの位置での変数（エディタ表示用）。
 * pageVars = 取得したデータ / item = 属するリストの1件目（入れ子は内側が優先）
 * inside = false ならノード自身がリストでも、その外側の位置として扱う
 */
export function scopeAt(
  doc: SiteDoc,
  pageId: string,
  nodeId: string,
  opts: PreviewOpts & { inside?: boolean } = {}
): { pageVars: Record<string, unknown>; item?: Record<string, unknown> } {
  let chain = listChainOf(doc, nodeId);
  if (opts.inside === false && doc.nodes[nodeId]?.type === "list") {
    chain = chain.slice(0, -1);
  }
  const itemOf = (pageVars: Record<string, unknown>) => {
    let scope: Record<string, unknown> = { ...pageVars };
    let item: Record<string, unknown> | undefined;
    for (const l of chain) {
      const first = toListItems(lookupVar(scope, listFromOf(l) ?? ""))[0];
      if (!first) return undefined;
      item = { ...(item ?? {}), ...first };
      scope = { ...scope, ...first };
    }
    return item;
  };
  const pageVars = previewDataVars(doc, pageId, opts);
  const item = itemOf(pageVars);
  // [slug] を決めずに見るときは、1件目で空なら [slug] のほかの見本で探す
  //（「大分類」のように一部の件にだけある一覧も、項目の候補を出せるように）
  if (!item && chain.length && opts.index === undefined) {
    for (const vars of previewVarsBySlug(doc, pageId)) {
      const other = itemOf(vars);
      if (other) return { pageVars: vars, item: other };
    }
  }
  return { pageVars, item };
}

/** [slug] の見本の2件目以降を順に当てはめたページの変数（1件目に無い値を探すため） */
function* previewVarsBySlug(doc: SiteDoc, pageId: string): Generator<Record<string, unknown>> {
  const n = Math.min(primaryCandidates(doc, pageId)?.items.length ?? 0, 20);
  for (let i = 1; i < n; i++) yield previewDataVars(doc, pageId, { index: i });
}

/**
 * 見本で配列になる変数か（[slug] のページは、1件目で配列でなければほかの見本でも調べる）。
 * 配列ならその配列、どの見本にも値が無ければ undefined（見本が古いなど。配列かもしれない）、
 * 配列でない値があれば null
 */
function sampleArray(
  doc: SiteDoc,
  pageId: string,
  samples: Record<string, unknown>,
  name: string
): unknown[] | null | undefined {
  let found = false;
  const check = (vars: Record<string, unknown>) => {
    const v = lookupVar(vars, name);
    if (v != null) found = true;
    return Array.isArray(v) ? v : null;
  };
  const first = check(samples);
  if (first) return first;
  for (const vars of previewVarsBySlug(doc, pageId)) {
    const v = check(vars);
    if (v) return v;
  }
  return found ? null : undefined;
}

/** リストが並べる項目（エディタ表示用。最初の数件のサンプル） */
export function listItemsAt(
  doc: SiteDoc,
  pageId: string,
  listNodeId: string,
  opts: PreviewOpts = {}
): Record<string, unknown>[] {
  const node = doc.nodes[listNodeId];
  const from = node ? listFromOf(node) : undefined;
  if (!from) return [];
  const { pageVars, item } = scopeAt(doc, pageId, listNodeId, { ...opts, inside: false });
  return toListItems(lookupVar({ ...pageVars, ...(item ?? {}) }, from));
}

/** 取得したデータの中にある「一覧」の候補（最大3階層まで探す） */
export interface ItemsCandidate {
  /** 一覧の位置（"items" や "data.list"。"" = データ全体が一覧） */
  path: string;
  count: number;
}

export function findItemsCandidates(json: unknown): ItemsCandidate[] {
  const out: ItemsCandidate[] = [];
  const walk = (value: unknown, path: string, depth: number) => {
    if (Array.isArray(value)) {
      if (value.some((x) => x && typeof x === "object" && !Array.isArray(x))) {
        out.push({ path, count: value.length });
      }
      return;
    }
    if (depth >= 3 || !value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      walk(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  walk(json, "", 0);
  return out;
}

/** 値が画像のURLらしいか */
export function looksLikeImage(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^(https?:)?\/\/|^\//.test(value) &&
    /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(value)
  );
}

/** 値がURLらしいか */
export function looksLikeUrl(value: unknown): boolean {
  return typeof value === "string" && /^(https?:)?\/\//.test(value);
}

/** 画面に文字として出せる値か（入れ子の項目は除く） */
export function isDisplayable(value: unknown): boolean {
  return value == null || typeof value !== "object";
}

/** 要素の位置で使えるデータ項目と、確認用の値（リストの項目・読み込んだデータから） */
export interface FieldOption {
  field: string;
  /** 1件目の値（見本として表示する） */
  sample: unknown;
}

/** 配列の番号・入れ子の項目名を、画面に出す名前にする（例: images.0 → images › 1番目） */
export function fieldLabel(path: string): string {
  return path
    .split(".")
    .map((seg) => (seg === "-1" ? tr("最後") : /^\d+$/.test(seg) ? tr("{p1}番目", { p1: +seg + 1 }) : seg))
    .join(" › ");
}

/**
 * 1件分のデータから、表示に使える項目をすべて取り出す。
 * 配列は「すべて」と各要素、入れ子はその中の項目まで展開する
 */
export function flattenFields(
  item: Record<string, unknown>,
  maxDepth = 3,
  maxItems = 5
): FieldOption[] {
  const out: FieldOption[] = [];
  const walk = (value: unknown, path: string, depth: number) => {
    if (value == null || typeof value !== "object") {
      out.push({ field: path, sample: value });
      return;
    }
    if (depth >= maxDepth) return;
    if (Array.isArray(value)) {
      // 文字や数値の配列は、まとめて1つの文章としても使える
      if (value.every((v) => v == null || typeof v !== "object")) {
        out.push({ field: path, sample: value });
      }
      value.slice(0, maxItems).forEach((v, i) => walk(v, `${path}.${i}`, depth + 1));
      return;
    }
    for (const [key, v] of Object.entries(value)) {
      walk(v, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  for (const [key, v] of Object.entries(item)) walk(v, key, 0);
  return out;
}

export function dataFieldsAt(
  doc: SiteDoc,
  pageId: string,
  nodeId: string,
  opts: PreviewOpts = {}
): FieldOption[] {
  const { pageVars, item } = scopeAt(doc, pageId, nodeId, opts);
  const seen = new Set<string>();
  const out: FieldOption[] = [];
  // リストの項目 → 取得したデータの順（同じ名前はリストの項目が優先される）
  for (const o of [
    ...(item ? flattenFields(item) : []),
    ...flattenFields(namedVars(pageVars), 4),
  ]) {
    if (seen.has(o.field)) continue;
    seen.add(o.field);
    out.push(o);
  }
  return out;
}

/* ---------- {変数} の書き換え（移行・変数名の変更） ---------- */

/** テンプレート中の {名前} を fn の結果に置き換える（null ならそのまま） */
export function mapVarTokens(
  template: string,
  fn: (name: string) => string | null
): string {
  return template.replace(/\\\{|\{([^{}\s"'<>`]+)\}/g, (m, name: string | undefined) => {
    // 文字としての「{」（\{…}）は変数ではない
    if (name === undefined) return m;
    const next = fn(name);
    return next == null ? m : `{${next}}`;
  });
}

function mapStepTokens(steps: ScriptStep[], fn: (name: string) => string | null) {
  for (const st of steps) {
    // 配列・取得したデータの名前での参照
    if ("array" in st && st.array) st.array = fn(st.array) ?? st.array;
    if (st.kind === "open-url" || st.kind === "fetch") st.url = mapVarTokens(st.url, fn);
    if (st.kind === "fetch") {
      st.headers = st.headers?.map((h) => ({ ...h, value: mapVarTokens(h.value, fn) }));
      if (st.body) st.body = mapVarTokens(st.body, fn);
    }
    else if (st.kind === "split") st.source = mapVarTokens(st.source, fn);
    else if (st.kind === "calc") st.expr = mapVarTokens(st.expr, fn);
    else if (st.kind === "replace") {
      st.source = mapVarTokens(st.source, fn);
      st.find = st.regex
        ? mapVarTokens(st.find, (name) => (isRegexQuantifier(name) ? null : fn(name)))
        : mapVarTokens(st.find, fn);
      st.to = mapVarTokens(st.to, fn);
    }
    else if (
      st.kind === "array-find" ||
      st.kind === "array-field" ||
      st.kind === "copy" ||
      st.kind === "list-edit" ||
      st.kind === "set-var" ||
      st.kind === "set-value" ||
      st.kind === "filter-array" ||
      st.kind === "store-save"
    ) {
      st.value = mapVarTokens(st.value, fn);
      if (st.kind === "filter-array") {
        st.or?.forEach((c) => (c.value = mapVarTokens(c.value, fn)));
      }
    } else if (st.kind === "if") {
      if (st.cond.value !== undefined) st.cond.value = mapVarTokens(st.cond.value, fn);
      if (st.cond.left !== undefined) st.cond.left = mapVarTokens(st.cond.left, fn);
      mapStepTokens(st.then, fn);
      if (st.else) mapStepTokens(st.else, fn);
    } else if (st.kind === "repeat" || st.kind === "for-each") {
      mapStepTokens(st.then, fn);
    }
  }
}

/** 要素のテキスト・画像・リンク・スクリプトの {変数} を書き換える */
export function mapNodeTokens(node: DocNode, fn: (name: string) => string | null) {
  if (node.text) node.text.content = mapVarTokens(node.text.content, fn);
  if (node.image) node.image.src = mapVarTokens(node.image.src, fn);
  if (node.link?.kind === "url" && node.link.url) {
    node.link.url = mapVarTokens(node.link.url, fn);
  }
  // フォーム部品の初期値・案内文・表示テキスト・選択肢・範囲
  const f = node.field;
  if (f) {
    for (const k of ["label", "defaultValue", "placeholder", "min", "max", "step", "accept"] as const) {
      if (f[k]) f[k] = mapVarTokens(f[k]!, fn);
    }
    if (f.options) f.options = f.options.map((o) => mapVarTokens(o, fn));
  }
  for (const s of node.scripts ?? []) mapStepTokens(s.steps, fn);
}

/** 「変数名」「変数名.〜」を、新しい変数名に付け替える関数 */
export function renameVarFn(from: string, to: string) {
  return (name: string): string | null =>
    name === from ? to : name.startsWith(`${from}.`) ? to + name.slice(from.length) : null;
}

/** ページ内で変数の名前を変えたとき、使っている箇所もまとめて書き換える */
export function renameVarInPage(doc: SiteDoc, pageId: string, from: string, to: string) {
  if (!from || from === to) return;
  const fn = renameVarFn(from, to);
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = doc.nodes[id];
    if (!n) return;
    if (n.type === "instance") {
      const comp = doc.components?.[n.componentId ?? ""];
      if (comp) walk(comp.rootId);
      return;
    }
    mapNodeTokens(n, fn);
    if (n.list?.from) n.list.from = fn(n.list.from) ?? n.list.from;
    n.children.forEach(walk);
  };
  const page = doc.pages[pageId];
  page?.children.forEach(walk);
  for (const s of [...(page?.pageScripts ?? []), ...(page?.scripts ?? [])]) {
    mapStepTokens(s.steps, fn);
  }
}

/**
 * 公開用に、スクリプトで作る変数（取得したデータ・配列・件数など）の名前を
 * 意味のない短い名前に付け替えた複製を返す（配信するHTML・スクリプトに名前を出さない）。
 * 要素のID・リストの項目名・URLのクエリと同じ名前は、参照先が変わらないようそのまま残す
 */
export function obfuscateVarNames(doc: SiteDoc): SiteDoc {
  const out: SiteDoc = structuredClone(doc);
  const stepLists: ScriptStep[][] = [];
  for (const p of Object.values(out.pages)) {
    for (const s of [...(p.pageScripts ?? []), ...(p.scripts ?? [])]) stepLists.push(s.steps);
  }
  for (const n of Object.values(out.nodes)) {
    for (const s of n.scripts ?? []) stepLists.push(s.steps);
  }

  const keep = new Set<string>(["slug", "値"]);
  for (const n of Object.values(out.nodes)) {
    if (n.attrId) keep.add(n.attrId);
    if (n.type === "field" && fieldVarName(n)) keep.add(fieldVarName(n));
  }
  const addQueryKeys = (url: string | undefined) => {
    for (const m of (url ?? "").matchAll(/[?&]([^=&#]+)=/g)) keep.add(m[1]);
  };
  for (const p of Object.values(out.pages)) Object.keys(pageQueryVars(p.query)).forEach((k) => keep.add(k));
  for (const n of Object.values(out.nodes)) if (n.link?.kind === "url") addQueryKeys(n.link.url);
  // 取得したデータの配列の要素（リストの項目）の項目名
  const addItemKeys = (v: unknown, inArray: boolean, depth: number) => {
    if (v == null || typeof v !== "object" || depth > 6) return;
    if (Array.isArray(v)) {
      v.forEach((x) => addItemKeys(x, true, depth + 1));
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (inArray) keep.add(k);
      addItemKeys(x, false, depth + 1);
    }
  };

  const defined = new Set<string>();
  for (const steps of stepLists) {
    walkAll(steps, (st) => {
      if (st.kind === "fetch") {
        if (st.as) defined.add(st.as);
        addItemKeys(st.sample, false, 0);
      }
      if (
        (st.kind === "array-field" || st.kind === "array-find" || st.kind === "join" || st.kind === "sort-array") &&
        st.field
      ) {
        keep.add(rootName(st.field));
      }
      if (st.kind === "filter-array") {
        for (const c of filterConds(st)) keep.add(rootName(c.field));
      }
      if (st.kind === "open-url") addQueryKeys(st.url);
      if ("into" in st && st.into) defined.add(st.into);
    });
  }

  const names = new Map<string, string>();
  let i = 0;
  for (const name of defined) {
    if (keep.has(name)) continue;
    let next: string;
    do next = `_${(i++).toString(36)}`;
    while (defined.has(next) || keep.has(next));
    names.set(name, next);
  }
  if (!names.size) return out;

  // 長い名前から当てる（"a.b" という名前と "a" の両方があっても正しく付け替える）
  const sorted = [...names.keys()].sort((a, b) => b.length - a.length);
  const fn = (name: string): string | null => {
    for (const from of sorted) {
      const r = renameVarFn(from, names.get(from)!)(name);
      if (r != null) return r;
    }
    return null;
  };
  for (const n of Object.values(out.nodes)) {
    mapNodeTokens(n, fn);
    if (n.list?.from) n.list.from = fn(n.list.from) ?? n.list.from;
  }
  for (const p of Object.values(out.pages)) {
    for (const s of [...(p.pageScripts ?? []), ...(p.scripts ?? [])]) mapStepTokens(s.steps, fn);
  }
  for (const steps of stepLists) {
    walkAll(steps, (st) => {
      if (st.kind === "fetch" && st.as) st.as = names.get(st.as) ?? st.as;
      if ("into" in st && st.into) st.into = names.get(st.into) ?? st.into;
    });
  }
  return out;
}
