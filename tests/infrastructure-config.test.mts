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

test("Cloudflare builds receive hosted public settings from Wrangler vars", async () => {
  const { parseJsonc, publicBuildEnvironment } = await import("../scripts/cloudflare.mjs");
  const config = parseJsonc(read("wrangler.jsonc"));
  const value = config.vars.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN;
  assert.equal(value, "https://tsumu.ebii.net");
  assert.equal(publicBuildEnvironment(config, {}).NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN, value);
  assert.equal(publicBuildEnvironment(config, {
    NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN: "https://custom.example.test",
  }).NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN, "https://custom.example.test");
});

test("Next.js editor routes apply the baseline response security headers", async (t) => {
  const priorHosted = process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN;
  const priorRelay = process.env.NEXT_PUBLIC_TSUMU_MCP_URL;
  process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN = "https://studio.example.test";
  process.env.NEXT_PUBLIC_TSUMU_MCP_URL = "https://relay.example.test";
  t.after(() => {
    if (priorHosted === undefined) delete process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN;
    else process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN = priorHosted;
    if (priorRelay === undefined) delete process.env.NEXT_PUBLIC_TSUMU_MCP_URL;
    else process.env.NEXT_PUBLIC_TSUMU_MCP_URL = priorRelay;
  });
  const { default: configForPhase } = await import("../next.config.mjs");
  const { PHASE_PRODUCTION_BUILD } = await import("next/constants.js");
  const nextConfig = await configForPhase(PHASE_PRODUCTION_BUILD);
  const { unstable_getResponseFromNextConfig } = await import("next/experimental/testing/server.js");
  async function headersFor(host: string, path: string) {
    return (await unstable_getResponseFromNextConfig({ url: `https://${host}${path}`, nextConfig })).headers;
  }

  for (const suffix of ["", "/"]) {
    const directory = "/mcp/sites-bridge" + suffix;
    const hosted = await headersFor("studio.example.test", directory);
    assert.equal(hosted.get("Content-Security-Policy"), "frame-ancestors https://relay.example.test");
    assert.equal(hosted.get("X-Frame-Options"), null);
    assert.equal(hosted.get("Referrer-Policy"), "no-referrer");
    assert.equal(hosted.get("Cache-Control"), "private, no-store");

    for (const host of ["editor.example.org", "studio-example.test"]) {
      const selfHosted = await headersFor(host, directory);
      assert.equal(selfHosted.get("X-Frame-Options"), "DENY", host);
      assert.equal(selfHosted.get("Content-Security-Policy"), "frame-ancestors 'none'", host);
      assert.equal(selfHosted.get("Cache-Control"), "private, no-store", host);
    }

    const asset = await headersFor("studio.example.test", "/api/assets/file" + suffix);
    assert.equal(asset.get("X-Frame-Options"), null);
    assert.equal(asset.get("Content-Security-Policy"), null);
    assert.equal(asset.get("X-Content-Type-Options"), "nosniff");
  }

  for (const path of ["/", "/mcp/choose", "/mcp/sites-bridge-extra", "/mcp/sites-bridge/child",
    "/api/assets/file-info", "/api/assets/file/child"]) {
    const headers = await headersFor("studio.example.test", path);
    assert.equal(headers.get("X-Content-Type-Options"), "nosniff", path);
    assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin", path);
    assert.equal(headers.get("X-Frame-Options"), "DENY", path);
    assert.equal(headers.get("Content-Security-Policy"), "frame-ancestors 'none'", path);
  }
  delete process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN;
  const disabled = await headersFor("studio.example.test", "/mcp/sites-bridge");
  assert.equal(disabled.get("X-Frame-Options"), "DENY");
  assert.equal(disabled.get("Content-Security-Policy"), "frame-ancestors 'none'");
  process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN = "https://studio.example.test";
  const spoof = await headersFor("studio.example.test.evil.example", "/mcp/sites-bridge");
  assert.equal(spoof.get("X-Frame-Options"), "DENY");
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
