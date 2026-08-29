import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";
import * as files from "../lib/publish-files";
import * as preconditions from "../lib/publish-preconditions";
import { advanceBranchRef } from "../lib/github";
import { hasPublishCredentials } from "../lib/publish-security";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../lib/api-json";

// Persist Git objects between real rollback, snapshot and publish handlers so
// ownership errors that only delete files on the next publication are visible.
function fixture(target: "production" | "test", manual: files.TreeEntry, historicalSha: string,
  options: { historicalManual?: files.TreeEntry; extraManual?: files.TreeEntry[];
    historicalExtra?: files.TreeEntry[]; historicalGenerated?: Record<string, string>;
    failTreeAt?: number; failCommit?: boolean; ambiguousUpdate?: boolean;
    lateMove?: boolean; noSourceManifest?: boolean } = {}) {
  const { historicalManual } = options;
  const branch = target === "test" ? "preview" : "main";
  const expected = { site: "site", target, repo: "owner/site", branch, productionBranch: "main" };
  const blobs = new Map<string, string>();
  const trees = new Map<string, files.TreeEntry[]>();
  const commits = new Map<string, { tree: { sha: string }; message: string; parents: string[] }>();
  const sha = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex");
  const blob = (path: string, content: string): files.TreeEntry => {
    const id = sha(content);
    blobs.set(id, content);
    return { path, mode: "100644", type: "blob", sha: id };
  };
  const saveTree = (entries: files.TreeEntry[]) => {
    assert.equal(files.conflictingCommitPaths(entries.map(entry => entry.path)), null);
    const id = sha(entries);
    trees.set(id, entries);
    return id;
  };
  // 再帰取得にはディレクトリも含め、保護サブツリーの置き換えも再現する。
  const recursiveTree = (entries: files.TreeEntry[]) => {
    const directories = new Set<string>();
    for (const entry of entries) {
      for (let slash = entry.path.indexOf("/"); slash !== -1; slash = entry.path.indexOf("/", slash + 1)) {
        directories.add(entry.path.slice(0, slash));
      }
    }
    return [...entries, ...[...directories].map(path => ({
      path, mode: "040000", type: "tree",
      sha: saveTree(entries.filter(entry => entry.path.startsWith(`${path}/`))
        .map(entry => ({ ...entry, path: entry.path.slice(path.length + 1) }))),
    }))];
  };
  const saveCommit = (tree: string, parents: string[] = []) => {
    const value = { tree: { sha: tree }, message: "Publish", parents };
    const id = sha(value);
    commits.set(id, value);
    return id;
  };
  const generated = { path: "old-page.html", mode: "100644", type: "blob", sha: "generated-page" };
  const oldManifest = files.serializeGeneratedManifest({
    ...(!historicalManual ? { [manual.path]: historicalSha } : {}), [generated.path]: generated.sha,
    ...options.historicalGenerated,
  });
  const source = saveCommit(saveTree([
    historicalManual ?? { ...manual, mode: "100644", type: "blob", sha: historicalSha }, generated,
    ...(options.historicalExtra ?? []),
    ...(!options.noSourceManifest ? [blob(files.GENERATED_MANIFEST_PATH, oldManifest)] : []),
  ]));
  let head = saveCommit(saveTree([manual, ...(options.extraManual ?? []), blob(files.GENERATED_MANIFEST_PATH, files.serializeGeneratedManifest({}))]), [source]);
  const refs: string[] = [];
  let commitWrites = 0, recorded = 0;
  const treeWrites: { base_tree?: string; tree: files.TreeEntry[] }[] = [];
  const gh = async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === `/git/ref/heads/${branch}`) return Response.json({ object: { sha: head } });
    if (path === `/compare/${source}...${head}`) return Response.json({ merge_base_commit: { sha: source } });
    if (path.startsWith("/git/commits/")) {
      const value = commits.get(path.slice("/git/commits/".length));
      assert.ok(value);
      return Response.json(value);
    }
    if (path.startsWith("/git/trees/")) {
      const id = path.slice("/git/trees/".length).split("?")[0];
      const tree = trees.get(commits.get(id)?.tree.sha ?? id);
      assert.ok(tree);
      return Response.json({ tree: recursiveTree(tree) });
    }
    if (path.startsWith("/git/blobs/")) {
      const text = blobs.get(path.slice("/git/blobs/".length));
      assert.notEqual(text, undefined);
      return Response.json({ encoding: "base64", content: Buffer.from(text!).toString("base64") });
    }
    if (path === "/git/trees") {
      treeWrites.push(body);
      if (options.failTreeAt === treeWrites.length) return Response.json({}, { status: 503 });
      // 同じリクエストの親パスと子パスは、削除を含めても重ねない。
      assert.equal(files.conflictingCommitPaths(body.tree.map((entry: files.TreeEntry) => entry.path)), null);
      const result = new Map((body.base_tree ? trees.get(body.base_tree)! : []).map(e => [e.path, e]));
      for (const entry of body.tree) {
        const replaced = [...result.keys()].filter(path => path === entry.path || path.startsWith(`${entry.path}/`));
        // GitHub は存在しないパスの削除を拒否する。
        if (entry.sha === null) assert.ok(replaced.length, `cannot delete missing path ${entry.path}`);
        for (const path of replaced) result.delete(path);
        if (entry.sha === null) continue;
        if (entry.type === "tree") {
          const subtree = trees.get(entry.sha);
          assert.ok(subtree, `unknown subtree ${entry.sha}`);
          for (const child of subtree) result.set(`${entry.path}/${child.path}`, { ...child, path: `${entry.path}/${child.path}` });
        } else result.set(entry.path, entry.content !== undefined ? blob(entry.path, entry.content) : entry);
      }
      return Response.json({ sha: saveTree([...result.values()]) });
    }
    if (path === "/git/commits") {
      commitWrites++;
      if (options.failCommit) return Response.json({}, { status: 503 });
      return Response.json({ sha: saveCommit(body.tree, body.parents) });
    }
    if (path === `/git/refs/heads/${branch}`) {
      assert.equal(body.force, false);
      assert.deepEqual(commits.get(body.sha)?.parents, [head]);
      if (options.lateMove) {
        head = saveCommit(commits.get(head)!.tree.sha, [head]);
        return Response.json({}, { status: 422 });
      }
      refs.push(path);
      head = body.sha;
      if (options.ambiguousUpdate) throw new Error("connection lost after ref update");
      return Response.json({});
    }
    throw new Error(`Unexpected GitHub request: ${path}`);
  };
  class NextResponse extends Response {
    static json(value: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(value), init); }
  }
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse },
    "lib/i18n-server": { serverTr: async () => (s: string) => s },
    "lib/server": { requireAuth: async () => null, recordPublish: async () => { recorded++; } },
    "lib/site-server": { siteIdOf: async () => "site", siteDestOf: async () => ({}) },
    "lib/github": {
      advanceBranchRef, branchPath: (s: string) => s, configError: () => null,
      targetConfig: (_: unknown, t: string) => ({ repo: expected.repo, branch: t === "test" ? "preview" : "main", token: "fake" }),
      githubClient: () => ({ gh, head: async () => head, fail: async () => { throw new Error("GitHub failure"); } }),
    },
    "lib/kv": {}, "lib/errors": { userMessage: (e: Error) => e.message },
    "lib/publish-files": files, "lib/publish-preconditions": preconditions, "lib/publish-security": { hasPublishCredentials },
    "lib/api-json": { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited },
  };
  const load = (path: string) => {
    const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", code)((name: string) => {
      const key = name.replace(/^(\.\.\/)+/, "");
      assert.ok(Object.hasOwn(mocks, key), name);
      return mocks[key];
    }, module, module.exports);
    return module.exports.POST as (req: Request) => Promise<Response>;
  };
  const rollback = load("../app/api/publish/history/route.ts");
  const publish = load("../app/api/publish/route.ts");
  return {
    source, refs, oldManifest, treeWrites,
    get currentHead() { return head; }, get commitWrites() { return commitWrites; }, get recorded() { return recorded; },
    sourceManifest: () => blobs.get(trees.get(commits.get(source)!.tree.sha)!.find(e => e.path === files.GENERATED_MANIFEST_PATH)!.sha!),
    entries: () => trees.get(commits.get(head)!.tree.sha)!,
    send: (body: object, history = false) => (history ? rollback : publish)(new Request("https://example.test", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: "site", target, expected, expectedHead: head, ...body }),
    })),
  };
}

for (const target of ["production", "test"] as const) {
  for (const [path, mode, type, historicalSha] of [
    ["manual.sh", "100755", "blob", "historical"],
    ["manual-link", "120000", "blob", "historical"],
    ["manual-module", "160000", "commit", "historical"],
    ["__proto__", "100644", "blob", "manual"],
  ]) {
    test(`${target}: rollback and subsequent publish preserve manual ownership of ${path}`, async () => {
      const manual = { path, mode, type, sha: "manual" };
      const f = fixture(target, manual, historicalSha);
      const rollback = await f.send({ sha: f.source }, true);
      assert.equal(rollback.status, 200, await rollback.text());
      assert.deepEqual(f.entries().find(e => e.path === path), manual);

      // Exercise the real next preflight and server-side retention logic.
      const preflight = await f.send({ action: "tree" });
      assert.equal(preflight.status, 200);
      const snapshot = await preflight.json();
      const publication = await f.send({
        action: "commit", keptPaths: [],
        files: { "new-page.html": "new", [files.GENERATED_MANIFEST_PATH]: files.serializeGeneratedManifest({ "new-page.html": "new" }) },
      });
      assert.equal(publication.status, 200, await publication.text());
      assert.deepEqual(f.entries().find(e => e.path === path), manual, "the next publish must not delete the retained manual file");
      assert.equal(f.entries().some(e => e.path === "old-page.html"), false, "obsolete generated files must still be removed");
      assert.deepEqual(snapshot.generated, { "old-page.html": "generated-page" });
      assert.equal(f.sourceManifest(), f.oldManifest, "historical manifest remains immutable");
      assert.deepEqual(f.refs, Array(2).fill(`/git/refs/heads/${target === "test" ? "preview" : "main"}`));
    });
  }
}


for (const target of ["production", "test"] as const) {
  for (const [oldPath, oldMode, oldType, path, mode, type] of [
    ["manual", "100644", "blob", "manual/info.md", "100755", "blob"],
    ["manual/info.md", "100644", "blob", "manual", "120000", "blob"],
    ["manual/info.md", "100644", "blob", "manual", "160000", "commit"],
    ["manual", "160000", "commit", "manual/info.md", "100644", "blob"],
  ]) {
    test(`${target}: rollback preserves a manual path converted from ${oldMode} ${oldPath} to ${mode} ${path}`, async () => {
      const historical = { path: oldPath, mode: oldMode, type: oldType, sha: "old-manual" };
      const manual = { path, mode, type, sha: "current-manual" };
      const extraManual = [
        { path: "notes/current.txt", mode: "100755", type: "blob", sha: "unrelated" },
        { path: ".github", mode: "120000", type: "blob", sha: "protected" },
      ];
      const f = fixture(target, manual, "unused", { historicalManual: historical, extraManual });
      const response = await f.send({ sha: f.source }, true);
      assert.equal(response.status, 200, await response.text());
      assert.equal(f.entries().some(entry => entry.path === oldPath), false);
      assert.deepEqual(f.entries().find(entry => entry.path === path), manual);
      for (const entry of extraManual) assert.deepEqual(f.entries().find(item => item.path === entry.path), entry);
      assert.ok(f.entries().some(entry => entry.path === "old-page.html"), "restore the historical generated site");
      assert.equal(files.conflictingCommitPaths(f.entries().map(entry => entry.path)), null);
      assert.equal(f.treeWrites.length, 2, "prune the deleted historical manual path before its replacement");
      assert.deepEqual(f.treeWrites[0].tree, [{ ...historical, sha: null }]);
      const next = await f.send({ action: "commit", files: {
        "new-page.html": "new",
        [files.GENERATED_MANIFEST_PATH]: files.serializeGeneratedManifest({ "new-page.html": "new" }),
      } });
      assert.equal(next.status, 200, await next.text());
      assert.deepEqual(f.entries().find(entry => entry.path === path), manual);
      for (const entry of extraManual) assert.deepEqual(f.entries().find(item => item.path === entry.path), entry);
      assert.equal(f.entries().some(entry => entry.path === oldPath || entry.path === "old-page.html"), false);
      assert.equal(f.sourceManifest(), f.oldManifest, "the historical tree is immutable");
      assert.equal(f.refs.length, 2, "each operation advances the branch only after its tree is complete");
    });
  }
}


for (const failTreeAt of [1, 2]) {
  test(`rollback leaves the branch unchanged when manual-path tree operation ${failTreeAt} fails`, async () => {
    const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
    const f = fixture("production", manual, "unused", {
      historicalManual: { ...manual, path: "manual", sha: "old-manual" }, failTreeAt,
    });
    const before = f.currentHead;
    const response = await f.send({ sha: f.source }, true);
    assert.equal(response.status, 502);
    assert.equal(f.currentHead, before);
    assert.equal(f.treeWrites.length, failTreeAt);
    assert.equal(f.commitWrites, 0);
    assert.equal(f.recorded, 0);
    assert.deepEqual(f.refs, []);
  });
}

test("a concurrent commit still rejects rollback after both manual-path tree operations", async () => {
  const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
  const f = fixture("test", manual, "unused", {
    historicalManual: { ...manual, path: "manual", sha: "old-manual" }, lateMove: true,
  });
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 409);
  assert.equal(f.treeWrites.length, 2);
  assert.equal(f.commitWrites, 1);
  assert.equal(f.recorded, 0);
  assert.deepEqual(f.refs, []);
  assert.deepEqual(f.entries().find(entry => entry.path === manual.path), manual);
});

test("rollback keeps refusing real generated-path conflicts and unclassified legacy paths", async () => {
  for (const legacy of [false, true]) {
    const manual = { path: `${legacy ? "manual" : "old-page.html"}/readme`, mode: "100644", type: "blob", sha: "manual" };
    const f = fixture("production", manual, "unused", {
      historicalManual: { ...manual, path: "manual", sha: "old-manual" }, noSourceManifest: legacy,
    });
    const response = await f.send({ sha: f.source }, true);
    assert.equal(response.status, 409);
    assert.deepEqual(f.treeWrites, []);
    assert.equal(f.commitWrites, 0);
    assert.equal(f.recorded, 0);
    assert.deepEqual(f.refs, []);
  }
});

test("rollback preserves siblings and protected subtrees through mixed nested path conversions", async () => {
  const manual = { path: "nested/to-directory/readme", mode: "100644", type: "blob", sha: "current" };
  const stable = { path: "nested/stable.txt", mode: "100755", type: "blob", sha: "unchanged" };
  const historicalGenerated = { path: "nested/site.html", mode: "100644", type: "blob", sha: "site" };
  const extraManual = [
    { path: "nested/to-directory/deep/tool.sh", mode: "100755", type: "blob", sha: "tool" },
    { path: "nested/to-file", mode: "120000", type: "blob", sha: "link" },
    stable,
    { path: ".github/workflows/current.yml", mode: "100644", type: "blob", sha: "current-workflow" },
    { path: ".github/CODEOWNERS", mode: "100644", type: "blob", sha: "owners" },
  ];
  const f = fixture("production", manual, "unused", {
    historicalManual: { ...manual, path: "nested/to-directory", sha: "old" },
    historicalExtra: [
      { ...manual, path: "nested/to-file/one", sha: "old-one" },
      { ...manual, path: "nested/to-file/deep/two", sha: "old-two" },
      { ...manual, path: ".github/workflows/old.yml", sha: "old-workflow" },
      stable, historicalGenerated,
    ],
    historicalGenerated: { [historicalGenerated.path]: historicalGenerated.sha }, extraManual,
  });
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 200, await response.text());
  for (const entry of [manual, ...extraManual, historicalGenerated]) {
    assert.deepEqual(f.entries().find(item => item.path === entry.path), entry);
  }
  assert.equal(f.entries().some(entry => entry.sha?.startsWith("old-")), false);
  assert.equal(f.treeWrites.length, 2);
  assert.equal(f.commitWrites, 1);
  assert.equal(f.recorded, 1);
  assert.equal(f.refs.length, 1);
  assert.equal(f.treeWrites[0].tree.length, 3);
  assert.ok(f.treeWrites[0].tree.every(entry => entry.sha === null && entry.path.startsWith("nested/to-")));
  assert.deepEqual(f.treeWrites[1].tree.filter(entry => files.isProtectedPath(entry.path)).map(entry => entry.path), [".github"]);
  assert.equal(f.treeWrites[1].tree.some(entry => entry.path === stable.path), false);
});

test("rollback preserves protected file and directory conversions while pruning manual paths", async () => {
  const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
  const protectedFile = { path: ".github", mode: "120000", type: "blob", sha: "link" };
  const protectedChild = { path: ".github/workflows/current.yml", mode: "100644", type: "blob", sha: "workflow" };
  for (const [historical, current] of [[protectedFile, protectedChild], [protectedChild, protectedFile]]) {
    const f = fixture("test", manual, "unused", {
      historicalManual: { ...manual, path: "manual", sha: "old" },
      historicalExtra: [historical], extraManual: [current],
    });
    const response = await f.send({ sha: f.source }, true);
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(f.entries().filter(entry => files.isProtectedPath(entry.path)), [current]);
    assert.equal(f.treeWrites.length, 2);
    assert.equal(f.commitWrites, 1);
    assert.equal(f.refs.length, 1);
  }
});

test("rollback refuses to replace a directory with any retained historical generated descendants", async () => {
  const manual = { path: "manual", mode: "120000", type: "blob", sha: "current" };
  const f = fixture("production", manual, "unused", {
    historicalManual: { ...manual, path: "manual/deleted.txt", mode: "100644", sha: "deleted" },
    historicalExtra: [{ ...manual, path: "manual/generated.html", mode: "100644", sha: "generated" }],
    historicalGenerated: { "manual/generated.html": "generated" },
  });
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 409);
  assert.deepEqual(f.treeWrites, []);
  assert.equal(f.commitWrites, 0);
  assert.deepEqual(f.refs, []);
});

test("commit creation failure after pruning and overlay leaves the branch unchanged", async () => {
  const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
  const f = fixture("production", manual, "unused", {
    historicalManual: { ...manual, path: "manual", sha: "old" }, failCommit: true,
  });
  const before = f.currentHead;
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 502);
  assert.equal(f.treeWrites.length, 2);
  assert.equal(f.commitWrites, 1);
  assert.equal(f.currentHead, before);
  assert.equal(f.recorded, 0);
  assert.deepEqual(f.refs, []);
});

test("a lost final ref response after both tree writes is verified without a duplicate rollback", async () => {
  const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
  const f = fixture("production", manual, "unused", {
    historicalManual: { ...manual, path: "manual", sha: "old" }, ambiguousUpdate: true,
  });
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 200, await response.text());
  assert.equal(f.treeWrites.length, 2);
  assert.equal(f.commitWrites, 1);
  assert.equal(f.refs.length, 1);
  assert.equal(f.recorded, 1);
  assert.deepEqual(f.entries().find(entry => entry.path === manual.path), manual);
});
