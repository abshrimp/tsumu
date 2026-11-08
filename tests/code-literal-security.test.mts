import assert from "node:assert/strict";
import { test } from "node:test";
import { codeLiteral } from "../lib/generator/code-literal";
import { parseValueOperandInput } from "../lib/script-model/compose";
import { interpolate } from "../lib/vars";
import { applyDocPatch, isDocPatch } from "../lib/doc-patch";
import type { SiteDoc } from "../lib/types";

test("generated code literals preserve values without emitting HTML script terminators", () => {
  for (const original of [
    "</script><script>alert(1)</script>", "<img src=x onerror=alert(1)>",
    "quote \" slash \\ and <>&", "\u2028\u2029", { nested: ["</script>", "<svg/onload=alert(1)>"] },
  ]) {
    const literal = codeLiteral(original);
    assert.deepEqual(JSON.parse(literal), original);
    assert.doesNotMatch(literal, /[<>&\u2028\u2029]/);
  }
  assert.match(codeLiteral("</script>"), /\\u003c\/script\\u003e/);
  assert.throws(() => codeLiteral(undefined), TypeError);
});

test("quoted value-recipe inputs keep braces literal even when preceded by a backslash", () => {
  for (const value of ["{name}", "\\{name}", "x {name} y", "<script>{name}</script>"]) {
    const { operand, operandType } = parseValueOperandInput(JSON.stringify(value));
    assert.equal(operandType, "text");
    assert.equal(interpolate(operand, { name: "INJECTED" }), value);
  }
});

test("document patch never accepts prototype-chain keys", () => {
  const doc = {
    siteName: "Safe", pages: { p: { id: "p", name: "p", slug: "", children: [] } },
    pageOrder: ["p"], nodes: {}, assets: {},
  } as SiteDoc;
  for (const name of ["__proto__", "constructor", "prototype"]) {
    const patch = [{ path: ["nodes", name], value: { injected: true } }];
    assert.equal(isDocPatch(patch), false);
    assert.throws(() => applyDocPatch(doc, patch));
  }
  assert.equal((Object.prototype as Record<string, unknown>).injected, undefined);
});
