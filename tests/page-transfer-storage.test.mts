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

