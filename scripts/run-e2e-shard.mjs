import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = process.argv[2] ?? "";
const match = /^(\d+)\/(\d+)$/.exec(spec);
if (!match) throw new Error("Expected a shard in the form 1/4");
const shard = Number(match[1]);
const shardCount = Number(match[2]);
if (!Number.isSafeInteger(shard) || !Number.isSafeInteger(shardCount) || shard < 1 || shard > shardCount) {
  throw new Error("Invalid shard: " + spec);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const env = { ...process.env };
for (const name of ["PLAYWRIGHT_JSON_OUTPUT_NAME", "PLAYWRIGHT_JSON_OUTPUT_FILE", "PLAYWRIGHT_JSON_OUTPUT_DIR"]) delete env[name];
const discovery = spawnSync(command, ["playwright", "test", "--list", "--reporter=json"], {
  cwd: root, encoding: "utf8", maxBuffer: 50 * 1024 * 1024, env,
});
if (discovery.error || discovery.status !== 0) {
  process.stderr.write(discovery.stderr || discovery.stdout || String(discovery.error) || "Unable to list E2E tests\n");
  process.exit(discovery.status || 1);
}

const report = JSON.parse(discovery.stdout);
const counts = new Map();
const normalizePath = (file) => {
  // Playwright's JSON reporter can make paths relative to the configured testDir.
  const absolute = isAbsolute(file) ? file : resolve(root, file.startsWith("e2e/") ? file : "e2e/" + file);
  const path = relative(root, absolute).replaceAll("\\", "/");
  if (!path.startsWith("e2e/") || !/\.(spec|test)\.[cm]?[jt]sx?$/.test(path) || !existsSync(absolute)) {
    throw new Error("Unexpected Playwright test path: " + file);
  }
  return path;
};
function collect(suites, inheritedFile) {
  for (const suite of suites ?? []) {
    const file = suite.file || inheritedFile;
    for (const test of suite.specs ?? []) {
      const count = test.tests?.length ?? 0;
      if (!count) continue;
      const source = test.file || file;
      if (typeof source !== "string") throw new Error("Playwright did not report a test file");
      const path = normalizePath(source);
      counts.set(path, (counts.get(path) ?? 0) + count);
    }
    collect(suite.suites, file);
  }
}
collect(report.suites);
if (counts.size === 0) throw new Error("No E2E tests were discovered; refusing to silently skip the suite");

// Timings are hints only. Discover the complete current suite on every run.
const history = JSON.parse(readFileSync(resolve(root, "scripts/e2e-shard-durations.json"), "utf8"));
const samples = Object.values(history.files);
const averageTestMs = samples.reduce((sum, value) => sum + value[1], 0) /
  samples.reduce((sum, value) => sum + value[0], 0);
const cases = [...counts].map(([path, count]) => {
  const previous = history.files[path];
  const estimatedMs = previous && previous[0] > 0
    ? Math.max(500, Math.round(previous[1] * count / previous[0]))
    : Math.max(1000, Math.round(averageTestMs * count));
  return { path, count, estimatedMs };
});
cases.sort((a, b) => b.estimatedMs - a.estimatedMs || a.path.localeCompare(b.path));

const buckets = Array.from({ length: shardCount }, (_, index) => ({ index, estimatedMs: 0, count: 0, files: [] }));
for (const item of cases) {
  const target = buckets.reduce((best, current) =>
    current.estimatedMs < best.estimatedMs ||
    (current.estimatedMs === best.estimatedMs && current.count < best.count)
      ? current : best);
  target.estimatedMs += item.estimatedMs;
  target.count += item.count;
  target.files.push(item.path);
}
const assigned = buckets[shard - 1];
assigned.files.sort();
console.log("Discovered " + [...counts.values()].reduce((a, b) => a + b, 0) + " tests in " + counts.size + " files.");
for (const group of buckets) {
  console.log("Shard " + (group.index + 1) + "/" + shardCount + ": " + group.count +
    " tests, " + group.files.length + " files, estimated " + (group.estimatedMs / 60_000).toFixed(2) + " min");
}
if (assigned.files.length === 0) {
  console.log("No test files assigned to shard " + shard);
  process.exit(0);
}
// Playwright positional arguments are file-path regular expressions. Anchor and escape each one.
const escapeRegex = (value) => Array.from(value, char =>
  ".*+?^$()[]{}|\\".includes(char) ? "\\" + char : char).join("");
const filters = assigned.files.map(file => escapeRegex(file) + "$");
const child = spawnSync(command, ["playwright", "test", ...filters], { cwd: root, stdio: "inherit", env });
if (child.error) throw child.error;
process.exit(child.status || (child.signal ? 1 : 0));
