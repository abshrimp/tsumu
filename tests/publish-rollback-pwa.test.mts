import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { prepareExportProject, type ExportFormat } from "../lib/export-formats";
import { advanceBranchRef } from "../lib/github";
import * as files from "../lib/publish-files";
import * as pwa from "../lib/publish-pwa";
import * as preconditions from "../lib/publish-preconditions";
import { hasPublishCredentials } from "../lib/publish-security";
import type { SiteDoc } from "../lib/types";

const doc: SiteDoc = {
  siteName: "Rollback PWA", nodes: {}, assets: {}, pageOrder: ["home"],
  pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
};
const workerPath = (format: ExportFormat) => format === "sveltekit" ? "static/sw.js"
  : format === "html" || format === "single-html" ? "sw.js" : "public/sw.js";
const gitBlobSha = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex");
const generatedManifest = (output: Record<string, string>) => files.serializeGeneratedManifest(
  Object.fromEntries(Object.entries(output).map(([path, text]) => [path, gitBlobSha(text)])),
);

// 生成したプロジェクトを Git オブジェクトとして保持し、実際の API ハンドラーだけを呼ぶ。
// 再帰ツリー・部分ツリーの置換・一度だけの先端更新も外部通信なしで検査する。
async function fixture(format: ExportFormat, options: {
  currentFormat?: ExportFormat; target?: "production" | "test"; sourcePwa?: boolean;
  noSourceManifest?: boolean; noSourceDoc?: boolean; currentOwned?: boolean; currentWorkerMissing?: boolean;
  manual?: files.TreeEntry[]; sourceManual?: files.TreeEntry[]; failTree?: number; concurrentRef?: boolean;
} = {}) {
  const target = options.target ?? "production";
  const branch = target === "test" ? "preview" : "main";
  const expected = { site: "site", target, repo: "owner/site", branch, productionBranch: "main" };
  const blobStore = new Map<string, string>();
  const treeStore = new Map<string, files.TreeEntry[]>();
  const commits = new Map<string, { tree: { sha: string }; parents: string[]; message: string }>();
  const sha = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex");
  const blob = (path: string, content: string, mode = "100644"): files.TreeEntry => {
    const id = gitBlobSha(content);
    blobStore.set(id, content);
    return { path, mode, type: "blob", sha: id };
  };
  const saveTree = (leaves: files.TreeEntry[]) => {
    assert.equal(files.conflictingCommitPaths(leaves.map(entry => entry.path)), null);
    const sorted = [...leaves].sort((a, b) => a.path.localeCompare(b.path));
    const id = sha(sorted);
    treeStore.set(id, sorted);
    return id;
  };
  const recursiveTree = (id: string): files.TreeEntry[] => {
    const leaves = treeStore.get(id)!;
    assert.ok(leaves, `known tree ${id}`);
    const directories = new Set(leaves.flatMap(entry => {
      const parts = entry.path.split("/");
      return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
    }));
    return [...leaves, ...[...directories].map(path => ({
      path, mode: "040000", type: "tree", sha: saveTree(leaves.filter(entry =>
        entry.path.startsWith(path + "/")).map(entry => ({ ...entry, path: entry.path.slice(path.length + 1) }))),
    }))];
  };
  const commit = (tree: string, parents: string[] = []) => {
    const value = { tree: { sha: tree }, parents, message: "Publish" };
    const id = sha(value); commits.set(id, value); return id;
  };
  const sourceDoc = { ...doc, pwa: { enabled: options.sourcePwa ?? false } };
  const sourceOutput = (await prepareExportProject(sourceDoc, format)).files;
  if (!options.noSourceDoc) sourceOutput[files.DOC_PATH] = JSON.stringify(sourceDoc);
  const sourceEntries = Object.entries(sourceOutput).map(([path, content]) => blob(path, content));
  if (!options.noSourceManifest) sourceEntries.push(blob(files.GENERATED_MANIFEST_PATH, generatedManifest(sourceOutput)));
  sourceEntries.push(blob(".github/workflows/ci.yml", "historical workflow"), ...(options.sourceManual ?? []));
  const source = commit(saveTree(sourceEntries));
  const currentFormat = options.currentFormat ?? "nextjs";
  const currentDoc = { ...doc, pwa: { enabled: true } };
  const currentOutput = (await prepareExportProject(currentDoc, currentFormat)).files;
  currentOutput[files.DOC_PATH] = JSON.stringify(currentDoc);
  const currentEntries = Object.entries(currentOutput).map(([path, content]) => blob(path, content));
  const currentOwnership = { ...currentOutput };
  if (options.currentOwned === false) delete currentOwnership[workerPath(currentFormat)];
  const manual = [blob("notes/manual.sh", "keep executable", "100755"),
    blob(".github/workflows/ci.yml", "current workflow"), ...(options.manual ?? [])];
  for (const entry of manual) delete currentOwnership[entry.path];
  let head = commit(saveTree([
    ...currentEntries.filter(entry => !manual.some(item => item.path === entry.path) &&
      !(options.currentWorkerMissing && entry.path === workerPath(currentFormat))),
    ...manual, blob(files.GENERATED_MANIFEST_PATH, generatedManifest(currentOwnership)),
  ]), [source]);
  const initial = head;
  const writes: { path: string; body: any }[] = [];
  let recorded = 0, treeCount = 0;
  const gh = async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (body) writes.push({ path, body });
    if (path === `/git/ref/heads/${branch}`) return Response.json({ object: { sha: head } });
    if (path.startsWith(`/compare/${source}...`)) return Response.json({ merge_base_commit: { sha: source } });
    if (path.startsWith("/git/commits/")) return Response.json(commits.get(path.slice(13)));
    if (path.startsWith("/git/trees/")) {
      const id = path.slice(11).split("?")[0];
      return Response.json({ tree: recursiveTree(commits.get(id)?.tree.sha ?? id) });
    }
    if (path.startsWith("/git/blobs/")) {
      const content = blobStore.get(path.slice(11)); assert.notEqual(content, undefined);
      return Response.json({ content: Buffer.from(content!).toString("base64"), encoding: "base64" });
    }
    if (path === "/git/trees") {
      if (++treeCount === options.failTree) return Response.json({}, { status: 503 });
      assert.equal(files.conflictingCommitPaths(body.tree.map((entry: files.TreeEntry) => entry.path)), null);
      const result = new Map((treeStore.get(body.base_tree) ?? []).map(entry => [entry.path, entry]));
      for (const edit of body.tree) {
        const present = [...result.keys()].filter(path => path === edit.path || path.startsWith(edit.path + "/"));
        if (edit.sha === null) assert.ok(present.length, "delete only an existing path");
        for (const path of present) result.delete(path);
        if (edit.sha === null) continue;
        const additions = edit.type === "tree" ? treeStore.get(edit.sha)!.map(entry => ({ ...entry, path: edit.path + "/" + entry.path }))
          : [edit.content !== undefined ? blob(edit.path, edit.content, edit.mode) : edit];
        for (const entry of additions) result.set(entry.path, entry);
      }
      return Response.json({ sha: saveTree([...result.values()]) });
    }
    if (path === "/git/commits") return Response.json({ sha: commit(body.tree, body.parents) });
    if (path === `/git/refs/heads/${branch}`) {
      assert.equal(body.force, false);
      assert.deepEqual(commits.get(body.sha)!.parents, [head]);
      if (options.concurrentRef) {
        head = commit(commits.get(head)!.tree.sha, [head]); return Response.json({}, { status: 422 });
      }
      head = body.sha; return Response.json({});
    }
    throw new Error(`Unexpected GitHub operation: ${path}`);
  };
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); }
  }
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse }, "lib/i18n-server": { serverTr: async () => (text: string) => text },
    "lib/server": { requireAuth: async () => null, recordPublish: async () => { recorded++; } },
    "lib/site-server": { siteIdOf: async () => "site", siteDestOf: async () => ({}) },
    "lib/github": { advanceBranchRef, branchPath: (value: string) => value, configError: () => null,
      targetConfig: (_: unknown, t: string) => ({ repo: expected.repo, branch: t === "test" ? "preview" : "main", token: "fake" }),
      githubClient: () => ({ gh, head: async () => head, fail: async () => { throw new Error("Mock GitHub failure"); } }),
    },
    "lib/publish-files": files, "lib/publish-pwa": pwa, "lib/publish-preconditions": preconditions,
    "lib/publish-security": { hasPublishCredentials }, "lib/kv": {}, "lib/errors": { userMessage: (e: Error) => e.message },
  };
  function load(path: string) {
    const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", code)((name: string) => {
      const key = name.replace(/^(\.\.\/)+/, ""); assert.ok(Object.hasOwn(mocks, key), name); return mocks[key];
    }, module, module.exports);
    return module.exports.POST as (req: Request) => Promise<Response>;
  }
  const rollback = load("../app/api/publish/history/route.ts"), publish = load("../app/api/publish/route.ts");
  const entries = () => treeStore.get(commits.get(head)!.tree.sha)!;
  const content = (path: string) => blobStore.get(entries().find(entry => entry.path === path)?.sha ?? "");
  const send = (body: object, history = false) => (history ? rollback : publish)(new Request("https://example.test", {
    method: "POST", body: JSON.stringify({ site: "site", target, expected, expectedHead: head, ...body }),
  }));
  return { source, initial, sourceOutput, currentOutput, manual, writes, content, entries, send,
    get head() { return head; }, get recorded() { return recorded; },
  };
}

test("rollback to a generated pre-PWA revision leaves a retirement endpoint and ownership", async () => {
  const f = await fixture("nextjs");
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 200, await response.text());
  assert.match(f.content("public/sw.js") ?? "", /registration\.unregister\(\)/);
  const generated = files.parseGeneratedManifest(f.content(files.GENERATED_MANIFEST_PATH)!)!;
  assert.equal(generated["public/sw.js"], gitBlobSha(f.content("public/sw.js")!));
});


for (const target of ["production", "test"] as const) {
  for (const currentFormat of ["nextjs", "html", "sveltekit"] as const) {
    test(`${target}: rollback retires ${currentFormat} workers across all restored export formats`, async () => {
      for (const format of ["nextjs", "react", "vue", "nuxt", "sveltekit", "html", "single-html"] as const) {
        const f = await fixture(format, { currentFormat, target, sourcePwa: format === "single-html" });
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await f.send({ sha: f.source }, true);
          assert.equal(response.status, 200, await response.text());
          const path = workerPath(format);
          assert.equal(f.content(path), pwa.PWA_RETIREMENT_WORKER, `${currentFormat} -> ${format}`);
          const ownership = files.parseGeneratedManifest(f.content(files.GENERATED_MANIFEST_PATH)!)!;
          assert.equal(ownership[path], gitBlobSha(f.content(path)!));
          for (const manual of f.manual) assert.deepEqual(f.entries().find(entry => entry.path === manual.path), manual);
          for (const [path, content] of Object.entries(f.sourceOutput)) assert.equal(f.content(path), content, path);
        }
        assert.equal(f.writes.filter(write => write.path === `/git/refs/heads/${target === "test" ? "preview" : "main"}`).length, 2);
        const snapshot = await (await f.send({ action: "tree" })).json();
        const output = (await prepareExportProject({ ...doc, pwa: { enabled: false } }, format)).files;
        pwa.addPwaRetirementWorker(doc, snapshot.generated, output, Object.keys(output), format);
        output[files.GENERATED_MANIFEST_PATH] = generatedManifest(output);
        const publish = await f.send({ action: "commit", files: output });
        assert.equal(publish.status, 200, await publish.text());
        assert.equal(f.content(workerPath(format)), pwa.PWA_RETIREMENT_WORKER);
        for (const manual of f.manual) assert.deepEqual(f.entries().find(entry => entry.path === manual.path), manual);
      }
    });
  }
}

test("the generated active worker can serve later cached HTML offline until the rollback retirement runs", async () => {
  const f = await fixture("html", { currentFormat: "html" });
  const handlers = new Map<string, (event: any) => void>();
  const cachedHtml = f.currentOutput["index.html"];
  runInNewContext(f.currentOutput["sw.js"], {
    self: { addEventListener: (event: string, handler: (event: any) => void) => handlers.set(event, handler), location: { origin: "https://site.test" } },
    URL, Response,
    fetch: async () => { throw new Error("offline"); },
    caches: { open: async () => ({ match: async () => new Response(cachedHtml) }) },
  });
  let offline: Promise<Response> | undefined;
  handlers.get("fetch")!({ request: new Request("https://site.test/"), respondWith: (value: Promise<Response>) => { offline = value; } });
  assert.equal(await (await offline!).text(), cachedHtml);
  assert.match(cachedHtml, /pwa\.js/);
  assert.doesNotMatch(f.sourceOutput["index.html"], /pwa\.js/);
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 200, await response.text());
  handlers.clear();
  const storage = new Set(["site-pwa-v2", "customer-cache"]);
  const calls: string[] = [];
  runInNewContext(f.content("sw.js")!, {
    self: {
      addEventListener: (event: string, handler: (event: any) => void) => handlers.set(event, handler),
      skipWaiting: async () => { calls.push("skipWaiting"); },
      registration: { unregister: async () => { calls.push("unregister"); return true; } },
    },
    caches: { delete: async (key: string) => { calls.push(`delete:${key}`); return storage.delete(key); } },
  });
  for (const event of ["install", "activate"]) {
    let pending: Promise<unknown> | undefined;
    handlers.get(event)!({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
    assert.ok(pending); await pending;
  }
  assert.deepEqual(calls, ["skipWaiting", "delete:site-pwa-v2", "unregister"]);
  assert.deepEqual([...storage], ["customer-cache"]);
  assert.equal(handlers.has("fetch"), false, "retirement does not intercept future requests");
});

test("active historical workers and manually owned workers retain their bytes and Git attributes", async () => {
  for (const format of ["nextjs", "html", "sveltekit"] as const) {
    const active = await fixture(format, { sourcePwa: true });
    assert.equal((await active.send({ sha: active.source }, true)).status, 200);
    assert.equal(active.content(workerPath(format)), active.sourceOutput[workerPath(format)]);
    assert.doesNotMatch(active.content(workerPath(format))!, /registration\.unregister/);
    for (const [mode, type] of [["100755", "blob"], ["120000", "blob"], ["160000", "commit"]]) {
      const manual = { path: workerPath(format), mode, type, sha: "manual-worker" };
      const f = await fixture(format, { manual: [manual] });
      assert.equal((await f.send({ sha: f.source }, true)).status, 200);
      assert.deepEqual(f.entries().find(entry => entry.path === manual.path), manual);
      assert.equal(Object.hasOwn(files.parseGeneratedManifest(f.content(files.GENERATED_MANIFEST_PATH)!)!, manual.path), false);
    }
  }
  const unowned = await fixture("nextjs", { currentOwned: false });
  assert.equal((await unowned.send({ sha: unowned.source }, true)).status, 200);
  assert.equal(unowned.content("public/sw.js"), unowned.currentOutput["public/sw.js"]);
});

test("retirement handles absent owned workers and legacy source manifests without claiming other legacy files", async () => {
  for (const options of [{ currentWorkerMissing: true }, { noSourceManifest: true }]) {
    const f = await fixture("sveltekit", options);
    assert.equal((await f.send({ sha: f.source }, true)).status, 200);
    assert.equal(f.content("static/sw.js"), pwa.PWA_RETIREMENT_WORKER);
    if (options.noSourceManifest) {
      assert.deepEqual(files.parseGeneratedManifest(f.content(files.GENERATED_MANIFEST_PATH)!), {
        "static/sw.js": gitBlobSha(pwa.PWA_RETIREMENT_WORKER),
      });
    }
  }
});

test("retirement cannot replace a manual ancestor or descendant and failed writes do not advance the branch", async () => {
  for (const path of ["public", "public/sw.js/manual.txt"]) {
    const manual = { path, mode: "120000", type: "blob", sha: "manual" };
    const f = await fixture("nextjs", { currentFormat: "html", manual: [manual] });
    const response = await f.send({ sha: f.source }, true);
    assert.equal(response.status, 409);
    assert.deepEqual(f.writes, []);
    assert.equal(f.head, f.initial);
  }
  const failed = await fixture("nextjs", { failTree: 1 });
  assert.equal((await failed.send({ sha: failed.source }, true)).status, 502);
  assert.equal(failed.head, failed.initial);
  assert.equal(failed.recorded, 0);
  assert.equal(failed.writes.some(write => write.path === "/git/commits" || write.path.startsWith("/git/refs")), false);
  const conflict = await fixture("nextjs", { concurrentRef: true });
  assert.equal((await conflict.send({ sha: conflict.source }, true)).status, 409);
  assert.equal(conflict.recorded, 0);
  assert.equal(conflict.content("public/sw.js"), conflict.currentOutput["public/sw.js"]);
  assert.equal(conflict.writes.filter(write => write.path.startsWith("/git/refs")).length, 1);
});

test("rollback layout detection uses generated files and leaves unknown legacy layouts unchanged", async () => {
  const known = { "index.html": "html" };
  const path = await pwa.rollbackPwaRetirement({ "public/sw.js": "owned" },
    ["index.html", "vite.config.ts"], ["index.html", "vite.config.ts"], known);
  assert.equal(path?.path, "sw.js", "a manually authored Vite config must not change HTML's serving root");
  assert.equal(await pwa.rollbackPwaRetirement({ "public/sw.js": "owned" }, ["manual.txt"], ["manual.txt"], null), null);
});


test("retirement prunes deleted historical manual path conflicts before adding the worker", async () => {
  for (const path of ["public", "public/sw.js/readme"]) {
    const historical = { path, mode: "120000", type: "blob", sha: "old-manual" };
    const f = await fixture("nextjs", { currentFormat: "html", sourceManual: [historical] });
    const response = await f.send({ sha: f.source }, true);
    assert.equal(response.status, 200, await response.text());
    const trees = f.writes.filter(write => write.path === "/git/trees");
    assert.equal(trees.length, 2);
    assert.deepEqual(trees[0].body.tree, [{ ...historical, sha: null }]);
    assert.equal(f.content("public/sw.js"), pwa.PWA_RETIREMENT_WORKER);
    assert.equal(f.entries().some(entry => entry.path === path), false);
    assert.equal(f.writes.filter(write => write.path.startsWith("/git/refs")).length, 1);
  }
  const failed = await fixture("nextjs", { currentFormat: "html", failTree: 2,
    sourceManual: [{ path: "public", mode: "120000", type: "blob", sha: "old-manual" }],
  });
  assert.equal((await failed.send({ sha: failed.source }, true)).status, 502);
  assert.equal(failed.head, failed.initial);
  assert.equal(failed.recorded, 0);
  assert.equal(failed.writes.some(write => write.path === "/git/commits" || write.path.startsWith("/git/refs")), false);
});


for (const target of ["production", "test"] as const) {
  for (const [path, mode, type] of [
    ["_tsumu", "100644", "blob"], ["_tsumu", "100755", "blob"],
    ["_tsumu", "120000", "blob"], ["_tsumu", "160000", "commit"],
    ["_tsumu/generated.json/manual.txt", "100644", "blob"],
  ]) {
    test(`${target}: retirement rejects a legacy ${mode} ${path} manifest conflict before any Git write`, async () => {
      // 所有情報と編集データがまだなかった版では、_tsumu 自体が手動ファイルの場合がある。
      const f = await fixture("nextjs", { target, noSourceManifest: true, noSourceDoc: true,
        sourceManual: [{ path, mode, type, sha: "historical-manual" }],
      });
      const response = await f.send({ sha: f.source }, true);
      assert.equal(response.status, 409, await response.text());
      assert.deepEqual(f.writes, [], "manifest paths must be checked before creating even a detached tree");
      assert.equal(f.head, f.initial);
      assert.equal(f.recorded, 0);
    });
  }
}
