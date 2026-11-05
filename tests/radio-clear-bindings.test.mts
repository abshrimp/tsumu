import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import type { SiteDoc } from "../lib/types";
import { radioClearDoc } from "./helpers/radio-clear-bindings";

/** DOMの入力状態と通知だけを用意し、書き出した実ランタイムを実行する。 */
function harness(options: { preview?: boolean; clearOnChange?: boolean; live?: boolean; configure?: (doc: SiteDoc) => void } = {}) {
  const doc = radioClearDoc(options.clearOnChange);
  if (options.live === false) {
    delete doc.nodes.result.text;
    delete doc.nodes.counts.text;
    delete doc.nodes.dependent.field;
  }
  options.configure?.(doc);
  const listeners = new Map<string, Array<(event: any) => void>>();
  const events: string[] = [];
  const elements: Element[] = [];
  class Element {
    nodeType = 1;
    parentElement: Element | null = null;
    firstChild: { nodeType: number; nodeValue: string } | null = null;
    attrs = new Map<string, string>();
    input?: Element;
    type = "";
    name = "";
    value = "";
    placeholder = "";
    private selected = false;
    constructor(public id: string, public tagName = "DIV") { elements.push(this); }
    get checked() { return this.selected; }
    set checked(on: boolean) {
      this.selected = on;
      // 同じフォーム・グループのラジオを選ぶと、元の選択はnative DOMが外す。
      if (on && this.type === "radio" && this.name) {
        for (const other of elements) if (other !== this && other.type === "radio" && other.name === this.name && other.form() === this.form()) other.selected = false;
      }
    }
    form(): Element | null { return this.tagName === "FORM" ? this : this.parentElement?.form() ?? null; }
    getAttribute(key: string) { return this.attrs.get(key) ?? null; }
    setAttribute(key: string, value: string) { this.attrs.set(key, value); }
    hasAttribute(key: string) { return this.attrs.has(key); }
    matches(selector: string) { return selector.split(",").some((tag) => tag.toUpperCase() === this.tagName); }
    querySelector() { return this.input ?? null; }
    closest(selector: string): Element | null {
      if (selector === "[data-scripts]") return this.hasAttribute("data-scripts") ? this : this.parentElement?.closest(selector) ?? null;
      return null;
    }
    dispatchEvent(event: Event) {
      events.push(`${this.parentElement?.id ?? this.id}:${event.type}`);
      emit(event.type, this);
      return true;
    }
  }
  const byId = new Map<string, Element>();
  for (const node of Object.values(doc.nodes)) {
    const el = new Element(node.attrId ?? node.id, node.semantic === "button" ? "BUTTON" : node.semantic === "form" ? "FORM" : "DIV");
    byId.set(node.id, el);
    if (node.scripts) el.setAttribute("data-scripts", JSON.stringify(node.scripts));
    if (node.text) {
      el.setAttribute("data-live", node.text.content);
      el.firstChild = { nodeType: 3, nodeValue: "" };
    }
    if (node.field) {
      const input = new Element("", "INPUT");
      input.parentElement = el;
      el.input = input;
      input.type = node.field.kind === "radio" ? "radio" : "text";
      input.name = node.field.group ?? "";
      input.value = node.field.kind === "radio" ? node.field.label ?? "" : "";
      input.checked = !!node.field.checked;
      if (node.field.defaultValue) input.setAttribute("data-live-value", node.field.defaultValue);
      if (node.field.placeholder) input.setAttribute("data-live-placeholder", node.field.placeholder);
    }
  }
  for (const node of Object.values(doc.nodes)) for (const child of node.children ?? []) byId.get(child)!.parentElement = byId.get(node.id)!;
  function query(selector: string) {
    if (selector.startsWith("#")) return elements.filter((el) => el.id === selector.slice(1));
    const group = /^input\[type="radio"\]\[name="([^"]+)"\]$/.exec(selector);
    if (group) return elements.filter((el) => el.type === "radio" && el.name === group[1]);
    const attr = /^\[([^\]]+)\]$/.exec(selector);
    return attr ? elements.filter((el) => el.hasAttribute(attr[1])) : [];
  }
  const root = {
    querySelector: (selector: string) => query(selector)[0] ?? null,
    querySelectorAll: query, contains: () => true,
    addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, [...listeners.get(name) ?? [], fn]),
    removeEventListener: () => {},
  };
  function emit(type: string, target: Element) {
    for (const fn of listeners.get(type) ?? []) fn({ target, isTrusted: false });
  }
  const dispose = runInNewContext(options.preview ? `(${SCRIPT_RUNTIME})({}).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (value: string) => value }, Event,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout, clearTimeout,
  });
  return {
    click: (id: string) => emit("click", byId.get(id)!),
    input: (id: string) => byId.get(id)!.input!,
    text: (id: string) => byId.get(id)!.firstChild!.nodeValue,
    select(id: string) { const input = byId.get(id)!.input!; input.checked = true; emit("input", input); },
    events, dispose,
  };
}

function assertCleared(h: ReturnType<typeof harness>) {
  assert.equal(h.input("small").checked, false);
  assert.equal(h.input("medium").checked, false);
  assert.equal(h.input("red").checked, true);
  assert.equal(h.text("result"), "size=; small=false; medium=false; index=; color=red");
  assert.equal(h.input("dependent").value, "Selected: ");
  assert.equal(h.input("dependent").placeholder, "Index: ");
}

for (const preview of [false, true]) {
  for (const button of ["clear-item-0", "clear-item-1", "clear-item-2", "clear-item-3", "clear-item-4", "clear-group", "unknown-group"]) {
    test(`${preview ? "full" : "published"} runtime refreshes live bindings for ${button} without firing change scripts`, () => {
      const h = harness({ preview });
      assert.equal(h.text("result"), "size=S; small=true; medium=false; index=1; color=red");
      h.click(button);
      assertCleared(h);
      assert.equal(h.text("counts"), "||");
      assert.deepEqual(h.events, [], "a deselected radio must not fire input/change");
      h.click(button);
      assertCleared(h);
      assert.deepEqual(h.events, [], "clearing again must remain a no-op");
      h.dispose();
    });
  }
}

test("changing the selection fires only the newly selected radio, in either DOM order", () => {
  const h = harness();
  h.click("select-medium");
  assert.equal(h.text("result"), "size=M; small=false; medium=true; index=2; color=red");
  assert.equal(h.text("counts"), "|1|");
  h.click("select-medium");
  assert.equal(h.text("counts"), "|1|");
  h.click("select-small");
  assert.equal(h.text("result"), "size=S; small=true; medium=false; index=1; color=red");
  assert.equal(h.text("counts"), "1|1|");
  assert.deepEqual(h.events, ["medium:input", "medium:change", "small:input", "small:change"]);
  h.click("clear-group");
  assertCleared(h);
  assert.equal(h.text("counts"), "1|1|");
  h.dispose();
});

test("a change script can clear its own radio without recursion or stale bindings", () => {
  const h = harness({ clearOnChange: true });
  h.click("select-medium");
  h.click("select-small");
  assertCleared(h);
  assert.equal(h.text("counts"), "1|1|");
  assert.deepEqual(h.events, ["medium:input", "medium:change", "small:input", "small:change"]);
  h.dispose();
});

test("normal user selection still refreshes bindings and runs exactly one change script", () => {
  const h = harness();
  h.click("clear-group");
  h.select("medium");
  assert.equal(h.text("result"), "size=M; small=false; medium=true; index=2; color=red");
  assert.equal(h.text("counts"), "|1|");
  h.click("clear-item-0");
  assert.equal(h.input("medium").checked, true, "clearing an unselected item does not clear the group");
  assert.equal(h.text("counts"), "|1|");
  h.dispose();
});

test("the pruned runtime also clears radios when no live bindings are present", () => {
  const h = harness({ live: false });
  h.click("clear-group");
  assert.equal(h.input("small").checked, false);
  assert.deepEqual(h.events, []);
  h.dispose();
});


test("a set-only bundle works without live fields or change handlers", () => {
  const h = harness({ live: false, configure(doc) {
    for (const node of Object.values(doc.nodes)) if (node.field?.kind === "radio") delete node.scripts;
  } });
  h.click("clear-group");
  assert.equal(h.input("small").checked, false);
  h.click("select-medium");
  assert.equal(h.input("medium").checked, true);
  h.click("unknown-group");
  assert.equal(h.input("medium").checked, false);
  assert.deepEqual(h.events, ["medium:input", "medium:change"]);
  h.dispose();
});

test("conditions after clearing read the new individual, group and index values", () => {
  const h = harness({ configure(doc) {
    doc.nodes["clear-group"].scripts![0].steps.push({
      id: "read-item", kind: "if", cond: { subject: "value", target: "small", op: "eq", value: "false" }, then: [{
        id: "read-group", kind: "if", cond: { subject: "var", target: "", left: "{size}|{small}|{size.index}", op: "eq", value: "|false|" }, then: [{
          id: "confirmed", kind: "set-var", into: "smallChanges", value: "cleared",
        }],
      }],
    });
  } });
  h.click("clear-group");
  assertCleared(h);
  assert.equal(h.text("counts"), "cleared||");
  assert.deepEqual(h.events, []);
  h.dispose();
});
