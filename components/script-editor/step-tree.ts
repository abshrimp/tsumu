/**
 * スクリプトの動作の木（入れ子の動作の並び）から、位置を指定して取り出す・差し込む・書き換える
 */

import { type PageScript } from "../../lib/script";
import { type ScriptStep } from "../../lib/types";
import { stepOutName } from "../../lib/data";

/* ---------- スクリプトの操作（純粋関数） ---------- */

/** 手順の並びの位置。list = "root" | "<ifのID>:then" | "<ifのID>:else" */
export interface Loc {
  scriptId: string;
  list: string;
  index: number;
}

// 分岐を区切るのは最後のコロンだけ。取り込んだ手順の ID にはコロンが含まれることがある。
function branchOf(list: string): [string, string] {
  const separator = list.lastIndexOf(":");
  return [list.slice(0, separator), list.slice(separator + 1)];
}

// Imported documents can contain duplicate step IDs. Resolve the first owner
// in document order consistently for both slot lookup and immutable edits.
function findBranchOwner(steps: ScriptStep[], id: string): ScriptStep | null {
  for (const step of steps) {
    if (!("then" in step)) continue;
    if (step.id === id) return step;
    const nested = findBranchOwner(step.then, id);
    if (nested) return nested;
    if (step.kind === "if" && step.else) {
      const otherwise = findBranchOwner(step.else, id);
      if (otherwise) return otherwise;
    }
  }
  return null;
}

export function listIn(script: PageScript, list: string, createMissing = false): ScriptStep[] | null {
  if (list === "root") return script.steps;
  const [sid, branch] = branchOf(list);
  const owner = findBranchOwner(script.steps, sid);
  if (!owner || !("then" in owner)) return null;
  if (owner.kind === "if" && branch === "else") {
    return owner.else ?? (createMissing ? (owner.else = []) : null);
  }
  return owner.then;
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

/**
 * ブロックを動かしたり削除したりするたびに、ワークスペース全体を深く複製せず、
 * 編集した一覧と、それを囲む手順だけを複製する。
 */
function spliceScriptList(
  scripts: PageScript[],
  loc: Loc,
  deleteCount: number,
  inserted: ScriptStep[],
  createMissing = false
): [PageScript[], ScriptStep[]] {
  const script = scripts.find((item) => item.id === loc.scriptId);
  if (!script) return [scripts, []];

  let removed: ScriptStep[] = [];
  if (loc.list === "root") {
    const steps = script.steps.slice();
    removed = steps.splice(loc.index, deleteCount, ...inserted);
    return [scripts.map((item) => item === script ? { ...item, steps } : item), removed];
  }

  const [sid, branch] = branchOf(loc.list);
  const owner = findBranchOwner(script.steps, sid);
  if (!owner) return [scripts, []];
  const field = owner.kind === "if" && branch === "else" ? "else" : "then";
  if (field === "else" && owner.kind === "if" && !owner.else && !createMissing) {
    return [scripts, []];
  }

  const updated = mapStep(scripts, sid, (step) => {
    if (step !== owner || !("then" in step)) return step;
    const source = field === "else" && step.kind === "if" ? (step.else ?? []) : step.then;
    const next = source.slice();
    removed = next.splice(loc.index, deleteCount, ...inserted);
    return { ...step, [field]: next } as ScriptStep;
  });
  return [updated, removed];
}

/** loc 以降の手順を取り出す（下につながるブロックごと動かす） */
export function takeAt(scripts: PageScript[], loc: Loc): [PageScript[], ScriptStep[]] {
  const [next, taken] = spliceScriptList(scripts, loc, Infinity, []);
  const script = next.find((item) => item.id === loc.scriptId);
  if (next !== scripts && loc.list === "root" && script && !script.trigger && !script.steps.length) {
    return [next.filter((item) => item.id !== script.id), taken];
  }
  return [next, taken];
}

export function insertAt(
  scripts: PageScript[],
  loc: Loc,
  steps: ScriptStep[]
): PageScript[] {
  return spliceScriptList(scripts, loc, 0, steps, true)[0];
}

/**
 * 新しくドロップした加工のブロックを、同じスクリプトの一覧の直前の出力につなぐ。
 * 既存の手順を動かしたときは、元にする値を決して書き換えない。
 */
export function connectNewTransform(scripts: PageScript[], loc: Loc, steps: ScriptStep[]): ScriptStep[] {
  const script = scripts.find((s) => s.id === loc.scriptId);
  const list = script && listIn(script, loc.list);
  const preceding = loc.index > 0 ? list?.[loc.index - 1] : undefined;
  const name = preceding ? stepOutName(preceding) : null;
  if (!name) return steps;
  return steps.map((step) =>
    step.kind === "transform" && !step.source
      ? { ...step, source: name, into: step.into || name }
      : step
  );
}

/** 選択したスクリプトと手順を、元のデータを書き換えない1回の走査で削除する。 */
export function removeKeys(scripts: PageScript[], keys: string[]): PageScript[] {
  const scriptIds = new Set<string>();
  const stepIds = new Set<string>();
  for (const key of keys) {
    if (key.startsWith("script:")) scriptIds.add(key.slice(7));
    else if (key.startsWith("step:")) stepIds.add(key.slice(5));
  }
  if (!scriptIds.size && !stepIds.size) return scripts;

  const prune = (steps: ScriptStep[]): ScriptStep[] => {
    let result: ScriptStep[] | undefined;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (stepIds.has(step.id)) {
        result ??= steps.slice(0, i);
        continue;
      }
      let next = step;
      if (step.kind === "if") {
        const then = prune(step.then);
        const otherwise = step.else ? prune(step.else) : undefined;
        if (then !== step.then || otherwise !== step.else) {
          next = { ...step, then, ...(step.else ? { else: otherwise } : {}) };
        }
      } else if (step.kind === "repeat" || step.kind === "for-each") {
        const then = prune(step.then);
        if (then !== step.then) next = { ...step, then };
      }
      if (result) result.push(next);
      else if (next !== step) {
        result = steps.slice(0, i);
        result.push(next);
      }
    }
    return result ?? steps;
  };

  let result: PageScript[] | undefined;
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    if (scriptIds.has(script.id)) {
      result ??= scripts.slice(0, i);
      continue;
    }
    const steps = stepIds.size ? prune(script.steps) : script.steps;
    if (steps !== script.steps && !script.trigger && !steps.length) {
      result ??= scripts.slice(0, i);
      continue;
    }
    const next = steps === script.steps ? script : { ...script, steps };
    if (result) result.push(next);
    else if (next !== script) {
      result = scripts.slice(0, i);
      result.push(next);
    }
  }
  return result ?? scripts;
}

export function mapStep(
  scripts: PageScript[],
  stepId: string,
  fn: (s: ScriptStep) => ScriptStep
): PageScript[] {
  // 手を付けていないスクリプト・分岐・ブロックは、同じオブジェクトのまま残す。
  const mapList = (list: ScriptStep[]): ScriptStep[] => {
    let changed: ScriptStep[] | null = null;
    list.forEach((step, index) => {
      let next: ScriptStep = step;
      if (step.id === stepId) {
        next = fn(step);
      } else if (step.kind === "if") {
        const then = mapList(step.then);
        const otherwise = step.else ? mapList(step.else) : undefined;
        if (then !== step.then || otherwise !== step.else) {
          next = { ...step, then, ...(step.else ? { else: otherwise } : {}) };
        }
      } else if (step.kind === "repeat" || step.kind === "for-each") {
        const then = mapList(step.then);
        if (then !== step.then) next = { ...step, then };
      }
      if (next !== step) {
        changed ??= list.slice();
        changed[index] = next;
      }
    });
    return changed ?? list;
  };
  return scripts.map((script) => {
    const steps = mapList(script.steps);
    return steps === script.steps ? script : { ...script, steps };
  });
}

/**
 * 絞り込みに番号を振る（同じ配列の中で 1, 2, 3…）。
 * 番号が無いものと、複製などで番号が重なったものだけに、空いている最も小さい番号を振る
 */
export function numberFilters(scripts: PageScript[]): PageScript[] {
  const used = new Map<string, Set<number>>();
  const need: Extract<ScriptStep, { kind: "list-display" }>[] = [];
  const walk = (steps: ScriptStep[]) => {
    for (const st of steps) {
      if (st.kind === "list-display" && st.mode === "filter") {
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
  scripts.forEach((script) => walk(script.steps));
  if (!need.length) return scripts;

  // 影響を受ける絞り込みのブロックと、それを囲む分岐だけに番号を振り直す。
  // ここで深く複製すると、通常の入力の編集のたびに mapStep が共有していた部分が失われていた。
  const assigned = new Map<ScriptStep, number>();
  const nextNumber = new Map<string, number>();
  for (const st of need) {
    const set = used.get(st.array)!;
    let n = nextNumber.get(st.array) ?? 1;
    while (set.has(n)) n++;
    nextNumber.set(st.array, n + 1);
    assigned.set(st, n);
  }
  const updateList = (steps: ScriptStep[]): ScriptStep[] => {
    let changed: ScriptStep[] | undefined;
    steps.forEach((step, index) => {
      let result: ScriptStep = step;
      if (step.kind === "list-display" && assigned.has(step)) {
        result = { ...step, no: assigned.get(step)! };
      } else if (step.kind === "if") {
        const then = updateList(step.then);
        const otherwise = step.else ? updateList(step.else) : undefined;
        if (then !== step.then || otherwise !== step.else) {
          result = { ...step, then, ...(step.else ? { else: otherwise } : {}) };
        }
      } else if (step.kind === "repeat" || step.kind === "for-each") {
        const then = updateList(step.then);
        if (then !== step.then) result = { ...step, then };
      }
      if (result !== step) {
        changed ??= steps.slice();
        changed[index] = result;
      }
    });
    return changed ?? steps;
  };
  return scripts.map((script) => {
    const steps = updateList(script.steps);
    return steps === script.steps ? script : { ...script, steps };
  });
}

// 1つのワークスペースに、絞り込みのドロップダウンがたくさん表示されることがある。
// すべてのスクリプトを何度も調べず、絞り込みの番号の索引を1つ作って使い回す。
const filterNumberIndex = new WeakMap<PageScript[], Map<string, number[]>>();

/** ページの絞り込みの番号（配列ごと） */
export function filterNumbersOf(scripts: PageScript[], array: string): number[] {
  let index = filterNumberIndex.get(scripts);
  if (!index) {
    const collected = new Map<string, Set<number>>();
    const walk = (steps: ScriptStep[]) => {
      for (const st of steps) {
        if (st.kind === "list-display" && st.mode === "filter" && st.no !== undefined) {
          const numbers = collected.get(st.array) ?? new Set<number>();
          numbers.add(st.no);
          collected.set(st.array, numbers);
        } else if (st.kind === "if") {
          walk(st.then);
          if (st.else) walk(st.else);
        } else if (st.kind === "repeat" || st.kind === "for-each") {
          walk(st.then);
        }
      }
    };
    scripts.forEach((script) => walk(script.steps));
    index = new Map([...collected].map(([name, numbers]) =>
      [name, [...numbers].sort((a, b) => a - b)]
    ));
    filterNumberIndex.set(scripts, index);
  }
  // 呼び出すたびに新しい配列を返す、という戻り値の約束を守る。
  return [...(index.get(array) ?? [])];
}

// このキーは画面上の差し込み位置を指すだけで、保存するデータには使わない。タプルにすることで、
// 縦線・引用符などの区切り文字を含む ID も、書き換えずに区別できる。
export const slotKey = (loc: Loc) => JSON.stringify([loc.scriptId, loc.list, loc.index]);
export function parseSlot(key: string): Loc {
  const [scriptId, list, index] = JSON.parse(key) as [string, string, number];
  return { scriptId, list, index };
}
