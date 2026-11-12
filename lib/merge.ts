import type { PageFolder, SiteDoc } from "./types";
import type { DocPatch } from "./doc-patch";
import { MAX_NODE_DEPTH } from "./doc-tree";
import { assetUsage } from "./asset-usage";
import { sameJson } from "./doc-share";

/**
 * 文書の3方向マージ（同時編集の競合の解決）。
 * base = 最後に同期した版、local = 自分の現在の内容、remote = サーバーの最新版。
 * ノードやページなどを ID ごとに、「自分が触っていなければ相手、相手が触って
 * いなければ自分、両方が触っていたら自分を優先」の規則で合成する。
 */

/** JSON の値では、項目が無いことと、明示的な null を区別する。 */
const sameValue = sameJson;

/** __proto__ のセッターを動かさずに、利用者のデータの任意のキーを残す。 */
function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
}

/** 値ごとの3方向の選択 */
function pick<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined
): T | undefined {
  if (sameValue(local, base)) return remote; // 自分は変更していない → 相手の変更（削除を含む）を採用する
  if (sameValue(remote, base)) return local; // 相手は変更していない → 自分の変更を採用する
  return local; // 両方が変更した（競合）→ 保存しようとしている自分を優先する
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * オブジェクトは、項目ごとに3方向で選ぶ。同じ要素の別の項目（文字と色など）を
 * 2人が同時に変えても、両方の変更を残す。同じ項目を両方が変えたときだけ、自分を優先する。
 * 配列（スクリプトの並びなど）は1つの値として扱う
 */
function pickDeep<T>(base: T | undefined, local: T | undefined, remote: T | undefined): T | undefined {
  if (sameValue(local, base)) return remote;
  if (sameValue(remote, base) || sameValue(remote, local)) return local;
  if ((base !== undefined && !isPlain(base)) || !isPlain(local) || !isPlain(remote)) return local;
  // 同時に初めて追加した、設定やスタイルの別々の項目も残す。
  // null や単一の値からの置き換えは、通常の競合として自分を優先する。
  const before: Record<string, unknown> = isPlain(base) ? base : {};
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(before)])) {
    const v = pickDeep(before[key], local[key], remote[key]);
    if (v !== undefined) setOwn(out, key, v);
  }
  return out as T;
}

/**
 * 既存のノードの項目だけを変える文書の差分について、履歴の時点を付け替える。
 * 同時編集の変更の多くは、ノードのスタイルやテキストを変えるだけ。
 * こうした変更のたびに、最大100件の元に戻す履歴のそれぞれで、すべてのノードを
 * マージし直し、要素のツリー全体を作り直す必要は無い。
 *
 * 構造を変える編集では null を返す。呼び出し側は、移動・削除・コンポーネントの
 * グラフの条件を保つため、完全な3方向マージを使わなければならない。
 *
 * base と updated は、渡した差分を適用する前と後の、まさにその文書でなければならない。
 */
export function rebaseNodePatch(
  base: SiteDoc,
  updated: SiteDoc,
  checkpoint: SiteDoc,
  patch: DocPatch,
): SiteDoc | null {
  if (!patch.length) return null;
  let nodes: SiteDoc["nodes"] | null = null;
  const seen = new Set<string>();
  for (const op of patch) {
    if (op.path.length !== 2 || op.path[0] !== "nodes" || "remove" in op) return null;
    const id = op.path[1];
    if (seen.has(id)) return null;
    seen.add(id);
    const before = base.nodes[id];
    const after = updated.nodes[id];
    const historical = checkpoint.nodes[id];
    if (!before || !after || !historical ||
        before.id !== after.id || before.type !== after.type ||
        before.componentId !== after.componentId ||
        !sameValue(before.children, after.children)) return null;

    // 他のノードをたどったり、その同一性を書き換えたりせずに、
    // mergeDocs(base, updated, checkpoint) と同じ、項目ごとの競合の優先順位に合わせる。
    const merged = pickDeep(before, after, historical);
    if (!merged ||
        merged.id !== historical.id || merged.type !== historical.type ||
        merged.componentId !== historical.componentId ||
        !sameValue(merged.children, historical.children)) return null;
    if (merged !== historical) {
      nodes ??= { ...checkpoint.nodes };
      setOwn(nodes, id, merged);
    }
  }
  // 古い履歴に無い画像や、CSS・HTML のアセットを、新しい参照が使っている可能性がある。
  // 依存関係を戻せる完全なマージに任せ、元に戻す操作で欠けた文書を作らないようにする。
  if (nodes && checkpoint.assets !== updated.assets &&
      Object.keys(updated.assets).some(id => !Object.hasOwn(checkpoint.assets, id))) return null;
  return nodes ? { ...checkpoint, nodes } : checkpoint;
}

/** ID をキーにしたコレクションを、ID ごとにマージする */
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
    // 同じ ID の別々の新しい要素は混ぜない。深く合成するのは、既存の要素の項目だけ。
    const v = b[id] === undefined ? pick(b[id], l[id], r[id]) : pickDeep(b[id], l[id], r[id]);
    if (v !== undefined) setOwn(out, id, v);
  }
  return out;
}

/**
 * 子の削除や、移動元からの取り外しだけでは、相手が消した空の親を復活させない。
 * 残すべき子の編集があれば、後で必要な祖先として戻す。
 */
function mergeContainers<T extends { children: string[] }>(
  base: Record<string, T>, local: Record<string, T>, remote: Record<string, T>
): Record<string, T> {
  const out = mergeRecord(base, local, remote);
  for (const id of Object.keys(out)) {
    if (!base[id] || !local[id] || remote[id]) continue;
    const { children: before, ...baseProps } = base[id];
    const { children: after, ...localProps } = local[id];
    if (after.length >= before.length || !sameJson(baseProps, localProps)) continue;
    // 順序の変更や追加は取り消さず、元の並びから取り除いただけの場合に限る。
    let index = 0;
    for (const child of before) if (child === after[index]) index++;
    if (index === after.length) delete out[id];
  }
  return out;
}

/** ID ごとにマージするコレクション（設定の値としては扱わない） */
const COLLECTION_KEYS = new Set(["pages", "pageOrder", "pageFolders", "nodes", "assets", "components"]);

/** 選んだ兄弟の順序を保つ。もう一方の並びで追加されたものは、その次に残る兄弟ごとにまとめ、
 * 子の多い親でも、並びごとに1回の走査で済むようにする。 */
function mergeOrder(
  base: string[] | undefined,
  local: string[] | undefined,
  remote: string[] | undefined,
  keep: (id: string) => boolean,
): string[] {
  const preferred = pick(base, local, remote);
  const other = preferred === local ? remote : local;
  if (!preferred?.length && !other?.length) return [];
  const order = new Set(preferred?.filter(keep));
  if (!other?.length || other === preferred) return [...order];

  const before = new Map<string, string[]>();
  let additions: string[] = [];
  for (const id of new Set(other)) {
    if (!keep(id)) continue;
    if (!order.has(id)) additions.push(id);
    else if (additions.length) {
      before.set(id, additions);
      additions = [];
    }
  }
  if (!before.size) return [...order, ...additions];
  const result: string[] = [];
  for (const id of order) {
    for (const addition of before.get(id) ?? []) result.push(addition);
    result.push(id);
  }
  return result.concat(additions);
}

/** フォルダの名前・存在と並び順を分けて扱い、別々のフォルダへの同時の編集を残す。 */
function mergePageFolders(
  base: PageFolder[] | undefined,
  local: PageFolder[] | undefined,
  remote: PageFolder[] | undefined,
): PageFolder[] | undefined {
  const record = (folders: PageFolder[] | undefined) =>
    Object.fromEntries((folders ?? []).map((folder) => [folder.id, folder]));
  const folders = mergeRecord(record(base), record(local), record(remote));
  const ids = (list: PageFolder[] | undefined) => (list ?? []).map((folder) => folder.id);
  const b = ids(base), l = ids(local), r = ids(remote);
  const order = mergeOrder(b, l, r, id => Object.hasOwn(folders, id));
  if (!order.length && pick(base, local, remote) === undefined) return undefined;
  return order.map((id) => folders[id]);
}

/** 親子関係は、要素の見た目とは別にマージする。同時の追加や移動で、要素を失わないため。 */
function mergeTree(base: SiteDoc, local: SiteDoc, remote: SiteDoc, merged: SiteDoc) {
  // 親は "page:<id>" / "node:<id>" の形で表す。要素の数だけの索引を文書ごとに作らず、文書から直接探す
  const owner = (doc: SiteDoc, key: string) => (key.startsWith("page:") ? doc.pages : doc.nodes);
  const listOf = (doc: SiteDoc, key: string): string[] | undefined => {
    const id = key.slice(5);
    const containers = owner(doc, key);
    return Object.hasOwn(containers, id) ? containers[id].children : undefined;
  };
  const available = (key: string) => Object.hasOwn(owner(merged, key), key.slice(5));
  const parentsOf = (doc: SiteDoc) => {
    const parents = new Map<string, string>();
    for (const id of Object.keys(doc.pages)) {
      const key = `page:${id}`;
      for (const child of doc.pages[id].children) parents.set(child, key);
    }
    for (const id of Object.keys(doc.nodes)) {
      const key = `node:${id}`;
      for (const child of doc.nodes[id].children) parents.set(child, key);
    }
    return parents;
  };
  const bp = parentsOf(base);
  const lp = parentsOf(local);
  const rp = parentsOf(remote);
  const parents = new Map<string, string>();
  const roots = new Set(Object.values(merged.components ?? {}).map((c) => c.rootId));
  for (const id of Object.keys(merged.nodes)) {
    if (roots.has(id)) continue;
    // 編集と削除が競合して要素を残した場合は、その配置も自分の側から残す。
    const parent = local.nodes[id] && !remote.nodes[id]
      ? lp.get(id)
      : pick(bp.get(id), lp.get(id), rp.get(id));
    if (parent && available(parent)) parents.set(id, parent);
  }

  // A を B の中へ、B を A の中へと、別々に動かした場合、合成した後にだけ循環が生じる。
  // 循環に含まれる相手の移動を、自分の側の位置に戻して解消する。
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
    // 元のデータ自体が循環していても、描画のときに無限に再帰させない。
    if (!id) {
      parents.delete(cycle[0]);
      continue;
    }
    const parent = lp.get(id);
    if (parent && available(parent)) parents.set(id, parent);
    else parents.delete(id);
  }

  // それぞれは正しい編集でも、組み合わさるとエディタが保存できない深さのツリーになることがある。
  // すべてのノードを残し、同時に追加した部分木を落とすより、元の配置を優先する。
  const pathToRoot = (start: string): string[] => {
    const path: string[] = [];
    const seen = new Set<string>();
    let id: string | undefined = start;
    while (id && !seen.has(id)) {
      seen.add(id);
      path.push(id);
      const parent = parents.get(id);
      id = parent?.startsWith("node:") ? parent.slice(5) : undefined;
    }
    return path;
  };
  const pageRoot = merged.pageOrder.find(id => merged.pages[id]) ?? Object.keys(merged.pages)[0];
  const originalParents = new Map(parents);
  const overflowPlacements = new Map<string, string[]>();
  for (const id of Object.keys(merged.nodes)) {
    let path = pathToRoot(id);
    while (path.length > MAX_NODE_DEPTH) {
      let repaired = false;
      for (const source of [lp, rp, bp]) {
        for (const nodeId of path) {
          const previous = parents.get(nodeId);
          const candidate = source.get(nodeId);
          if (!candidate || candidate === previous || !available(candidate)) continue;
          parents.set(nodeId, candidate);
          if (!findCycle() && pathToRoot(id).length < path.length) {
            repaired = true;
            break;
          }
          if (previous) parents.set(nodeId, previous); else parents.delete(nodeId);
        }
        if (repaired) break;
      }
      if (!repaired) {
        if (pageRoot) parents.set(id, `page:${pageRoot}`); else parents.delete(id);
      }
      path = pathToRoot(id);
    }
  }
  // コンポーネントの参照は、子の所有とは別の2つ目のグラフを作る。2人の編集者が
  // それぞれ正しい入れ子のインスタンスを追加しても、合わせると A→B→A になることがある。
  // その設定やどちらかのコンポーネントの定義を消す代わりに、競合する相手のインスタンスを
  // マスターの外へ動かす。
  const componentRoots = new Map(Object.values(merged.components ?? {}).map(c => [c.rootId, c.id]));
  const componentGraph = () => {
    const graph = new Map<string, { target: string; nodeId: string }[]>();
    for (const [id, node] of Object.entries(merged.nodes)) {
      if (node.type !== "instance" || !node.componentId) continue;
      const owner = pathToRoot(id).map(root => componentRoots.get(root)).find(Boolean);
      if (!owner) continue;
      const edges = graph.get(owner) ?? [];
      edges.push({ target: node.componentId, nodeId: id });
      graph.set(owner, edges);
    }
    return graph;
  };
  const instanceIsCyclic = (id: string): boolean => {
    const target = merged.nodes[id]?.componentId;
    const owner = pathToRoot(id).map(root => componentRoots.get(root)).find(Boolean);
    if (!target || !owner) return false;
    const graph = componentGraph();
    const pending = [target];
    const seen = new Set<string>();
    for (let component = pending.pop(); component !== undefined; component = pending.pop()) {
      if (component === owner) return true;
      if (seen.has(component)) continue;
      seen.add(component);
      for (const edge of graph.get(component) ?? []) pending.push(edge.target);
    }
    return false;
  };
  const componentCycle = (): string[] | null => {
    if (!componentRoots.size) return null;
    const graph = componentGraph();
    const done = new Set<string>();
    const active = new Map<string, number>();
    for (const root of graph.keys()) {
      if (done.has(root)) continue;
      const stack: { id: string; index: number; via?: string }[] = [{ id: root, index: 0 }];
      active.set(root, 0);
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const edge = graph.get(frame.id)?.[frame.index++];
        if (!edge) {
          done.add(frame.id);
          active.delete(frame.id);
          stack.pop();
          continue;
        }
        const cycleStart = active.get(edge.target);
        if (cycleStart !== undefined) {
          return [...stack.slice(cycleStart + 1).map(item => item.via!), edge.nodeId];
        }
        if (done.has(edge.target)) continue;
        active.set(edge.target, stack.length);
        stack.push({ id: edge.target, index: 0, via: edge.nodeId });
      }
    }
    return null;
  };
  let referenceCycle: string[] | null;
  while ((referenceCycle = componentCycle())) {
    const id = referenceCycle.find(id => !local.nodes[id] ||
      local.nodes[id].componentId !== merged.nodes[id].componentId || parents.get(id) !== lp.get(id)) ?? referenceCycle[0];
    // それ自体がインスタンスであるマスターのルートは、その定義から切り離せない。
    // できれば自分の側の参照を残し、不正な入力の場合は、ルートのノードを消さずに
    // 再帰しないようにする。
    if (componentRoots.has(id)) {
      merged.nodes[id] = { ...merged.nodes[id], componentId: local.nodes[id]?.componentId };
      if (instanceIsCyclic(id)) merged.nodes[id] = { ...merged.nodes[id], componentId: undefined };
    } else {
      let restored = false;
      const previous = parents.get(id);
      for (const source of [lp, rp, bp]) {
        const candidate = source.get(id);
        if (!candidate || candidate === previous || !available(candidate)) continue;
        parents.set(id, candidate);
        if (!findCycle() && Object.keys(merged.nodes).every(nodeId => pathToRoot(nodeId).length <= MAX_NODE_DEPTH) && !instanceIsCyclic(id)) {
          restored = true;
          break;
        }
        if (previous) parents.set(id, previous); else parents.delete(id);
      }
      if (!restored) {
        if (pageRoot) parents.set(id, `page:${pageRoot}`); else parents.delete(id);
      }
    }
  }
  // 代わりの配置は、どちらの入力の兄弟の並びにも無いことがある。
  for (const [id, parent] of parents) {
    if (originalParents.get(id) === parent) continue;
    const list = overflowPlacements.get(parent) ?? [];
    list.push(id);
    overflowPlacements.set(parent, list);
  }

  const mergeChildren = (key: string): string[] => {
    const order = mergeOrder(listOf(base, key), listOf(local, key), listOf(remote, key), id => parents.get(id) === key);
    const repaired = overflowPlacements.get(key);
    return repaired ? [...new Set([...order, ...repaired])] : order;
  };
  // 入力の履歴のスナップショットは書き換えない。
  for (const [id, page] of Object.entries(merged.pages)) {
    merged.pages[id] = { ...page, children: mergeChildren(`page:${id}`) };
  }
  for (const [id, node] of Object.entries(merged.nodes)) {
    const children = mergeChildren(`node:${id}`);
    // 子の並びが変わらない要素は、入力の参照のまま残す（次のマージや差分保存が、参照の比較だけで済む）
    if (!sameList(children, node.children)) merged.nodes[id] = { ...node, children };
  }
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 自分の編集を優先して残した要素が、相手が消した親の下に取り残されないようにする。
 * 戻すのは必要な祖先だけ。編集していない兄弟や、自分の側で削除した要素は戻さない。
 */
function restoreEditedTreePaths(base: SiteDoc, local: SiteDoc, remote: SiteDoc, merged: SiteDoc) {
  // 戻す対象は、自分の側にあって相手の側に無い要素・コンポーネントと、その祖先だけ。
  // どちらも無ければ（履歴の付け替えの大半）、親子関係の索引を作らずに終える
  const localOnly = (mine: Record<string, unknown> | undefined, theirs: Record<string, unknown> | undefined) => {
    for (const id of Object.keys(mine ?? {})) if (mine![id] && !theirs?.[id]) return true;
    return false;
  };
  if (!localOnly(local.nodes, remote.nodes) && !localOnly(local.components, remote.components)) return;
  const parents = new Map<string, { kind: "page" | "node"; id: string }>();
  for (const page of Object.values(local.pages)) {
    for (const id of page.children) parents.set(id, { kind: "page", id: page.id });
  }
  for (const node of Object.values(local.nodes)) {
    for (const id of node.children) parents.set(id, { kind: "node", id: node.id });
  }
  // 移動は親の children だけを変えるため、ノード単体で比べると編集していないように見える。
  // 自分の側で別の親へ動かした要素は、削除と競合しても中身ごと残す。
  const baseParents = new Map<string, string>();
  for (const page of Object.values(base.pages)) {
    for (const id of page.children) baseParents.set(id, `page:${page.id}`);
  }
  for (const node of Object.values(base.nodes)) {
    for (const id of node.children) baseParents.set(id, `node:${node.id}`);
  }
  const moved = [...parents].filter(([id, parent]) =>
    base.nodes[id] && !remote.nodes[id] &&
    baseParents.get(id) !== `${parent.kind}:${parent.id}`
  ).map(([id]) => id);
  const visitedMoves = new Set<string>();
  for (let id = moved.pop(); id !== undefined; id = moved.pop()) {
    if (visitedMoves.has(id)) continue;
    visitedMoves.add(id);
    const node = local.nodes[id];
    if (!node) continue;
    if (!merged.nodes[id] && !remote.nodes[id]) merged.nodes[id] = node;
    moved.push(...node.children);
  }
  const localComponents = Object.values(local.components ?? {});
  const queue = Object.keys(merged.nodes).filter((id) => local.nodes[id] && !remote.nodes[id]);
  const seen = new Set<string>();
  const restoredComponents = new Set<string>();
  const restoreComponent = (id: string) => {
    const comp = local.components?.[id];
    if (!comp || remote.components?.[id] || restoredComponents.has(id)) return;
    restoredComponents.add(id);
    (merged.components ??= {})[id] ??= comp;
    // 残したインスタンスやコンポーネントの設定に必要なマスターは、その内容も一緒に残す。
    const stack = [comp.rootId];
    const visited = new Set<string>();
    for (let nodeId = stack.pop(); nodeId !== undefined; nodeId = stack.pop()) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const node = local.nodes[nodeId];
      if (!node) continue;
      if (!merged.nodes[nodeId]) merged.nodes[nodeId] = node;
      queue.push(nodeId);
      stack.push(...node.children);
    }
  };
  for (const id of Object.keys(merged.components ?? {})) restoreComponent(id);
  for (const node of Object.values(merged.nodes)) {
    if (node.type === "instance" && node.componentId) restoreComponent(node.componentId);
  }
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const node = merged.nodes[id];
    if (node?.type === "instance" && node.componentId) restoreComponent(node.componentId);
    const parent = parents.get(id);
    if (!parent) {
      const comp = localComponents.find((c) => c.rootId === id);
      // マスターの中の編集だけが残った場合は、コンポーネントの定義を戻す。
      // この経路では、消された、編集していない兄弟までは戻さない。
      if (comp && !merged.components?.[comp.id]) (merged.components ??= {})[comp.id] = comp;
      continue;
    }
    if (parent.kind === "page") {
      if (!merged.pages[parent.id] && local.pages[parent.id] && !remote.pages[parent.id]) {
        merged.pages[parent.id] = local.pages[parent.id];
        if (local.pageOrder.includes(parent.id) && !merged.pageOrder.includes(parent.id)) {
          merged.pageOrder.push(parent.id);
        }
      }
    } else {
      if (!merged.nodes[parent.id] && local.nodes[parent.id] && !remote.nodes[parent.id]) {
        merged.nodes[parent.id] = local.nodes[parent.id];
      }
      if (merged.nodes[parent.id] && !remote.nodes[parent.id]) queue.push(parent.id);
    }
  }
}

export function mergeDocs(
  base: SiteDoc,
  local: SiteDoc,
  remote: SiteDoc
): SiteDoc {
  const merged = mergeOnce(base, local, remote);
  if (merged.pageOrder.length) return merged;
  // 残りのページを別々の人が1つずつ消すと、どちらも1ページは残しているのに、合成した後は0ページになる。
  // ページの無いデータは開けないため、相手が消したページのうち自分の側に残っているものを、
  // 相手は触っていないもの（元の版のまま）として合成し直す。中の要素も、自分の側の内容で残る
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

/**
 * 一方が未使用のアセットを削除し、もう一方がそれを使い始めた場合は、残っている参照を優先する。
 * 画像だけでなく、CSS・HTML・ZIP の中の依存関係も、未使用の判定と同じ規則で守る。
 */
function restoreReferencedAssets(base: SiteDoc, local: SiteDoc, remote: SiteDoc, merged: SiteDoc): void {
  const missing = new Map<string, SiteDoc["assets"][string]>();
  for (const doc of [base, remote, local]) {
    for (const [id, asset] of Object.entries(doc.assets)) {
      if (!Object.hasOwn(merged.assets, id)) missing.set(id, asset);
    }
  }
  // 通常の同時編集ではアセットを削除しないため、本文から使用箇所を探す必要は無い。
  if (!missing.size) return;
  const available = { ...merged.assets };
  for (const [id, asset] of missing) setOwn(available, id, asset);
  const used = assetUsage({ ...merged, assets: available });
  for (const [id, asset] of missing) {
    if (used.has(id)) setOwn(merged.assets, id, asset);
  }
}

function mergeOnce(
  base: SiteDoc,
  local: SiteDoc,
  remote: SiteDoc
): SiteDoc {
  const nodes = mergeContainers(base.nodes, local.nodes, remote.nodes);
  const pages = mergeContainers(base.pages, local.pages, remote.pages);

  // ページの順序: 変更した側を採用し、存在と過不足を整える
  let pageOrder = [
    ...(pick(base.pageOrder, local.pageOrder, remote.pageOrder) ??
      remote.pageOrder),
  ];
  pageOrder = pageOrder.filter((id) => pages[id]);
  // 片方で追加したページを並びに加える。並びに入っていないページ（ローディング画面の
  // 編集用のページ）は、どちらの並びにも無いため加えない
  const listed = new Set([...local.pageOrder, ...remote.pageOrder]);
  for (const id of Object.keys(pages)) {
    if (!pageOrder.includes(id) && listed.has(id)) pageOrder.push(id);
  }

  // サイトの設定（siteName・pwa・dataRevalidate など）は、値ごとに3方向で選ぶ。
  // 項目を列挙すると、後から追加した設定がマージのたびに消えるため、すべてのキーを対象にする
  const settings: Record<string, unknown> = {};
  const b = base as unknown as Record<string, unknown>;
  const l = local as unknown as Record<string, unknown>;
  const r = remote as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    if (COLLECTION_KEYS.has(key)) continue;
    const v = pickDeep(b[key], l[key], r[key]);
    if (v !== undefined) setOwn(settings, key, v);
  }

  const merged: SiteDoc = {
    ...(settings as Partial<SiteDoc>),
    schemaVersion: 1,
    siteName: (settings.siteName as string | undefined) ?? remote.siteName,
    pages,
    pageOrder,
    nodes,
    assets: mergeRecord(base.assets, local.assets, remote.assets),
    components: mergeRecord(base.components, local.components, remote.components),
  };
  const pageFolders = mergePageFolders(base.pageFolders, local.pageFolders, remote.pageFolders);
  if (pageFolders !== undefined) merged.pageFolders = pageFolders;
  restoreEditedTreePaths(base, local, remote, merged);
  mergeTree(base, local, remote, merged);
  restoreReferencedAssets(base, local, remote, merged);
  // 移動とフォルダの削除が重なっても、存在しないフォルダへの所属を残さない。
  const folderIds = new Set((pageFolders ?? []).map((folder) => folder.id));
  for (const page of Object.values(merged.pages)) {
    if (page.folderId && !folderIds.has(page.folderId)) delete page.folderId;
  }
  return merged;
}
