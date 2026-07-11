import { SELF_TARGET, type DocNode, type ScriptStep, type SiteDoc } from "./types";
import { cloneSteps, pageNodeIds, scriptUid } from "./script";
import { mapNodeTokens } from "./data";

/** 「nav-links」→「nav-links-2」のように、使われていないIDにする */
function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  const stem = base.replace(/-\d+$/, "") || base;
  let n = 2;
  while (used.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

function mapSteps(steps: ScriptStep[], fn: (id: string) => string | null) {
  for (const st of steps) {
    if ("target" in st && st.target && st.target !== SELF_TARGET) {
      st.target = fn(st.target) ?? st.target;
    }
    if (st.kind === "open-url") {
      // ページ内の位置へのリンク（#ID）
      const m = /^#(.+)$/.exec(st.url);
      if (m) st.url = `#${fn(m[1]) ?? m[1]}`;
    }
    if (st.kind === "if") {
      if (st.cond.target && st.cond.target !== SELF_TARGET) {
        st.cond.target = fn(st.cond.target) ?? st.cond.target;
      }
      mapSteps(st.then, fn);
      if (st.else) mapSteps(st.else, fn);
    } else if (st.kind === "repeat" || st.kind === "for-each") {
      mapSteps(st.then, fn);
    }
  }
}

/**
 * 複製・追加する要素（clones）を、置く先のページで使えるようにする。
 * - ID属性が置き先のページの要素やラジオのグループ名と重なるなら、別のIDに付け替える
 * - 複製の中のスクリプト・{ID}・#ID の参照も、付け替えたIDへ合わせる（複製したメニューボタンは複製したメニューを開く）
 * - スクリプトとブロックには新しい内部IDを振る（元と同じだとスクリプト画面で元のブロックまで変わる）
 */
export function refreshClonedIds(doc: SiteDoc, pageId: string, clones: DocNode[]) {
  const used = new Set<string>();
  for (const id of pageNodeIds(doc, pageId)) {
    const n = doc.nodes[id];
    if (n?.attrId) used.add(n.attrId);
    if (n?.type === "field" && n.field?.kind === "radio" && n.field.group?.trim()) {
      used.add(n.field.group.trim());
    }
  }
  for (const c of clones) {
    if (c.type === "field" && c.field?.kind === "radio" && c.field.group?.trim()) {
      used.add(c.field.group.trim());
    }
  }
  const renamed = new Map<string, string>();
  for (const c of clones) {
    if (!c.attrId) continue;
    const prev = renamed.get(c.attrId);
    if (prev) {
      c.attrId = prev;
      continue;
    }
    const next = uniqueId(c.attrId, used);
    used.add(next);
    if (next !== c.attrId) renamed.set(c.attrId, next);
    c.attrId = next;
  }

  const fn = (name: string): string | null => {
    const root = name.split(".")[0];
    const to = renamed.get(root);
    return to ? to + name.slice(root.length) : null;
  };
  for (const c of clones) {
    if (c.scripts?.length) {
      c.scripts = c.scripts.map((s) => ({ ...s, id: scriptUid(), steps: cloneSteps(s.steps) }));
    }
    if (!renamed.size) continue;
    // {ID} の変数（文字・画像・リンク・スクリプトの値）
    mapNodeTokens(c, fn);
    for (const s of c.scripts ?? []) mapSteps(s.steps, fn);
    if (c.link?.kind === "url" && c.link.url) {
      const m = /^#(.+)$/.exec(c.link.url);
      if (m) c.link.url = `#${fn(m[1]) ?? m[1]}`;
    }
  }
}
