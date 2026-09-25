import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../lib/db";
import { permanentlyDeleteTrashedAsset } from "../lib/asset-trash-delete";

const path = "assets/muhmi2o0abcdef-photo.png";

function fixture(options: {
  busy?: boolean;
  candidate?: boolean;
  refs?: Array<string[]>;
  brokenRoom?: boolean;
  failKv?: boolean;
  changeCandidate?: boolean;
} = {}) {
  let lease = !!options.busy;
  let stored = options.candidate !== false;
  let stamped = 1_700_000_000_000;
  let deleted = false;
  let reads = 0;
  let kvDeletes = 0;
  const db: Db = {
    backend: "d1",
    execute: async (statement) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (sql.includes("UPDATE asset_gc_state SET lease_until=?")) {
        if (lease) return { rows: [], rowsAffected: 0 };
        lease = true;
        return { rows: [{ id: 1 }], rowsAffected: 1 };
      }
      if (sql.includes("UPDATE asset_gc_state SET lease_until=0")) {
        lease = false;
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("FROM asset_gc_candidates") && !sql.includes("JOIN asset_gc_state")) {
        return { rows: stored ? [{ first_unreferenced_at: stamped }] : [], rowsAffected: 0 };
      }
      if (sql.includes("JOIN asset_gc_state")) {
        return { rows: stored && lease ? [{ first_unreferenced_at: options.changeCandidate ? stamped + 1 : stamped }] : [], rowsAffected: 0 };
      }
      if (sql.includes("FROM sites s LEFT JOIN site_document_rooms")) {
        return { rows: [{ site: "site", room_key: "room" }], rowsAffected: 0 };
      }
      throw new Error("Unexpected SQL: " + sql);
    },
    batch: async (statements) => {
      assert.equal(statements.length, 2);
      stored = false;
      deleted = true;
      return statements.map(() => ({ rows: [], rowsAffected: 1 }));
    },
  };
  const rooms = {
    idFromName: (name: string) => name,
    get: (_id: unknown) => ({
      async gcAssetReferences() {
        if (options.brokenRoom) throw new Error("Document read failed");
        const response = options.refs?.[Math.min(reads, options.refs.length - 1)] ?? [];
        reads++;
        return response;
      },
    }),
  };
  const kv = {
    async delete(asset: string) {
      assert.equal(asset, path);
      kvDeletes++;
      if (options.failKv) throw new Error("KV failed");
    },
  };
  return {
    run: () => permanentlyDeleteTrashedAsset({ db, rooms, kv, path }),
    snapshot: () => ({ lease, stored, deleted, reads, kvDeletes }),
  };
}

test("explicit permanent delete rechecks all documents before deleting the KV file and D1 rows", async () => {
  const f = fixture({ refs: [[], []] });
  assert.equal(await f.run(), "deleted");
  assert.deepEqual(f.snapshot(), { lease: false, stored: false, deleted: true, reads: 2, kvDeletes: 1 });
  assert.equal(await f.run(), "missing");
});

test("a still referenced file is protected, even if it appears only in the final scan", async () => {
  for (const refs of [[[path]], [[], [path]]]) {
    const f = fixture({ refs });
    assert.equal(await f.run(), "in-use");
    const result = f.snapshot();
    assert.equal(result.stored, true);
    assert.equal(result.kvDeletes, 0);
    assert.equal(result.lease, false);
  }
});

test("concurrent sweep, a missing candidate or a changed deletion epoch cannot delete the file", async () => {
  for (const [options, expected] of [
    [{ busy: true }, "busy"],
    [{ candidate: false }, "missing"],
    [{ changeCandidate: true }, "missing"],
  ] as const) {
    const f = fixture(options);
    assert.equal(await f.run(), expected);
    assert.equal(f.snapshot().kvDeletes, 0);
    assert.equal(f.snapshot().deleted, false);
  }
});

test("unreadable documents or KV deletion failures abort safely and release the lease", async () => {
  for (const options of [{ brokenRoom: true }, { failKv: true }]) {
    const f = fixture(options);
    await assert.rejects(f.run());
    assert.equal(f.snapshot().lease, false);
    assert.equal(f.snapshot().stored, true);
    assert.equal(f.snapshot().deleted, false);
  }
});
