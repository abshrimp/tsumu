import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { buildPagePayload, copyPagesToSite } from "../lib/page-transfer";

const target = { id: "destination", name: "Destination" };
const source = createInitialDoc();
const payload = buildPagePayload(source, source.pageOrder);

test("server copy retries against the latest revision, preserving concurrent target edits", async () => {
  const before = createInitialDoc();
  const concurrent = structuredClone(before);
  concurrent.siteName = "Concurrent title";
  concurrent.customHeadHtml = "<!-- Concurrent edit -->";
  const bodies: any[] = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "https://example.test");
    assert.equal(url.searchParams.get("site"), target.id);
    if (!init) return Response.json({ exists: true, rev: "1", doc: before });
    bodies.push(JSON.parse(String(init.body)));
    assert.equal(url.searchParams.get("base"), String(bodies.length));
    return bodies.length === 1 ? Response.json({ conflict: true, rev: "2", doc: concurrent }, { status: 409 }) : Response.json({ ok: true });
  };
  try {
    await copyPagesToSite(target, payload, "server");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].siteName, concurrent.siteName);
    assert.equal(bodies[1].customHeadHtml, concurrent.customHeadHtml);
    assert.equal(bodies[1].pageOrder.length, concurrent.pageOrder.length + payload.pages.length);
  } finally { globalThis.fetch = oldFetch; }
});

test("server conflict rechecks screen widths before attempting another write", async () => {
  const before = createInitialDoc(), concurrent = createInitialDoc();
  concurrent.breakpoints = [{ id: "custom", label: "Custom", maxWidth: 800 }];
  let writes = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (!init) return Response.json({ exists: true, rev: "1", doc: before });
    writes++;
    return Response.json({ conflict: true, rev: "2", doc: concurrent }, { status: 409 });
  };
  try {
    await assert.rejects(copyPagesToSite(target, payload, "server"), /画面幅|screen-width/);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = oldFetch; }
});


test("a lost server copy reply is confirmed from the new page IDs without repeating the write", async t => {
  for (const reply of ["network", "server", "truncated", "not-saved"] as const) {
    await t.test(reply, async t => {
      let destination = createInitialDoc(), reads = 0, writes = 0;
      const initialCount = destination.pageOrder.length;
      t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
        if (!init) {
          reads++;
          return Response.json({ exists: true, rev: String(reads), doc: destination });
        }
        writes++;
        if (reply !== "not-saved") {
          destination = JSON.parse(String(init.body));
          destination.siteName = "Concurrent rename after the copy";
        }
        if (reply === "network") throw new TypeError("Connection reset after sending");
        if (reply === "server") return Response.json({ error: "Error after write" }, { status: 502 });
        return new Response('{"ok":');
      });
      if (reply === "not-saved") await assert.rejects(copyPagesToSite(target, payload, "server"));
      else await copyPagesToSite(target, payload, "server");
      assert.equal(reads, 2);
      assert.equal(writes, 1);
      assert.equal(destination.pageOrder.length, initialCount + (reply === "not-saved" ? 0 : payload.pages.length));
    });
  }
});

test("an unreadable destination or conflict cannot initiate a copy into a blank site", async t => {
  for (const conflict of [false, true]) {
    await t.test(conflict ? "invalid conflict" : "invalid read", async t => {
      let writes = 0;
      t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
        if (!init) return conflict ? Response.json({ exists: true, rev: "1", doc: createInitialDoc() }) : new Response("");
        writes++;
        return Response.json({}, { status: 409 });
      });
      await assert.rejects(copyPagesToSite(target, payload, "server"));
      assert.equal(writes, conflict ? 1 : 0);
    });
  }
});
