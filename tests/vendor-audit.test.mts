import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkUpstreamAdvisories, fetchUpstreamAdvisories, validateVendoredManifest,
} from "../scripts/audit-vendored-picomatch.mjs";

const advisory = {
  id: 1247710,
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  title: "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
  severity: "high",
  vulnerable_versions: "<=4.0.7",
};
const patched = "GHSA-fc5q-39xc-vjpf";
const manifest = {
  name: "@tsumu/picomatch", version: "4.0.7+tsumu.1",
  tsumu: { upstreamVersion: "4.0.7", patchedAdvisories: [patched] },
};

test("vendor audit accepts only the shipped patch and consistent upstream metadata", () => {
  assert.equal(validateVendoredManifest(manifest), "4.0.7");
  assert.deepEqual(checkUpstreamAdvisories({ picomatch: [advisory] }), [patched]);
  assert.deepEqual(checkUpstreamAdvisories({}), []);
  assert.deepEqual(checkUpstreamAdvisories({ picomatch: [] }), []);
  for (const value of [
    null, {}, { ...manifest, version: "4.0.8+tsumu.1" },
    { ...manifest, tsumu: { ...manifest.tsumu, upstreamVersion: "latest" } },
    { ...manifest, tsumu: { ...manifest.tsumu, upstreamVersion: ["4.0.7"] } },
    { ...manifest, tsumu: { ...manifest.tsumu, patchedAdvisories: [patched, "GHSA-aaaa-bbbb-cccc"] } },
  ]) assert.throws(() => validateVendoredManifest(value), /metadata/);
});

test("new upstream advisories and changes to the covered advisory stop the audit", () => {
  assert.throws(() => checkUpstreamAdvisories({ picomatch: [advisory, {
    ...advisory, id: 2, url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "low",
  }] }), /Unpatched upstream/);
  assert.throws(() => checkUpstreamAdvisories({ picomatch: [{
    ...advisory, vulnerable_versions: "<=4.0.8",
  }] }), /Changed/);
  assert.throws(() => checkUpstreamAdvisories({ picomatch: [advisory, advisory] }), /duplicate/);
});

test("malformed registry payloads cannot become a successful empty audit", () => {
  for (const payload of [null, [], "", true, { error: "unavailable" },
    { picomatch: null }, { picomatch: {} }, { picomatch: [null] },
    { picomatch: [{ ...advisory, id: "1247710" }] },
    { picomatch: [{ ...advisory, name: "different-package" }] },
    { picomatch: [{ ...advisory, title: "" }] },
    { picomatch: [{ ...advisory, severity: "unknown" }] },
    { picomatch: [{ ...advisory, vulnerable_versions: null }] },
    { picomatch: [{ ...advisory, url: advisory.url + "?other-advisory" }] },
  ]) assert.throws(() => checkUpstreamAdvisories(payload), /Invalid npm advisory/);
});

test("vendor audit queries the official registry with only the upstream package and version", async () => {
  const covered = await fetchUpstreamAdvisories("4.0.7", async (url, init) => {
    assert.equal(url, "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { picomatch: ["4.0.7"] });
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    // The bulk endpoint does not always supply a Content-Type header.
    return new Response(JSON.stringify({ picomatch: [advisory] }));
  });
  assert.deepEqual(covered, [patched]);
});

test("HTTP, network, timeout and JSON failures keep the vendor audit failed", async () => {
  for (const response of [
    Response.json({ error: "unavailable" }, { status: 503 }),
    new Response("", { status: 302, headers: { Location: "https://example.com/" } }),
    new Response("<html>unavailable</html>", { headers: { "Content-Type": "text/html" } }),
    new Response("not json", { headers: { "Content-Type": "application/json" } }),
  ]) await assert.rejects(fetchUpstreamAdvisories("4.0.7", async () => response));
  for (const error of [new Error("network unavailable"), new DOMException("Timed out", "TimeoutError")]) {
    await assert.rejects(fetchUpstreamAdvisories("4.0.7", async () => { throw error; }),
      candidate => candidate === error);
  }
});
