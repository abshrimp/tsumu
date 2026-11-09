import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("all CI jobs use full commit-pinned actions and checkouts do not persist credentials", () => {
  const workflow = read(".github/workflows/ci.yml");
  const uses = [...workflow.matchAll(/^\s*- uses: ([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0, "Expected GitHub actions in the CI workflow");
  for (const action of uses) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `Action ${action} must be pinned by commit SHA`);
  }
  const checkoutCount = (workflow.match(/- uses: actions\/checkout@/g) ?? []).length;
  const safeCheckouts = [...workflow.matchAll(
    /- uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n[ \t]+with:\n[ \t]+persist-credentials: false/g,
  )];
  assert.ok(checkoutCount > 0, "Expected at least one checkout step");
  assert.equal(safeCheckouts.length, checkoutCount, "Every checkout must disable credential persistence");
});

test("CI checks pull requests without path skips, dependencies, workers and all E2E shards", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.match(workflow, /^  push:\s*$/m);
  for (const name of ["check", "dependency-audit", "worker-build", "e2e-shard", "generated-formats"]) {
    assert.match(workflow, new RegExp(`^  ${name}:$`, "m"));
  }
  assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /npm run build:worker/);
  assert.match(workflow, /shard: \[1, 2, 3, 4\]/);
  assert.match(workflow, /framework: \[nextjs, react, vue, nuxt, sveltekit\]/);
  assert.match(workflow, /node scripts\/run-e2e-shard\.mjs/);
});

test("Docker runtime is non-root and local credentials are excluded from the build context", () => {
  const dockerfile = read("Dockerfile");
  const ignored = read(".dockerignore").split(/\r?\n/).map((line) => line.trim());
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^VOLUME \/data$/m);
  assert.match(dockerfile, /chown node:node \/data/);
  for (const path of [".env*", ".dev.vars*", ".npmrc", "wrangler.local.jsonc",
    "wrangler.generated.jsonc", "wrangler.preview.generated.jsonc", ".generated-export-smoke/"]) {
    assert.ok(ignored.includes(path), `${path} must be outside the Docker build context`);
  }
});

test("runtime requirements match between package metadata and CI", () => {
  const pkg = JSON.parse(read("package.json"));
  const version = read(".nvmrc").trim();
  assert.equal(pkg.engines.node, `>=${version}`);
  assert.equal(pkg.packageManager, `npm@${pkg.engines.npm.slice(2)}`);
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /node-version-file: \.nvmrc/);
});

test("Next.js editor routes apply the baseline response security headers", async () => {
  const { default: configForPhase } = await import("../next.config.mjs");
  const { PHASE_PRODUCTION_BUILD } = await import("next/constants.js");
  const nextConfig = await configForPhase(PHASE_PRODUCTION_BUILD);
  const headers = await nextConfig.headers();
  const global = headers.find((entry: { source: string }) => entry.source === "/:path*");
  assert.ok(global, "Expected headers for every path, including API routes");
  const globalHeaders = new Map(global.headers.map((item: { key: string; value: string }) => [item.key, item.value]));
  assert.equal(globalHeaders.get("X-Content-Type-Options"), "nosniff");
  assert.equal(globalHeaders.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  const frames = headers.find((entry: { source: string }) => entry.source.startsWith("/((?!api/"));
  assert.ok(frames, "Expected clickjacking protection for the editor UI");
  assert.ok(frames.headers.some((item: { key: string; value: string }) =>
    item.key === "Content-Security-Policy" && item.value.includes("frame-ancestors 'self'")));
});
