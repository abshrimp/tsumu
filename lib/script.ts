import {
  PAGE_TARGET,
  SELF_TARGET,
  type DocNode,
  type LinkSetting,
  type Script,
  type ScriptPos,
  type ScriptStep,
  type ScriptTrigger,
  type SiteDoc,
} from "./types";
import { filterConds, isDataStep, listFromOf, pagePlan } from "./data";
import { tr } from "./i18n";
import { extractVars, splitRegexVars } from "./vars";
import { fieldVarNames } from "./fields";

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
  click: tr("クリックしたとき"),
  "hover-start": tr("ホバーし始めたとき"),
  "hover-end": tr("ホバーが外れたとき"),
  change: tr("値が変わったとき"),
  load: tr("ページを開いたとき"),
  "in-view": tr("画面に入ったとき"),
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
export function cloneSteps(steps: ScriptStep[]): ScriptStep[] {
  return steps.map((st) =>
    st.kind === "if"
      ? {
          ...st,
          id: scriptUid("st"),
          cond: { ...st.cond },
          then: cloneSteps(st.then),
          ...(st.else ? { else: cloneSteps(st.else) } : {}),
        }
      : st.kind === "repeat" || st.kind === "for-each"
        ? { ...st, id: scriptUid("st"), then: cloneSteps(st.then) }
        : { ...st, id: scriptUid("st") }
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

/** ページ内の要素ID（インスタンスはコンポーネントのマスターを辿る） */
export function pageNodeIds(
  doc: SiteDoc,
  pageId: string,
  extraRootIds: string[] = []
): string[] {
  const out: string[] = [];
  const walked = new Set<string>();
  const walk = (id: string) => {
    if (walked.has(id)) return;
    walked.add(id);
    const n = doc.nodes[id];
    if (!n) return;
    if (n.type === "instance") {
      const comp = doc.components?.[n.componentId ?? ""];
      if (comp) walk(comp.rootId);
      return;
    }
    out.push(id);
    n.children.forEach(walk);
  };
  doc.pages[pageId]?.children.forEach(walk);
  extraRootIds.forEach(walk);
  return out;
}

/** ページ内の全要素のスクリプト + 要素につながっていないブロック */
export function pageScriptsOf(doc: SiteDoc, nodeIds: string[], pageId: string): PageScript[] {
  const out: PageScript[] = [];
  for (const id of nodeIds) {
    const n = doc.nodes[id];
    if (n) for (const s of scriptsOf(n)) out.push({ ...s, nodeId: id });
  }
  for (const s of doc.pages[pageId]?.pageScripts ?? []) {
    out.push({ ...s, nodeId: PAGE_TARGET });
  }
  for (const s of doc.pages[pageId]?.scripts ?? []) out.push({ ...s, nodeId: null });
  // 要素ごとに置いていた位置が重なる場合は下へずらして見せる
  const placed: ScriptPos[] = [];
  return out.map((s) => {
    const pos = { ...s.pos };
    while (placed.some((p) => Math.abs(p.x - pos.x) < 48 && Math.abs(p.y - pos.y) < 48)) {
      pos.y += 150;
    }
    placed.push(pos);
    return pos.y === s.pos.y ? s : { ...s, pos };
  });
}

/** スクリプト画面の内容を、各要素（link / scripts）とページ（未接続分）へ書き戻す */
export function applyPageScripts(
  doc: SiteDoc,
  pageId: string,
  nodeIds: string[],
  views: PageScript[]
) {
  const byNode = new Map<string, Script[]>();
  const loose: Script[] = [];
  const own: Script[] = [];
  for (const { nodeId, ...s } of views) {
    if (nodeId === PAGE_TARGET && s.trigger) {
      own.push(s);
    } else if (nodeId && s.trigger && nodeIds.includes(nodeId) && doc.nodes[nodeId]) {
      byNode.set(nodeId, [...(byNode.get(nodeId) ?? []), s]);
    } else {
      loose.push(s);
    }
  }
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
      if (!kinds && st.kind === "if") add(st.cond.target);
    });
  }
  return [...out];
}

/** 画面上で動くスクリプトを持つか（きっかけ + データの取得以外の動作がある） */
export function hasRunnableScripts(node: Pick<DocNode, "scripts">): boolean {
  return !!node.scripts?.some(
    (s) => s.trigger && s.steps.some((st) => !isDataStep(st))
  );
}

/* ---------- 実行形式への変換 ---------- */

type RuntimeStep = Record<string, unknown>;
export interface RuntimeScript {
  trigger: ScriptTrigger;
  steps: RuntimeStep[];
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
  str: (s: string, kind: "url" | "value") => string = (s) => s,
  withPageId = true,
  /** 配信する前に済ませるため除くブロックのID（ページを開いたときの分解・配列の〜） */
  skip?: Set<string>,
  /**
   * 「［{名前}］を変数［］とする」で、配信前に値が決まる変数の値をそのまま渡す
   * （配列を文字にしない）。画面上で値が決まる変数なら undefined
   */
  raw?: (name: string) => unknown
): RuntimeScript[] {
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
        case "filter-array":
          return {
            kind: st.kind,
            array: st.array,
            ...(st.no !== undefined ? { no: st.no } : {}),
            ...(st.join === "or" ? { join: "or" } : {}),
            conds: filterConds(st).map((c) => ({ ...c, value: str(c.value, "value") })),
          };
        case "store-save": {
          const { id: _id, ...rest } = st;
          return { ...rest, value: str(st.value, "value") };
        }
        case "split": {
          const { id: _id, ...rest } = st;
          return { ...rest, source: str(st.source, "value") };
        }
        case "set-var": {
          const { id: _id, value: _value, ...rest } = st;
          const one = /^\{([^{}]+)\}$/.exec(st.value.trim());
          const v = one && raw ? raw(one[1].trim()) : undefined;
          return v !== undefined ? { ...rest, raw: v } : { ...rest, value: str(st.value, "value") };
        }
        case "calc": {
          const { id: _id, ...rest } = st;
          return { ...rest, expr: str(st.expr, "value") };
        }
        case "replace": {
          const { id: _id, find: _find, ...rest } = st;
          return {
            ...rest,
            source: str(st.source, "value"),
            // 正規表現は、変数の部分だけ値に置き換えて（ランタイムで記号を無効にして）つなぐ
            ...(st.regex
              ? {
                  find: splitRegexVars(st.find).map((p) =>
                    p.var !== undefined ? { v: str(p.text, "value") } : p.text
                  ),
                }
              : { find: str(st.find, "value") }),
            to: str(st.to, "value"),
          };
        }
        case "array-find":
        case "list-edit":
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
            cond: {
              ...st.cond,
              ...(st.cond.value !== undefined ? { value: str(st.cond.value, "value") } : {}),
              ...(st.cond.left !== undefined ? { left: str(st.cond.left, "value") } : {}),
            },
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
    .filter((s) => s.trigger && s.steps.length)
    .map((s) => ({
      trigger: s.trigger!,
      steps: conv(s.steps),
      ...(s.trigger === "hover-end" && s.keepOnShown ? { keep: true as const } : {}),
    }))
    .filter((s) => s.steps.length);
}

/** 画面上で絞り込み・並べ替え・件数取得に使う配列の名前 → 項目名（書き出しで項目ごとに持たせる値） */
export function listFilterFields(doc: SiteDoc): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of allScripts(doc)) {
    walkSteps(s.steps, (st) => {
      if (st.kind === "count" && st.array) {
        if (!out.has(st.array)) out.set(st.array, new Set<string>());
        return;
      }
      if ((st.kind !== "filter-array" && st.kind !== "sort-array") || !st.array || !st.field) {
        return;
      }
      const set = out.get(st.array) ?? new Set<string>();
      set.add(st.field);
      if (st.kind === "filter-array") filterConds(st).forEach((c) => set.add(c.field));
      out.set(st.array, set);
    });
  }
  return out;
}

/**
 * 文字列中の {変数} のうち、画面上で値が決まるもの（names の変数とその中の項目）を
 * そのまま残すための値（{ "名前": "{名前}" }）。ページを配信するときの置き換えに混ぜて使う
 */
export function keepTokens(str: string, names: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!names.size) return out;
  for (const name of extractVars(str)) {
    if (names.has(name.split(".")[0])) out[name] = `{${name}}`;
  }
  return out;
}

/** スクリプトの {変数} のうち、画面上で値を入れるもの（画面上の変数と入力欄のID） */
export function liveVarNames(doc: SiteDoc, pageId: string, nodeIds: string[]): Set<string> {
  const out = new Set(pagePlan(doc, pageId).clientVars);
  for (const id of nodeIds) {
    const n = doc.nodes[id];
    if (n?.type === "field") fieldVarNames(n).forEach((v) => out.add(v));
  }
  return out;
}

/** 画面上で値が決まる配列を並べるリストか（ブラウザでお手本を複製して並べる） */
export function isClientList(doc: SiteDoc, pageId: string, node: DocNode): boolean {
  const from = listFromOf(node);
  return !!from && pagePlan(doc, pageId).clientVars.has(from.split(".")[0]);
}
