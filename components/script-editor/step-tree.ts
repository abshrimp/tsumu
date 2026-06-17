/**
 * スクリプトの動作の木（入れ子の動作の並び）を、位置を指定して取り出し・差し込み・書き換える
 */

import { type PageScript } from "../../lib/script";
import { type ScriptStep } from "../../lib/types";

/* ---------- スクリプト操作（純粋関数） ---------- */

/** ステップ列の位置。list = "root" | "<ifのID>:then" | "<ifのID>:else" */
export interface Loc {
  scriptId: string;
  list: string;
  index: number;
}

export function listIn(script: PageScript, list: string): ScriptStep[] | null {
  if (list === "root") return script.steps;
  const [sid, branch] = list.split(":");
  let found: ScriptStep[] | null = null;
  const visit = (steps: ScriptStep[]) => {
    for (const s of steps) {
      if (s.kind === "repeat" || s.kind === "for-each") {
        if (s.id === sid) {
          found = s.then;
          return;
        }
        visit(s.then);
        continue;
      }
      if (s.kind !== "if") continue;
      if (s.id === sid) {
        found = branch === "else" ? (s.else ??= []) : s.then;
        return;
      }
      visit(s.then);
      if (s.else) visit(s.else);
    }
  };
  visit(script.steps);
  return found;
}

/** ブロックの並びの中（入れ子も含む）に stepId があるか */
export function stepIn(steps: ScriptStep[], stepId: string): boolean {
  return steps.some(
    (st) =>
      st.id === stepId ||
      ("then" in st && stepIn(st.then, stepId)) ||
      (st.kind === "if" && !!st.else && stepIn(st.else, stepId))
  );
}

/** loc 以降のステップを取り出す（下につながるブロックごと動かす） */
export function takeAt(scripts: PageScript[], loc: Loc): [PageScript[], ScriptStep[]] {
  const next = structuredClone(scripts);
  const script = next.find((s) => s.id === loc.scriptId);
  const list = script && listIn(script, loc.list);
  if (!script || !list) return [scripts, []];
  const taken = list.splice(loc.index);
  // きっかけの無い集まりを丸ごと取り出したら、その集まりは消す
  if (loc.list === "root" && !script.trigger && !script.steps.length) {
    return [next.filter((s) => s.id !== script.id), taken];
  }
  return [next, taken];
}

export function insertAt(
  scripts: PageScript[],
  loc: Loc,
  steps: ScriptStep[]
): PageScript[] {
  const next = structuredClone(scripts);
  const script = next.find((s) => s.id === loc.scriptId);
  const list = script && listIn(script, loc.list);
  if (!list) return scripts;
  list.splice(loc.index, 0, ...steps);
  return next;
}

/** ステップIDの位置を探す */
function locOfStep(scripts: PageScript[], stepId: string): Loc | null {
  const search = (
    steps: ScriptStep[],
    scriptId: string,
    list: string
  ): Loc | null => {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.id === stepId) return { scriptId, list, index: i };
      if (s.kind === "if") {
        const found =
          search(s.then, scriptId, `${s.id}:then`) ??
          (s.else ? search(s.else, scriptId, `${s.id}:else`) : null);
        if (found) return found;
      } else if (s.kind === "repeat" || s.kind === "for-each") {
        const found = search(s.then, scriptId, `${s.id}:then`);
        if (found) return found;
      }
    }
    return null;
  };
  for (const sc of scripts) {
    const found = search(sc.steps, sc.id, "root");
    if (found) return found;
  }
  return null;
}

function removeOne(scripts: PageScript[], loc: Loc): PageScript[] {
  const next = structuredClone(scripts);
  const script = next.find((s) => s.id === loc.scriptId);
  const list = script && listIn(script, loc.list);
  if (!script || !list) return scripts;
  list.splice(loc.index, 1);
  if (!script.trigger && !script.steps.length) {
    return next.filter((s) => s.id !== script.id);
  }
  return next;
}

/** 選択キー（"script:<ID>" / "step:<ID>"）のブロックをまとめて削除する */
export function removeKeys(scripts: PageScript[], keys: string[]): PageScript[] {
  const scriptIds = new Set(
    keys.filter((k) => k.startsWith("script:")).map((k) => k.slice(7))
  );
  let next = scripts.filter((s) => !scriptIds.has(s.id));
  for (const k of keys) {
    if (!k.startsWith("step:")) continue;
    const loc = locOfStep(next, k.slice(5));
    if (loc) next = removeOne(next, loc);
  }
  return next;
}

export function mapStep(
  scripts: PageScript[],
  stepId: string,
  fn: (s: ScriptStep) => ScriptStep
): PageScript[] {
  const mapList = (list: ScriptStep[]): ScriptStep[] =>
    list.map((s) =>
      s.id === stepId
        ? fn(s)
        : s.kind === "if"
          ? {
              ...s,
              then: mapList(s.then),
              ...(s.else ? { else: mapList(s.else) } : {}),
            }
          : s.kind === "repeat" || s.kind === "for-each"
            ? { ...s, then: mapList(s.then) }
            : s
    );
  return scripts.map((s) => ({ ...s, steps: mapList(s.steps) }));
}

/**
 * 絞り込みに番号を振る（同じ配列の中で 1, 2, 3…）。
 * 番号の無いもの・複製などで重なったものだけに、空いているいちばん小さい番号を振る
 */
export function numberFilters(scripts: PageScript[]): PageScript[] {
  const used = new Map<string, Set<number>>();
  const need: Extract<ScriptStep, { kind: "filter-array" }>[] = [];
  const next = structuredClone(scripts);
  const walk = (steps: ScriptStep[]) => {
    for (const st of steps) {
      if (st.kind === "filter-array") {
        const set = used.get(st.array) ?? new Set<number>();
        used.set(st.array, set);
        if (st.no !== undefined && st.no > 0 && !set.has(st.no)) set.add(st.no);
        else need.push(st);
      } else if (st.kind === "if") {
        walk(st.then);
        if (st.else) walk(st.else);
      } else if (st.kind === "repeat" || st.kind === "for-each") {
        walk(st.then);
      }
    }
  };
  next.forEach((sc) => walk(sc.steps));
  if (!need.length) return scripts;
  for (const st of need) {
    const set = used.get(st.array)!;
    let n = 1;
    while (set.has(n)) n++;
    set.add(n);
    st.no = n;
  }
  return next;
}

/** ページの絞り込みの番号（配列ごと） */
export function filterNumbersOf(scripts: PageScript[], array: string): number[] {
  const out: number[] = [];
  const walk = (steps: ScriptStep[]) => {
    for (const st of steps) {
      if (st.kind === "filter-array" && st.array === array && st.no !== undefined) out.push(st.no);
      else if (st.kind === "if") {
        walk(st.then);
        if (st.else) walk(st.else);
      } else if (st.kind === "repeat" || st.kind === "for-each") walk(st.then);
    }
  };
  scripts.forEach((sc) => walk(sc.steps));
  return [...new Set(out)].sort((a, b) => a - b);
}

export const slotKey = (loc: Loc) => `${loc.scriptId}|${loc.list}|${loc.index}`;
export function parseSlot(key: string): Loc {
  const [scriptId, list, index] = key.split("|");
  return { scriptId, list, index: Number(index) };
}
