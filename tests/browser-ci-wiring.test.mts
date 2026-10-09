import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
function job(name: string): string {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  assert.notEqual(start, -1, `Expected CI job: ${name}`);
  return workflow.slice(start + header.length).split(/^  [\w-]+:\s*$/m)[0];
}

test("CI runs the browser discovery regression in its required check job", () => {
  assert.match(job("check"),
    /^      - run: node --import tsx --test e2e\/browser-projects\.check\.mts$/m);
});

test("E2E shards all consume the production build from their workflow run", () => {
  const producer = job("e2e-build");
  const shards = job("e2e-shard");
  assert.match(producer, /^      - run: npm run build$/m);
  assert.match(producer, /tar --exclude=\.next\/cache -cf e2e-build\.tar \.next/);
  assert.match(producer, /actions\/upload-artifact@[^\n]+\n +with:\n +name: e2e-build\n +path: e2e-build\.tar/);
  assert.match(shards, /^    needs: e2e-build$/m);
  assert.match(shards, /actions\/download-artifact@[^\n]+\n +with:\n +name: e2e-build/);
  assert.match(shards, /tar -xf e2e-build\.tar/);
  assert.doesNotMatch(shards, /^      - run: npm run build$/m);
});

test("browser jobs use the exact locked Playwright image, with preinstalled engines and dependencies", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const version = lock.packages["node_modules/@playwright/test"].version as string;
  const image = "mcr.microsoft.com/playwright:v" + version + "-noble";
  for (const name of ["e2e-shard", "generated-formats"]) {
    const source = job(name);
    assert.ok(source.includes("image: " + image), name + " must use matching browser executables");
    assert.match(source, /^      options: --user 1001$/m);
    assert.doesNotMatch(source, /playwright install(?: --with-deps)?/, "Image already includes all three engines and system dependencies");
    assert.match(source, /^      - run: npm ci$/m);
  }
  assert.match(job("e2e-shard"), /node scripts\/run-e2e-shard\.mjs/);
  assert.match(job("generated-formats"), /scripts\/check-generated-browser\.mts/);
});
