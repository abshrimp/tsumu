import assert from "node:assert/strict";
import { test } from "node:test";
import { SCRIPT_RUNTIME } from "../lib/script-runtime";
import { generateProject } from "../lib/generator";
import { createInitialDoc } from "../lib/presets";

test("script storage fallback retains prototype-like keys when cookies and localStorage are disabled", () => {
  const start = SCRIPT_RUNTIME.indexOf('  var prefix = "";');
  const end = SCRIPT_RUNTIME.indexOf("  /*/store*/", start);
  assert.ok(start >= 0 && end > start, "the runtime must contain its storage implementation");
  const code = SCRIPT_RUNTIME.slice(start, end);
  const unavailable = () => { throw new Error("storage unavailable"); };
  const location = { hostname: "site.example", protocol: "https:" };
  const document = { get cookie() { return unavailable(); }, set cookie(_value: string) { unavailable(); } };
  const localStorage = {
    getItem: unavailable, setItem: unavailable, removeItem: unavailable,
  };
  const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
  const storage = new Function(
    "env", "location", "document", "localStorage", "has",
    code + "\nreturn { storeGet, storeSet };",
  )({ storePrefix: "" }, location, document, localStorage, has) as {
    storeGet: (key: string, shared: boolean) => string;
    storeSet: (key: string, value: string, shared: boolean) => void;
  };
  for (const shared of [false, true]) {
    for (const key of ["__proto__", "constructor", "toString", "ordinary"]) {
      storage.storeSet(key, "value for " + key, shared);
      assert.equal(storage.storeGet(key, shared), "value for " + key);
    }
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("script storage round-trips primitive and structured JSON values locally and through shared cookies", () => {
  const start = SCRIPT_RUNTIME.indexOf('  var prefix = "";');
  const end = SCRIPT_RUNTIME.indexOf("  /*/store*/", start);
  const storageSource = SCRIPT_RUNTIME.slice(start, end);
  const values = new Map<string, string>();
  const cookies = new Map<string, string>();
  const document = {
    get cookie() { return [...cookies.values()].join("; "); },
    set cookie(raw: string) {
      const pair = raw.split(";", 1)[0];
      const key = pair.slice(0, pair.indexOf("="));
      if (/; max-age=0(?:;|$)/i.test(raw)) cookies.delete(key);
      else cookies.set(key, pair);
    },
  };
  const localStorage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
  const storage = new Function("env", "location", "document", "localStorage", "has",
    storageSource + "\nreturn { storeGet, storeSet };")(
      { storePrefix: "", sharedDomain: "example.com" }, { hostname: "one.example.com", protocol: "https:" },
      document, localStorage,
      (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key),
    ) as { storeGet(k: string, shared: boolean): unknown; storeSet(k: string, v: unknown, shared: boolean): void };
  const cases: Array<[string, unknown]> = [
    ["number", 12], ["string", "0012"], ["text", "日本語 + quoted \"text\""],
    ["json-looking-string", '{"city":"Kyoto"}'], ["prefix-string", "tsumu-store-v1:plain"],
    ["envelope-looking-string", 'tsumu-store-v1:{"value":12,"missing":false}'],
    ["boolean", false], ["null", null],
    ["array", [1, false, null, { city: "Kyoto" }]],
    ["dictionary", { a: 1, b: [2] }], ["missing", undefined],
  ];
  for (const shared of [false, true]) {
    for (const [key, value] of cases) {
      storage.storeSet(key, value, shared);
      assert.deepEqual(storage.storeGet(key, shared), value, key);
      assert.equal(cookies.has(key), shared);
      if (typeof value === "string" && key !== "envelope-looking-string") {
        const raw = shared
          ? decodeURIComponent((cookies.get(key) ?? "").slice(key.length + 1))
          : values.get(key);
        assert.equal(raw, value, `stored string must be verbatim: ${key}`);
      }
    }
    assert.equal(storage.storeGet("absent", shared), undefined);
  }
  document.cookie = "external=0012";
  assert.equal(storage.storeGet("external", true), "0012");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("exported browser script includes prototype-free storage", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [
      { id: "save", kind: "store-save", key: "__proto__", value: "value" },
      { id: "read", kind: "store-load", key: "__proto__", into: "record" },
    ],
  }];
  const file = generateProject(doc).files["public/scripts.js"];
  assert.ok(file);
  assert.match(file, /var mem = Object\.create\(null\)/);
});
