import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db, ResultSet } from "../lib/db";
import { insertSiteWithDoc } from "../lib/sites";

const config = {
  name: "Restored site", repo: null, branch: "main", previewBranch: "preview",
  siteUrl: null, previewUrl: null,
};

test("new server site and restored document are committed in one batch", async () => {
  const calls: any[] = [];
  const db: Db = {
    execute: async () => { throw new Error("Must not save a partially created site"); },
    batch: async (statements) => {
      calls.push(statements);
      return [
        { rows: [], rowsAffected: 1 },
        { rows: [], rowsAffected: 1 },
      ] as ResultSet[];
    },
  };
  const body = JSON.stringify({ siteName: "Restored site", pages: {}, nodes: {}, assets: {} });
  await insertSiteWithDoc(db, "imported-1", config, body);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2);
  assert.match(calls[0][0].sql, /INSERT INTO sites/);
  assert.match(calls[0][1].sql, /INSERT INTO docs/);
  assert.equal(calls[0][0].args[0], "imported-1");
  assert.equal(calls[0][1].args[0], "imported-1");
  assert.equal(calls[0][1].args[2], body);
});

test("site import propagates transaction failures instead of returning an incomplete site", async () => {
  const db: Db = {
    execute: async () => { throw new Error("Unexpected non-atomic insert"); },
    batch: async () => { throw new Error("Transaction rolled back"); },
  };
  await assert.rejects(insertSiteWithDoc(db, "imported-2", config, "{}"), /rolled back/);
});
