import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import ts from "@typescript/typescript6";
import { VARS_RUNTIME, interpolate, varText } from "../lib/vars";
import { compareValues } from "../lib/data";
import { nativeDataModule } from "../lib/generator/native-data";
import { SCRIPT_RUNTIME } from "../lib/script-runtime";

function exportsOf(source: string) {
  const module = { exports: {} as any };
  runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, { module });
  return module.exports;
}
const generated = exportsOf(VARS_RUNTIME);
const native = exportsOf(nativeDataModule());
const deep = JSON.parse("[".repeat(20_000) + '"value"' + "]".repeat(20_000));

test("generated variable helpers typecheck with strict TypeScript", () => {
  const file = "/generated-value-text-vars.ts";
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  host.getSourceFile = (name, language, onError, createNew) => name === file
    ? ts.createSourceFile(name, VARS_RUNTIME, language, true)
    : original(name, language, onError, createNew);
  const program = ts.createProgram([file], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});

test("small, deeply nested fetched JSON remains renderable in editor and generated modules", () => {
  assert.equal(varText(deep), "value");
  assert.equal(interpolate("Result: {value}", { value: deep }), "Result: value");
  assert.equal(generated.varText(deep), "value");
  assert.equal(native.resolveText("Result: {value}", { value: deep }), "Result: value");
  assert.equal(compareValues(deep, "value"), 0);
});

test("list formatting preserves empty values, nested separators and repeated shared subtrees", () => {
  const shared = ["a", null, ["b", "", {}, false, 0]];
  const value = [shared, [], shared];
  const expected = "a, b, false, 0, a, b, false, 0";
  for (const render of [varText, generated.varText, (value: unknown) => native.resolveText("{value}", { value })]) {
    assert.equal(render(value), expected);
    assert.equal(render([, null, [undefined, []], "", {}]), "");
  }
  assert.equal(compareValues(value, "a,,b,,[object Object],false,0,,a,,b,,[object Object],false,0"), 0);
});

test("cyclic arrays stop at the active branch while preserving later values", () => {
  const cycle: unknown[] = ["before"];
  cycle.push(cycle, "after");
  for (const render of [varText, generated.varText, (value: unknown) => native.resolveText("{value}", { value })]) {
    assert.equal(render(cycle), "before, after");
  }
  assert.equal(compareValues(cycle, "before,,after"), 0);
});

test("shared list expansion cannot grow formatted text beyond the JSON data budget", () => {
  const shared = "x".repeat(3 * 1024 * 1024);
  for (const render of [varText, generated.varText, (value: unknown) => native.resolveText("{value}", { value })]) {
    assert.equal(render([shared, shared]), "");
    assert.equal(render([shared]), shared, "an ordinary bounded value remains intact");
  }
  assert.equal(compareValues([shared, shared], ""), 0);
});

test("sparse lists have a traversal budget instead of allocating their entire length", () => {
  assert.equal(varText(new Array(0xffffffff)), "");
});

test("DOM runtime initializes live text from deeply nested server values", () => {
  const output = {
    firstChild: { nodeType: 3, nodeValue: "" },
    getAttribute: () => "Result: {value}",
    closest: () => null,
  };
  const root = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-live]" ? [output] : [],
    addEventListener() {}, removeEventListener() {},
  };
  const dispose = runInNewContext(`(${SCRIPT_RUNTIME})({}).install(document, { value });`, {
    document: root, value: deep, CSS: { escape: (value: string) => value },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame() {},
  });
  assert.equal(output.firstChild.nodeValue, "Result: value");
  dispose();
});
