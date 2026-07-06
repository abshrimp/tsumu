/** 比較用の合成データだけを使用。実行: node --import tsx scripts/bench-asset-usage.mts */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { assetUsage } from "../lib/asset-usage";
import { referenceAssetUsage } from "../tests/helpers/asset-usage-reference";
import { largeAssetLibrary } from "../tests/helpers/large-asset-library";

for (const [images, nodes] of [[500, 50], [2_000, 100], [5_000, 200]]) {
  const doc = largeAssetLibrary(images, nodes);
  const before = referenceAssetUsage(doc);
  assert.deepEqual([...assetUsage(doc)].sort(), [...before].sort());
  const measure = (run: typeof assetUsage) => {
    const samples = Array.from({ length: 3 }, () => { const start = performance.now(); run(doc); return performance.now() - start; });
    return Number(samples.sort((a, b) => a - b)[1].toFixed(2));
  };
  const previousMs = measure(referenceAssetUsage);
  const indexedMs = measure(assetUsage);
  console.log(JSON.stringify({ images, nodes, styleValues: nodes * 10, previousMs, indexedMs, speedup: +(previousMs / indexedMs).toFixed(1) }));
}
