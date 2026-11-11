import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { condGroups, filterItems, keyOfItem, matchOp, type ListOp } from "../lib/data";
import { parseValueLiteral } from "../lib/value-semantics";

// d55de8d の filterItems。合成データで旧実装と同じ結果になることも確認する。
function before(items: Record<string, unknown>[], ops: ListOp[]) {
  const filters = ops.filter((o): o is Extract<ListOp, { kind: "filter" }> => o.kind === "filter");
  if (!filters.length) return items;
  const pass = (o: Extract<ListOp, { kind: "filter" }>, item: Record<string, unknown>) =>
    condGroups(o.conds).some((g) => g.every((c) => {
      const right = c.resolvedValue ? c.resolvedValue.value : parseValueLiteral(c.value);
      const result = matchOp(keyOfItem(item, c.field), c.op, right);
      return c.not ? !result : result;
    }));
  return items.filter((item) => filters.reduce<boolean>(
    (acc, o, i) => (i === 0 ? pass(o, item) : o.join === "or" ? acc || pass(o, item) : acc && pass(o, item)), true));
}

const cases: { name: string; rows: number; iterations: number; ops: ListOp[] }[] = [
  { name: "large-json-membership", rows: 50000, iterations: 1, ops: [{ kind: "filter", conds: [
    { field: "category", op: "in", value: JSON.stringify(Array.from({ length: 20 }, (_, i) => `category-${i}`)) },
    { field: "score", op: "gte", value: "10", and: true },
    { field: "active", op: "eq", value: "true" },
  ] }] },
  { name: "large-scalar-groups", rows: 50000, iterations: 1, ops: [{ kind: "filter", conds: [
    { field: "score", op: "gte", value: "10" },
    { field: "score", op: "lte", value: "30", and: true },
    { field: "active", op: "eq", value: "true" },
  ] }] },
  { name: "small-scalar", rows: 10, iterations: 1000, ops: [{ kind: "filter", conds: [
    { field: "score", op: "gte", value: "10" },
  ] }] },
];
const results = [];
for (const fixture of cases) {
  const items = Array.from({ length: fixture.rows }, (_, i) => ({
    category: `category-${i % 30}`, score: i % 40, active: i % 3 === 0,
  }));
  assert.deepEqual(filterItems(items, fixture.ops), before(items, fixture.ops));
  const samples = { before: [] as number[], after: [] as number[] };
  let checksum = 0;
  for (let sample = -3; sample < 15; sample++) {
    const order = sample % 2 ? ["before", "after"] as const : ["after", "before"] as const;
    for (const key of order) {
      const fn = key === "before" ? before : filterItems;
      const start = performance.now();
      for (let i = 0; i < fixture.iterations; i++) checksum += fn(items, fixture.ops).length;
      if (sample >= 0) samples[key].push((performance.now() - start) / fixture.iterations);
    }
  }
  const summary = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { medianMs: sorted[7], p95Ms: sorted[14] };
  };
  results.push({ name: fixture.name, rows: fixture.rows, iterations: fixture.iterations, checksum,
    before: summary(samples.before), after: summary(samples.after), samples });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, baseline: "d55de8dea021d22f1aec319d53b45027e91b529f", warmups: 3, measuredSamples: 15, results }, null, 2));
