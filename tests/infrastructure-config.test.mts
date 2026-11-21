import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("all CI jobs use full commit-pinned actions and checkouts do not persist credentials", () => {
  const workflow = readdirSync(new URL(".github/workflows/", root))
    .filter(name => /\.ya?ml$/.test(name))
    .map(name => read(`.github/workflows/${name}`))
    .join("\n");
  const uses = [...workflow.matchAll(/^\s*(?:- )?uses: ([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0, "Expected GitHub actions in the CI workflow");
  for (const action of uses) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `Action ${action} must be pinned by commit SHA`);
  }
  const checkoutCount = (workflow.match(/^\s*(?:- )?uses: actions\/checkout@/gm) ?? []).length;
  const safeCheckouts = [...workflow.matchAll(
    /^\s*(?:- )?uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n[ \t]+with:\n[ \t]+persist-credentials: false/gm,
  )];
  assert.ok(checkoutCount > 0, "Expected at least one checkout step");
  assert.equal(safeCheckouts.length, checkoutCount, "Every checkout must disable credential persistence");
});

test("CI checks pull requests without path skips, dependencies, workers and all E2E shards", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.match(workflow, /^  push:\s*$/m);
  for (const name of ["check", "e2e-shard", "generated-formats"]) {
    assert.match(workflow, new RegExp(`^  ${name}:$`, "m"));
  }
  const requiredCheck = workflow.split("  check:\n")[1]?.split("  e2e-build:\n")[0];
  assert.ok(requiredCheck, "Expected a check job containing the required infrastructure audits");
  assert.match(requiredCheck, /TSUMU_DOCKER_TESTS: "1"/);
  assert.match(requiredCheck, /npm audit --audit-level=high/);
  assert.match(requiredCheck, /npm run build:worker/);
  assert.ok(requiredCheck.includes("docker build --tag tsumu:ci ."));
  assert.ok(requiredCheck.includes("docker run --detach --name tsumu-ci"));
  assert.ok(requiredCheck.includes("docker exec tsumu-ci id -u"));
  assert.ok(requiredCheck.includes('dpkg --compare-versions "$zlib_version" ge "1:1.3.dfsg+really1.3.1-1+deb13u1"'));
  assert.ok(requiredCheck.includes("http://127.0.0.1:3188/robots.txt"));
  assert.match(workflow, /shard: \[1, 2, 3, 4\]/);
  assert.match(workflow, /framework: \[nextjs, react, vue, nuxt, sveltekit\]/);
  assert.match(workflow, /node scripts\/run-e2e-shard\.mjs/);
  const browserImages = workflow.match(/^      image: mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble$/gm) ?? [];
  assert.equal(browserImages.length, 2, "E2E shards and generated-format checks must use preinstalled browser images");
  const shardRunner = read("scripts/run-e2e-shard.mjs");
  assert.doesNotMatch(shardRunner, /\bnpx\b/);
  assert.match(shardRunner, /resolve\("@playwright\/test\/cli"\)/);
  assert.match(read("playwright.config.ts"), /npx --no-install next start/);
});

function ciJob(workflow: string, name: string): string {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  assert.notEqual(start, -1, `Expected CI job: ${name}`);
  return workflow.slice(start + header.length).split(/^  [\w-]+:\s*$/m)[0];
}

test("CI runs the browser discovery regression and shares one production build across locked Playwright shards", () => {
  const workflow = read(".github/workflows/ci.yml");
  const producer = ciJob(workflow, "e2e-build");
  const shards = ciJob(workflow, "e2e-shard");
  assert.match(producer, /^      - run: npm run build$/m);
  assert.match(producer, /^      - run: node --import tsx --test e2e\/browser-projects\.check\.mts\n        env:\n          E2E_DISCOVERY_OUTPUT: e2e-discovery\.json$/m);
  assert.match(shards, /^          E2E_DISCOVERY_INPUT: e2e-discovery\.json$/m);
  assert.match(producer, /tar --exclude=\.next\/cache -cf e2e-build\.tar \.next e2e-discovery\.json/);
  assert.match(producer, /actions\/upload-artifact@[^\n]+\n +with:\n +name: e2e-build\n +path: e2e-build\.tar/);
  assert.match(shards, /^    needs: e2e-build$/m);
  assert.match(shards, /actions\/download-artifact@[^\n]+\n +with:\n +name: e2e-build/);
  assert.match(shards, /tar -xf e2e-build\.tar/);
  assert.doesNotMatch(shards, /^      - run: npm run build$/m);

  const lock = JSON.parse(read("package-lock.json"));
  const version = lock.packages["node_modules/@playwright/test"].version as string;
  const image = "mcr.microsoft.com/playwright:v" + version + "-noble";
  for (const name of ["e2e-shard", "generated-formats"]) {
    const source = ciJob(workflow, name);
    assert.ok(source.includes("image: " + image), name + " must use matching browser executables");
    assert.match(source, /^      options: --user 1001$/m);
    assert.doesNotMatch(source, /playwright install(?: --with-deps)?/, "Image already includes all three engines and system dependencies");
    assert.match(source, /^      - run: npm ci$/m);
  }
  assert.match(shards, /node scripts\/run-e2e-shard\.mjs/);
  assert.match(ciJob(workflow, "generated-formats"), /scripts\/check-generated-browser\.mts/);
});

test("Docker runtime is non-root and local credentials are excluded from the build context", () => {
  const dockerfile = read("Dockerfile");
  const ignored = read(".dockerignore").split(/\r?\n/).map((line) => line.trim());
  const imageRefs = [...dockerfile.matchAll(/^FROM node:([^@\s]+)@sha256:([0-9a-f]{64})(?: AS [a-z0-9-]+)?$/gm)];
  assert.equal(imageRefs.length, 2, "Both Docker stages must use immutable image digests");
  const minimumNodeVersion = read(".nvmrc").trim();
  const imageVersion = imageRefs[0][1].replace(/-slim$/, "");
  assert.match(imageRefs[0][1], /^\d+\.\d+\.\d+-slim$/, "Docker must use an exact Node.js slim release");
  const minParts = minimumNodeVersion.split(".").map(Number);
  const imageParts = imageVersion.split(".").map(Number);
  assert.equal(imageParts[0], minParts[0], "Docker and .nvmrc must use the same Node.js major version");
  assert.ok(imageParts[1] > minParts[1] || (imageParts[1] === minParts[1] && imageParts[2] >= minParts[2]),
    "Docker must not use a Node.js version older than .nvmrc");
  assert.equal(imageRefs[0][1], imageRefs[1][1]);
  assert.equal(imageRefs[0][2], imageRefs[1][2]);
  assert.match(dockerfile, /^COPY --from=build --chown=node:node \/app\/\.next\/standalone \.\/$/m);
  assert.match(dockerfile, /^COPY --from=build --chown=node:node \/app\/\.next\/static \.\/\.next\/static$/m);
  assert.match(dockerfile, /^COPY --from=build --chown=node:node \/app\/public \.\/public$/m);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends --only-upgrade zlib1g/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^VOLUME \/data$/m);
  assert.match(dockerfile, /chown node:node \/data/);
  for (const path of [".env*", ".dev.vars*", ".npmrc", "wrangler.local.jsonc",
    "wrangler.generated.jsonc", "wrangler.preview.generated.jsonc", ".generated-export-smoke/",
    "**/.env*", "**/.dev.vars*", "**/.npmrc", "**/wrangler.local.jsonc",
    "**/wrangler.generated.jsonc", "**/wrangler.preview.generated.jsonc"]) {
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
    item.key === "X-Frame-Options" && item.value === "DENY"));
  assert.ok(frames.headers.some((item: { key: string; value: string }) =>
    item.key === "Content-Security-Policy" && item.value.includes("frame-ancestors 'none'")));
  // Exactly one inert, read-only listing page may be embedded by the official MCP host.
  assert.ok(frames.source.includes("mcp/sites-bridge"));
  const directory = headers.find((entry: { source: string; has?: Array<{ type: string; value: string }> }) =>
    entry.source === "/mcp/sites-bridge" && entry.has?.some(item =>
      item.type === "host" && item.value === "tsumu.ebii.net"));
  assert.ok(directory, "The hosted directory frame exception must match the exact official host");
  assert.ok(directory.headers.some((item: { key: string; value: string }) =>
    item.key === "Content-Security-Policy" && item.value === "frame-ancestors https://mcp.tsumu.ebii.net"));
  assert.ok(directory.headers.every((item: { key: string }) => item.key !== "X-Frame-Options"));

  const selfHosted = headers.find((entry: { source: string; missing?: Array<{ type: string; value: string }> }) =>
    entry.source === "/mcp/sites-bridge" && entry.missing?.some(item =>
      item.type === "host" && item.value === "tsumu.ebii.net"));
  assert.ok(selfHosted, "Every non-official host must retain clickjacking protection");
  assert.ok(selfHosted.headers.some((item: { key: string; value: string }) =>
    item.key === "X-Frame-Options" && item.value === "DENY"));
  assert.ok(selfHosted.headers.some((item: { key: string; value: string }) =>
    item.key === "Content-Security-Policy" && item.value === "frame-ancestors 'none'"));
  for (const page of ["app/mcp/choose/page.tsx", "app/mcp/sites-bridge/page.tsx"]) {
    const source = read(page);
    assert.match(source, /if \(!isOfficialEditorHost\(\(await headers\(\)\)\.get\("host"\)\)\) notFound\(\)/,
      `${page} must return 404 before serving hosted-only MCP UI on self-hosted sites`);
  }

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
      installScriptPackages.push(name);
    }
  }
  const allowed = Object.entries(pkg.allowScripts as Record<string, boolean>)
    .filter(([, enabled]) => enabled).map(([name]) => name).sort();
  assert.deepEqual(allowed, installScriptPackages.sort(),
    "npm install-script allowlist must cover exactly the packages with install scripts");
});
