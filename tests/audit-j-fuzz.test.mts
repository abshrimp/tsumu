import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createDocPatch, applyDocPatch, applyDocPatchAtRevision, isDocPatch } from "../lib/doc-patch";
import { codeLiteral } from "../lib/generator/code-literal";
import { mergeDocs } from "../lib/merge";
import { createInitialDoc } from "../lib/presets";
import { parseSiteImport, validateImportedDoc } from "../lib/site-import";
import { safeNavigationUrl, safeResourceUrl, NAVIGATION_RUNTIME } from "../lib/url-policy";
import { matchesValueCondition, setVarPath, withinScriptValueLimit } from "../lib/value-semantics";
import type { SiteDoc } from "../lib/types";

// AUD-J: All randomized cases are deterministic and report their reproduction seed.
// Keep this file self-contained; the root npm test command picks up tests/*.test.mts.
const SEED = 0x4a202611;
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}
function choose<T>(next: () => number, values: readonly T[]): T {
  return values[Math.floor(next() * values.length)];
}
const utf8 = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test("AUD-J-001: navigation URL guard and exported browser runtime agree on mutated inputs", () => {
  const browserGuard = runInNewContext(NAVIGATION_RUNTIME + "\nsafeNavigationUrl") as (url: string) => string;
  const attacks = [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>", "file:///etc/passwd",
    "//attacker.invalid/x", "/\\attacker.invalid/x",
    "https:\\attacker.invalid/x", "https://safe.invalid/\r\nalert(1)",
    "javas\ncript:alert(1)", "https://user:pass@host.invalid/x",
  ];
  for (const url of attacks.slice(0, 9)) {
    assert.equal(safeNavigationUrl(url), "#", "unexpectedly allowed: " + JSON.stringify(url));
  }
  const next = random(SEED);
  const prefixes = [
    "", "/", "./", "../", "#", "?", "https://example.invalid/", "http://example.invalid/",
    "mailto:", "tel:", "javascript:", "data:", "//", "\\", "https:\\",
  ];
  const tails = [
    "ok", "x?next=1", "a b", "\u2028", "%2F", "<script>", "\u0000", "\n",
    "\r", "\t", "\\", "#fragment", "?q=x", "\u007f", "https://other.invalid",
  ];
  for (let i = 0; i < 600; i++) {
    const url = choose(next, prefixes) + choose(next, tails) + (next() < 0.2 ? choose(next, tails) : "");
    assert.equal(browserGuard(url), safeNavigationUrl(url), "seed=" + SEED + " case=" + i + " input=" + JSON.stringify(url));
    const resource = safeResourceUrl(url);
    assert.equal(typeof resource, "string");
    if (safeNavigationUrl(url) === "#" && !/^(?:blob:|data:(?:image|video|audio)\/[\w.+-]+;base64,)/i.test(url.trim())) {
      assert.equal(resource, "#", "unsafe resource URL: " + JSON.stringify(url));
    }
  }
});

test("AUD-J-002: generated JS literals retain untrusted JSON without creating HTML script terminators", () => {
  const next = random(SEED ^ 0x202);
  const parts = [
    "</script>", "<script>", "<style>", "&", "\u2028", "\u2029", "'", '"',
    "\\", "${process.env.SECRET}", "<img src=x onerror=alert(1)>",
    "\u0000", "日本語", "\n", "🧪", "</ScRiPt>",
  ];
  for (let i = 0; i < 350; i++) {
    const value = Array.from({ length: 1 + Math.floor(next() * 8) }, () => choose(next, parts)).join("");
    const literal = codeLiteral({ value, items: [value, false, 0, null] });
    assert.doesNotMatch(literal, /<\/script/i, "seed=" + SEED + " case=" + i);
    assert.doesNotMatch(literal, /[\u2028\u2029]/, "nonportable source separator");
    assert.deepEqual(
      JSON.parse(JSON.stringify(runInNewContext("(" + literal + ")"))),
      { value, items: [value, false, 0, null] },
      "seed=" + SEED + " case=" + i,
    );
  }
});

test("AUD-J-003: import, patch, reload and concurrent non-conflicting merge preserve meaning", async () => {
  const next = random(SEED ^ 0x303);
  const original = JSON.parse(JSON.stringify(createInitialDoc())) as SiteDoc;
  const initial = (await parseSiteImport(utf8(original), "doc")).doc;
  for (let i = 0; i < 120; i++) {
    const base = structuredClone(initial);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.siteName = "Local " + i + choose(next, ["<&>", "日本語", "</script>", "\u0000", "Ω"]);
    remote.description = "Remote " + i + choose(next, ["<svg>", "newline\n", "quotes \"'", ""]);
    const patch = createDocPatch(base, local);
    assert.ok(patch && patch.length > 0 && isDocPatch(patch), "seed=" + SEED + " case=" + i);
    const applied = applyDocPatch(base, patch);
    assert.deepEqual(applied, local, "patch case=" + i);
    assert.notEqual(applied, base);
    assert.deepEqual(base, initial, "base mutated, case=" + i);
    assert.equal(applyDocPatchAtRevision(base, "old", "new", patch), null);
    const combined = mergeDocs(base, local, remote);
    assert.equal(combined.siteName, local.siteName, "local edit lost, case=" + i);
    assert.equal(combined.description, remote.description, "remote edit lost, case=" + i);
    const reloaded = (await parseSiteImport(utf8(combined), "doc")).doc;
    assert.deepEqual(reloaded, JSON.parse(JSON.stringify(combined)), "round-trip case=" + i);
    assert.doesNotThrow(() => validateImportedDoc(reloaded));
  }
});

test("AUD-J-004: mutated SiteDocs reject prototype keys, dangling pages and cyclic node references", async () => {
  const source = JSON.parse(JSON.stringify(createInitialDoc())) as SiteDoc;
  const page = source.pages[source.pageOrder[0]];
  const root = page.children[0];
  assert.ok(root, "fixture should contain a root node");
  const mutations: ((value: SiteDoc) => void)[] = [
    (value) => { value.pageOrder.push("unknown-page"); },
    (value) => { value.nodes[root].children.push(root); },
    (value) => { value.nodes[root].children.push("deleted-node"); },
    (value) => { value.nodes[root].children.push(root, root); },
    (value) => { Object.defineProperty(value, "__proto__", {
      value: { polluted: true }, enumerable: true, configurable: true,
    }); },
    (value) => { Object.defineProperty(value.assets, "constructor", {
      value: {}, enumerable: true, configurable: true,
    }); },
  ];
  for (let i = 0; i < mutations.length; i++) {
    const doc = structuredClone(source);
    mutations[i](doc);
    await assert.rejects(
      parseSiteImport(utf8(doc), "doc"),
      /(?:page|element|property|reference)/i,
      "seed=" + SEED + " mutation=" + i,
    );
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  }
});

test("AUD-J-005: script expression comparisons are symmetric and bounded for generated JSON values", () => {
  const next = random(SEED ^ 0x505);
  const primitives: unknown[] = [null, false, true, 0, 1, -1, 1.5, "", "0", "true", "false", "日本語"];
  const value = (depth: number): unknown => {
    if (!depth || next() < 0.7) return choose(next, primitives);
    if (next() < 0.5) return [value(depth - 1), value(depth - 1)];
    return { left: value(depth - 1), right: value(depth - 1) };
  };
  for (let i = 0; i < 500; i++) {
    const a = value(3), b = value(3);
    assert.equal(matchesValueCondition(a, "eq", b), matchesValueCondition(b, "eq", a),
      "seed=" + SEED + " case=" + i);
    assert.equal(withinScriptValueLimit(a), true, "generated value rejected, case=" + i);
    assert.equal(withinScriptValueLimit(b), true, "generated value rejected, case=" + i);
  }
  assert.equal(matchesValueCondition(Number.NaN, "gt", 1), false);
  assert.equal(matchesValueCondition(Number.POSITIVE_INFINITY, "lte", "Infinity"), false);
  const cyclic: { child?: unknown } = {};
  cyclic.child = cyclic;
  assert.equal(withinScriptValueLimit(cyclic), false);
  let oversized: unknown = "leaf";
  for (let i = 0; i < 70; i++) oversized = { next: oversized };
  assert.equal(withinScriptValueLimit(oversized), false);
});

test("AUD-J-006: variable writes cannot mutate inherited prototypes or their input", () => {
  const before = ({} as Record<string, unknown>).polluted;
  const next = random(SEED ^ 0x606);
  const names = [
    "state.value", "state.__proto__.polluted", "__proto__.polluted",
    "constructor.prototype.polluted", "array.0.value", "array.1.name", "state.a.b",
  ];
  for (let i = 0; i < 200; i++) {
    const vars: Record<string, unknown> = { state: { original: true }, array: [{ original: true }] };
    const snapshot = structuredClone(vars);
    const name = choose(next, names);
    const result = setVarPath(vars, name, i);
    assert.notEqual(result, undefined, "seed=" + SEED + " case=" + i);
    assert.deepEqual(snapshot, { state: { original: true }, array: [{ original: true }] });
    assert.equal(({} as Record<string, unknown>).polluted, before);
    assert.equal(Object.getPrototypeOf(vars), Object.prototype);
  }
});
