import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

function mountPicker() {
  const source = readFileSync("components/script-editor/ValueTransformSettings.tsx", "utf8");
  const picker = source.slice(source.indexOf("function fieldSuggestions("), source.indexOf("function RecipeStepSettings("));
  const slots: any[] = [];
  let cursor = 0, value = "商品";
  const changes: string[] = [];
  const context: any = {
    useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useId() { cursor++; return "field-key"; },
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useMemo: (fn: () => unknown) => fn(), useEffect() {}, tr: (text: string) => text,
    ChevronDown() {}, createPortal: (child: unknown) => child,
    React: { createElement: (type: unknown, props: any, ...children: unknown[]) => ({ type, props: { ...props, children } }) },
  };
  runInNewContext(transformSync(picker + "\nglobalThis.picker = FieldKeyPicker;", { loader: "tsx", jsx: "transform" }).code, context);
  const input = () => {
    cursor = 0;
    return context.picker({ value, options: ["商品名", "商品番号"], onChange(next: string) { value = next; changes.push(next); } }).props.children[0].props;
  };
  input().onFocus();
  return { input, changes, press(key: string, nativeEvent = {}) {
    let prevented = 0, stopped = 0;
    input().onKeyDown({ key, nativeEvent, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
    return { prevented, stopped };
  } };
}

for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
  for (const key of ["Enter", "ArrowDown", "ArrowUp", "Escape"]) {
    test(`field picker leaves ${key} to IME (${JSON.stringify(nativeEvent)})`, () => {
      const picker = mountPicker();
      const before = picker.input();
      assert.deepEqual(picker.press(key, nativeEvent), { prevented: 0, stopped: 0 });
      const after = picker.input();
      assert.equal(after.value, before.value);
      assert.equal(after["aria-expanded"], true);
      assert.equal(after["aria-activedescendant"], before["aria-activedescendant"]);
      assert.deepEqual(picker.changes, []);
    });
  }
}

test("field picker supports ordinary arrows, Enter and Escape after composition", () => {
  const picker = mountPicker();
  assert.equal(picker.press("ArrowDown").prevented, 1);
  assert.equal(picker.press("Enter").prevented, 1);
  assert.deepEqual(picker.changes, ["商品番号"]);
  assert.equal(picker.input()["aria-expanded"], false);
  picker.input().onFocus();
  assert.deepEqual(picker.press("Escape"), { prevented: 1, stopped: 1 });
  assert.equal(picker.input()["aria-expanded"], false);
  assert.equal(picker.input().value, "商品番号");
  assert.deepEqual(picker.changes, ["商品番号"]);
});
