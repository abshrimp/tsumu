import assert from "node:assert/strict";
import { test } from "node:test";
import * as sites from "../lib/sites";
import { argOf, isRoomLookup, original, replacement, setup, sqlOf } from "./helpers/document-generation-api";

const copyRequest = (input: unknown = { name: "Copy", copyFrom: "source" }) => new Request("https://editor.example.test/api/sites", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
});
const imported = { name: original.siteName, importId: "0123456789", initialDoc: original };

for (const importing of [false, true]) {
  test(`${importing ? "import" : "copy"} rolls back its own generation if document routing lookup fails`, async t => {
    const f = await setup(t); await f.create("source");
    const id = importing ? imported.importId : "destination";
    let createdKey: string | null = null;
    f.hooks.afterBatch = async stmts => {
      if (stmts.some(stmt => /INSERT INTO sites/.test(sqlOf(stmt)) && argOf(stmt) === id)) {
        createdKey = await sites.getSiteRoomKey(f.rawDb, id);
      }
    };
    f.hooks.beforeExecute = async stmt => { if (isRoomLookup(stmt, id)) throw new Error("Synthetic transient D1 failure"); };
    const response = await f.sites.POST(copyRequest(importing ? imported : undefined));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Couldn't create it" });
    assert.ok(createdKey);
    assert.equal(await sites.getSite(f.rawDb, id), null);
    assert.equal(await sites.getSiteRoomKey(f.rawDb, id), null);
    assert.equal(f.room(createdKey).replace(JSON.stringify(original), null).kind, "missing");
    f.hooks.beforeExecute = undefined;
    assert.equal((await f.sites.POST(copyRequest(importing ? imported : undefined))).status, 200, "retry is not blocked by an empty site");
  });
}

for (const timing of ["before target lookup", "during RPC", "after RPC", "final response lookup"] as const) {
  for (const replacementDoc of [null, replacement]) {
    test(`copy rejects a replacement ${timing}, preserving its ${replacementDoc ? "document" : "empty room"}`, async t => {
      const f = await setup(t); await f.create("source");
      let replacementKey: string | undefined;
      const replace = async () => { replacementKey = await f.replace("destination", replacementDoc); };
      if (timing === "before target lookup") {
        f.hooks.afterBatch = async stmts => {
          if (stmts.some(stmt => /INSERT INTO sites/.test(sqlOf(stmt)) && argOf(stmt) === "destination")) {
            f.hooks.afterBatch = undefined;
            await replace();
          }
        };
      } else if (timing === "during RPC" || timing === "after RPC") {
        const hook = timing === "during RPC" ? "beforeRoomWrite" : "afterRoomWrite";
        f.hooks[hook] = async () => { f.hooks[hook] = undefined; await replace(); };
      } else {
        f.hooks.beforeExecute = async stmt => {
          if (/SELECT s\.\*/.test(sqlOf(stmt)) && argOf(stmt) === "destination") {
            f.hooks.beforeExecute = undefined; await replace();
          }
        };
      }
      const response = await f.sites.POST(copyRequest());
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "Couldn't create it" });
      assert.ok(replacementKey);
      assert.equal((await sites.getSite(f.rawDb, "destination"))?.name, "Replacement owner");
      assert.equal(await sites.getSiteRoomKey(f.rawDb, "destination"), replacementKey);
      const snapshot = f.room(replacementKey).snapshot();
      assert.deepEqual(snapshot ? JSON.parse(snapshot.body) : null, replacementDoc);
      if (!replacementDoc) {
        assert.equal(f.room(replacementKey).replace(JSON.stringify(replacement), null).kind, "saved", "replacement is not sealed");
      }
    });
  }
}

test("copy rejects a generation deleted while initialization RPC completes", async t => {
  const f = await setup(t); await f.create("source"); let createdKey: string | undefined;
  f.hooks.afterRoomWrite = async key => {
    f.hooks.afterRoomWrite = undefined; createdKey = key;
    await sites.deleteSite(f.rawDb, "destination", key);
  };
  const response = await f.sites.POST(copyRequest());
  assert.equal(response.status, 502);
  assert.equal(await sites.getSite(f.rawDb, "destination"), null);
  assert.ok(createdKey);
  assert.equal(f.room(createdKey).replace(JSON.stringify(original), null).kind, "missing");
});

test("failed D1 rollback and cleanup never target a replacement generation", async t => {
  const f = await setup(t); await f.create("source"); let replacementKey: string | undefined;
  const attemptedErase: string[] = [];
  f.hooks.afterBatch = async stmts => {
    if (stmts.some(stmt => /INSERT INTO sites/.test(sqlOf(stmt)) && argOf(stmt) === "destination")) {
      f.hooks.afterBatch = undefined;
      replacementKey = await f.replace("destination", replacement);
    }
  };
  f.hooks.beforeBatch = async stmts => {
    if (stmts.some(stmt => /DELETE FROM sites/.test(sqlOf(stmt)))) throw new Error("Synthetic rollback failure");
  };
  f.hooks.beforeErase = async key => { attemptedErase.push(key); throw new Error("Synthetic cleanup failure"); };
  f.hooks.beforeExecute = async stmt => {
    if (/SELECT room_key FROM document_room_cleanup/.test(sqlOf(stmt))) throw new Error("Synthetic cleanup queue failure");
  };
  const response = await f.sites.POST(copyRequest());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Couldn't create it" });
  assert.ok(replacementKey);
  assert.equal(attemptedErase.length, 1);
  assert.ok(!attemptedErase.includes(replacementKey));
  assert.equal(await sites.getSiteRoomKey(f.rawDb, "destination"), replacementKey);
  assert.deepEqual(JSON.parse(f.room(replacementKey).snapshot()!.body), replacement);
});

test("ordinary D1 creation, copy, and import retain public response shapes without generation keys", async t => {
  const f = await setup(t); await f.create("source");
  for (const input of [{ name: "Empty" }, { name: "Copy", copyFrom: "source" }, imported]) {
    const id = "importId" in input ? input.importId : "destination";
    const response = await f.sites.POST(copyRequest(input));
    assert.equal(response.status, 200);
    const payload = await response.json();
    const key = (await sites.getSiteRoomKey(f.rawDb, id))!;
    assert.deepEqual(Object.keys(payload), ["site"]);
    assert.equal(payload.site.id, id);
    assert.ok(!JSON.stringify(payload).includes(key));
    assert.ok(!Object.hasOwn(payload.site, "roomKey"));
    if ("copyFrom" in input || "importId" in input) assert.deepEqual(JSON.parse(f.room(key).snapshot()!.body), original);
    else assert.equal(f.room(key).snapshot(), null);
    await sites.deleteSite(f.rawDb, id, key);
  }
});

test("insertSite returns only the generation it created and getSite can require that generation", async t => {
  const f = await setup(t);
  const key = await sites.insertSite(f.rawDb, "destination", {
    name: "Original", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
  });
  assert.ok(key);
  assert.equal(key, await sites.getSiteRoomKey(f.rawDb, "destination"));
  assert.equal((await sites.getSite(f.rawDb, "destination", key))?.name, "Original");
  await f.replace("destination", replacement);
  assert.equal(await sites.getSite(f.rawDb, "destination", key), null);
  assert.equal((await sites.getSite(f.rawDb, "destination"))?.name, "Replacement owner");
});
