import assert from "node:assert/strict";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SiteDoc } from "../lib/types";

// Run this same harness against each checkout, sequentially on an idle machine:
// node --import tsx benchmarks/generator-names.mts /path/to/checkout
// Measures allocation alone, not the full export pipeline or browser rendering.
const root = resolve(process.argv[2] ?? ".");
const { buildClassNames } = await import(pathToFileURL(resolve(root, "lib/generator/names.ts")).href);
const results = [];
for (const count of [1000, 5000, 10000]) {
  const doc = {
    nodes: Object.fromEntries(Array.from({ length: count }, (_, i) => ["n" + i, {
      id: "n" + i, name: "ボックス",
    }])),
  } as SiteDoc;
  const samples: number[] = [];
  for (let sample = -1; sample < 5; sample++) {
    const start = performance.now();
    const names: Map<string, string> = buildClassNames(doc);
    const elapsed = performance.now() - start;
    assert.equal(names.size, count);
    assert.equal(names.get("n0"), "box");
    assert.equal(names.get("n" + (count - 1)), "box-" + count);
    if (sample >= 0) samples.push(elapsed);
  }
  const ordered = [...samples].sort((a, b) => a - b);
  results.push({ count, medianMs: ordered[2], samples });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, warmups: 1, measuredSamples: 5, results }, null, 2));
