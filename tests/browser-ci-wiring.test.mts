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

test("E2E shards install all configured engines without expanding generated-format installs", () => {
  const installed = (name: string) => [...job(name).matchAll(
    /^\s+(?:- )?run: npx --no-install playwright install --with-deps ([^\r\n]+)$/gm,
  )].map((match) => match[1].trim().split(/\s+/).sort());
  assert.deepEqual(installed("e2e-shard"), [["chromium", "firefox", "webkit"]]);
  assert.deepEqual(installed("generated-formats"), [["chromium"]]);
});
