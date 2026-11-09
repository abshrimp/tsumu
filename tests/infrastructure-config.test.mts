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
  for (const name of ["check", "e2e-shard", "generated-formats"]) {
    assert.match(workflow, new RegExp(`^  ${name}:import assert from "node:assert/strict";
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
, "m"));
  }
  const requiredCheck = workflow.split("  check:\n")[1]?.split("  e2e-shard:\n")[0];
  assert.ok(requiredCheck, "Expected a check job containing the required infrastructure audits");
  assert.match(requiredCheck, /npm audit --omit=dev --audit-level=high/);
  assert.match(requiredCheck, /npm audit --audit-level=high/);
  assert.match(requiredCheck, /npm run build:worker/);
  assert.match(workflow, /shard: \[1, 2, 3, 4\]/);
  assert.match(workflow, /framework: \[nextjs, react, vue, nuxt, sveltekit\]/);
  assert.match(workflow, /node scripts\/run-e2e-shard\.mjs/);
});

test("Docker runtime is non-root and local credentials are excluded from the build context", () => {
  const dockerfile = read("Dockerfile");
  const ignored = read(".dockerignore").split(/\r?\n/).map((line) => line.trim());
  const imageRefs = [...dockerfile.matchAll(/^FROM node:([^@\\s]+)@sha256:([0-9a-f]{64})(?: AS [a-z0-9-]+)?$/gm)];
  assert.equal(imageRefs.length, 2, "Both Docker stages must use immutable image digests");
  assert.equal(imageRefs[0][1], read(".nvmrc").trim() + "-slim");
  assert.equal(imageRefs[0][1], imageRefs[1][1]);
  assert.equal(imageRefs[0][2], imageRefs[1][2]);
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

test("the lockfile stays registry-only and install script permissions match resolved versions", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.lockfileVersion, 3);
  for (const field of ["dependencies", "devDependencies"]) {
    assert.deepEqual(lock.packages[""][field], pkg[field], `Lockfile ${field} must match package.json`);
  }
  const installScriptPackages: string[] = [];
  for (const [path, resolved] of Object.entries(lock.packages) as Array<[string, {
    version?: string; resolved?: string; hasInstallScript?: boolean;
  }]>) {
    if (path === "") continue;
    if (resolved.resolved) {
      assert.match(resolved.resolved, /^https:\/\/registry\.npmjs\.org\//,
        `Unreviewed dependency source at ${path}`);
    }
    if (resolved.hasInstallScript) {
      assert.ok(resolved.version, `Script package ${path} must have a pinned version`);
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      installScriptPackages.push(`${name}@${resolved.version}`);
    }
  }
  const allowed = Object.entries(pkg.allowScripts as Record<string, boolean>)
    .filter(([, enabled]) => enabled).map(([name]) => name).sort();
  assert.deepEqual(allowed, installScriptPackages.sort(),
    "npm install-script allowlist must be updated whenever locked script dependencies change");
});
