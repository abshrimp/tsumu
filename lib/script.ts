import {
  PAGE_TARGET,
  SELF_TARGET,
  type DocNode,
  type LinkSetting,
  type Script,
  type ScriptCond,
  type ScriptPos,
  type ScriptStep,
  type ScriptTrigger,
  type SiteDoc,
} from "./types";
import { filterConds, isDataStep } from "./data";
import { tr } from "./i18n";
import { extractVars, hasVars } from "./vars";
import { singleValueReference } from "./variable-choice";

/** src が空のときに出す透明の1×1画像（壊れた画像の枠を出さない） */
export const EMPTY_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

let seq = 0;
export function scriptUid(prefix = "sc"): string {
  seq += 1;
  // 共同編集で別の人の作ったIDと重ならないよう、ランダムな部分も付ける（lib/presets.ts の genId と同じ）
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

/** node.link をエディタ上で表すスクリプトのID（`link_<ノードID>`） */
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

/* ---------- link <-> スクリプト ---------- */

/** 「クリックしたとき → 開く」1つだけのスクリプトなら link として表せる */
function linkOfScript(s: Script): LinkSetting | null {
  if (s.trigger !== "click" || s.steps.length !== 1) return null;
  const st = s.steps[0];
  if (st.kind === "open-page") {
    return {
      kind: "page",
      pageId: st.pageId,
      ...(st.newTab ? { newTab: true } : {}),
      pos: s.pos,
    };
  }
  if (st.kind === "open-url") {
    return { kind: "url", url: st.url, newTab: !!st.newTab, pos: s.pos };
  }
  return null;
}

/** エディタに並べるスクリプト一覧（link は「クリックしたとき → 開く」として先頭に） */
export function scriptsOf(node: DocNode): Script[] {
  const out: Script[] = [];
  if (node.link) {
    const l = node.link;
    const id = `${LINK_PREFIX}${node.id}`;
    out.push({
      id,
      trigger: "click",
      pos: l.pos ?? { x: 32, y: 32 },
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
 * エディタのスクリプト一覧を保存形式へ分ける。
 * allowLink なら最初の「クリックしたとき → 開く」だけのものを link（a タグ）にする
 */
export function splitScripts(
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
    // link 由来の予約IDは、通常のスクリプトになった時点で振り直す
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

/* ---------- ページ単位のスクリプト画面 ---------- */

/**
 * ページのスクリプト画面での1件。
 * nodeId = きっかけの要素（PAGE_TARGET = このページ / null = 要素未選択）
 */
export interface PageScript extends Script {
  nodeId: string | null;
}

/**
 * ページ内の要素ID（インスタンスはコンポーネントのマスターを辿る）。
 * ID属性の重複を調べるときは、使用箇所自身のIDも含める。
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

/** Reuse immutable view wrappers for unchanged scripts across editor updates. */
const scriptViewCache = new WeakMap<Script, Map<string, PageScript>>();
function scriptView(script: Script, nodeId: string | null): PageScript {
  let byNode = scriptViewCache.get(script);
  if (!byNode) {
    byNode = new Map();
    scriptViewCache.set(script, byNode);
  }
  const key = nodeId ?? "";
  const saved = byNode.get(key);
  if (saved && saved.id === script.id && saved.steps === script.steps &&
      saved.pos === script.pos && saved.trigger === script.trigger &&
      saved.changeVariable === script.changeVariable &&
      saved.keepOnShown === script.keepOnShown) return saved;
  const view: PageScript = { ...script, nodeId };
  byNode.set(key, view);
  return view;
}

/** ページ内の全要素のスクリプト + 要素につながっていないブロック */
export function pageScriptsOf(doc: SiteDoc, nodeIds: string[], pageId: string): PageScript[] {
  const out: PageScript[] = [];
  for (const id of nodeIds) {
    const n = doc.nodes[id];
    if (n) for (const s of scriptsOf(n)) out.push(scriptView(s, id));
  }
  for (const s of doc.pages[pageId]?.pageScripts ?? []) {
    out.push(scriptView(s, PAGE_TARGET));
  }
  for (const s of doc.pages[pageId]?.scripts ?? []) out.push(scriptView(s, null));
  // Only examine nearby positions when avoiding overlaps. A full scan made
  // opening a workspace with many separate script stacks quadratic.
  const cellSize = 48;
  const placed = new Map<string, ScriptPos[]>();
  // All earlier candidate rows for one original position remain occupied.
  // Skip them on the next collision instead of repeatedly rescanning.
  const nextCollisionY = new Map<string, number>();
  const key = (x: number, y: number) =>
    `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
  const overlaps = (pos: ScriptPos) => {
    const x = Math.floor(pos.x / cellSize);
    const y = Math.floor(pos.y / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const p of placed.get(`${x + dx}:${y + dy}`) ?? []) {
          if (Math.abs(p.x - pos.x) < 48 && Math.abs(p.y - pos.y) < 48) return true;
        }
      }
    }
    return false;
  };
  return out.map((s) => {
    const pos = { ...s.pos };
    const originalKey = `${pos.x}:${pos.y}`;
    const nextY = nextCollisionY.get(originalKey);
    if (nextY !== undefined) pos.y = nextY;
    while (overlaps(pos)) pos.y += 150;
    nextCollisionY.set(originalKey, pos.y + 150);
    const cell = key(pos.x, pos.y);
    const list = placed.get(cell) ?? [];
    list.push(pos);
    placed.set(cell, list);
    return pos.y === s.pos.y ? s : { ...s, pos };
  });
}

/** Partition the workspace once; both mutable import writes and editor commits use it. */
function groupPageScripts(doc: SiteDoc, nodeIds: string[], views: PageScript[]) {
  const byNode = new Map<string, Script[]>();
  const validNodeIds = new Set(nodeIds);
  const loose: Script[] = [];
  const own: Script[] = [];
  for (const { nodeId, ...s } of views) {
    if (nodeId === PAGE_TARGET && s.trigger) {
      own.push(s);
    } else if (nodeId && s.trigger && validNodeIds.has(nodeId) && doc.nodes[nodeId]) {
      const group = byNode.get(nodeId);
      if (group) group.push(s);
      else byNode.set(nodeId, [s]);
    } else {
      loose.push(s);
    }
  }
  return { byNode, loose, own };
}

/** スクリプト画面の内容を、各要素（link / scripts）とページ（未接続分）へ書き戻す */
export function applyPageScripts(
  doc: SiteDoc,
  pageId: string,
  nodeIds: string[],
  views: PageScript[]
) {
  const { byNode, loose, own } = groupPageScripts(doc, nodeIds, views);
  for (const id of nodeIds) {
    const n = doc.nodes[id];
    if (!n) continue;
    // リンク（aタグ）にできるのはボックスだけ
    const r = splitScripts(byNode.get(id) ?? [], n.type === "box");
    n.link = r.link;
    if (r.scripts) n.scripts = r.scripts;
    else delete n.scripts;
  }
  const page = doc.pages[pageId];
  if (page) {
    if (loose.length) page.scripts = loose;
    else delete page.scripts;
    if (own.length) page.pageScripts = own;
    else delete page.pageScripts;
  }
}

/**
 * Apply workspace edits without cloning the entire site (including its assets
 * and unrelated pages). Undo snapshots can safely share the untouched branches.
 *
 * pageScriptsOf() creates display wrappers, so comparing only object identity
 * would turn an unchanged script into a new document/history entry.
 */
function sameScript(a: Script, b: Script): boolean {
  return a === b || (
    a.id === b.id &&
    a.trigger === b.trigger &&
    a.changeVariable === b.changeVariable &&
    a.keepOnShown === b.keepOnShown &&
    a.steps === b.steps &&
    a.pos.x === b.pos.x &&
    a.pos.y === b.pos.y
  );
}

function sameScriptList(a: Script[] | undefined, b: Script[] | undefined): boolean {
  if (a === b) return true;
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false;
  return (a ?? []).every((script, i) => sameScript(script, b![i]));
}

/** Reuse stable script objects even when another script on the same node changes. */
function reuseUnchangedScripts(before: Script[] | undefined, after: Script[] | undefined): Script[] | undefined {
  if (!after || !before) return after;
  return after.map((script, i) => before[i] && sameScript(before[i], script) ? before[i] : script);
}

function sameLink(a: LinkSetting | null, b: LinkSetting | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.url === b.url && a.pageId === b.pageId &&
    !!a.newTab === !!b.newTab && a.pos?.x === b.pos?.x && a.pos?.y === b.pos?.y;
}

/** Pure, copy-on-write counterpart to applyPageScripts for frequent editor commits. */
export function withPageScripts(
  doc: SiteDoc,
  pageId: string,
  nodeIds: string[],
  views: PageScript[]
): SiteDoc {
  const page = doc.pages[pageId];
  if (!page) return doc;

  const { byNode, loose, own } = groupPageScripts(doc, nodeIds, views);
  let nodes: SiteDoc["nodes"] | null = null;
  for (const id of nodeIds) {
    const previous = doc.nodes[id];
    if (!previous) continue;
    // Only allocate a node when its own script or link data actually changes.
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

  const changedPage = !sameScriptList(page.scripts, loose) ||
    !sameScriptList(page.pageScripts, own);
  if (!nodes && !changedPage) return doc;

  let pages = doc.pages;
  if (changedPage) {
    const updated = { ...page };
    if (loose.length) updated.scripts = reuseUnchangedScripts(page.scripts, loose);
    else delete updated.scripts;
    if (own.length) updated.pageScripts = reuseUnchangedScripts(page.pageScripts, own);
    else delete updated.pageScripts;
    pages = { ...doc.pages, [pageId]: updated };
  }
  return { ...doc, nodes: nodes ?? doc.nodes, pages };
}

/* ---------- 走査 ---------- */

/** 実行されるスクリプトすべて（要素のもの + 「このページ」のもの） */
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

/** スクリプトが参照するID属性（SELF_TARGET は要素自身のIDに解決） */
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

/** 画面上で動くスクリプトを持つか（きっかけ + データの取得以外の動作がある） */
export function hasRunnableScripts(node: Pick<DocNode, "scripts">): boolean {
  return !!node.scripts?.some(
    (s) => s.trigger &&
      (s.trigger !== "change" || s.changeVariable === undefined || !!s.changeVariable.trim()) &&
      s.steps.some((st) => !isDataStep(st))
  );
}

/* ---------- 実行形式への変換 ---------- */

type RuntimeStep = Record<string, unknown>;
export interface RuntimeScript {
  trigger: ScriptTrigger;
  steps: RuntimeStep[];
  changeVariable?: string;
  keep?: true;
}

/**
 * 実行用に変換する（ID・位置を落とし、ページはURLパスへ）。
 * データの取得はページを配信する前に済ませるため、ここでは除く。
 * str: URL・値の文字列を差し替える（{変数} の解決など）
 * withPageId: ページIDも残す（プレビューはIDでページを切り替える。書き出しはURLだけ使う）
 */
export function compileScripts(
  node: Pick<DocNode, "scripts">,
  pageHref: (pageId: string) => string,
  /** item は対象配列の項目を実行時に読む式。項目なしで値を確定しない。 */
  str: (s: string, kind: "url" | "value", item?: boolean) => string = (s) => s,
  withPageId = true,
  /** 配信する前に済ませるため除くブロックのID（ページを開いたときの分解・配列の〜） */
  skip?: Set<string>,
  /**
   * 「［{名前}］を変数［］とする」で、配信前に値が決まる変数の値をそのまま渡す
   * （配列を文字にしない）。画面上で値が決まる変数なら undefined
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
    steps.filter((st) => !isDataStep(st) && !skip?.has(st.id)).map((st) => {
      switch (st.kind) {
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
          // Provide an SSR fallback only. A preceding browser-side assignment
          // takes priority at runtime, allowing several blocks to rewrite one variable.
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
    .filter((s) => s.trigger && s.steps.length &&
      (s.trigger !== "change" || s.changeVariable === undefined || !!s.changeVariable.trim()))
    .map((s) => ({
      trigger: s.trigger!,
      steps: conv(s.steps),
      ...(s.trigger === "change" && s.changeVariable ? { changeVariable: s.changeVariable } : {}),
      ...(s.trigger === "hover-end" && s.keepOnShown ? { keep: true as const } : {}),
    }))
    .filter((s) => s.steps.length);
}

/** 画面上で絞り込み・並べ替え・件数取得に使う配列の名前 → 項目名（書き出しで項目ごとに持たせる値） */
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

/** A write replaces its descendants and changes the value of its ancestors. */
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
      // An assignment may create a field. List edits require an existing list,
      // so modifying a nested list cannot add keys to its ancestors.
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
 * 文字列中の {変数} のうち、画面上で値が決まるものを
 * そのまま残すための値（{ "名前": "{名前}" }）。ページを配信するときの置き換えに混ぜて使う
 */
export function keepTokens(str: string, isLive: (name: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of extractVars(str)) {
    if (isLive(name)) out[name] = `{${name}}`;
  }
  return out;
}

