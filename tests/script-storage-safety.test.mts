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
  const document = { get cookie() { return ""; }, set cookie(_value: string) { unavailable(); } };
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
  for (const key of ["__proto__", "constructor", "toString", "ordinary"]) {
    storage.storeSet(key, "value for " + key, false);
    assert.equal(storage.storeGet(key, false), "value for " + key);
  }
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
