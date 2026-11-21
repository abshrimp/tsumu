import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { nativeDataModule } from "../lib/generator/native-data";

test("native field bindings restore prior page data and the authored defaults after reset", async () => {
  const { formScope, setField, resetFields, resolveText } = await import(
    "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64")
  );
  const form = {};
  const base = { source: "cobalt" };
  const defaults = [["choice", "{source}", ["other", "cobalt", "moss"]], ["source", "blue"], ["check", "true"]];
  const scope = () => formScope(base, defaults);
  const output = () => resolveText("{choice}|{source}|{check}", scope());
  assert.equal(output(), "cobalt|cobalt|true");
  setField(scope(), "source", { target: { form, value: "moss" } });
  assert.equal(output(), "moss|moss|true");
  setField(scope(), "choice", { target: { form, value: "other" } });
  setField(scope(), "check", { target: { form, type: "checkbox", checked: false } });
  const reset = async (defaultPrevented: boolean) => {
    resetFields({ target: form, defaultPrevented });
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  await reset(true);
  assert.equal(output(), "other|moss|false");
  await reset(false);
  assert.equal(output(), "cobalt|cobalt|true");
  assert.deepEqual(base, { source: "cobalt" });
});

test("textarea defaults retain their first newline through HTML parsing and client rendering", () => {
  const source = nativeDataModule().replace(/\bexport /g, "") + "\ntextareaText(initial)";
  const initial = "\r\nFirst\r\nSecond";
  assert.equal(runInNewContext(source, { initial }), "\n\nFirst\nSecond");
  assert.equal(runInNewContext(source, { initial, document: {} }), "\nFirst\nSecond");
});
