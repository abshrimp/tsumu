import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { generateProject } from "../lib/generator";
import { prepareExportProject, type ExportFormat } from "../lib/export-formats";
import { addPwaRetirementWorker } from "../lib/publish-pwa";
import { parseGeneratedManifest, planPublish, serializeGeneratedManifest } from "../lib/publish-files";
import type { SiteDoc } from "../lib/types";

const doc: SiteDoc = {
  siteName: "PWA lifecycle", nodes: {}, assets: {}, pageOrder: ["home"],
  pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
};
const enabled = generateProject({ ...doc, pwa: { enabled: true } }).files;
const manifest = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([path, content]) => [
  path, createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0${content}`).digest("hex"),
]));
const owned = manifest(enabled);
function prepare(pwa: SiteDoc["pwa"], generated: Record<string, string> | null = owned) {
  const target = { ...doc, pwa };
  const { files } = generateProject(target);
  const outputPaths = Object.keys(files);
  addPwaRetirementWorker(target, generated, files, outputPaths);
  return { files, outputPaths };
}

test("fresh non-PWA and ZIP generation never emits retirement or registration code", () => {
  for (const pwa of [undefined, { enabled: false }]) {
    const { files } = generateProject({ ...doc, pwa });
    for (const path of ["public/sw.js", "public/pwa.js", "app/manifest.ts"]) assert.equal(files[path], undefined);
    assert.doesNotMatch(files["app/layout.tsx"], /pwa\.js/);
    assert.ok(!Object.values(files).some(text => /serviceWorker|unregister\(/.test(text)));
  }
});

test("PWA-off publication retires only a worker owned by the destination manifest, including absent pwa settings", () => {
  for (const pwa of [undefined, { enabled: false }]) {
    const { files, outputPaths } = prepare(pwa);
    assert.match(files["public/sw.js"], /registration\.unregister\(\)/);
    assert.equal(outputPaths.filter(path => path === "public/sw.js").length, 1);
    for (const path of ["public/pwa.js", "app/manifest.ts"]) assert.equal(files[path], undefined);
    assert.doesNotMatch(files["app/layout.tsx"], /pwa\.js/);
    const plan = planPublish({ ...owned, "manual.txt": "manual" }, owned, outputPaths);
    assert.deepEqual(plan, { edited: [], clashing: [], kept: { "manual.txt": "manual" } });
  }
});

test("path alone, explicit false, and inherited manifest properties cannot establish ownership", () => {
  // オンからオフにした未公開の文書や、別の公開先へのコピーにも、同じ条件を適用する。
  for (const pwa of [undefined, { enabled: false }]) {
    for (const generated of [null, {}, { "public/pwa.js": "registered-elsewhere" }, Object.create({ "public/sw.js": "inherited" })]) {
      const { files, outputPaths } = prepare(pwa, generated);
      assert.equal(files["public/sw.js"], undefined);
      assert.ok(!outputPaths.includes("public/sw.js"));
      const plan = planPublish({ "public/sw.js": "manual" }, generated, outputPaths);
      assert.deepEqual(plan, { edited: [], clashing: [], kept: { "public/sw.js": "manual" } });
    }
  }
});

test("the serialized generated manifest retains the endpoint across repeated off publications", () => {
  const first = prepare({ enabled: false });
  const next = parseGeneratedManifest(serializeGeneratedManifest(manifest(first.files)))!;
  assert.ok(Object.hasOwn(next, "public/sw.js"));
  const repeated = prepare(undefined, next);
  assert.equal(repeated.files["public/sw.js"], first.files["public/sw.js"]);
  assert.deepEqual(planPublish(next, next, repeated.outputPaths), { edited: [], clashing: [], kept: {} });
  // 公開先でファイルが欠けても、所有の情報が残っていれば、終了用の配信を復元できる。
  assert.ok(repeated.outputPaths.includes("public/sw.js"));
});

test("a manually edited generated worker still requires overwrite confirmation in the plan", () => {
  const { outputPaths } = prepare({ enabled: false });
  const plan = planPublish({ ...owned, "public/sw.js": "manual-edit" }, owned, outputPaths);
  assert.deepEqual(plan.edited, ["public/sw.js"]);
  assert.deepEqual(plan.clashing, []);
  assert.equal(plan.kept["public/sw.js"], undefined);
});

test("reenabling replaces the retirement worker with the unchanged generated PWA and registration", () => {
  const retired = prepare({ enabled: false });
  const reenabled = prepare({ enabled: true }, manifest(retired.files));
  for (const path of ["public/sw.js", "public/pwa.js", "app/manifest.ts"]) assert.equal(reenabled.files[path], enabled[path]);
  assert.equal(reenabled.outputPaths.filter(path => path === "public/sw.js").length, 1);
});

for (const cacheResult of ["present", "absent", "failure"] as const) {
  test(`retirement waits for install, unregisters itself after cache ${cacheResult}, and leaves other caches alone`, async () => {
    const storage = new Set(["customer-cache", "site-pwa-unrelated", ...(cacheResult === "absent" ? [] : ["site-pwa-v2"])]);
    const calls: string[] = [];
    type Handler = (event: { waitUntil: (value: Promise<unknown>) => void }) => void;
    const handlers = new Map<string, Handler>();
    let skip!: () => void;
    const skipped = new Promise<void>(resolve => { skip = resolve; });
    runInNewContext(prepare({ enabled: false }).files["public/sw.js"], {
      self: {
        addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
        skipWaiting: () => { calls.push("skipWaiting"); return skipped; },
        registration: { unregister: async () => { calls.push("unregister"); return true; } },
      },
      caches: { delete: async (name: string) => {
        calls.push(`delete:${name}`);
        if (cacheResult === "failure") throw new Error("Cache deletion failed");
        return storage.delete(name);
      } },
    });
    assert.deepEqual([...handlers.keys()], ["install", "activate"], "retirement never intercepts fetches");
    let installation: Promise<unknown> | undefined;
    handlers.get("install")!({ waitUntil: value => { installation = value; } });
    assert.equal(installation, skipped);
    skip(); await installation;
    let activation: Promise<unknown> | undefined;
    handlers.get("activate")!({ waitUntil: value => { activation = value; } });
    assert.ok(activation);
    await activation;
    assert.deepEqual(calls, ["skipWaiting", "delete:site-pwa-v2", "unregister"]);
    assert.deepEqual([...storage], ["customer-cache", "site-pwa-unrelated", ...(cacheResult === "failure" ? ["site-pwa-v2"] : [])]);
  });
}


const workerPaths: Record<ExportFormat, string> = {
  nextjs: "public/sw.js", react: "public/sw.js", vue: "public/sw.js", nuxt: "public/sw.js",
  sveltekit: "static/sw.js", html: "sw.js", "single-html": "sw.js",
};

// 実際の書き出しの結果を使い、変換元と変換先ごとの配信の場所と所有の情報を確かめる。
for (const previous of Object.keys(workerPaths).filter(format => format !== "single-html") as ExportFormat[]) {
  test(`${previous} PWA retirement uses the destination's served worker path across export formats`, async () => {
    const source = await prepareExportProject({ ...doc, pwa: { enabled: true } }, previous);
    const generated = manifest(source.files);
    assert.ok(Object.hasOwn(generated, workerPaths[previous]));
    for (const format of Object.keys(workerPaths) as ExportFormat[]) {
      const target = { ...doc, pwa: { enabled: false } };
      const output = await prepareExportProject(target, format);
      const paths = Object.keys(output.files);
      const expected = workerPaths[format];
      addPwaRetirementWorker(target, generated, output.files, paths, format);
      assert.match(output.files[expected] ?? "", /registration\.unregister\(\)/, format);
      assert.deepEqual(paths.filter(path => /^(?:public\/|static\/)?sw\.js$/.test(path)), [expected]);
      const next = parseGeneratedManifest(serializeGeneratedManifest(manifest(output.files)))!;
      const repeated = await prepareExportProject(target, format);
      addPwaRetirementWorker(target, next, repeated.files, Object.keys(repeated.files), format);
      assert.equal(repeated.files[expected], output.files[expected], "keep retiring late visitors after repeated publishes");
    }
  });
}

test("single HTML retires an installed PWA even while the document's PWA setting stays enabled", async () => {
  const target = { ...doc, pwa: { enabled: true } };
  const output = await prepareExportProject(target, "single-html");
  assert.deepEqual(Object.keys(output.files), ["index.html"]);
  assert.doesNotMatch(output.files["index.html"], /serviceWorker\.register/);
  const paths = Object.keys(output.files);
  addPwaRetirementWorker(target, owned, output.files, paths, "single-html");
  assert.match(output.files["sw.js"] ?? "", /registration\.unregister\(\)/);
  assert.equal(output.files["public/sw.js"], undefined);
  assert.deepEqual(paths, ["index.html", "sw.js"]);
});

test("SvelteKit path names do not establish ownership or replace a newly enabled worker", async () => {
  for (const generated of [null, {}, Object.create({ "static/sw.js": "inherited" })]) {
    const files: Record<string, string> = {};
    const paths: string[] = [];
    addPwaRetirementWorker(doc, generated, files, paths, "sveltekit");
    assert.deepEqual(files, {});
    assert.deepEqual(paths, []);
  }
  for (const format of Object.keys(workerPaths).filter(format => format !== "single-html") as ExportFormat[]) {
    const target = { ...doc, pwa: { enabled: true } };
    const output = await prepareExportProject(target, format);
    const before = { ...output.files };
    addPwaRetirementWorker(target, { "static/sw.js": "retired" }, output.files, Object.keys(output.files), format);
    assert.deepEqual(output.files, before, format);
  }
});
