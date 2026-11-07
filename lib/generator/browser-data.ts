import type { SiteDoc, Page } from "../types";
import { pagePlan } from "../data";
import { evaluateValueRecipe } from "../script-model/recipe-runtime";
import { runPurePageSteps } from "../page-load-steps";

/**
 * Prepare the page-load plan for the exported browser and SSR interpreters.
 * PR #136 removes countFilters and represents value work as "transform".
 * Until the new planner lands here, preserve the load sequence directly from
 * the #136 document; afterwards, respect its client/server partition.
 */
export function pageDataPlan(doc: SiteDoc, page: Page) {
  const plan = pagePlan(doc, page.id);
  type PlanStep = (typeof plan.steps)[number];
  type FutureStep = { id?: string; kind: string; [name: string]: unknown };
  const load = (page.pageScripts ?? [])
    .filter((script) => script.trigger === "load")
    .flatMap((script) => script.steps as unknown as FutureStep[]);
  const oldPlanner = "countFilters" in plan;
  const hasNewKinds = load.some((step) => step.kind === "transform" || step.kind === "list-display");
  const pureKinds = new Set(["fetch", "set-var", "transform", "if", "for-each", "repeat"]);
  const steps = oldPlanner && hasNewKinds
    ? load.filter((step) => pureKinds.has(step.kind)) as unknown as PlanStep[]
    : plan.steps;
  // The new planner owns initial list-display operations and excludes the
  // client-side ones. Only the old planner needs temporary forward planning.
  const listOps = new Map(plan.listOps);
  if (oldPlanner && hasNewKinds) {
    for (const st of load) {
      if (st.kind !== "list-display" || typeof st.array !== "string" || !st.array) continue;
      const current = listOps.get(st.array) ?? [];
      if (st.mode === "clear") {
        listOps.set(st.array, current.filter((op) =>
          op.kind !== "filter" || (st.no !== undefined && op.no !== st.no)));
      } else if (st.mode === "sort" && typeof st.field === "string" && st.field) {
        listOps.set(st.array, [...current, { kind: "sort", field: st.field,
          dir: st.dir === "desc" ? "desc" : "asc" }]);
      } else if (st.mode === "filter" && typeof st.field === "string" && st.field) {
        const conds = [
          { field: st.field, op: st.op, value: st.value, not: st.not },
          ...(Array.isArray(st.or) ? st.or : []),
        ] as Array<{ field: string; op: string; value: string; not?: boolean; and?: boolean }>;
        const filter = { kind: "filter" as const, conds: conds.filter((c) => c.field),
          no: typeof st.no === "number" ? st.no : undefined,
          join: st.join === "or" ? "or" as const : "and" as const };
        const index = filter.no === undefined ? -1 : current.findIndex((op) =>
          op.kind === "filter" && op.no === filter.no);
        listOps.set(st.array, index >= 0
          ? current.map((op, i) => i === index ? filter : op)
          : [...current, filter]);
      }
    }
  }
  return {
    steps: steps.map((step) => {
      if (step.kind !== "fetch") return step;
      // Sample results are editor-only; never put them in generated JS.
      const { sample: _sample, sampleTotals: _totals, fetchedAt: _at, ...publicStep } = step;
      return publicStep;
    }),
    listOps: Object.fromEntries(listOps),
    // Removed by #136; retain only for this pre-merge planner's old tests.
    ...("countFilters" in plan && plan.countFilters instanceof Map
      ? { countFilters: Object.fromEntries(plan.countFilters) } : {}),
  };
}

/** Browser-only data runner embedded in all generated client-side formats. */
const BASE_PAGE_DATA_RUNTIME = "(function () {\n  \"use strict\";\n  const element = document.querySelector(\"script[data-page-plan]\");\n  let config = {};\n  try { config = JSON.parse(element?.textContent || \"{}\"); }\n  catch (error) { console.warn(\"Invalid page data\", error); }\n\n  function read(vars, path) {\n    if (vars == null || typeof vars !== \"object\") return undefined;\n    if (Object.prototype.hasOwnProperty.call(vars, path)) return vars[path];\n    return String(path || \"\").split(\".\").reduce((value, key) => {\n      if (value == null || typeof value !== \"object\") return undefined;\n      return Array.isArray(value) && key === \"-1\" ? value[value.length - 1] : value[key];\n    }, vars);\n  }\n  function write(vars, path, value) {\n    if (!path) return;\n    if (!path.includes(\".\") || Object.prototype.hasOwnProperty.call(vars, path)) {\n      vars[path] = value; return;\n    }\n    const [root, ...keys] = path.split(\".\");\n    const replace = (input, list) => {\n      if (!list.length) return value;\n      const [key, ...rest] = list;\n      const copy = Array.isArray(input) ? input.slice() : input && typeof input === \"object\" ? { ...input } : {};\n      copy[key] = replace(copy[key], rest);\n      return copy;\n    };\n    vars[root] = replace(vars[root], keys);\n  }\n  function text(value) {\n    if (value == null) return \"\";\n    if (Array.isArray(value)) return value.map(text).filter(Boolean).join(\", \");\n    return typeof value === \"object\" ? \"\" : String(value);\n  }\n  function interpolate(template, vars, encode = false) {\n    return String(template || \"\").replace(/\\\\\\{|\\{([^{}\\s\"'<>]+)\\}|\\[slug\\]/g, (all, name, offset) => {\n      if (all === \"\\\\{\") return \"{\";\n      const result = text(read(vars, name || \"slug\"));\n      return encode ? offset === 0 && /^(?:https?:|mailto:|tel:|\\/(?!\\/)|#)/i.test(result)\n        ? result : encodeURIComponent(result) : result;\n    });\n  }\n  function jsonBody(template, vars) {\n    const src = String(template || \"\");\n    let out = \"\", from = 0, quoted = false;\n    for (const match of src.matchAll(/\\\\\\{|\\{([^{}\\s\"'<>]+)\\}|\\[slug\\]/g)) {\n      const prefix = src.slice(from, match.index);\n      for (let i = 0; i < prefix.length; i++) {\n        if (prefix[i] === \"\\\\\") i++;\n        else if (prefix[i] === '\"') quoted = !quoted;\n      }\n      out += prefix;\n      from = match.index + match[0].length;\n      if (match[0] === \"\\\\{\") out += \"{\";\n      else {\n        const v = read(vars, match[1] || \"slug\");\n        out += quoted ? JSON.stringify(text(v)).slice(1, -1) : JSON.stringify(v === undefined ? null : v);\n      }\n    }\n    return out + src.slice(from);\n  }\n  function compare(a, b, op) {\n    a = text(a); b = text(b);\n    switch (op) {\n      case \"neq\": return a !== b;\n      case \"contains\": return a.includes(b);\n      case \"not-contains\": return !a.includes(b);\n      case \"starts-with\": return a.startsWith(b);\n      case \"ends-with\": return a.endsWith(b);\n      case \"gt\": return parseFloat(a) > parseFloat(b);\n      case \"lt\": return parseFloat(a) < parseFloat(b);\n      case \"empty\": return a === \"\";\n      case \"not-empty\": return a !== \"\";\n      case \"in\": return b.split(\",\").some(value => value.trim() === a);\n      default: return a === b;\n    }\n  }\n  function passes(item, clauses, vars) {\n    if (!clauses.length) return false;\n    const groups = [];\n    for (const c of clauses) {\n      if (c.and && groups.length) groups[groups.length - 1].push(c);\n      else groups.push([c]);\n    }\n    return groups.some(group => group.every(c => {\n      const value = compare(read(item, c.field), interpolate(c.value, vars), c.op);\n      return c.not ? !value : value;\n    }));\n  }\n  function filter(items, operations, vars) {\n    const filters = (operations || []).filter(op => op.kind === \"filter\");\n    return filters.length ? items.filter(value => {\n      const item = value && typeof value === \"object\" ? value : { \"値\": value };\n      return filters.reduce((acc, op, index) => {\n        const result = passes(item, op.conds || [], vars);\n        return index === 0 ? result : op.join === \"or\" ? acc || result : acc && result;\n      }, true);\n    }) : items;\n  }\n  function applyOps(items, operations, vars) {\n    if (!Array.isArray(items)) return items;\n    let next = filter(items, operations, vars);\n    for (const op of operations || []) if (op.kind === \"sort\") {\n      const dir = op.dir === \"desc\" ? -1 : 1;\n      next = next.map((value, index) => ({ value, index })).sort((a, b) => {\n        const x = read(a.value, op.field), y = read(b.value, op.field);\n        const order = typeof x === \"number\" && typeof y === \"number\" ? x - y :\n          text(x).localeCompare(text(y), \"ja\", { numeric: true });\n        return dir * order || a.index - b.index;\n      }).map(pair => pair.value);\n    }\n    return next;\n  }\n  function setItemField(list, field, template, vars) {\n    if (!Array.isArray(list)) return list;\n    const exact = /^\\{([^{}]+)\\}$/.exec(String(template).trim());\n    return list.map(value => {\n      if (value == null || Array.isArray(value)) return value;\n      const item = typeof value === \"object\" ? value : { \"値\": value };\n      const scope = { ...vars, ...item };\n      return { ...item, [field]: exact ? (read(scope, exact[1]) ?? null) : interpolate(template, scope) };\n    });\n  }\n  function each(list, step, vars) {\n    if (!Array.isArray(list)) return list;\n    const run = (steps, item) => {\n      for (const st of steps) {\n        if (st.kind === \"array-field\" && st.array === step.array && st.field) {\n          item = setItemField([item], st.field, st.value, { ...vars, ...item })[0];\n        } else if (st.kind === \"if\" && st.cond.subject === \"var\") {\n          const scope = { ...vars, ...item };\n          const ok = compare(interpolate(st.cond.left, scope),\n            interpolate(st.cond.value, scope), st.cond.op);\n          item = run(ok ? st.then || [] : st.else || [], item);\n        }\n      }\n      return item;\n    };\n    return list.map(value => {\n      if (value == null || Array.isArray(value)) return value;\n      return run(step.then || [], typeof value === \"object\" ? value : { \"値\": value });\n    });\n  }\n  async function request(st, vars) {\n    const url = interpolate(st.url, vars, true);\n    if (!/^(?:https?:\\/\\/|\\/(?!\\/)|\\.\\/|\\.\\.\\/)/i.test(url)) {\n      console.warn(\"Unsupported page data URL:\", url); return null;\n    }\n    const method = st.method || \"GET\", headers = {};\n    for (const header of st.headers || []) {\n      if (header.name && header.name.trim())\n        headers[header.name.trim()] = interpolate(header.value, vars);\n    }\n    const init = { method, headers };\n    if (method !== \"GET\" && method !== \"HEAD\" && st.body?.trim()) {\n      headers[\"Content-Type\"] = \"application/json\";\n      init.body = jsonBody(st.body, vars);\n    }\n    try {\n      const response = await fetch(url, init);\n      if (!response.ok) throw new Error(\"HTTP \" + response.status);\n      if (Number(response.headers?.get(\"content-length\") || 0) > 5 * 1024 * 1024)\n        throw new Error(\"Response exceeds 5 MB\");\n      const body = await response.text();\n      if (body.length > 5 * 1024 * 1024) throw new Error(\"Response exceeds 5 MB\");\n      return JSON.parse(body);\n    } catch (error) {\n      console.warn(\"Unable to fetch page data:\", url, error);\n      return null;\n    }\n  }\n  async function load(plan) {\n    const vars = Object.fromEntries(new URLSearchParams(location.search));\n    for (const st of plan.steps || []) {\n      switch (st.kind) {\n        case \"fetch\":\n          if (st.as) write(vars, st.as, await request(st, vars));\n          break;\n        case \"transform\":\n        case \"set-var\":\n        case \"if\":\n        case \"for-each\":\n        case \"repeat\":\n          if (!runPurePageSteps([st], vars, read, interpolate, evaluateValueRecipe)) {\n            throw new Error(\"Page-load script exceeded execution limits\");\n          }\n          break;\n        case \"split\":\n          if (st.into) write(vars, st.into,\n            interpolate(st.source, vars).split(st.sep || \",\").map(v => v.trim()).filter(Boolean));\n          break;\n        case \"array-find\":\n          if (st.into) {\n            const list = read(vars, st.array), wanted = interpolate(st.value, vars);\n            const value = Array.isArray(list) ? list.find(item => {\n              const actual = text(read(item, st.field));\n              return actual === wanted || encodeURIComponent(actual) === wanted;\n            }) : null;\n            write(vars, st.into, value ?? null);\n          }\n          break;\n        case \"array-field\":\n          if (st.array && st.field) write(vars, st.array,\n            setItemField(read(vars, st.array), st.field, st.value, vars));\n          break;\n        case \"join\":\n          if (st.into) {\n            const list = read(vars, st.array);\n            write(vars, st.into, Array.isArray(list) ? list.map(item => {\n              const value = st.field ? read(item, st.field) : item;\n              return value == null || typeof value === \"object\" ? \"\" : text(value);\n            }).filter(Boolean).join(st.sep) : text(list));\n          }\n          break;\n        case \"count\":\n          if (st.into) {\n            const list = read(vars, st.array);\n            write(vars, st.into, Array.isArray(list) ?\n              filter(list, plan.countFilters?.[st.id] || [], vars).length : 0);\n          }\n          break;\n      }\n    }\n    for (const [name, ops] of Object.entries(plan.listOps || {})) {\n      const list = read(vars, name);\n      if (Array.isArray(list)) write(vars, name, applyOps(list, ops, vars));\n    }\n    return vars;\n  }\n  window.__pageDataReady = load(config).catch(error => {\n    console.warn(\"Page data initialization failed:\", error);\n    return {};\n  });\n})();";

// Use exactly the same pure evaluators as #136's editor, SSR, and script runtime.
const interpreter = [
  "  // #136 shared pure page-data helpers",
  "  const __name = (fn) => fn;",
  "  const evaluateValueRecipe = (" + evaluateValueRecipe.toString() + ");",
  "  const runPurePageSteps = (" + runPurePageSteps.toString() + ");",
].join("\n") + "\n";
export const PAGE_DATA_RUNTIME = BASE_PAGE_DATA_RUNTIME.replace(
  "  function read(vars, path) {",
  interpreter + "  function read(vars, path) {",
);
