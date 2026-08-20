import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");

/** 生成済みHTMLのDOM操作を記録するモデル。ネイティブDOM・イベントの証明は e2e/ で別に行う。 */
export class ListDomNode {
  childNodes: ListDomNode[] = [];
  attrs: Record<string, string> = {};
  style = { display: "" };
  parentElement: ListDomNode | null = null;
  nodeValue = "";
  private fieldValue?: string;
  private explicitSelection = false;
  handlers = new Map<string, Function[]>();
  constructor(public nodeType = 1, public tagName = "DIV") {}
  static from(node: any): ListDomNode {
    const el = new ListDomNode(node.nodeType, node.tagName ?? "");
    if (node.nodeType === 3) el.nodeValue = node.text;
    else {
      el.attrs = { ...node.attributes };
      el.style.display = /display:([^;]+)/.exec(el.attrs.style ?? "")?.[1] ?? "";
      for (const c of node.childNodes) el.appendChild(ListDomNode.from(c));
    }
    return el;
  }
  get children() { return this.childNodes.filter(c => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get nextSibling(): ListDomNode | null {
    const siblings = this.parentElement?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(c => c.textContent).join(""); }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(Object.assign(new ListDomNode(3), { nodeValue: value }));
  }
  get type() { return this.attrs.type ?? "text"; }
  get name() { return this.attrs.name ?? ""; }
  get id() { return this.attrs.id ?? ""; }
  get options() { return this.querySelectorAll("option"); }
  get defaultSelected() { return this.hasAttribute("selected"); }
  set defaultSelected(value: boolean) { if (value) this.attrs.selected = ""; else delete this.attrs.selected; }
  get selectedIndex() { const index = this.options.findIndex(o => o.defaultSelected); return index >= 0 || this.explicitSelection ? index : this.options.length ? 0 : -1; }
  set selectedIndex(value: number) { this.explicitSelection = true; this.options.forEach((o, i) => { o.defaultSelected = i === value; }); }
  get defaultValue(): string { return this.tagName === "TEXTAREA" ? this.textContent : this.attrs.value ?? ""; }
  set defaultValue(value: string) { if (this.tagName === "TEXTAREA") this.textContent = value; else this.attrs.value = value; }
  get value(): string {
    if (this.tagName === "SELECT") return this.options[this.selectedIndex]?.value ?? "";
    if (this.tagName === "OPTION") return this.attrs.value ?? this.textContent;
    return this.fieldValue ?? this.defaultValue;
  }
  set value(value: string) {
    if (this.tagName === "SELECT") this.selectedIndex = this.options.findIndex(o => o.value === value);
    else if (this.tagName === "OPTION") this.attrs.value = value;
    else this.fieldValue = value;
  }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  hasAttribute(name: string) { return Object.hasOwn(this.attrs, name); }
  setAttribute(name: string, value: string) { this.attrs[name] = String(value); }
  matches(selector: string): boolean {
    if (this.nodeType !== 1) return false;
    return selector.split(",").some(s => {
      const not = /:not\((.+)\)$/.exec(s);
      if (not) return this.matches(s.slice(0, not.index)) && !this.matches(not[1]);
      if (s.startsWith("#")) return this.attrs.id === s.slice(1);
      const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s);
      if (attr) return attr[2] === undefined ? this.hasAttribute(attr[1]) : this.attrs[attr[1]] === attr[2];
      return this.tagName.toLowerCase() === s.toLowerCase();
    });
  }
  querySelectorAll(selector: string): ListDomNode[] {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): ListDomNode | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(node: ListDomNode): boolean { return node === this || this.childNodes.some(c => c.contains(node)); }
  appendChild(node: ListDomNode) {
    node.parentElement?.removeChild(node); this.childNodes.push(node); node.parentElement = this; return node;
  }
  insertBefore(node: ListDomNode, before: ListDomNode) {
    node.parentElement?.removeChild(node); this.childNodes.splice(this.childNodes.indexOf(before), 0, node); node.parentElement = this;
  }
  removeChild(node: ListDomNode) { this.childNodes = this.childNodes.filter(c => c !== node); node.parentElement = null; }
  cloneNode(deep: boolean) {
    const clone = new ListDomNode(this.nodeType, this.tagName);
    clone.attrs = { ...this.attrs }; clone.style = { ...this.style }; clone.nodeValue = this.nodeValue;
    if (deep) this.childNodes.forEach(c => clone.appendChild(c.cloneNode(true)));
    return clone;
  }
  addEventListener(type: string, fn: Function, capture = false) {
    if (!capture) this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  removeEventListener() {}
}

export function listRuntimeDom(html: string, source: string, globals: Record<string, unknown> = {}) {
  const root = ListDomNode.from(parse(html));
  let mutation = () => {};
  const frames: Array<() => void> = [], vars: Record<string, unknown> = {};
  const dispose = runInNewContext(source, {
    ...globals,
    document: Object.assign(root, { createElement: (tag: string) => new ListDomNode(1, tag.toUpperCase()),
      createTextNode: (value: string) => Object.assign(new ListDomNode(3), { nodeValue: value }) }),
    CSS: { escape: (v: string) => v }, Event,
    getComputedStyle: (el: ListDomNode) => el.style,
    env: { setVar: (name: string, value: unknown) => { vars[name] = value; } },
    MutationObserver: class { constructor(fn: () => void) { mutation = fn; } observe() {} disconnect() {} },
    requestAnimationFrame: (fn: () => void) => frames.push(fn), setTimeout, clearTimeout,
  });
  const scan = () => { mutation(); while (frames.length) frames.shift()!(); };
  const active = (selector: string) => root.querySelectorAll(selector).filter(el => !el.closest("[data-tpl]"));
  return { root, vars, active, dispose, scan,
    async click(id: string, index = 0) {
      const target = active(`#${id}`)[index]; assert.ok(target, id);
      for (const handler of root.handlers.get("click") ?? []) handler({ target, preventDefault() {} });
      await new Promise<void>(done => setImmediate(done)); scan();
    },
    navigate(next: string) {
      for (const c of [...root.childNodes]) root.removeChild(c);
      for (const c of [...ListDomNode.from(parse(next)).childNodes]) root.appendChild(c);
      scan();
    },
  };
}
