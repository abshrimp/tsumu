import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
// TypeScript 7 の CLI と併用する、構文解析・変換用の公式互換 API。
import ts from "@typescript/typescript6";
import { generateProject } from "../lib/generator";
import { headHtmlToJsx } from "../lib/generator/head";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { DocNode, SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);

function fixture(nodes: DocNode[]): SiteDoc {
  return {
    siteName: "Export test",
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: nodes.map((n) => n.id) } },
    pageOrder: ["p"], nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), assets: {},
  };
}

function evaluate(source: string) {
  const result = ts.transpileModule(source, {
    fileName: "fixture.tsx", reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.deepEqual(result.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  const mod = { exports: {} as { default: () => any } };
  new Function("require", "module", "exports", result.outputText)(require, mod, mod.exports);
  return mod.exports.default();
}

test("exported JSX preserves quotes, backslashes, newlines and literal HTML entities", () => {
  for (const value of ['Say "hello"', "C:\\new\\test", "line 1\r\nline 2\tend", "&copy; &amp; &#34;", "<hello> 日本語"]) {
    const doc = fixture([
      { ...makeBox(), id: "field", type: "field", field: { kind: "input", placeholder: value, defaultValue: value } },
      { ...makeBox(), id: "image", type: "image", image: { src: "/image.png", alt: value, width: 10, height: 10 } },
      { ...makeBox(), id: "link", link: { kind: "url", url: `https://example.com/?q=${value}` } },
    ]);
    const tree = evaluate(generateProject(doc).files["app/page.tsx"]);
    const [, field, image, link] = tree.props.children;
    assert.equal(field.props.placeholder, value);
    assert.equal(field.props.defaultValue, value);
    assert.equal(image.props.alt, value);
    assert.equal(link.props.href, `https://example.com/?q=${value}`);
  }
});

test("custom head attributes preserve HTML entities and embedded quotes", () => {
  const jsx = headHtmlToJsx(`<meta name="description" content='Say "hello" &amp; goodbye'>`, "");
  const tree = evaluate(`export default function Head() { return (${jsx}); }`);
  assert.equal(tree.props.content, 'Say "hello" & goodbye');
});

test("custom head attributes unknown to React's types do not break the typecheck", () => {
  const jsx = headHtmlToJsx(`<script language="javascript" src="/x.js?a=1&amp;b=2" style="color:red" data-id="7"></script><meta name="a" content="b" scheme="&#x41;&amp;">`, "");
  assert.doesNotMatch(jsx, / language=| scheme=|style/);
  const tree = evaluate(`export default function Head() { return (<>${jsx}</>); }`);
  const [script, meta] = tree.props.children;
  assert.deepEqual(script.props, { language: "javascript", src: "/x.js?a=1&b=2", "data-id": "7" });
  assert.equal(meta.props.scheme, "A&");
});

test("generated components avoid framework names and the exported project typechecks", () => {
  const names = ["Page", "Image", "Link", "Fragment", "SmartLink", "SearchForm", "SiteLoadingScreen", "PageHtml", "Metadata", "Vars", "Item", "Image2", "Object", "Array", "Promise", "Record", "JSON", "Error", "Number", "String", "Boolean", "Proxy", "RequestInit"];
  const doc = fixture([]);
  doc.components = {};
  for (const [i, name] of names.entries()) {
    const rootId = `root${i}`;
    const id = `component${i}`;
    doc.components[id] = { id, name, rootId };
    doc.nodes[rootId] = { ...makeBox(), id: rootId, children: [`image${i}`, `link${i}`, `dynamic${i}`] };
    doc.nodes[`image${i}`] = { ...makeBox(), id: `image${i}`, type: "image", image: { src: "/test.png", alt: "Test", width: 10, height: 10 } };
    doc.nodes[`link${i}`] = { ...makeBox(), id: `link${i}`, link: { kind: "url", url: "/" } };
    doc.nodes[`dynamic${i}`] = { ...makeBox(), id: `dynamic${i}`, link: { kind: "url", url: "{target}" } };
    const instance = `instance${i}`;
    doc.nodes[instance] = { ...makeBox(), id: instance, type: "instance", componentId: id };
    doc.pages.p.children.push(instance);
  }
  doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "items" } };
  doc.pages.p.children.push("list");
  doc.pages.p.pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
      { id: "fetch", kind: "fetch", url: "https://example.com/?q={q}", as: "items" },
      { id: "dyn", kind: "fetch", url: "{api}/items", as: "more" },
      { id: "join", kind: "join", array: "items", field: "title", sep: ",", into: "titles" },
      { id: "split", kind: "split", source: "{titles}", sep: ",", into: "parts" },
    ],
  }];
  // 計測タグなどのスクリプトを含むページ専用コード（ページ遷移で開いたときにも動かす）
  doc.pages.p.customEndHtml = `<script src="/tag.js"></script><script>window.tagged = true;</script>`;
  doc.pages.p.customTopHtml = `<script type="application/ld+json">{"@type":"Thing"}</script>`;
  doc.customHeadHtml = `<script language="javascript" src="/x.js"></script><meta name="a" content="b" scheme="c" style="x">`;
  const { files } = generateProject(doc);
  assert.match(files["app/page.tsx"], /<PageHtml html=\{"<script src=/);
  // 取得先のホストが {変数} で決まるときも、接続時に宛先を確かめる fetchPublic で取得する
  assert.match(files["app/page.tsx"], /fetchJson\(interpolateUrl\("\{[^"]*\}\/items", vars\)\)/);
  assert.match(files["app/page.tsx"], /import \{ fetchPublic, readTextLimited \} from "@\/lib\/safe-fetch";/);
  assert.ok(files["lib/safe-fetch.ts"]);
  assert.match(files["app/page.tsx"], /fetchJson\(interpolateUrl\("https:\/\/example\.com\/\?q=\{q\}", vars\)\)/);
  assert.match(files["app/page.tsx"], /dangerouslySetInnerHTML=\{\{ __html: "<script type=\\"application\/ld\+json\\">/);
  assert.match(files["components/PageHtml2.tsx"], /export default function PageHtml2\(\)/);
  const dir = mkdtempSync(join(tmpdir(), "tsumu-export-test-"));
  try {
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    // 書き出すサイトも本体と同じ TypeScript 7 で型チェックする。
    execFileSync(process.execPath, [
      join(dirname(require.resolve("typescript/package.json")), "bin/tsc"),
      "--project", join(dir, "tsconfig.json"), "--noEmit", "--incremental", "false",
    ], { cwd: dir, stdio: "pipe" });
    assert.match(files["components/SmartLink.tsx"], /export default function SmartLink\(/);
    assert.match(files["components/SmartLink2.tsx"], /export default function SmartLink2\(\)/,
      "the user component must not be overwritten by the link helper");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** ページ直下に roots を置き、ほかのノードも doc に入れる */
function site(roots: DocNode[], others: DocNode[] = []): SiteDoc {
  const doc = fixture(roots);
  for (const n of others) doc.nodes[n.id] = n;
  return doc;
}

const load = (steps: object[]) => [{ id: "load", trigger: "load" as const, pos: { x: 0, y: 0 }, steps: steps as never }];
const click = (steps: object[]) => [{ id: "click", trigger: "click" as const, pos: { x: 0, y: 0 }, steps: steps as never }];

test("a link inside a link becomes a click script instead of a nested <a>", () => {
  const inner: DocNode = { ...makeBox(), id: "inner", text: { content: "Inner", heading: 0 }, link: { kind: "url", url: "https://example.com/?a=1&b=2", newTab: true } };
  const outer: DocNode = { ...makeBox(), id: "outer", link: { kind: "url", url: "/about" }, children: ["inner"] };
  const doc = site([outer], [inner]);
  const { files } = generateProject(doc);
  const tree = evaluate(files["app/page.tsx"]);
  const link = tree.props.children[1];
  const child = link.props.children;
  assert.equal(child.type, "p");
  assert.deepEqual(JSON.parse(child.props["data-scripts"]), [
    { trigger: "click", steps: [{ kind: "open-url", url: "https://example.com/?a=1&b=2", newTab: true }] },
  ]);
  assert.match(files["public/scripts.js"], /window\.open/);
  // 編集中のデータはそのまま
  assert.deepEqual(doc.nodes.inner.link, { kind: "url", url: "https://example.com/?a=1&b=2", newTab: true });
});

test("a link inside a component used in a link is converted, and nested forms become divs", () => {
  const compLink: DocNode = { ...makeBox(), id: "compLink", text: { content: "About", heading: 0 }, link: { kind: "page", pageId: "p" } };
  const wrap: DocNode = { ...makeBox(), id: "wrap", link: { kind: "url", url: "https://example.org/" }, children: ["inst"] };
  const inst: DocNode = { ...makeBox(), id: "inst", type: "instance", componentId: "c" };
  const inner: DocNode = { ...makeBox(), id: "innerForm", semantic: "form" };
  const outer: DocNode = { ...makeBox(), id: "outerForm", semantic: "form", children: ["innerForm"] };
  const doc = site([wrap, outer], [compLink, inst, inner]);
  doc.components = { c: { id: "c", name: "Nav", rootId: "compLink" } };
  const { files } = generateProject(doc);
  assert.doesNotMatch(files["components/Nav.tsx"], /<Link|<a /);
  assert.ok(files["components/Nav.tsx"].includes(String.raw`\"kind\":\"open-page\",\"href\":\"/\"`));
  assert.equal(files["app/page.tsx"].match(/<SearchForm/g)?.length, 1);
});

test("a component whose root renders nothing returns null", () => {
  const media: DocNode = { ...makeBox(), id: "media", type: "media", media: { kind: "video", src: "" } };
  const inst: DocNode = { ...makeBox(), id: "inst", type: "instance", componentId: "c" };
  const doc = site([inst], [media]);
  doc.components = { c: { id: "c", name: "Empty", rootId: "media" } };
  const source = generateProject(doc).files["components/Empty.tsx"];
  const result = ts.transpileModule(source, { fileName: "Empty.tsx", reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(result.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  assert.match(source, /return \(\s*null\s*\);/);
});

test("scripts in a browser-rendered list template keep the item's {names}", () => {
  const button: DocNode = { ...makeBox(), id: "pick", semantic: "button", text: { content: "Pick", heading: 0 }, scripts: click([{ id: "s", kind: "set-value", target: "kw", value: "{値}" }]) };
  const list: DocNode = { ...makeBox(), id: "list", type: "list", list: { from: "tags" }, children: ["pick"] };
  const make: DocNode = { ...makeBox(), id: "make", scripts: click([{ id: "sp", kind: "split", source: "a,b", sep: ",", into: "tags" }]) };
  const page = generateProject(site([make, list], [button])).files["app/page.tsx"];
  assert.match(page, /data-client-list/);
  // テンプレートの Proxy を展開すると {値} が空文字になる
  assert.match(page, /"value":interpolate\("\{値\}", iv\d+\)/);
});

test("[slug] pages answer 404 when the API has no item, and metadata reads the same query", () => {
  const title: DocNode = { ...makeBox(), id: "t", text: { content: "{item.title}", heading: 1 } };
  const doc = site([title]);
  doc.pages.p.slug = "items/[slug]";
  doc.pages.p.pageScripts = load([
    { id: "f", kind: "fetch", url: "https://api.example.com/items/{slug}", as: "raw", sample: { title: "A" } },
    { id: "v", kind: "set-var", value: "{raw}", into: "item" },
  ]);
  const isr = generateProject(doc).files["app/items/[slug]/page.tsx"];
  assert.match(isr, /export const revalidate = 60/);
  assert.match(isr, /if \(res\.status === 404 \|\| res\.status === 410\) return null;/);

  // URLのクエリも使う取得: メタデータもクエリを入れてから同じURLを取得する
  (doc.pages.p.pageScripts[0].steps[0] as { url: string }).url = "https://api.example.com/items/{slug}?lang={lang}";
  const dynamic = generateProject(doc).files["app/items/[slug]/page.tsx"];
  const meta = dynamic.slice(dynamic.indexOf("export async function generateMetadata"), dynamic.indexOf("export default"));
  assert.match(meta, /searchParams/);
  // URLの [slug] は ?slug= より優先する
  assert.ok(meta.indexOf("vars[k] = v") < meta.indexOf("vars.slug = slug"));
});

test("a search form inside a component makes the page read the query on every request", () => {
  const input: DocNode = { ...makeBox(), id: "q", type: "field", attrId: "q", field: { kind: "input", inputType: "search" } };
  const label: DocNode = { ...makeBox(), id: "label", text: { content: "{q}を検索", heading: 0 } };
  const form: DocNode = { ...makeBox(), id: "form", semantic: "form", children: ["q", "label"] };
  const inst: DocNode = { ...makeBox(), id: "inst", type: "instance", componentId: "c" };
  const doc = site([inst], [input, label, form]);
  doc.components = { c: { id: "c", name: "Search", rootId: "form" } };
  doc.pages.p.pageScripts = load([{ id: "f", kind: "fetch", url: "https://api.example.com/search?q={q}", as: "res" }]);
  const { files } = generateProject(doc);
  assert.match(files["app/page.tsx"], /export const dynamic = "force-dynamic"/);
  assert.match(files["app/page.tsx"], /await searchParams/);
  // コンポーネントの中でも、入力欄の値を使う文字は入力に合わせて書き直す
  assert.match(files["components/Search.tsx"], /data-live=\{interpolate\("\{q\}を検索", \{ \.\.\.\{\}, \.\.\.\{"q":"\{q\}"/);
});

test("elements shown by page scripts keep their display, custom CSS keeps semicolons in values", () => {
  const banner: DocNode = {
    ...makeBox(), id: "banner", attrId: "banner",
    styles: { base: { default: { display: "none", flexDirection: "row" } } },
    customCss: `background-image: url(data:image/png;base64,iVBORw0KGgo=); content: "a;b $1 $&"`,
  };
  const doc = site([banner]);
  doc.pages.p.pageScripts = load([{ id: "w", kind: "wait", seconds: 1 }, { id: "s", kind: "show", target: "banner" }]);
  const { files } = generateProject(doc);
  assert.match(files["app/page.tsx"], /id="banner" data-toggle-show="flex"/);
  assert.match(files["styles/site.css"], /  background-image: url\(data:image\/png;base64,iVBORw0KGgo=\);\n  content: "a;b \$1 \$&";\n/);
});

test("page URLs starting with an underscore are routed instead of becoming private folders", () => {
  const doc = site([]);
  doc.pages.u = { id: "u", name: "Drafts", slug: "_drafts/notes", title: "Drafts", description: "", children: [] };
  doc.pageOrder.push("u");
  assert.ok(generateProject(doc).files["app/%5Fdrafts/notes/page.tsx"]);
});

test("the site language is used for <html lang>, the manifest and the default 404 page", () => {
  const doc = site([]);
  doc.pwa = { enabled: true };
  assert.match(generateProject(doc).files["app/layout.tsx"], /<html lang="ja">/);
  doc.lang = "zh-Hant";
  const { files } = generateProject(doc);
  assert.match(files["app/layout.tsx"], /<html lang="zh-Hant">/);
  assert.match(files["app/manifest.ts"], /"lang": "zh-Hant"/);
  assert.match(files["app/not-found.tsx"], /Page not found\./);
  // 言語コードでない値は使わない（属性を壊さない）
  doc.lang = `"><script>alert(1)</script>`;
  assert.match(generateProject(doc).files["app/layout.tsx"], /<html lang="ja">/);
});

test("a page in another language wraps its content in a lang element", () => {
  const title: DocNode = { ...makeBox(), id: "t", text: { content: "Hello", heading: 1 } };
  const doc = site([title]);
  doc.lang = "ja";
  assert.doesNotMatch(generateProject(doc).files["app/page.tsx"], /lang=/);
  doc.pages.p.lang = "en";
  const tree = evaluate(generateProject(doc).files["app/page.tsx"]);
  const wrapper = tree.props.children;
  assert.equal(wrapper.props.lang, "en");
  assert.deepEqual(wrapper.props.style, { display: "contents" });
  assert.equal(wrapper.props.children[1].props.children, "Hello");
  // サイトと同じ言語なら包まない
  doc.lang = "en";
  assert.doesNotMatch(generateProject(doc).files["app/page.tsx"], /lang=/);
});

test("moving to a deleted destination preserves the nodes and their original parent", () => {
  for (const kind of ["node", "page"] as const) {
    useEditor.getState().replaceDoc(fixture(["a", "b"].map((id) => ({ ...makeBox(), id }))));
    const before = structuredClone(useEditor.getState().doc);
    useEditor.getState().moveNodes(["a", "b"], { kind, id: "deleted" }, 0);
    assert.deepEqual(useEditor.getState().doc, before);
  }
});

test("moving repeated selections inserts each node only once and can be undone", () => {
  useEditor.getState().replaceDoc(fixture(["a", "b"].map((id) => ({ ...makeBox(), id }))));
  useEditor.getState().moveNodes(["a", "a"], { kind: "node", id: "b" }, 0);
  assert.deepEqual(useEditor.getState().doc.pages.p.children, ["b"]);
  assert.deepEqual(useEditor.getState().doc.nodes.b.children, ["a"]);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.pages.p.children, ["a", "b"]);
});

test("a component master cannot be moved into a page", () => {
  useEditor.getState().replaceDoc(fixture(["a", "b"].map((id) => ({ ...makeBox(), id }))));
  useEditor.getState().createComponent("a");
  const before = structuredClone(useEditor.getState().doc);
  const rootId = Object.values(before.components!)[0].rootId;
  useEditor.getState().moveNodes([rootId], { kind: "page", id: "p" }, 0);
  assert.deepEqual(useEditor.getState().doc, before);
});

test("a corrupted tree with a cycle still generates instead of overflowing the stack", () => {
  const a: DocNode = { ...makeBox(), id: "a", children: ["b"] };
  const b: DocNode = { ...makeBox(), id: "b", text: { content: "B", heading: 0 }, children: ["a"] };
  const list: DocNode = { ...makeBox(), id: "l", type: "list", list: { from: "items" }, children: ["l"] };
  const doc = site([a, list], [b]);
  const page = generateProject(doc).files["app/page.tsx"];
  assert.match(page, /\{"B"\}/);
});

test("generated ids differ even when created in the same millisecond on different clients", async () => {
  const ids = new Set(Array.from({ length: 2000 }, () => makeBox().id));
  assert.equal(ids.size, 2000);
  assert.match(makeBox().id, /^node_[a-z0-9]+$/);
});

test("duplicated elements keep their own custom keyframes", () => {
  const motion = (css: string) => [{ id: "motion_1", trigger: "load" as const, keyframes: "custom", customKeyframes: css, duration: 1, delay: 0, easing: "ease" }];
  const a: DocNode = { ...makeBox(), id: "a", motions: motion("from { opacity: 0 }") };
  const b: DocNode = { ...makeBox(), id: "b", motions: motion("from { transform: scale(0) }") };
  const css = generateProject(site([a, b])).files["styles/site.css"];
  assert.match(css, /@keyframes anim-a-motion_1 \{\n  from \{ opacity: 0 \}/);
  assert.match(css, /@keyframes anim-b-motion_1 \{\n  from \{ transform: scale\(0\) \}/);
});

test("device ranges for hiding leave no gap at fractional screen widths", () => {
  const box: DocNode = { ...makeBox(), id: "x", hiddenOn: ["base"] };
  const css = generateProject(site([box])).files["styles/site.css"];
  // 「パソコンでは非表示」は、すぐ下の画面の max-width をわずかに超えたところから
  const m = /@media \(min-width: ([\d.]+)px\) \{\n  \.[\w-]+ \{\n    display: none;/.exec(css);
  assert.ok(m, css);
  assert.ok(!Number.isInteger(Number(m[1])) && Number(m[1]) % 1 < 0.1, m[1]);
});

test("a fetch URL that cannot be parsed does not stop the export and sends no credentials", () => {
  const doc = fixture([]);
  doc.pages.p.pageScripts = load([
    { id: "fetch", kind: "fetch", url: "https://exa mple.com/items", as: "items", headers: [{ name: "Authorization", value: "Bearer x" }] },
  ]) as never;
  const { files } = generateProject(doc);
  // 取得元のオリジンが決まらないので、資格情報つきの取得は safeRequestOrigin が止める
  assert.match(files["app/page.tsx"], /fetchJson\(interpolateUrl\("https:\/\/exa mple\.com\/items", vars\), JSON\.stringify\(\{ headers: \{ "Authorization": "Bearer x" \} \}\), undefined\)/);
});

test("the script runtime parses as JavaScript (preview and export run it with new Function)", async () => {
  const { SCRIPT_RUNTIME } = await import("../lib/script-runtime");
  // テンプレート文字列の中の正規表現は \\/ と書かないと / で終わり、プレビューのキャンバスごと落ちる
  assert.doesNotThrow(() => new Function(`return (${SCRIPT_RUNTIME})`));
});
