import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const fonts = require("next/dist/compiled/@next/font/dist/google/font-data.json");
const familiesByAxis = new Map();
for (const [family, font] of Object.entries(fonts)) {
  const weight = font.axes?.find(axis => axis.tag === "wght");
  if (!weight) continue;
  const range = weight.min + ".." + weight.max;
  if (!familiesByAxis.has(range)) familiesByAxis.set(range, []);
  familiesByAxis.get(range).push(family);
}

const axes = Object.fromEntries([...familiesByAxis].sort(([a], [b]) => a.localeCompare(b, "en")).map(
  ([range, families]) => [range, families.sort().join("|")],
));
writeFileSync(new URL("../lib/google-font-axes.json", import.meta.url), JSON.stringify(axes, null, 2) + "\n");
