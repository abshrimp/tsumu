/**
 * スクリプトの動作の木（入れ子の動作の並び）を、位置を指定して取り出し・差し込み・書き換える
 */

import { type PageScript } from "../../lib/script";
import { type ScriptStep } from "../../lib/types";
import { stepOutName } from "../../lib/data";

/* ---------- スクリプト操作（純粋関数） ---------- */

/** ステップ列の位置。list = "root" | "<ifのID>:then" | "<ifのID>:else" */
export interface Loc {
  scriptId: string;
  list: string;
  index: number;
}

// Only the final colon separates the branch; imported step IDs may contain colons.
function branchOf(list: string): [string, string] {
  const separator = list.lastIndexOf(":");
  return [list.slice(0, separator), list.slice(separator + 1)];
}

export function listIn(script: PageScript, list: string, createMissing = false): ScriptStep[] | null {
  if (list === "root") return script.steps;
  const [sid, branch] = branchOf(list);
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
        found = branch === "else" ? (s.else ?? (createMissing ? (s.else = []) : null)) : s.then;
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

/**
 * Copy only the edited list and its enclosing steps, instead of deeply cloning
 * the entire workspace whenever a block is moved or deleted.
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
  // Resolve duplicate IDs with the same direct-match short circuit as listIn.
  const findOwner = (steps: ScriptStep[]): ScriptStep | null => {
    let found: ScriptStep | null = null;
    for (const step of steps) {
      if (step.kind === "repeat" || step.kind === "for-each") {
        if (step.id === sid) return step;
        found = findOwner(step.then) ?? found;
        continue;
      }
      if (step.kind !== "if") continue;
      if (step.id === sid) return step;
      found = findOwner(step.then) ?? found;
      if (step.else) found = findOwner(step.else) ?? found;
    }
    return found;
  };
  const owner = findOwner(script.steps);
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

/** loc 以降のステップを取り出す（下につながるブロックごと動かす） */
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
 * Connect a newly dropped processing block to the preceding output in the
 * same script list. Moving an existing step must never rewrite its source.
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

/** Delete selected scripts and steps with one immutable traversal. */
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
  // Preserve the identity of untouched scripts, branches, and blocks.
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
 * 番号の無いもの・複製などで重なったものだけに、空いているいちばん小さい番号を振る
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

  // Renumber only the affected filter blocks and their enclosing branches.
  // Deep cloning here discarded mapStep's sharing on every normal input edit.
  const assigned = new Map<ScriptStep, number>();
  for (const st of need) {
    const set = used.get(st.array)!;
    let n = 1;
    while (set.has(n)) n++;
    set.add(n);
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

// A single workspace can show many filter dropdowns. Reuse one index of
// filter numbers for all of them instead of scanning every script repeatedly.
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
  // Preserve the previous return-value contract (a fresh array per call).
  return [...(index.get(array) ?? [])];
}

// These keys only address live DOM slots, never saved data. A tuple keeps IDs
// containing pipes, quotes or other delimiters distinct without rewriting them.
export const slotKey = (loc: Loc) => JSON.stringify([loc.scriptId, loc.list, loc.index]);
export function parseSlot(key: string): Loc {
  const [scriptId, list, index] = JSON.parse(key) as [string, string, number];
  return { scriptId, list, index };
}
