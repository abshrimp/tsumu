import type { SiteDoc } from "./types";

/**
 * ドキュメントの三方向マージ（同時編集の競合解決）。
 * base = 最後に同期した版、local = 自分の現在、remote = サーバーの最新。
 * ノード・ページなどID単位で「自分が触っていなければ相手、相手が触って
 * いなければ自分、両方触っていたら自分優先」で合成する。
 */

/** 値単位の三方向選択 */
function pick<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined
): T | undefined {
  const jb = JSON.stringify(base ?? null);
  const jl = JSON.stringify(local ?? null);
  if (jl === jb) return remote; // 自分は未変更 → 相手の変更（削除含む）を採用
  const jr = JSON.stringify(remote ?? null);
  if (jr === jb) return local; // 相手は未変更 → 自分の変更を採用
  return local; // 両方変更（競合）→ 保存しようとしている自分を優先
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * まとまり（オブジェクト）は項目ごとに三方向で選ぶ。同じ要素の別の項目（文字と色など）を
 * 2人が同時に変えても、両方の変更を残す。同じ項目を両方が変えたときだけ自分を優先する。
 * 配列（スクリプトの並びなど）は1つの値として扱う
 */
function pickDeep<T>(base: T | undefined, local: T | undefined, remote: T | undefined): T | undefined {
  const jb = JSON.stringify(base ?? null);
  const jl = JSON.stringify(local ?? null);
  if (jl === jb) return remote;
  const jr = JSON.stringify(remote ?? null);
  if (jr === jb || jr === jl) return local;
  if (!isPlain(base) || !isPlain(local) || !isPlain(remote)) return local;
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    const v = pickDeep(base[key], local[key], remote[key]);
    if (v !== undefined) out[key] = v;
  }
  return out as T;
}

/** ID keyed なコレクションをID単位でマージ */
function mergeRecord<T>(
  base: Record<string, T> | undefined,
  local: Record<string, T> | undefined,
  remote: Record<string, T> | undefined
): Record<string, T> {
  const b = base ?? {};
  const l = local ?? {};
  const r = remote ?? {};
  const out: Record<string, T> = {};
  const ids = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]);
  for (const id of ids) {
    const v = pickDeep(b[id], l[id], r[id]);
    if (v !== undefined) out[id] = v;
  }
  return out;
}

/** ID単位でマージするコレクション（設定の値としては扱わない） */
const COLLECTION_KEYS = new Set(["pages", "pageOrder", "nodes", "assets", "components"]);

/** 親子関係は要素の見た目とは独立してマージする。同時追加や移動で要素を失わないため。 */
function mergeTree(base: SiteDoc, local: SiteDoc, remote: SiteDoc, merged: SiteDoc) {
  const containers = (doc: SiteDoc) => new Map<string, string[]>([
    ...Object.entries(doc.pages).map(([id, p]) => [`page:${id}`, p.children] as const),
    ...Object.entries(doc.nodes).map(([id, n]) => [`node:${id}`, n.children] as const),
  ]);
  const b = containers(base);
  const l = containers(local);
  const r = containers(remote);
  const available = containers(merged);
  const parentsOf = (lists: Map<string, string[]>) => {
    const parents = new Map<string, string>();
    for (const [parent, children] of lists) {
      for (const child of children) parents.set(child, parent);
    }
    return parents;
  };
  const bp = parentsOf(b);
  const lp = parentsOf(l);
  const rp = parentsOf(r);
  const parents = new Map<string, string>();
  const roots = new Set(Object.values(merged.components ?? {}).map((c) => c.rootId));
  for (const id of Object.keys(merged.nodes)) {
    if (roots.has(id)) continue;
    const parent = pick(bp.get(id), lp.get(id), rp.get(id));
    if (parent && available.has(parent)) parents.set(id, parent);
  }

  // AをBへ、BをAへと別々に動かした場合、合成後にだけ循環が生じる。
  // 循環に含まれるリモート移動をローカルの位置へ戻して解消する。
  const findCycle = (): string[] | null => {
    const done = new Set<string>();
    for (const start of parents.keys()) {
      const path = new Map<string, number>();
      let id: string | undefined = start;
      while (id && !done.has(id)) {
        if (path.has(id)) return [...path.keys()].slice(path.get(id));
        path.set(id, path.size);
        const parent = parents.get(id);
        id = parent?.startsWith("node:") ? parent.slice(5) : undefined;
      }
      for (const visited of path.keys()) done.add(visited);
    }
    return null;
  };
  let cycle: string[] | null;
  while ((cycle = findCycle())) {
    const id = cycle.find((id) => parents.get(id) !== lp.get(id));
    // 元データ自体が循環していても、描画時に無限再帰させない。
    if (!id) {
      parents.delete(cycle[0]);
      continue;
    }
    const parent = lp.get(id);
    if (parent && available.has(parent)) parents.set(id, parent);
    else parents.delete(id);
  }

  const mergeChildren = (key: string): string[] => {
    const preferred = pick(b.get(key), l.get(key), r.get(key)) ?? [];
    const result = [...new Set(preferred)].filter((id) => parents.get(id) === key);
    // 採用した並びに無い追加要素は、元の次の兄弟の手前に差し込む。
    for (const list of [l.get(key) ?? [], r.get(key) ?? []]) {
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        if (parents.get(id) !== key || result.includes(id)) continue;
        const next = list.slice(i + 1).find((sibling) => result.includes(sibling));
        result.splice(next === undefined ? result.length : result.indexOf(next), 0, id);
      }
    }
    return result;
  };
  // 入力の履歴スナップショットは書き換えない。
  for (const [id, page] of Object.entries(merged.pages)) {
    merged.pages[id] = { ...page, children: mergeChildren(`page:${id}`) };
  }
  for (const [id, node] of Object.entries(merged.nodes)) {
    merged.nodes[id] = { ...node, children: mergeChildren(`node:${id}`) };
  }
}

export function mergeDocs(
  base: SiteDoc,
  local: SiteDoc,
  remote: SiteDoc
): SiteDoc {
  const merged = mergeOnce(base, local, remote);
  if (merged.pageOrder.length) return merged;
  // 残りのページを別々の人が1つずつ消すと、どちらも1ページは残しているのに合成後は0ページになる。
  // ページの無いデータは開けないため、相手が消したページのうち自分の側に残っているものを、
  // 相手は触っていない扱い（元の版のまま）にして合成し直す。中の要素も自分の側の内容で残る
  const kept = local.pageOrder.filter((id) => local.pages[id] && base.pages[id] && !remote.pages[id]);
  if (!kept.length) return merged;
  const pages = { ...remote.pages };
  const nodes = { ...remote.nodes };
  const stack = kept.flatMap((id) => {
    pages[id] = base.pages[id];
    return base.pages[id].children;
  });
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    const node = base.nodes[id];
    if (!node || nodes[id]) continue;
    nodes[id] = node;
    stack.push(...node.children);
  }
  return mergeOnce(base, local, { ...remote, pages, nodes, pageOrder: [...remote.pageOrder, ...kept] });
}

function mergeOnce(
  base: SiteDoc,
  local: SiteDoc,
  remote: SiteDoc
): SiteDoc {
  const nodes = mergeRecord(base.nodes, local.nodes, remote.nodes);
  const pages = mergeRecord(base.pages, local.pages, remote.pages);

  // ページ順: 変更した側を採用し、存在と過不足を整える
  let pageOrder = [
    ...(pick(base.pageOrder, local.pageOrder, remote.pageOrder) ??
      remote.pageOrder),
  ];
  pageOrder = pageOrder.filter((id) => pages[id]);
  // 片方で足したページを並びに加える。並びに入っていないページ（ローディング画面の
  // 編集用ページ）は、どちらの並びにも無いので加えない
  const listed = new Set([...local.pageOrder, ...remote.pageOrder]);
  for (const id of Object.keys(pages)) {
    if (!pageOrder.includes(id) && listed.has(id)) pageOrder.push(id);
  }

  // サイト設定（siteName・pwa・dataRevalidate など）は値ごとに三方向で選ぶ。
  // 項目を列挙すると、あとから足した設定がマージのたびに消えるため、すべてのキーを対象にする
  const settings: Record<string, unknown> = {};
  const b = base as unknown as Record<string, unknown>;
  const l = local as unknown as Record<string, unknown>;
  const r = remote as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    if (COLLECTION_KEYS.has(key)) continue;
    const v = pickDeep(b[key], l[key], r[key]);
    if (v !== undefined) settings[key] = v;
  }

  const merged: SiteDoc = {
    ...(settings as Partial<SiteDoc>),
    siteName: (settings.siteName as string | undefined) ?? remote.siteName,
    pages,
    pageOrder,
    nodes,
    assets: mergeRecord(base.assets, local.assets, remote.assets),
    components: mergeRecord(base.components, local.components, remote.components),
  };
  mergeTree(base, local, remote, merged);
  return merged;
}
