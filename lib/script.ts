import {
  PAGE_TARGET,
  SELF_TARGET,
  type DocNode,
  type LinkSetting,
  type Page,
  type Script,
  type ScriptCond,
  type ScriptStep,
  type ScriptTrigger,
  type SiteDoc,
} from "./types";
import { filterConds } from "./data";
import { tr } from "./i18n";
import { extractVars, hasVars } from "./vars";
import { singleValueReference } from "./variable-choice";

/** src が空のときに表示する、透明な 1×1 の画像（壊れた画像の枠を表示しない） */
export const EMPTY_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

let seq = 0;
export function scriptUid(prefix = "sc"): string {
  seq += 1;
  // 共同編集で別の人が作った ID と重ならないよう、ランダムな部分も付ける（lib/presets.ts の genId と同じ）
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

/** node.link をエディタ上で表すスクリプトの ID（`link_<ノードID>`） */
const LINK_PREFIX = "link_";
export const isLinkScriptId = (id: string) => id.startsWith(LINK_PREFIX);

export const TRIGGER_LABELS: Record<ScriptTrigger, string> = {
  click: tr("When clicked"),
  "hover-start": tr("When hover starts"),
  "hover-end": tr("When hover ends"),
  change: tr("When the value changes"),
  load: tr("When the page opens"),
  "in-view": tr("When scrolled into view"),
};

export const TRIGGER_ORDER: ScriptTrigger[] = [
  "click",
  "hover-start",
  "hover-end",
  "change",
  "load",
  "in-view",
];

/* ---------- link とスクリプトの相互変換 ---------- */

/** 「クリックしたとき → 開く」だけを持つスクリプトなら、link として表せる */
function linkOfScript(s: Script): LinkSetting | null {
  if (s.trigger !== "click" || s.steps.length !== 1) return null;
  const st = s.steps[0];
  if (st.kind === "open-page") {
    return { kind: "page", pageId: st.pageId, ...(st.newTab ? { newTab: true } : {}) };
  }
  if (st.kind === "open-url") {
    return { kind: "url", url: st.url, newTab: !!st.newTab };
  }
  return null;
}

/** エディタに並べるスクリプトの一覧（link は「クリックしたとき → 開く」として先頭に置く） */
export function scriptsOf(node: DocNode): Script[] {
  const out: Script[] = [];
  if (node.link) {
    const l = node.link;
    const id = `${LINK_PREFIX}${node.id}`;
    out.push({
      id,
      trigger: "click",
      steps: [
        l.kind === "page"
          ? {
              id: `${id}_step`,
              kind: "open-page",
              pageId: l.pageId ?? "",
              ...(l.newTab ? { newTab: true } : {}),
            }
          : {
              id: `${id}_step`,
              kind: "open-url",
              url: l.url ?? "",
              ...(l.newTab ? { newTab: true } : {}),
            },
      ],
    });
  }
  return out.concat(node.scripts ?? []);
}

/** ステップを新しいIDで複製する */
export function cloneSteps(steps: ScriptStep[], makeId = () => scriptUid("st")): ScriptStep[] {
  return steps.map((st) =>
    st.kind === "if"
      ? {
          ...st,
          id: makeId(),
          cond: { ...st.cond },
          ...(st.conditions ? { conditions: st.conditions.map((condition) => ({ ...condition })) } : {}),
          then: cloneSteps(st.then, makeId),
          ...(st.else ? { else: cloneSteps(st.else, makeId) } : {}),
        }
      : st.kind === "repeat" || st.kind === "for-each"
        ? { ...st, id: makeId(), then: cloneSteps(st.then, makeId) }
        : { ...st, id: makeId() }
  );
}

/**
 * エディタのスクリプトの一覧を、保存する形に分ける。
 * allowLink のときは、最初の「クリックしたとき → 開く」だけのものを link（a タグ）にする
 */
function splitScripts(
  scripts: Script[],
  allowLink: boolean
): Pick<DocNode, "link" | "scripts"> {
  let link: LinkSetting | null = null;
  const rest: Script[] = [];
  for (const s of scripts) {
    const l: LinkSetting | null =
      link || !allowLink ? null : linkOfScript(s);
    if (l) {
      link = l;
      continue;
    }
    // link から来た予約の ID は、通常のスクリプトになった時点で振り直す
    let fromLink = isLinkScriptId(s.id);
    walkSteps(s.steps, (st) => {
      if (isLinkScriptId(st.id)) fromLink = true;
    });
    rest.push(
      fromLink ? { ...s, id: scriptUid(), steps: cloneSteps(s.steps) } : s
    );
  }
  return { link, scripts: rest.length ? rest : undefined };
}

/* ---------- ページ単位のスクリプトの画面 ---------- */

/**
 * ページのスクリプトの画面での1件。
 * nodeId = きっかけの要素（PAGE_TARGET = このページ）
 */
export interface PageScript extends Script {
  nodeId: string;
}

/**
 * ページの中の要素の ID（インスタンスは、コンポーネントのマスターをたどる）。
 * ID 属性の重複を調べるときは、使用箇所自身の ID も含める。
 */
export function pageNodeIds(
  doc: SiteDoc,
  pageId: string,
  extraRootIds: string[] = [],
  includeInstances = false
): string[] {
  const out: string[] = [];
  visitPageNodes(doc, pageId, extraRootIds, (id) => out.push(id), includeInstances);
  return out;
}

/** 表示順にたどり、インスタンスの位置でコンポーネントのマスターを展開する。 */
export function visitPageNodes(
  doc: SiteDoc,
  pageId: string,
  extraRootIds: string[],
  visit: (id: string, node: DocNode, depth: number) => void,
  includeInstances = false
) {
  const walked = new Set<string>();
  const pending = [...(doc.pages[pageId]?.children ?? []), ...extraRootIds]
    .reverse().map((id) => ({ id, depth: 0 }));
  while (pending.length) {
    const { id, depth } = pending.pop()!;
    if (walked.has(id)) continue;
    walked.add(id);
    const node = doc.nodes[id];
    if (!node) continue;
    if (node.type === "instance") {
      if (includeInstances) visit(id, node, depth);
      const master = doc.components?.[node.componentId ?? ""];
      if (master) pending.push({ id: master.rootId, depth: includeInstances ? depth + 1 : depth });
    } else {
      visit(id, node, depth);
      for (let i = node.children.length - 1; i >= 0; i--)
        pending.push({ id: node.children[i], depth: depth + 1 });
    }
  }
}

/** エディタが更新されても、変わっていないスクリプトには、変更しない表示用の包みを使い回す。 */
const scriptViewCache = new WeakMap<Script, Map<string, PageScript>>();
function scriptView(script: Script, nodeId: string): PageScript {
  let byNode = scriptViewCache.get(script);
  if (!byNode) {
    byNode = new Map();
    scriptViewCache.set(script, byNode);
  }
  const saved = byNode.get(nodeId);
  if (saved && saved.id === script.id && saved.steps === script.steps &&
      saved.trigger === script.trigger &&
      saved.changeVariable === script.changeVariable &&
      saved.keepOnShown === script.keepOnShown) return saved;
  const view: PageScript = { ...script, nodeId };
  byNode.set(nodeId, view);
  return view;
}

/**
 * ページのスクリプトを、画面に並べる順に返す。
 * 「このページ」のものが先で、続けて要素のものをページ内の表示順に並べる。
 */
export function pageScriptsOf(doc: SiteDoc, nodeIds: string[], pageId: string): PageScript[] {
  const out: PageScript[] = [];
  for (const s of doc.pages[pageId]?.pageScripts ?? []) out.push(scriptView(s, PAGE_TARGET));
  for (const id of nodeIds) {
    const n = doc.nodes[id];
    if (n) for (const s of scriptsOf(n)) out.push(scriptView(s, id));
  }
  return out;
}

/** 画面の内容を、きっかけの要素ごとに振り分ける。存在しない要素を指すものは保存しない。 */
function groupPageScripts(doc: SiteDoc, nodeIds: string[], views: PageScript[]) {
  const byNode = new Map<string, Script[]>();
  const validNodeIds = new Set(nodeIds);
  const own: Script[] = [];
  for (const { nodeId, ...s } of views) {
    if (nodeId === PAGE_TARGET) {
      own.push(s);
    } else if (validNodeIds.has(nodeId) && doc.nodes[nodeId]) {
      const group = byNode.get(nodeId);
      if (group) group.push(s);
      else byNode.set(nodeId, [s]);
    }
  }
  return { byNode, own };
}

/** スクリプトの画面の内容を、各要素（link / scripts）とページに書き戻す */
export function applyPageScripts(
  doc: SiteDoc,
  pageId: string,
  nodeIds: string[],
  views: PageScript[]
) {
  const { byNode, own } = groupPageScripts(doc, nodeIds, views);
  for (const id of nodeIds) {
    const n = doc.nodes[id];
    if (!n) continue;
    // リンク（a タグ）にできるのは、ボックスだけ
    const r = splitScripts(byNode.get(id) ?? [], n.type === "box");
    n.link = r.link;
    if (r.scripts) n.scripts = r.scripts;
    else delete n.scripts;
  }
  const page = doc.pages[pageId];
  if (page) {
    if (own.length) page.pageScripts = own;
    else delete page.pageScripts;
  }
}

/**
 * サイト全体（アセットや関係の無いページを含む）を複製せずに、画面での編集を反映する。
 * 元に戻すためのスナップショットは、触れていない枝を安全に共有できる。
 *
 * pageScriptsOf() は表示用の包みを作るため、オブジェクトの同一性だけで比べると、
 * 変わっていないスクリプトが新しい文書や履歴の項目になってしまう。
 */
function sameScript(a: Script, b: Script): boolean {
  return a === b || (
    a.id === b.id &&
    a.trigger === b.trigger &&
    a.changeVariable === b.changeVariable &&
    a.keepOnShown === b.keepOnShown &&
    a.steps === b.steps
  );
}

function sameScriptList(a: Script[] | undefined, b: Script[] | undefined): boolean {
  if (a === b) return true;
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false;
  return (a ?? []).every((script, i) => sameScript(script, b![i]));
}

/** 同じノードの別のスクリプトが変わっても、変わっていないスクリプトのオブジェクトは使い回す。 */
function reuseUnchangedScripts(before: Script[] | undefined, after: Script[] | undefined): Script[] | undefined {
  if (!after || !before) return after;
  return after.map((script, i) => before[i] && sameScript(before[i], script) ? before[i] : script);
}

function sameLink(a: LinkSetting | null, b: LinkSetting | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.url === b.url && a.pageId === b.pageId &&
    !!a.newTab === !!b.newTab;
}

/** applyPageScripts の、純粋でコピーオンライトの版。エディタで頻繁に確定するときに使う。 */
export function withPageScripts(
  doc: SiteDoc,
  pageId: string,
  nodeIds: string[],
  views: PageScript[]
): SiteDoc {
  const page = doc.pages[pageId];
  if (!page) return doc;

  const { byNode, own } = groupPageScripts(doc, nodeIds, views);
  let nodes: SiteDoc["nodes"] | null = null;
  for (const id of nodeIds) {
    const previous = doc.nodes[id];
    if (!previous) continue;
    // ノードを新しく作るのは、そのノード自身のスクリプトやリンクのデータが実際に変わったときだけ。
    const updated = splitScripts(byNode.get(id) ?? [], previous.type === "box");
    const sameLinkValue = sameLink(previous.link, updated.link);
    if (sameLinkValue && sameScriptList(previous.scripts, updated.scripts)) continue;

    const copy = { ...previous, link: sameLinkValue ? previous.link : updated.link };
    if (updated.scripts) {
      copy.scripts = reuseUnchangedScripts(previous.scripts, updated.scripts);
    } else {
      delete copy.scripts;
    }
    nodes ??= { ...doc.nodes };
    nodes[id] = copy;
  }

  const changedPage = !sameScriptList(page.pageScripts, own);
  if (!nodes && !changedPage) return doc;

  let pages = doc.pages;
  if (changedPage) {
    const updated = { ...page };
    if (own.length) updated.pageScripts = reuseUnchangedScripts(page.pageScripts, own);
    else delete updated.pageScripts;
    pages = { ...doc.pages, [pageId]: updated };
  }
  return { ...doc, nodes: nodes ?? doc.nodes, pages };
}

/* ---------- 走査 ---------- */

/** 実行されるすべてのスクリプト（要素のものと「このページ」のもの） */
export function allScripts(doc: SiteDoc): Script[] {
  return [
    ...Object.values(doc.nodes).flatMap((n) => n.scripts ?? []),
    ...Object.values(doc.pages).flatMap((p) => p.pageScripts ?? []),
  ];
}

export function walkSteps(steps: ScriptStep[], fn: (st: ScriptStep) => void) {
  for (const st of steps) {
    fn(st);
    if (st.kind === "if") {
      walkSteps(st.then, fn);
      if (st.else) walkSteps(st.else, fn);
    } else if (st.kind === "repeat" || st.kind === "for-each") {
      walkSteps(st.then, fn);
    }
  }
}

/** Retarget explicit page destinations in a copied node or page, including nested script blocks. */
export function remapPageLinks(owner: DocNode | Page, toPage: (id: string) => string): void {
  if ("type" in owner && owner.link?.kind === "page" && owner.link.pageId) {
    owner.link.pageId = toPage(owner.link.pageId);
  }
  const scripts = "type" in owner ? owner.scripts : owner.pageScripts;
  for (const script of scripts ?? []) {
    walkSteps(script.steps, step => {
      if (step.kind === "open-page") step.pageId = toPage(step.pageId);
    });
  }
}

/** スクリプトが参照する ID 属性（SELF_TARGET は、要素自身の ID に解決する） */
export function scriptTargetIds(
  node: Pick<DocNode, "scripts" | "attrId">,
  kinds?: ScriptStep["kind"][]
): string[] {
  const out = new Set<string>();
  const add = (t: string) => {
    const id = t === SELF_TARGET ? node.attrId : t;
    if (id) out.add(id);
  };
  for (const s of node.scripts ?? []) {
    walkSteps(s.steps, (st) => {
      if (kinds && !kinds.includes(st.kind)) return;
      if ("target" in st) add(st.target);
      if (!kinds && st.kind === "if") {
        add(st.cond.target);
        (st.conditions ?? []).forEach((condition) => add(condition.target));
      }
    });
  }
  return [...out];
}

/** 画面上で動く可能性のあるスクリプトを持つか。サーバー済みの手順はコンパイル時に除く。 */
export function hasRunnableScripts(node: Pick<DocNode, "scripts">): boolean {
  return !!node.scripts?.some(
    (s) => (s.trigger !== "change" || s.changeVariable === undefined || !!s.changeVariable.trim()) &&
      s.steps.length > 0
  );
}

/* ---------- 実行形式への変換 ---------- */

type RuntimeStep = Record<string, unknown>;
interface RuntimeScript {
  trigger: ScriptTrigger;
  steps: RuntimeStep[];
  changeVariable?: string;
  keep?: true;
}

/**
 * 実行用に変換する（ID や位置を除き、ページは URL のパスにする）。
 * ページを開いたときの直下で実行済みのデータ取得だけを skip により除く。
 * str: URL や値の文字列を差し替える（{変数} の解決など）
 * withPageId: ページの ID も残す（プレビューは ID でページを切り替え、書き出しは URL だけを使う）
 */
export function compileScripts(
  node: Pick<DocNode, "scripts">,
  pageHref: (pageId: string) => string,
  /** item は、対象の配列の項目を実行時に読む式。項目が無い状態で値を確定しない。 */
  str: (s: string, kind: "url" | "value", item?: boolean) => string = (s) => s,
  withPageId = true,
  /** 配信する前に済ませるため、ここでは除くブロックの ID（ページを開いたときの分解や、配列の〜） */
  skip?: Set<string>,
  /**
   * 「［{名前}］を変数［］とする」で、配信する前に値が決まる変数の値をそのまま渡す
   * （配列を文字にしない）。画面上で値が決まる変数なら undefined を返す。
   * item が true のときは配列の各項目が優先されるため、参照を残す。
   */
  raw?: (name: string, item?: boolean, usage?: "length") => unknown
): RuntimeScript[] {
  const typedInput = (value: string) => {
    if (!hasVars(value)) return value;
    const name = singleValueReference(value);
    if (!name) return str(value, "value");
    const fallback = raw?.(name);
    return { inputRef: name, ...(fallback !== undefined ? { raw: fallback } : {}) };
  };
  const compileCondition = (condition: ScriptCond) => {
    const input = condition.subject === "var" ? typedInput : (s: string) => str(s, "value");
    return {
      ...condition,
      ...(condition.left !== undefined ? { left: input(condition.left) } : {}),
      ...(condition.value !== undefined ? { value: input(condition.value) } : {}),
    };
  };
  const conv = (steps: ScriptStep[]): RuntimeStep[] =>
    steps.filter((st) => !skip?.has(st.id)).map((st) => {
      switch (st.kind) {
        case "fetch": {
          const { id: _id, preview: _preview, ...rest } = st;
          return {
            ...rest,
            url: str(st.url, "url", true),
            headers: st.headers?.map((header) => ({ ...header, value: str(header.value, "value", true) })),
          };
        }
        case "open-page":
          return {
            kind: st.kind,
            ...(withPageId ? { pageId: st.pageId } : {}),
            href: pageHref(st.pageId),
            ...(st.newTab ? { newTab: true } : {}),
          };
        case "open-url":
          return {
            kind: st.kind,
            url: str(st.url, "url"),
            ...(st.newTab ? { newTab: true } : {}),
          };
        case "dialog":
          return {
            kind: st.kind, mode: st.mode, message: str(st.message, "value"),
            ...(st.mode === "prompt" ? { defaultValue: str(st.defaultValue ?? "", "value") } : {}),
            ...(st.mode !== "alert" && st.into ? { into: st.into } : {}),
          };
        case "set-value":
          return { kind: st.kind, target: st.target, value: str(st.value, "value") };
        case "list-display":
          return {
            kind: st.kind, mode: st.mode, array: st.array,
            ...(st.no !== undefined ? { no: st.no } : {}),
            ...(st.mode === "filter" ? {
              ...(st.join === "or" ? { join: "or" } : {}),
              conds: filterConds(st).map((v) => ({ ...v, value: typedInput(v.value) })),
            } : {}),
            ...(st.mode === "sort" ? { field: st.field, dir: st.dir } : {}),
          };
        case "set-list-item":
          return { kind: st.kind, list: st.list, key: typedInput(st.key), value: typedInput(st.value) };
        case "remove-list-item":
          return { kind: st.kind, list: st.list, mode: st.mode, value: typedInput(st.value) };
        case "store-save": {
          const { id: _id, ...rest } = st;
          return { ...rest, value: str(st.value, "value") };
        }
        case "set-var": {
          const { id: _id, value: _value, ...rest } = st;
          const one = /^\{([^{}\s"'<>`]+)\}$/.exec(st.value.trim());
          const v = one && raw ? raw(one[1].trim()) : undefined;
          return v !== undefined ? { ...rest, raw: v } : { ...rest, value: str(st.value, "value") };
        }
        case "transform": {
          const { id: _id, ...rest } = st;
          // SSR での代わりの値だけを渡す。実行時は、前にあるブラウザ側の代入が優先されるため、
          // 複数のブロックで1つの変数を書き換えられる。
          const v = st.source ? raw?.(st.source, undefined, st.transform.kind === "length" ? "length" : undefined) : undefined;
          return v !== undefined ? { ...rest, raw: v } : rest;
        }
        case "copy": {
          const { id: _id, ...rest } = st;
          return { ...rest, value: str(st.value, "value") };
        }
        case "repeat":
          return { kind: st.kind, times: st.times, then: conv(st.then) };
        case "for-each":
          return { kind: st.kind, array: st.array, then: conv(st.then) };
        case "if":
          return {
            kind: st.kind,
            cond: compileCondition(st.cond),
            ...(st.conditions?.length ? { conditions: st.conditions.map(compileCondition) } : {}),
            then: conv(st.then),
            ...(st.else ? { else: conv(st.else) } : {}),
          };
        default: {
          const { id: _id, ...rest } = st;
          return rest;
        }
      }
    });
  return (node.scripts ?? [])
    .filter((s) => s.steps.length &&
      (s.trigger !== "change" || s.changeVariable === undefined || !!s.changeVariable.trim()))
    .map((s) => ({
      trigger: s.trigger,
      steps: conv(s.steps),
      ...(s.trigger === "change" && s.changeVariable ? { changeVariable: s.changeVariable } : {}),
      ...(s.trigger === "hover-end" && s.keepOnShown ? { keep: true as const } : {}),
    }))
    .filter((s) => s.steps.length);
}

/** 画面上で絞り込み・並べ替え・件数の取得に使う配列の名前 → 項目の名前（書き出しで項目ごとに持たせる値） */
export function listFilterFields(doc: SiteDoc): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of allScripts(doc)) {
    walkSteps(s.steps, (st) => {
      if (st.kind !== "list-display" || st.mode === "clear" || !st.array || !st.field) return;
      const set = out.get(st.array) ?? new Set<string>();
      set.add(st.field);
      if (st.mode === "filter") filterConds(st).forEach((cond) => set.add(cond.field));
      out.set(st.array, set);
    });
  }
  return out;
}

/** 書き込みは、その子孫を置き換え、祖先の値を変える。 */
export function matchVariableWrites(writes: Set<string>, assignments = writes) {
  const parents = new Set<string>();
  const countParents = new Set<string>();
  const indexedParents = new Set<string>();
  const lastItemParents = new Set<string>();
  for (const path of writes) {
    const last = path.lastIndexOf(".");
    if (last >= 0 && /^(0|[1-9]\d*)$/.test(path.slice(last + 1))) {
      parents.add(path.slice(0, last) + ".length");
    }
    for (let end = path.indexOf("."); end >= 0; end = path.indexOf(".", end + 1)) {
      const parent = path.slice(0, end);
      const part = path.slice(end + 1).split(".", 1)[0];
      if (/^(0|[1-9]\d*|-1)$/.test(part)) indexedParents.add(parent);
      if (part === "-1") lastItemParents.add(parent);
      parents.add(parent);
      // 代入は項目を作ることがある。リストの編集は既存のリストを必要とするため、
      // 入れ子のリストを変えても、祖先にキーは増えない。
      if (assignments.has(path)) countParents.add(parent);
    }
  }
  return (name: string, usage?: "length") => {
    if (writes.has(name) || (usage === "length" ? countParents : parents).has(name)) return true;
    for (let end = name.indexOf("."); end >= 0; end = name.indexOf(".", end + 1)) {
      const parent = name.slice(0, end);
      if (writes.has(parent)) return true;
      const part = name.slice(end + 1).split(".", 1)[0];
      if (part === "-1" && indexedParents.has(parent) ||
          lastItemParents.has(parent) && /^(0|[1-9]\d*)$/.test(part)) return true;
    }
    return false;
  };
}

/**
 * 文字列の中の {変数} のうち、画面上で値が決まるものを
 * そのまま残すための値（{ "名前": "{名前}" }）。ページを配信するときの置き換えに混ぜて使う
 */
export function keepTokens(str: string, isLive: (name: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of extractVars(str)) {
    if (isLive(name)) out[name] = `{${name}}`;
  }
  return out;
}

