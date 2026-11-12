import type {
  DocNode,
  ListContent,
  FilterCond,
  Script,
  ScriptOp,
  ScriptStep,
  SiteDoc,
} from "./types";
import {
  extractVars,
  interpolate,
  isSlugPage,
  lookupVar,
  pageQueryVars,
  urlHasSlug,
  varText,
} from "./vars";
import { fieldStateNotes, fieldVarName, fieldVarNames, isRadioItem } from "./fields";
import { tr, trc } from "./i18n";
import { evaluateValueRecipe } from "./script-model/recipe-runtime";
import { matchesValueCondition, parseValueLiteral } from "./value-semantics";
import { runPurePageSteps } from "./page-load-steps";
import { formatValueText } from "./value-text";

/** "data.items" のようなパスでオブジェクトを掘る（配列の "-1" は最後の要素） */
export function digPath(root: unknown, path: string | undefined): unknown {
  if (!path?.trim()) return root;
  let cur = root;
  for (const raw of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    const key = raw.trim();
    const part = Array.isArray(cur) && key === "-1" ? cur.length - 1 : key;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Record<string | number, unknown>)[part];
  }
  return cur;
}

/** 文字や数値の配列をリストで並べるとき、各要素を入れる項目名（{値}） */
export const ITEM_VALUE = "値";

/** Shared display row for the canvas and generated scripts. The latter embed the function source. */
export function toListItem(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : { "値": value };
}

export function toListItems(value: unknown): Record<string, unknown>[] {
  return value && typeof value === "object" ? Object.values(value).map(toListItem) : [];
}

/** Return the first list record for an editor suggestion without expanding the whole list. */
export function firstListItem(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  // The common dense-array case never needs to enumerate the remaining keys.
  if (Array.isArray(value) && Object.prototype.propertyIsEnumerable.call(value, 0)) {
    return toListItem(value[0]);
  }
  // Object.entries(value) would allocate every record even though previews
  // inspect only the first own enumerable entry.
  for (const key in value) {
    if (Object.hasOwn(value, key)) return toListItem((value as Record<string, unknown>)[key]);
  }
  return undefined;
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
 * 絞り込みの比較（スクリプトの「配列を絞り込む」。ブラウザ実行時・書き出し（filterPredicate）と同じく
 * lib/value-semantics.ts の matchesValueCondition の規則）
 */
export function matchOp(v: unknown, op: ScriptOp | undefined, w: unknown): boolean {
  return matchesValueCondition(v, op ?? "eq", w);
}

/** Coerce fetched JSON without invoking custom or shadowed toString methods. */
function safeCompareText(value: unknown): string {
  return formatValueText(value, true);
}

/**
 * 並べ替えの比較。数値どうしは数値で、それ以外は数字を数値として比べる文字列比較
 * （ブラウザ実行時の order・書き出しの listItemsExpr と同じ規則）
 */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return safeCompareText(a).localeCompare(safeCompareText(b), "ja", { numeric: true });
}

/** 「配列を絞り込む」の条件（最初の条件 + 「かつ」「または」の条件。項目未選択は除く） */
export function filterConds(
  st: Extract<ScriptStep, { kind: "list-display" }>
): FilterCond[] {
  const all = [{ field: st.field, op: st.op, value: st.value, not: st.not }, ...(st.or ?? [])];
  const result: FilterCond[] = [];
  let pendingOr = false;
  all.forEach((condition, index) => {
    if (index > 0 && !("and" in condition && condition.and)) pendingOr = true;
    if (!condition.field) return;
    // Keep an OR boundary introduced by an unfinished clause:
    // A OR [empty field] AND C must still mean A OR C.
    const join = result.length > 0 && !pendingOr && "and" in condition && !!condition.and;
    result.push({ ...condition, ...(result.length ? { and: join } : {}) });
    pendingOr = false;
  });
  return result;
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
  | {
      kind: "filter";
      // Transient Canvas evaluation state; never written to the document.
      conds: (FilterCond & { resolvedValue?: { value: unknown } })[];
      no?: number;
      join?: "and" | "or";
    }
  | { kind: "sort"; field: string; dir: "asc" | "desc" };

/** 絞り込み（value の {変数} は解決済み）だけを項目配列に適用 */
export function filterItems(
  items: Record<string, unknown>[],
  ops: ListOp[]
): Record<string, unknown>[] {
  // 絞り込みは、並んだ順に「かつ」「または」でつないだ1つの条件にする
  const filters = ops.filter((o): o is Extract<ListOp, { kind: "filter" }> => o.kind === "filter");
  if (!filters.length) return items;
  // 条件の組み分けと定数の解析は行数によらず1回だけ行う。
  // 呼び出しごとに作り直し、編集や変数の変更を次のプレビューに反映する。
  const prepared = filters.map((o) => ({
    join: o.join,
    groups: condGroups(o.conds).map((group) => group.map((condition) => ({
      condition, ready: false, right: undefined as unknown,
    }))),
  }));
  const pass = (o: (typeof prepared)[number], item: Record<string, unknown>) =>
    o.groups.some((g) =>
      g.every((entry) => {
        const c = entry.condition;
        // 短絡評価で使われない値は解析しない。
        if (!entry.ready) {
          entry.right = c.resolvedValue ? c.resolvedValue.value : parseValueLiteral(c.value);
          entry.ready = true;
        }
        const result = matchOp(keyOfItem(item, c.field), c.op, entry.right);
        return c.not ? !result : result;
      })
    );
  return items.filter((item) =>
    prepared.reduce<boolean>(
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

/** 「変数を探す」に表示する変数の分類 */
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
    groups.push({ key: "item", label: tr("List display item (changes for each entry)"), vars: item });
  }
  const data = namedVars(pageVars);
  if (Object.keys(data).length) {
    groups.push({ key: "data", label: tr("Fetched data and variables"), vars: data });
  }
  const url: Record<string, unknown> = {};
  const notes: Record<string, string> = {};
  if (page && isSlugPage(page.slug)) {
    url.slug = undefined;
    notes.slug = tr("The [slug] part of the page URL");
  }
  for (const [k, v] of Object.entries(pageQueryVars(page?.query))) url[k] = v;
  if (Object.keys(url).length) groups.push({ key: "url", label: tr("Page URL"), vars: url, notes });
  const els: Record<string, unknown> = {};
  const elNotes: Record<string, string> = {};
  for (const n of idVarNodesOf(doc, pageId)) {
    if (n.type === "field") {
      const name = idVarName(n);
      if (name) {
        els[name] = undefined;
        elNotes[name] =
          n.field?.kind === "checkbox"
            ? tr("true when checked, false when not")
            : n.field?.kind === "radio"
              ? tr("Value of the chosen radio button in the group")
              : tr("The value entered in the field");
      }
      if (isRadioItem(n)) {
        els[n.attrId!] = undefined;
        elNotes[n.attrId!] = tr("true when this radio button is chosen");
      }
    } else {
      els[n.attrId!] = nodeTextTemplate(doc, n);
    }
  }
  if (Object.keys(els).length) {
    groups.push({ key: "element", label: tr("Elements with an ID"), vars: els, notes: elNotes });
  }
  // 入力欄の状態（{ID.checked} など）
  const states = fieldStateNotes(idVarNodesOf(doc, pageId).filter((n) => n.type === "field"), tr);
  if (Object.keys(states).length) {
    groups.push({
      key: "state",
      advanced: true,
      label: tr("Field states"),
      vars: Object.fromEntries(Object.keys(states).map((k) => [k, undefined])),
      notes: states,
    });
  }
  const known = new Set(groups.flatMap((g) => Object.keys(g.vars)));
  const made = scriptVarNames(doc, pageId).filter((n) => !known.has(n));
  if (made.length) {
    groups.push({
      key: "script",
      label: tr("Variables set by scripts (their values are set at runtime)"),
      vars: Object.fromEntries(made.map((n) => [n, undefined])),
      notes: Object.fromEntries(made.map((n) => [n, tr("Set when the script runs")])),
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
    if (v && typeof v === "object") return tr("List", "list_variant_1");
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
        n.type !== "field" ? describe(nodeTextTemplate(doc, n)) : n.field?.kind === "checkbox" ? "true / false" : tr("Field value");
    }
    if (isRadioItem(n)) out[n.attrId!] ??= "true / false";
  }
  for (const n of scriptVarNames(doc, pageId)) out[n] ??= tr("Variable made by a script");
  return out;
}

/* ---------- ページで取得するデータ（スクリプトのデータのブロック） ---------- */

/** ページを配信する前（サーバー側）にだけ動くブロック（データの取得） */
export type DataStep = Extract<ScriptStep, { kind: "fetch" }>;
/** リストの各要素を処理するブロック（純粋な処理なら配信前にも実行する）。 */
export type ForEachStep = Extract<ScriptStep, { kind: "for-each" }>;
export type SetVarStep = Extract<ScriptStep, { kind: "set-var" }>;
export type TransformStep = Extract<ScriptStep, { kind: "transform" }>;
/** ページを配信する前に実行するブロック */
export type PureGroupStep = Extract<ScriptStep, { kind: "for-each" | "if" | "repeat" }>;
export type ServerStep = DataStep | SetVarStep | TransformStep | PureGroupStep | Extract<ScriptStep, { kind: "set-list-item" | "remove-list-item" }>;

/** 「［{名前}］を変数［］とする」の {名前}（値が {名前} 1つだけでなければ null） */
export function setVarSource(st: SetVarStep): string | null {
  const m = /^\{([^{}\s"'<>`]+)\}$/.exec(st.value.trim());
  return m ? m[1].trim() : null;
}
export type FetchStep = Extract<ScriptStep, { kind: "fetch" }>;

/** データのブロックか（ページを配信する前に動き、画面上のスクリプトには含めない） */
export function isDataStep(st: ScriptStep): st is DataStep {
  return st.kind === "fetch";
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
function scriptsInPage(doc: SiteDoc, pageId: string, runnableOnly = false): ScriptStep[][] {
  const page = doc.pages[pageId];
  const out: ScriptStep[][] = [];
  const collect = (script: Script) => {
    if (!runnableOnly || (script.trigger &&
        (script.trigger !== "change" || script.changeVariable === undefined || script.changeVariable.trim()))) {
      out.push(script.steps);
    }
  };
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
    n.scripts?.forEach(collect);
    n.children.forEach(walk);
  };
  page?.children.forEach(walk);
  page?.pageScripts?.forEach(collect);
  if (!runnableOnly) page?.scripts?.forEach(collect);
  return out;
}

export interface PagePlan {
  /** ページを開いたときに、配信する前に実行するブロック（実行順） */
  steps: ServerStep[];
  /** steps のうち、画面上のスクリプトから除く分岐ブロック（分解・配列の〜）のID */
  serverIds: Set<string>;
  /** 画面上（ブラウザ）で値が決まる変数・配列の名前 */
  clientVars: Set<string>;
  /** Exact destinations, used to distinguish mutable paths from their server-only siblings. */
  clientAssignmentPaths: Set<string>;
  /** Exact list paths mutated by browser actions, for initializing their runtime values. */
  clientListTargets: Set<string>;
  /**
   * 配列の名前 → 配信する前にリストへ適用する絞り込み・並べ替え（実行順。value は未解決）。
   * 該当するブロックのIDは serverIds にも入る
   */
  listOps: Map<string, ListOp[]>;
  /**
   */
}

/**
 * Page-load control structures are eligible for SSR only when every nested
 * step is data-only. Browser actions are never swallowed by server evaluation.
 */
/** References inside user-written text parameters also determine server/client placement. */
function transformReferences(transform: TransformStep["transform"]): string[] {
  const refs = (text: string) => extractVars(text);
  let fields: string[] = [];
  switch (transform.kind) {
    case "field": fields = refs(transform.key); break;
    case "fallback": fields = refs(transform.text); break;
    case "split":
    case "join": fields = refs(transform.separator); break;
    case "replace": fields = [...refs(transform.find), ...refs(transform.replacement)]; break;
    case "sort": fields = refs(transform.field); break;
  }
  if ("operandType" in transform && transform.operandType === "variable" &&
      typeof transform.operand === "string") fields.push(transform.operand);
  else if ("operandType" in transform && transform.operandType === "text" &&
      typeof transform.operand === "string") fields.push(...refs(transform.operand));
  return fields;
}

function repeatVarName(value: number | string): string | null {
  if (typeof value !== "string") return null;
  return /^\{([^{}\s]+)\}$/.exec(value.trim())?.[1] ?? null;
}

function pureLoadStep(st: ScriptStep, inLoop = false): boolean {
  switch (st.kind) {
    case "set-var": return !!st.into;
    case "set-list-item": return !!st.list;
    case "remove-list-item": return !!st.list && !!st.value.trim();
    case "break-loop": return inLoop;
    case "transform": return !!st.source && !!st.into;
    case "if": return (st.conditions?.length ?? 0) <= 32 &&
      [st.cond, ...(st.conditions ?? [])].every((condition) => condition.subject === "var") &&
      st.then.every((child) => pureLoadStep(child, inLoop)) &&
      (st.else ?? []).every((child) => pureLoadStep(child, inLoop));
    case "for-each": return !!st.array && st.then.length > 0 &&
      st.then.every((child) => pureLoadStep(child, true));
    case "repeat": return (typeof st.times === "number" ? Number.isInteger(st.times) && st.times > 0 && st.times <= 1000 : !!repeatVarName(st.times)) &&
      st.then.every((child) => pureLoadStep(child, true));
    default: return false;
  }
}

/**
 * ページのデータのブロックを、配信する前に動くものと画面上で動くものに分ける。
 * 「このページ｜ページを開いたとき」の直下にあるデータのブロックだけが配信前に動き、
 * 分解・配列の〜は、使う値がストレージや入力欄によらなければ配信前に動く
 */
export function pagePlan(doc: SiteDoc, pageId: string): PagePlan {
  const page = doc.pages[pageId];
  const loadRoot = new Set<ScriptStep>();
  const nestedLoad = new Set<ScriptStep>();
  for (const s of page?.pageScripts ?? []) {
    if (s.trigger !== "load") continue;
    s.steps.forEach((st) => {
      loadRoot.add(st);
      if ((st.kind === "for-each" || st.kind === "if" || st.kind === "repeat") && pureLoadStep(st)) {
        walkAll([st], (child) => nestedLoad.add(child));
      }
    });
  }
  const mayRunOnServer = (st: ScriptStep) => loadRoot.has(st) || nestedLoad.has(st);
  const clientVars = new Set<string>();
  const clientListTargets = new Set<string>();
  const clientAssignmentPaths = new Set<string>();
  const watchedRoots = new Set((page?.pageScripts ?? []).flatMap((s) =>
    s.trigger === "change" && s.changeVariable && s.steps.length ? [rootName(s.changeVariable)] : []));
  const runtimeScripts = scriptsInPage(doc, pageId, true);
  const writeTarget = (st: ScriptStep) =>
    st.kind === "set-list-item" || st.kind === "remove-list-item" ? st.list : "into" in st ? st.into : "";
  const markClientWrite = (st: ScriptStep) => {
    const name = writeTarget(st);
    if (!name) return;
    clientVars.add(rootName(name));
    if (st.kind === "set-list-item" || st.kind === "remove-list-item") clientListTargets.add(name);
    else clientAssignmentPaths.add(name);
  };
  const fieldIds = new Set(
    idVarNodesOf(doc, pageId)
      .filter((n) => n.type === "field")
      .flatMap((n) => fieldVarNames(n))
  );
  for (const steps of runtimeScripts) {
    walkAll(steps, (st) => {
      const name = writeTarget(st);
      if (!name) return;
      // A watched assignment must run with the handler installed, even for
      // constants in page-load scripts that could otherwise be precomputed.
      if (watchedRoots.has(rootName(name)) || !mayRunOnServer(st) || st.kind === "store-load" ||
          (st.kind === "set-var" && loadRoot.has(st) && !setVarSource(st) && extractVars(st.value).length) ||
          (st.kind === "transform" && !st.source)) {
        markClientWrite(st);
      }
    });
  }
  const isClient = (name: string) => clientVars.has(rootName(name)) || fieldIds.has(rootName(name));
  // 「ページを開いたとき」の直下以外でも絞り込み・並べ替えをする配列は、
  // 後から解除・変更できるよう画面上で扱う
  const dynamicArrays = new Set<string>();
  for (const steps of runtimeScripts) {
    walkAll(steps, (st) => {
      if (
        st.kind === "list-display" &&
        !loadRoot.has(st)
      ) {
        dynamicArrays.add(st.array);
      }
    });
  }
  const steps: ServerStep[] = [];
  const serverIds = new Set<string>();
  const listOps = new Map<string, ListOp[]>();
  // 同じ番号の絞り込みはもう一度動かすと置き換わる
  const addOp = (array: string, op: ListOp) => {
    const cur = listOps.get(array) ?? [];
    const i =
      op.kind === "filter" && op.no !== undefined
        ? cur.findIndex((o) => o.kind === "filter" && o.no === op.no)
        : -1;
    listOps.set(array, i >= 0 ? cur.map((o, j) => (j === i ? op : o)) : [...cur, op]);
  };
  const isServerPure = (st: ScriptStep, inLoop = false): boolean => {
    if (st.kind === "set-var") return !!st.into &&
      !clientVars.has(rootName(st.into)) && !extractVars(st.value).some(isClient);
    if (st.kind === "set-list-item") return !!st.list && !isClient(st.list) &&
      !extractVars(st.key).some(isClient) && !extractVars(st.value).some(isClient);
    if (st.kind === "remove-list-item") return !!st.list && !!st.value.trim() &&
      !isClient(st.list) && !extractVars(st.value).some(isClient);
    if (st.kind === "break-loop") return inLoop;
    if (st.kind === "transform") {
      if (!st.into || !st.source || clientVars.has(rootName(st.into)) || isClient(st.source)) return false;
      return !transformReferences(st.transform).some(isClient);
    }
    if (st.kind === "for-each") return !!st.array && !isClient(st.array) &&
      st.then.length > 0 && st.then.every((child) => isServerPure(child, true));
    if (st.kind === "if") return (st.conditions?.length ?? 0) <= 32 &&
      [st.cond, ...(st.conditions ?? [])].every((condition) =>
        condition.subject === "var" &&
        !extractVars(condition.left ?? "").some(isClient) &&
        !extractVars(condition.value ?? "").some(isClient)) &&
      st.then.every((child) => isServerPure(child, inLoop)) &&
      (st.else ?? []).every((child) => isServerPure(child, inLoop));
    if (st.kind === "repeat") {
      const name = repeatVarName(st.times);
      return (typeof st.times === "number"
        ? Number.isInteger(st.times) && st.times > 0 && st.times <= 1000
        : !!name && !isClient(name)) && st.then.every((child) => isServerPure(child, true));
    }
    return false;
  };
  for (const s of page?.pageScripts ?? []) {
    if (s.trigger !== "load") continue;
    for (const st of s.steps) {
      if (isDataStep(st)) {
        steps.push(st);
      } else if (st.kind === "set-var" || st.kind === "transform") {
        // A load-time, pure value chain or constant assignment can run on the server.
        const src = st.kind === "transform" ? st.source : setVarSource(st);
        if (!st.into || (!src && !(st.kind === "set-var" && !extractVars(st.value).length))) continue;
        const clientParameter = st.kind === "transform" &&
          transformReferences(st.transform).some(isClient);
        if ((src && isClient(src)) || clientParameter || clientVars.has(rootName(st.into))) {
          markClientWrite(st);
        } else {
          steps.push(st);
          serverIds.add(st.id);
        }
      } else if ((st.kind === "set-list-item" || st.kind === "remove-list-item") && isServerPure(st)) {
        steps.push(st);
        serverIds.add(st.id);
      } else if (st.kind === "set-list-item" || st.kind === "remove-list-item") {
        markClientWrite(st);
      } else if (st.kind === "for-each" || st.kind === "if" || st.kind === "repeat") {
        if (isServerPure(st)) {
          steps.push(st);
          serverIds.add(st.id);
        } else {
          walkAll([st], markClientWrite);
        }
      } else if (
        st.kind === "list-display" && st.mode !== "clear" &&
        st.array &&
        st.field &&
        !isClient(st.array) &&
        !dynamicArrays.has(st.array) &&
        !(
          st.mode === "filter" &&
          filterConds(st).some((c) => extractVars(c.value).some(isClient))
        )
      ) {
        addOp(
          st.array,
          st.mode === "filter"
            ? { kind: "filter", conds: filterConds(st), no: st.no, join: st.join }
            : { kind: "sort", field: st.field, dir: st.dir }
        );
        serverIds.add(st.id);
      } else if (
        st.kind === "list-display" && st.mode === "clear" &&
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
  return { steps, serverIds, clientVars, clientAssignmentPaths, clientListTargets, listOps };
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

/** Index script variable producers once for the editor's many input fields. */
export interface PageVariableIndex {
  names: string[];
  /** How many steps produce each name (reserved values are accounted for separately). */
  counts: Map<string, number>;
  /** Names produced by a step; repeated IDs may occur in imported data. */
  byStep: Map<string, Map<string, number>>;
  hasOther: (name: string, stepId: string) => boolean;
}

export function pageVariableIndex(doc: SiteDoc, pageId: string): PageVariableIndex {
  const counts = new Map<string, number>();
  const byStep = new Map<string, Map<string, number>>();
  for (const steps of scriptsInPage(doc, pageId)) {
    walkAll(steps, (step) => {
      const name = stepOutName(step);
      if (!name) return;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const produced = byStep.get(step.id) ?? new Map<string, number>();
      produced.set(name, (produced.get(name) ?? 0) + 1);
      byStep.set(step.id, produced);
    });
  }
  const names = [...new Set(["slug", ITEM_VALUE, ...counts.keys()])];
  return {
    names, counts, byStep,
    hasOther: (name, stepId) =>
      name === "slug" || name === ITEM_VALUE ||
      (counts.get(name) ?? 0) > (byStep.get(stepId)?.get(name) ?? 0),
  };
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

/** Locate the script containing each step once per immutable document. */
type InputStepOwner = {
  where: "page" | "node";
  id: string;
  field: "pageScripts" | "scripts";
  index: number;
};
const inputStepOwners = new WeakMap<SiteDoc, Map<string, InputStepOwner[]>>();

function ownersOfInputSteps(doc: SiteDoc): Map<string, InputStepOwner[]> {
  const cached = inputStepOwners.get(doc);
  if (cached) return cached;
  const index = new Map<string, InputStepOwner[]>();
  const add = (scripts: { steps: ScriptStep[] }[] | undefined,
    location: Omit<InputStepOwner, "index">) => {
    scripts?.forEach((script, position) => {
      const owner: InputStepOwner = { ...location, index: position };
      const seen = new Set<string>();
      walkAll(script.steps, (step) => {
        if (seen.has(step.id)) return;
        seen.add(step.id);
        const owners = index.get(step.id) ?? [];
        owners.push(owner);
        index.set(step.id, owners);
      });
    });
  };
  for (const [id, page] of Object.entries(doc.pages)) {
    add(page.pageScripts, { where: "page", id, field: "pageScripts" });
    add(page.scripts, { where: "page", id, field: "scripts" });
  }
  for (const [id, node] of Object.entries(doc.nodes)) {
    add(node.scripts, { where: "node", id, field: "scripts" });
  }
  inputStepOwners.set(doc, index);
  return index;
}

/** 候補用の文書。編集中のブロック自身を実行・列挙せず、同名の別producerやフォームは保つ。 */
export function scriptInputDoc(doc: SiteDoc, stepId?: string): SiteDoc {
  if (!stepId) return doc;
  const owners = ownersOfInputSteps(doc).get(stepId);
  if (!owners?.length) return doc;

  const withoutStep = (list: ScriptStep[]): ScriptStep[] => {
    let changed: ScriptStep[] | undefined;
    for (let i = 0; i < list.length; i++) {
      const step = list[i];
      if (step.id === stepId) {
        changed ??= list.slice(0, i);
        continue;
      }
      let next: ScriptStep = step;
      if (step.kind === "if") {
        const then = withoutStep(step.then);
        const otherwise = step.else ? withoutStep(step.else) : undefined;
        if (then !== step.then || otherwise !== step.else) {
          next = { ...step, then, ...(step.else ? { else: otherwise } : {}) };
        }
      } else if (step.kind === "repeat" || step.kind === "for-each") {
        const then = withoutStep(step.then);
        if (then !== step.then) next = { ...step, then };
      }
      if (changed) changed.push(next);
      else if (next !== step) {
        changed = list.slice(0, i);
        changed.push(next);
      }
    }
    return changed ?? list;
  };
  const rewrite = <T extends { steps: ScriptStep[] }>(
    scripts: T[] | undefined, index: number
  ): T[] | undefined => {
    const script = scripts?.[index];
    if (!script || !scripts) return undefined;
    const steps = withoutStep(script.steps);
    if (steps === script.steps) return undefined;
    const updated = scripts.slice();
    updated[index] = { ...script, steps };
    return updated;
  };
  let pages: SiteDoc["pages"] | undefined;
  let nodes: SiteDoc["nodes"] | undefined;
  for (const owner of owners) {
    if (owner.where === "page") {
      const page = (pages ?? doc.pages)[owner.id];
      if (!page) continue;
      const updated = rewrite(page[owner.field], owner.index);
      if (!updated) continue;
      pages ??= { ...doc.pages };
      pages[owner.id] = { ...page, [owner.field]: updated };
    } else {
      const node = (nodes ?? doc.nodes)[owner.id];
      if (!node) continue;
      const updated = rewrite(node.scripts, owner.index);
      if (!updated) continue;
      nodes ??= { ...doc.nodes };
      nodes[owner.id] = { ...node, scripts: updated };
    }
  }
  return pages || nodes
    ? { ...doc, ...(pages ? { pages } : {}), ...(nodes ? { nodes } : {}) }
    : doc;
}

/** 名前の候補を、ページ内の既存の変数と重ならないようにする */
export function uniqueVarName(doc: SiteDoc, pageId: string, base: string, exceptStepId?: string): string {
  const used = dataVarNames(doc, pageId, exceptStepId);
  const stem = cleanVarName(base) || trc("variable_name", "data");
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
        out.push({ name: c.name, client: clientVars.has(rootName(c.name)) });
        added = true;
      }
    }
  }
  // New ordinary transform blocks can also create list variables. Keep their
  // results selectable even before runtime data is available.
  let transformedSamples: Record<string, unknown> | undefined;
  for (const steps of scriptsInPage(doc, pageId)) {
    walkAll(steps, (st) => {
      if (st.kind !== "transform" || !st.into || seen.has(st.into)) return;
      const listProducing = ["split", "sort", "append"].includes(st.transform.kind);
      if (!listProducing) {
        transformedSamples ??= previewDataVars(doc, pageId);
        if (!Array.isArray(lookupVar(transformedSamples, st.into))) return;
      }
      seen.add(st.into);
      out.push({ name: st.into, client: clientVars.has(rootName(st.into)) });
    });
  }
  // Lists may have either numeric or named keys.
  const visitedLists = new Set<unknown>();
  const visit = (value: unknown, name: string, depth: number) => {
    if (!value || typeof value !== "object" || visitedLists.has(value) || depth > 4) return;
    visitedLists.add(value);
    if (!seen.has(name)) {
      seen.add(name);
      out.push({ name, client: clientVars.has(name.split(".")[0]) });
    }
    if (depth < 4) {
      // List samples can contain 20 records, but their picker only needs the
      // first record to discover nested paths. Other indexes remain writable.
      const children = Array.isArray(value)
        ? value.length ? [["0", value[0]] as const] : []
        : Object.entries(value).slice(0, 50);
      for (const [key, child] of children) {
        if (!key.includes(".") && child && typeof child === "object")
          visit(child, name + "." + key, depth + 1);
      }
    }
  };
  const sampleVars = previewDataVars(doc, pageId);
  for (const [name, value] of Object.entries(sampleVars))
    if (!name.startsWith("#")) visit(value, name, 0);
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
 * A slug-aware record can be selected using an ordinary list loop:
 * for each entry -> if {ループ.値.field} equals {slug} -> set selected = {ループ.値}, break.
 * No special search transformation is required.
 */
function slugSelectorOf(doc: SiteDoc, pageId: string): {
  loop: ForEachStep; field: string; selected: SetVarStep;
} | null {
  for (const step of pageDataSteps(doc, pageId)) {
    if (step.kind !== "for-each" || !step.array) continue;
    for (const child of step.then) {
      if (child.kind !== "if") continue;
      const clauses = [child.cond, ...(child.conditions ?? [])];
      if (clauses.length !== 1) continue;
      const clause = clauses[0];
      if (clause.subject !== "var" || clause.op !== "eq" || clause.not) continue;
      const left = clause.left?.trim() ?? "";
      const right = clause.value?.trim() ?? "";
      const prefix = "{ループ.値.";
      const field = left.startsWith(prefix) && left.endsWith("}") && right === "{slug}"
        ? left.slice(prefix.length, -1) : "";
      if (!field) continue;
      const selected = child.then.find((item): item is SetVarStep =>
        item.kind === "set-var" && item.value.trim() === "{ループ.値}" && !!item.into);
      if (selected && child.then.some((item) => item.kind === "break-loop"))
        return { loop: step, field, selected };
    }
  }
  return null;
}

export type PrimaryStep = SetVarStep;
export function primaryDataStep(doc: SiteDoc, pageId: string): { step: PrimaryStep } | null {
  const page = doc.pages[pageId];
  if (!page || !isSlugPage(page.slug)) return null;
  const chosen = slugSelectorOf(doc, pageId);
  if (chosen) return { step: chosen.selected };
  const all = pageDataSteps(doc, pageId);
  const slugFetches = new Set(all.filter((step) =>
    step.kind === "fetch" && step.as && urlHasSlug(step.url)).map((step) => (step as FetchStep).as!));
  for (const step of all) {
    const source = step.kind === "set-var" ? setVarSource(step) : null;
    if (source && slugFetches.has(rootName(source))) return { step: step as SetVarStep };
  }
  return null;
}

/** Preview candidates used by slug-aware loops. */
export function primaryCandidates(
  doc: SiteDoc, pageId: string, live?: Record<string, unknown>,
): { field: string; items: Record<string, unknown>[] } | null {
  const selection = slugSelectorOf(doc, pageId);
  if (!selection) return null;
  const vars = previewDataVars(doc, pageId, { live, index: 0 });
  return { field: selection.field, items: toListItems(lookupVar(vars, selection.loop.array)) };
}

/** 一覧の1件の、見分ける項目の値（"category.slug" のような位置も使える） */
export function keyOfItem(item: Record<string, unknown>, field: string): unknown {
  return Object.prototype.hasOwnProperty.call(item, field) ? item[field] : digPath(item, field);
}

/** 「探す」ブロックの照合（URLの値はエンコードされていることがある） */
export function sameKey(value: unknown, key: string): boolean {
  const v = String(value ?? "");
  return v === key || encodeURIComponent(v) === key;
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
  const origins: Record<string, { totals?: Record<string, number>; path: string }> = {};
  const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
  const save = (key: string, value: unknown) =>
    Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
  const setOrigin = (key: string, value: { totals?: Record<string, number>; path: string }) =>
    Object.defineProperty(origins, key, { value, writable: true, enumerable: true, configurable: true });
  const originFor = (name: string) => {
    if (own(origins, name)) return origins[name];
    const [head, ...tail] = name.split(".");
    const root = own(origins, head) ? origins[head] : undefined;
    return root ? { totals: root.totals, path: [root.path, ...tail].filter(Boolean).join(".") } : null;
  };
  const primarySelector = slugSelectorOf(doc, pageId);
  const scope = () => ({ ...opts.vars, slug: opts.slug, ...out });
  const plan = pagePlan(doc, pageId);
  for (const st of plan.steps) {
    switch (st.kind) {
      case "fetch":
        if (st.as) {
          save(st.as, opts.live && own(opts.live, st.id) ? opts.live[st.id] : st.preview?.sample ?? null);
          setOrigin(st.as, {
            totals: opts.live?.[st.id] !== undefined ? opts.liveTotals?.[st.id] : st.preview?.totals,
            path: "",
          });
        }
        break;
      case "set-var": {
        if (!st.into) break;
        const src = setVarSource(st);
        if (src) {
          save(st.into, lookupVar(scope(), src));
          const origin = originFor(src);
          if (origin) setOrigin(st.into, origin);
        } else if (!extractVars(st.value).length) {
          // Infer only unambiguous JSON literals; preserve ordinary text.
          save(st.into, parseValueLiteral(interpolate(st.value, scope())));
          delete origins[st.into];
        }
        break;
      }
      case "set-list-item":
      case "remove-list-item": {
        runPurePageSteps([st], out, lookupVar, interpolate, evaluateValueRecipe,
          { ...opts.vars, slug: opts.slug });
        break;
      }
      case "transform": {
        if (!st.into || !st.source) break;
        const vars = scope();
        const result = evaluateValueRecipe(lookupVar(vars, st.source), [st.transform], vars);
        if (result.kind === "value") {
          const origin = originFor(st.source);
          if (st.transform.kind === "length" && origin?.totals &&
              Object.hasOwn(origin.totals, origin.path)) {
            save(st.into, origin.totals[origin.path]);
          } else {
            save(st.into, result.value);
          }
          if (st.transform.kind === "field" && origin) {
            setOrigin(st.into, { totals: origin.totals,
              path: [origin.path, interpolate(st.transform.key, vars)].filter(Boolean).join(".") });
          } else delete origins[st.into];
        } else if (result.kind === "missing") {
          // Avoid reusing the result from a previous run in a connected block.
          save(st.into, undefined);
          delete origins[st.into];
        }
        break;
      }
      case "for-each":
      case "if":
      case "repeat": {
        // Run the same interpreter as exported pages; nested source fields
        // override outer values, while assignments persist in the page vars.
        const selectedSlug = st.kind === "for-each" && primarySelector?.loop.id === st.id &&
          opts.index !== undefined && opts.slug === undefined
          ? keyOfItem(toListItems(lookupVar(scope(), st.array))[opts.index] ?? {}, primarySelector.field)
          : opts.slug;
        runPurePageSteps([st], out, lookupVar, interpolate, evaluateValueRecipe,
          { ...opts.vars, slug: selectedSlug });
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
    for (const copy of copies) {
      if (Object.prototype.hasOwnProperty.call(out, copy.into)) continue;
      const value = lookupVar(scope(), copy.src);
      if (value === undefined) continue;
      save(copy.into, value);
      added = true;
    }
  }
  return out;
}

export { setVarPath } from "./value-semantics";

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
      // リストは文字・数値・真偽値も「値」として並べられる。空でも取得後に使える。
      if (!value.length || toListItems(value).length) {
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
    .map((seg) => (seg === "-1" ? tr("Last") : /^\d+$/.test(seg) ? tr("#{p1}", { p1: +seg + 1 }) : seg))
    .join(" › ");
}

/**
 * 1件分のデータから、表示に使える項目をすべて取り出す。
 * 配列は「すべて」と先頭要素の見本、入れ子はその中の項目まで展開する
 */
export function flattenFields(
  item: Record<string, unknown>,
  maxDepth = 3,
  maxItems = 1
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
    if (st.kind === "set-list-item" || st.kind === "remove-list-item") {
      st.list = fn(st.list) ?? st.list;
      if (st.kind === "set-list-item") st.key = mapVarTokens(st.key, fn);
      st.value = mapVarTokens(st.value, fn);
    }
    if (st.kind === "open-url" || st.kind === "fetch") st.url = mapVarTokens(st.url, fn);
    if (st.kind === "fetch") {
      st.headers = st.headers?.map((h) => ({ ...h, value: mapVarTokens(h.value, fn) }));
      if (st.body) st.body = mapVarTokens(st.body, fn);
    }
    else if (st.kind === "transform") {
      st.source = fn(st.source) ?? st.source;
      const t = st.transform;
      const next: Record<string, unknown> = { ...t };
      if ("operandType" in t && typeof t.operand === "string") {
        if (t.operandType === "variable") next.operand = fn(t.operand) ?? t.operand;
        if (t.operandType === "text") next.operand = mapVarTokens(t.operand, fn);
      }
      if (t.kind === "field") next.key = mapVarTokens(t.key, fn);
      if (t.kind === "fallback") next.text = mapVarTokens(t.text, fn);
      if (t.kind === "split" || t.kind === "join") next.separator = mapVarTokens(t.separator, fn);
      if (t.kind === "replace") {
        next.find = mapVarTokens(t.find, fn);
        next.replacement = mapVarTokens(t.replacement, fn);
      }
      if (t.kind === "sort") next.field = mapVarTokens(t.field, fn);
      st.transform = next as typeof st.transform;
    }
    else if (
      st.kind === "copy" ||
      st.kind === "set-var" ||
      st.kind === "set-value" ||
      st.kind === "list-display" ||
      st.kind === "store-save"
    ) {
      st.value = mapVarTokens(st.value, fn);
      if (st.kind === "list-display") {
        st.or?.forEach((c) => (c.value = mapVarTokens(c.value, fn)));
      }
    } else if (st.kind === "if") {
      for (const condition of [st.cond, ...(st.conditions ?? [])]) {
        if (condition.value !== undefined) condition.value = mapVarTokens(condition.value, fn);
        if (condition.left !== undefined) condition.left = mapVarTokens(condition.left, fn);
      }
      mapStepTokens(st.then, fn);
      if (st.else) mapStepTokens(st.else, fn);
    } else if (st.kind === "wait" && typeof st.seconds === "string") {
      st.seconds = mapVarTokens(st.seconds, fn);
    } else if (st.kind === "repeat" || st.kind === "for-each") {
      if (st.kind === "repeat" && typeof st.times === "string") st.times = mapVarTokens(st.times, fn);
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
    if (f.options) f.options = f.options.map((o) => ({
      label: mapVarTokens(o.label, fn),
      value: mapVarTokens(o.value, fn),
    }));
  }
  for (const s of node.scripts ?? []) {
    if (s.changeVariable !== undefined)
      s.changeVariable = fn(s.changeVariable) ?? s.changeVariable;
    mapStepTokens(s.steps, fn);
  }
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
    if (s.changeVariable !== undefined)
      s.changeVariable = fn(s.changeVariable) ?? s.changeVariable;
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

  const keep = new Set<string>(["slug", "値", "ループ"]);
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
        addItemKeys(st.preview?.sample, false, 0);
      }
      if (st.kind === "list-display") {
        if (st.field) keep.add(rootName(st.field));
        if (st.mode === "filter") {
          for (const condition of filterConds(st)) keep.add(rootName(condition.field));
        }
      }
      if (st.kind === "open-url") addQueryKeys(st.url);
      // A dotted assignment updates a field of its root variable.
      if ("into" in st && st.into) defined.add(rootName(st.into));
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
    for (const s of [...(p.pageScripts ?? []), ...(p.scripts ?? [])]) {
      if (s.changeVariable !== undefined)
        s.changeVariable = fn(s.changeVariable) ?? s.changeVariable;
      mapStepTokens(s.steps, fn);
    }
  }
  for (const steps of stepLists) {
    walkAll(steps, (st) => {
      if (st.kind === "fetch" && st.as) st.as = names.get(st.as) ?? st.as;
      if ("into" in st && st.into) st.into = fn(st.into) ?? st.into;
    });
  }
  return out;
}
