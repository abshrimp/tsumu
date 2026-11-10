import assert from "node:assert/strict";
import { test } from "node:test";
import { readActivity } from "../lib/activity";
import { readPublishedExportOptions, DEFAULT_PUBLISHED_EXPORT_OPTIONS } from "../lib/publish-preferences";
import { load, replacement, setup, sqlOf, isRoomLookup } from "./helpers/document-generation-api";

class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(value), init); }
}
const options = { framework: "vue", language: "javascript", style: "tailwind" } as const;
const head = "a".repeat(40);

async function fixture(t: Parameters<typeof setup>[0], operation: "production" | "test" | "rollback") {
  const f = await setup(t);
  const oldKey = await f.create("source");
  const db = { dbConfigured: () => true, getDb: async () => f.db };
  const common = {
    "next/server": { NextResponse },
    "./i18n-server": { serverTr: async () => (value: string) => value },
    "./db": db,
  };
  const siteServer = load("../../lib/site-server.ts", common);
  const server = load("../../lib/server.ts", {
    ...common, "../auth": { authConfigured: () => false }, "./anonymous": { anonymousAllowed: () => true },
  });
  let beforeRef: (() => Promise<void>) | undefined;
  let refs = 0;
  const gh = async (path: string) => {
    if (path.startsWith("/git/ref/heads/")) return Response.json({ object: { sha: head } });
    if (path.startsWith("/git/trees/")) return Response.json({ tree: [] });
    if (path.startsWith("/git/commits/")) return Response.json({ tree: { sha: "old-tree" }, message: "Synthetic" });
    if (path === "/git/trees") return Response.json({ sha: "new-tree" });
    if (path === "/git/commits") return Response.json({ sha: "new-commit" });
    if (path.startsWith("/git/refs/heads/")) {
      await beforeRef?.();
      refs++;
      return Response.json({});
    }
    assert.fail("Unexpected synthetic GitHub path: " + path);
  };
  const target = operation === "test" ? "test" : "production";
  const conf = { repo: "synthetic/site", branch: target === "test" ? "preview" : "main", token: "synthetic" };
  const github = await import("../lib/github");
  const prefix = operation === "rollback" ? "../../../../lib/" : "../../../lib/";
  const route = load(operation === "rollback" ? "../../app/api/publish/history/route.ts" : "../../app/api/publish/route.ts", {
    "next/server": { NextResponse },
    [prefix + "i18n-server"]: common["./i18n-server"],
    [prefix + "db"]: db,
    [prefix + "server"]: server,
    [prefix + "site-server"]: siteServer,
    [prefix + "github"]: {
      ...github, configError: () => null,
      targetConfig: (_dest: unknown, target: string) => ({ ...conf, branch: target === "test" ? "preview" : "main" }),
      githubClient: () => ({ gh, head: async () => head, fail: () => assert.fail("Unexpected GitHub error") }),
    },
  });
  return {
    ...f, oldKey, siteServer, refs: () => refs,
    beforeRef(fn: () => Promise<void>) { beforeRef = fn; },
    send: () => route.POST(new Request("https://editor.example.test/api/publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site: "source", target, expectedHead: head,
        expected: { site: "source", target, repo: conf.repo, branch: conf.branch, productionBranch: "main" },
        ...(operation === "rollback" ? { sha: head } : {
          action: "commit", files: { "index.html": "Synthetic" }, exportOptions: options,
        }),
      }),
    })),
  };
}

for (const operation of ["production", "test", "rollback"] as const) {
  for (const phase of ["unchanged", "ref", "activity", ...(operation === "rollback" ? [] : ["preferences"])] as const) {
    test(`${operation} bookkeeping stays with its original generation (${phase})`, async t => {
      const f = await fixture(t, operation);
      let newKey: string | undefined;
      const replace = async () => { newKey = await f.replace("source", replacement); };
      if (phase === "ref") f.beforeRef(replace);
      if (phase === "activity" || phase === "preferences") {
        f.hooks.beforeExecute = async stmt => {
          if (sqlOf(stmt).includes(phase === "activity" ? "INSERT INTO site_activity" : "INSERT INTO site_publish_options")) {
            f.hooks.beforeExecute = undefined;
            await replace();
          }
        };
      }
      const response = await f.send();
      assert.equal(response.status, 200);
      const responseText = await response.text();
      assert.equal(responseText.includes(f.oldKey), false);
      assert.equal(responseText.includes('"roomKey"'), false);
      const result = JSON.parse(responseText);
      assert.equal(result.ok, true);
      assert.equal(f.refs(), 1);
      const activity = await readActivity(f.rawDb, "source");
      const published = operation === "test" ? activity.lastTestPublish : activity.lastPublish;
      if (phase === "unchanged") {
        assert.ok(published);
        if (operation !== "rollback") {
          assert.equal(result.optionsSaved, true);
          assert.deepEqual(await readPublishedExportOptions(f.rawDb, "source"), options);
        }
      } else {
        assert.ok(newKey);
        assert.notEqual(newKey, f.oldKey);
        assert.deepEqual(await readPublishedExportOptions(f.rawDb, "source"), DEFAULT_PUBLISHED_EXPORT_OPTIONS);
        assert.equal(published, null);
        assert.deepEqual(JSON.parse(f.room(newKey).snapshot()!.body), replacement);
        if (operation !== "rollback" && phase !== "activity") assert.equal(result.optionsSaved, false);
      }
    });
  }
}

test("destination lookup cannot pair replacement settings with an old generation", async t => {
  const f = await fixture(t, "production");
  f.hooks.afterExecute = async stmt => {
    if (isRoomLookup(stmt, "source")) {
      f.hooks.afterExecute = undefined;
      await f.replace("source", replacement);
    }
  };
  const response = await f.send();
  assert.equal(response.status, 404);
  assert.equal(f.refs(), 0);
});
