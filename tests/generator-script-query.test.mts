import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { generateProject } from "../lib/generator";
import { makeBox } from "../lib/presets";
import type { Script, SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);
const script = (steps: Script["steps"]): Script => ({ id: "s", trigger: "click", pos: { x: 0, y: 0 }, steps });
function fixture(s: Script, pageScript = false): SiteDoc {
  const node = { ...makeBox(), id: "button", ...(pageScript ? {} : { scripts: [s] }) };
  return {
    siteName: "Query test", assets: {}, nodes: { button: node }, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["button"], ...(pageScript ? { pageScripts: [{ ...s, trigger: "load" }] } : {}) } },
  };
}
async function renderedScript(doc: SiteDoc, query: Record<string, string>, pageScript = false) {
  const source = generateProject(doc).files["app/page.tsx"];
  assert.match(source, /export const dynamic = "force-dynamic"/);
  const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  const mod = { exports: {} as { default: (props: object) => Promise<any> } };
  const localRequire = (name: string) => require(name === "@/lib/vars" ? "../lib/vars" : name);
  new Function("require", "module", "exports", code)(localRequire, mod, mod.exports);
  const tree = await mod.exports.default({ searchParams: Promise.resolve(query) });
  return JSON.parse(tree.props.children[pageScript ? 0 : 1].props["data-scripts"]);
}

test("クエリをスクリプトだけで使う場合も、リクエストごとの値を渡す", async () => {
  const doc = fixture(script([{ id: "go", kind: "open-url", url: "/search?q={q}" }]));
  for (const q of ["hello world", "another"]) {
    const scripts = await renderedScript(doc, { q });
    assert.equal(scripts[0].steps[0].url, `/search?q=${encodeURIComponent(q)}`);
  }
});

test("ページの条件分岐にしかないクエリも失われない", async () => {
  const doc = fixture(script([{ id: "if", kind: "if", cond: { subject: "var", target: "", left: "{campaign}", op: "eq", value: "sale" }, then: [{ id: "go", kind: "open-url", url: "/sale?from={source}" }] }]), true);
  const scripts = await renderedScript(doc, { campaign: "sale", source: "mail" }, true);
  assert.deepEqual(scripts[0].steps[0].cond.left, { inputRef: "campaign", raw: "sale" });
  assert.equal(scripts[0].steps[0].then[0].url, "/sale?from=mail");
});

test("画面上で作る変数だけのスクリプトは ISR を維持する", () => {
  const doc = fixture(script([{ id: "set", kind: "set-var", into: "local", value: "hello" }, { id: "go", kind: "open-url", url: "/search?q={local}" }]));
  const source = generateProject(doc).files["app/page.tsx"];
  assert.match(source, /export const revalidate = 60/);
  assert.doesNotMatch(source, /await searchParams/);
});

test("クリック時にクエリを変数へコピーする場合も元の値を渡す", async () => {
  const doc = fixture(script([{ id: "copy", kind: "set-var", into: "local", value: "{source}" }]));
  const scripts = await renderedScript(doc, { source: "newsletter" });
  assert.equal(scripts[0].steps[0].raw, "newsletter");
});


test("ブラウザで同名の変数を作っても、配信前の取得にはクエリを使う", () => {
  const doc = fixture(script([{ id: "set", kind: "set-var", into: "q", value: "clicked" }]));
  doc.nodes.button.link = { kind: "url", url: "/?q=initial" };
  doc.pages.p.pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "fetch", kind: "fetch", url: "https://example.com/api?q={q}", as: "result" }],
  }];
  const source = generateProject(doc).files["app/page.tsx"];
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /await searchParams/);
  assert.doesNotMatch(source, /export const revalidate/);
});
