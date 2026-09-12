import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, serializeOuter, type DefaultTreeAdapterTypes as Html } from "parse5";
import { convertHtmlToSite } from "../lib/html-to-site";
import { generateExportProject } from "../lib/export-formats";

// DOMParser と同じく、HTML のパーサーの実際の名前空間と、スクリプトが無効なときの noscript の
// ツリーを使う。この準備に必要な DOM の操作だけを合わせる。CSSOM と、結果の書き出しの実行は、
// ブラウザのテストで確かめる。
function importHtml(source: string) {
  const tree = parse(source, { scriptingEnabled: false });
  class NodeAdapter {
    readonly childNodes: NodeAdapter[];
    constructor(readonly node: Html.Node, readonly parentElement: NodeAdapter | null = null) {
      this.childNodes = "childNodes" in node
        ? node.childNodes.map(child => new NodeAdapter(child, this)) : [];
    }
    get nodeType() { return "tagName" in this.node ? 1 : this.node.nodeName === "#text" ? 3 : 9; }
    get tagName() { return "tagName" in this.node ? this.node.tagName.toUpperCase() : ""; }
    get namespaceURI() { return "namespaceURI" in this.node ? this.node.namespaceURI : null; }
    get attributes() { return "attrs" in this.node ? this.node.attrs : []; }
    get id() { return this.getAttribute("id") || ""; }
    get outerHTML() { return serializeOuter(this.node); }
    get textContent(): string {
      return "value" in this.node ? this.node.value : this.childNodes.map(child => child.textContent).join("");
    }
    get children() { return this.childNodes.filter(child => child.nodeType === 1); }
    getAttribute(name: string) { return this.attributes.find(attr => attr.name === name)?.value ?? null; }
    matches(selector: string): boolean {
      if (selector === "[style]") return this.getAttribute("style") !== null;
      if (selector === 'meta[name="description"]') return this.tagName === "META" && this.getAttribute("name") === "description";
      assert.match(selector, /^[a-z]+(?:,\s*[a-z]+)*$/i, "add explicit adapter support for new selectors");
      return selector.split(/,\s*/).some(tag => tag.toUpperCase() === this.tagName);
    }
    querySelectorAll(selector: string): NodeAdapter[] {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector: string): NodeAdapter | null {
      return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
    }
  }
  const root = new NodeAdapter(tree);
  const document = Object.assign(root, {
    head: root.querySelector("head")!, body: root.querySelector("body")!,
    documentElement: root.querySelector("html")!, title: "Code boundaries",
  });
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    DOMParser: class { parseFromString() { return document; } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  });
  try { return convertHtmlToSite(source).doc; }
  finally {
    for (const key of ["DOMParser", "Node"]) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

for (const wrapper of ["noscript", "math"]) {
  for (const code of ["<script>window.inertProbe = 1;</script>", "<style>body { --inert-probe: 1; }</style>"]) {
    test(`HTML import keeps ${wrapper} ${code.startsWith("<script>") ? "scripts" : "styles"} inert`, () => {
      const fallback = `<${wrapper}>${code}</${wrapper}>`;
      const doc = importHtml(`<body>${fallback}<p>Visible content</p></body>`);
      const page = doc.pages[doc.pageOrder[0]];
      assert.doesNotMatch(page.customEndHtml || "", /inertProbe/);
      assert.doesNotMatch(page.customTopHtml || "", /inert-probe/);
      assert.ok(Object.values(doc.nodes).some(node => node.code?.html === fallback),
        "preserve the fallback in its original context");

      const output = generateExportProject(doc, "html").files["index.html"];
      const tree = parse(output); // 公開した文書では、スクリプトが有効になっている。
      const active: string[] = [];
      const visit = (node: Html.Node) => {
        if ("tagName" in node && node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
            ["script", "style"].includes(node.tagName)) active.push(serializeOuter(node));
        if ("childNodes" in node) node.childNodes.forEach(visit);
      };
      visit(tree);
      assert.doesNotMatch(active.join("\n"), /inertProbe|inert-probe/);
    });
  }
}

test("HTML import preserves intentional page scripts and active styles for publication", () => {
  const doc = importHtml('<head><script>window.headProbe = 1;</script></head><body>' +
    '<section><script>window.bodyProbe = 1;</script><style>body { --active-probe: 1; }</style></section></body>');
  const page = doc.pages[doc.pageOrder[0]];
  assert.match(page.customTopHtml || "", /window.headProbe = 1/);
  assert.match(page.customEndHtml || "", /window.bodyProbe = 1/);
  assert.match(page.customTopHtml || "", /--active-probe: 1/);
  const output = generateExportProject(doc, "html").files["index.html"];
  assert.match(output, /window.headProbe = 1/);
  assert.match(output, /window.bodyProbe = 1/);
});
