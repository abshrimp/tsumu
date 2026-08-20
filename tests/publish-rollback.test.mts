import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";
import * as files from "../lib/publish-files";
import * as preconditions from "../lib/publish-preconditions";
import { advanceBranchRef } from "../lib/github";
import { hasPublishCredentials } from "../lib/publish-security";

// Persist Git objects between real rollback, snapshot and publish handlers so
// ownership errors that only delete files on the next publication are visible.
function fixture(target: "production" | "test", manual: files.TreeEntry, historicalSha: string) {
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
    const id = sha(entries);
    trees.set(id, entries);
    return id;
  };
  const saveCommit = (tree: string, parents: string[] = []) => {
    const value = { tree: { sha: tree }, message: "Publish", parents };
    const id = sha(value);
    commits.set(id, value);
    return id;
  };
  const generated = { path: "old-page.html", mode: "100644", type: "blob", sha: "generated-page" };
  const oldManifest = files.serializeGeneratedManifest({ [manual.path]: historicalSha, [generated.path]: generated.sha });
  const source = saveCommit(saveTree([
    { ...manual, mode: "100644", type: "blob", sha: historicalSha }, generated,
    blob(files.GENERATED_MANIFEST_PATH, oldManifest),
  ]));
  let head = saveCommit(saveTree([manual, blob(files.GENERATED_MANIFEST_PATH, files.serializeGeneratedManifest({}))]), [source]);
  const refs: string[] = [];
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
      return Response.json({ tree });
    }
    if (path.startsWith("/git/blobs/")) {
      const text = blobs.get(path.slice("/git/blobs/".length));
      assert.notEqual(text, undefined);
      return Response.json({ encoding: "base64", content: Buffer.from(text!).toString("base64") });
    }
    if (path === "/git/trees") {
      const result = new Map((body.base_tree ? trees.get(body.base_tree)! : []).map(e => [e.path, e]));
      for (const entry of body.tree) {
        if (entry.sha === null) result.delete(entry.path);
        else result.set(entry.path, entry.content !== undefined ? blob(entry.path, entry.content) : entry);
      }
      return Response.json({ sha: saveTree([...result.values()]) });
    }
    if (path === "/git/commits") return Response.json({ sha: saveCommit(body.tree, body.parents) });
    if (path === `/git/refs/heads/${branch}`) {
      assert.equal(body.force, false);
      assert.deepEqual(commits.get(body.sha)?.parents, [head]);
      refs.push(path);
      head = body.sha;
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
    "lib/server": { requireAuth: async () => null, recordPublish: async () => {} },
    "lib/site-server": { siteIdOf: async () => "site", siteDestOf: async () => ({}) },
    "lib/github": {
      advanceBranchRef, branchPath: (s: string) => s, configError: () => null,
      targetConfig: (_: unknown, t: string) => ({ repo: expected.repo, branch: t === "test" ? "preview" : "main", token: "fake" }),
      githubClient: () => ({ gh, head: async () => head, fail: async () => { throw new Error("GitHub failure"); } }),
    },
    "lib/kv": {}, "lib/errors": { userMessage: (e: Error) => e.message },
    "lib/publish-files": files, "lib/publish-preconditions": preconditions, "lib/publish-security": { hasPublishCredentials },
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
    source, refs, oldManifest,
    sourceManifest: () => blobs.get(trees.get(commits.get(source)!.tree.sha)!.find(e => e.path === files.GENERATED_MANIFEST_PATH)!.sha!),
    entries: () => trees.get(commits.get(head)!.tree.sha)!,
    send: (body: object, history = false) => (history ? rollback : publish)(new Request("https://example.test", {
      method: "POST", body: JSON.stringify({ site: "site", target, expected, expectedHead: head, ...body }),
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
