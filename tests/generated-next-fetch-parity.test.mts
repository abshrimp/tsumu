import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { generateProject } from "../lib/generator";
import { fetchRequestOf } from "../lib/fetch-request";
import { makeBox } from "../lib/presets";
import type { SiteDoc, ScriptStep } from "../lib/types";

const require = createRequire(import.meta.url);
function execute(source: string, dependencies: Record<string, unknown> = {}) {
  const module = { exports: {} as any };
  const compiled = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", compiled)(
    (name: string) => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}

test("the emitted Next page sends the same JSON and headers as the editor, using its emitted vars module", async () => {
  const options: Extract<ScriptStep, { kind: "fetch" }> = {
    id: "fetch", kind: "fetch", as: "result", method: "POST",
    url: "https://example.com/api", headers: [{ name: "content-type", value: "application/vnd.test+json" }],
    body: JSON.stringify({ literal: "\\{name}", value: "{name}", next: "{slug}" }),
  };
  const node = { ...makeBox(), id: "box" };
  const doc: SiteDoc = {
    siteName: "Request parity", assets: {}, nodes: { box: node }, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["box"],
      pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [options] }] } },
  };
  const project = generateProject(doc);
  const sent: Array<{ url: string; init: any }> = [];
  const page = execute(project.files["app/page.tsx"], {
    "@/lib/vars": execute(project.files["lib/vars.ts"]),
    "@/lib/safe-fetch": {
      fetchPublic: async (url: string, init: any) => { sent.push({ url, init }); return { ok: true }; },
      readTextLimited: async () => "{}",
    },
  });
  const vars = { name: 'quotes" and slash\\ and newline\n', slug: "日本" };
  await page.default({ searchParams: Promise.resolve(vars) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, options.url);
  const expected = fetchRequestOf(options, vars)!;
  assert.equal(sent[0].init.method, expected.method);
  assert.deepEqual(sent[0].init.headers, expected.headers);
  assert.equal(sent[0].init.body, expected.body);
  assert.deepEqual(JSON.parse(sent[0].init.body), { literal: "{name}", value: vars.name, next: vars.slug });
});
