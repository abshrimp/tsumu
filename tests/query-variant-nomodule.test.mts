import assert from "node:assert/strict";
import { test } from "node:test";
import { QUERY_VARIANT_RUNTIME } from "../lib/generator/query-route";

// A module-capable browser ignores classic nomodule scripts without dispatching
// load/error. The router must not await an event that the browser never emits.
async function bootstrap(moduleCapable: boolean, type = "") {
  const inserted: string[] = [];
  const attributes = [{ name: "nomodule", value: "" }, { name: "src", value: "/legacy.js" }, { name: "type", value: type }];
  const old = {
    attributes, textContent: "",
    ...(moduleCapable ? { noModule: true } : {}),
    getAttribute: (name: string) => attributes.find(a => a.name === name)?.value ?? null,
    hasAttribute: (name: string) => attributes.some(a => a.name === name),
    replaceWith(script: any) {
      inserted.push("authored");
      if (!moduleCapable || type === "module") queueMicrotask(() => script.onload?.());
    },
  };
  const document = {
    currentScript: { getAttribute: () => JSON.stringify(["/data-loader.js", "/scripts.js"]) },
    documentElement: {},
    querySelector: (selector: string) => selector === "[data-variant-root]"
      ? { innerHTML: "", querySelectorAll: () => [old] }
      : selector === "script[data-page-variants]"
        ? { textContent: JSON.stringify([{ query: {}, html: "" }]) } : null,
    createElement: () => ({ text: "", src: "", setAttribute() {} }),
    body: { appendChild(script: any) { inserted.push(script.src); queueMicrotask(() => script.onload?.()); } },
  };
  new Function("document", "location", "URLSearchParams", QUERY_VARIANT_RUNTIME)(document, { search: "" }, URLSearchParams);
  await new Promise<void>(resolve => setImmediate(resolve));
  return inserted;
}

test("query variants do not wait for ignored classic nomodule scripts", async () => {
  assert.deepEqual(await bootstrap(true), ["/data-loader.js", "/scripts.js"]);
});

test("nomodule scripts still run when the browser does not support modules", async () => {
  assert.deepEqual(await bootstrap(false), ["authored", "/data-loader.js", "/scripts.js"]);
});

test("the nomodule attribute does not suppress module scripts", async () => {
  assert.deepEqual(await bootstrap(true, "module"), ["authored", "/data-loader.js", "/scripts.js"]);
});

test("the nomodule attribute does not suppress import maps", async () => {
  assert.deepEqual(await bootstrap(true, "importmap"), ["authored", "/data-loader.js", "/scripts.js"]);
});
