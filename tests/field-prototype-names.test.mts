import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldDefaults, fieldStateValues } from "../lib/fields";
import { makeBox } from "../lib/presets";
import type { DocNode } from "../lib/types";

const field = (name: string, kind: "input" | "select" | "radio" = "input"): DocNode => ({
  ...makeBox(), id: `node-${name}`, type: "field", attrId: name,
  field: kind === "radio" ? { kind, group: "choice", label: "Selected", checked: true }
    : { kind, defaultValue: "Selected", options: ["Selected"] },
});
for (const name of ["constructor", "toString", "__proto__"]) {
  test(`field defaults preserve an own value for the valid ID ${name}`, () => {
    const values = fieldDefaults([field(name)]);
    assert.equal(Object.hasOwn(values, name), true);
    assert.equal(values[name], "Selected");
    assert.equal(Object.getPrototypeOf(values), Object.prototype);
  });
}
test("radio item and select state variables preserve a __proto__ ID", () => {
  for (const kind of ["radio", "select"] as const) {
    const values = kind === "radio" ? { choice: "Selected" } : { ["__proto__"]: "Selected" };
    const result = fieldStateValues([field("__proto__", kind)], values);
    assert.equal(Object.hasOwn(result, "__proto__"), true);
    assert.equal(result.__proto__, kind === "radio" ? "true" : "Selected");
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
  }
});

test("missing field values do not read inherited object members", () => {
  for (const name of ["constructor", "toString", "__proto__"]) {
    assert.equal(fieldStateValues([field(name)], {})[`${name}.length`], "0");
  }
});
