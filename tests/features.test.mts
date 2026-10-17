import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTransform, serializeTransform, extractPartStyles } from "../lib/style";
import { interpolateJson, interpolateUrl } from "../lib/vars";
import { fetchRequestOf, bodyJsonError } from "../lib/fetch-request";
import { fieldDefaults, fieldInitialValue, fieldStateValues, fieldValuePatch, fieldVarName } from "../lib/fields";
import { applyCommentAction, parseCommentAction, type CommentThread } from "../lib/comments";
import { obfuscateVarNames, varNamesAt } from "../lib/data";
import { refreshClonedIds } from "../lib/cloneIds";
import { generateProject } from "../lib/generator";
import { runChecks } from "../lib/generator/checks";
import { makeBox, makeField, makeSwitch } from "../lib/presets";
import { usesLiveFields } from "../lib/script-runtime";
import type { DocNode, SiteDoc } from "../lib/types";

test("transform keeps unknown functions and round-trips its parts", () => {
  const t = parseTransform("translateY(-4px) rotate(0.5turn) scale(1.1, 0.9) skewX(10deg) perspective(400px)");
  assert.equal(t.x, "0px");
  assert.equal(t.y, "-4px");
  assert.equal(t.rotate, 180);
  assert.equal(t.scaleX, 1.1);
  assert.equal(t.scaleY, 0.9);
  assert.equal(t.skewX, 10);
  assert.equal(t.rest, "perspective(400px)");
  const again = parseTransform(serializeTransform({ ...t, rotate: 0 })!);
  assert.equal(again.rotate, 0);
  assert.equal(again.y, "-4px");
  assert.equal(again.rest, "perspective(400px)");
  assert.equal(serializeTransform(parseTransform("none")), null);
  assert.equal(serializeTransform({ ...parseTransform(""), x: "-50%" }), "translate(-50%, 0px)");
});

test("pseudo-element style props are split out of the map", () => {
  const map: Record<string, string> = { color: "red", placeholderColor: "#999", fileButtonBackground: "#000" };
  const parts = extractPartStyles(map);
  assert.deepEqual(map, { color: "red" });
  assert.equal(parts.length, 2);
  assert.match(parts[0].selector(".a"), /::placeholder/);
  assert.equal(parts[0].map.color, "#999");
  assert.match(parts[1].selector(".a"), /::file-selector-button/);
  assert.equal(parts[1].map.backgroundColor, "#000");
});

test("JSON body variables are escaped inside strings and raw outside", () => {
  const out = interpolateJson('{"q": "{q}", "n": {n}, "list": {arr}, "none": {x}}', { q: 'a "b"', n: 3, arr: [1, "2"] });
  assert.deepEqual(JSON.parse(out), { q: 'a "b"', n: 3, list: [1, "2"], none: null });
  assert.equal(bodyJsonError('{"a": {n}}'), false);
  assert.equal(bodyJsonError('{"a": '), true);
});

test("fetch request options add a JSON content type only when sending a body", () => {
  assert.equal(fetchRequestOf({}, {}), undefined);
  const r = fetchRequestOf(
    { method: "POST", headers: [{ name: "X-Key", value: "{k}" }], body: '{"q": "{q}"}' },
    { k: "secret", q: "hi" }
  );
  assert.deepEqual(r, {
    method: "POST",
    headers: { "X-Key": "secret", "Content-Type": "application/json" },
    body: '{"q": "hi"}',
  });
  // GET では本文を送らない
  assert.equal(fetchRequestOf({ method: "GET", body: "{}" }, {}), undefined);
});

test("field initial values follow the published browser values", () => {
  assert.equal(fieldInitialValue({ kind: "checkbox", checked: true }), "true");
  assert.equal(fieldInitialValue({ kind: "checkbox" }), "false");
  assert.equal(fieldInitialValue({ kind: "select", options: ["A", "B"] }), "A");
  assert.equal(fieldInitialValue({ kind: "input", defaultValue: "Hi {name}" }, { name: "Ann" }), "Hi Ann");
  const defaultRadio = makeField("radio");
  assert.equal(defaultRadio.field?.group, "radio");
  assert.equal(defaultRadio.attrId, "radio-1");
  // ラジオのグループ名が空なら ID属性 へフォールバックしない
  const ungroupedRadio: DocNode = { ...makeBox(), id: "ur", type: "field", attrId: "radio-1", field: { kind: "radio", label: "S", checked: true } };
  assert.equal(fieldVarName(ungroupedRadio), "");
  assert.deepEqual(fieldDefaults([ungroupedRadio]), {});
  // グループ名を付けたラジオ: {グループ名} が選んだ値、{ID} はそのボタンを選んでいるか
  const item = (id: string, label: string, checked?: boolean): DocNode => ({ ...makeBox(), id, type: "field", attrId: id, field: { kind: "radio", label, group: "size", checked, disabled: id === "s" } });
  const group = [item("s", "S"), item("m", "M", true), item("l", "L")];
  const values = fieldDefaults(group);
  assert.deepEqual(values, { size: "M" });
  assert.equal(fieldStateValues(group, values).m, "true");
  assert.equal(fieldStateValues(group, values).s, "false");
  assert.equal(fieldStateValues(group, values)["s.disabled"], "true");
  assert.equal(fieldStateValues(group, values)["size.index"], "2");
  assert.deepEqual(fieldValuePatch(group, "s", "true", values), { size: "S" });
  assert.deepEqual(fieldValuePatch(group, "m", "false", values), { size: "" });
  const box: DocNode = { ...makeBox(), id: "a", type: "field", attrId: "agree", field: { kind: "checkbox" } };
  assert.deepEqual(fieldValuePatch([box], "agree", "on", {}), { agree: "true" });
});

function docWith(nodes: DocNode[], pageScripts?: SiteDoc["pages"][string]["pageScripts"]): SiteDoc {
  return {
    siteName: "T",
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: nodes.map((n) => n.id), pageScripts } },
    pageOrder: ["p"],
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    assets: {},
  };
}

test("variables made inside an if block are suggested in text", () => {
  const box: DocNode = {
    ...makeBox(),
    id: "cb",
    type: "field",
    attrId: "agree",
    field: { kind: "checkbox", label: "OK" },
    scripts: [
      {
        id: "s",
        trigger: "change",
        pos: { x: 0, y: 0 },
        steps: [
          {
            id: "if",
            kind: "if",
            cond: { subject: "value", target: "@self", op: "eq", value: "on" },
            then: [{ id: "sv", kind: "set-var", value: "hoge", into: "hensuu" }],
          },
        ],
      },
    ],
  };
  const text: DocNode = { ...makeBox(), id: "t", text: { content: "", heading: 0 } };
  assert.ok(varNamesAt(docWith([box, text]), "p", "t").includes("hensuu"));
});

test("published fields interpolate variables and keep a live template for field values", () => {
  const name: DocNode = { ...makeBox(), id: "n", type: "field", attrId: "name", field: { kind: "input", placeholder: "Your name" } };
  const hello: DocNode = { ...makeBox(), id: "h", type: "field", attrId: "greet", field: { kind: "input", defaultValue: "Hi {name}", min: "1", required: true } };
  const sel: DocNode = { ...makeBox(), id: "s", type: "field", attrId: "plan", field: { kind: "select", defaultValue: "{name}", options: ["{name}", "Guest"] } };
  const cb: DocNode = { ...makeBox(), id: "c", type: "field", attrId: "ok", field: { kind: "checkbox", label: "For {name}" } };
  const doc = docWith([name, hello, sel, cb]);
  assert.equal(usesLiveFields(doc), true);
  const { files } = generateProject(doc);
  const page = Object.entries(files).find(([p]) => p.endsWith("page.tsx"))![1];
  assert.match(page, /defaultValue=\{interpolate\("Hi \{name\}", vars\)\}/);
  assert.match(page, /data-live-value=/);
  assert.match(page, /<option data-live=/);
  assert.match(page, /<span data-live=[^>]*>\{interpolate\("For \{name\}", vars\)\}<\/span>/);
  assert.match(page, / required/);
  // 文字の入力欄に min は付けない
  assert.doesNotMatch(page, /min=/);
  assert.ok(files["public/scripts.js"], "the runtime is published so the text follows the field");
});

test("comments: only the author can edit or delete, and resolving records who", () => {
  const ann = { email: "ann@example.com", name: "Ann", image: null };
  const bob = { email: "bob@example.com", name: "Bob", image: null };
  const create = parseCommentAction({ action: "create", id: "t1", pageId: "p", nodeId: "n1", x: 0.5, y: 2, bp: "base", body: " hi " });
  assert.ok(create && create.action === "create" && create.y === 1 && create.body === "hi");
  let threads: CommentThread[] = applyCommentAction([], create!, ann, 1);
  threads = applyCommentAction(threads, { action: "reply", threadId: "t1", id: "m2", body: "yo" }, bob, 2);
  assert.equal(threads[0].messages.length, 2);
  // Bob は Ann のコメントを消せない
  assert.equal(applyCommentAction(threads, { action: "delete-thread", threadId: "t1" }, bob)[0]?.id, "t1");
  assert.equal(applyCommentAction(threads, { action: "edit", messageId: "t1-0", body: "x" }, bob)[0].messages[0].body, "hi");
  threads = applyCommentAction(threads, { action: "resolve", threadId: "t1", resolved: true }, bob, 3);
  assert.equal(threads[0].resolvedBy?.email, "bob@example.com");
  assert.equal(applyCommentAction(threads, { action: "delete-thread", threadId: "t1" }, ann).length, 0);
  assert.equal(parseCommentAction({ action: "create", id: "bad id!", pageId: "p", nodeId: null, x: 0, y: 0, body: "a" }), null);
});

test("buttons, switches and radio groups are exported as working HTML", () => {
  const btn: DocNode = { ...makeBox(), id: "b", semantic: "button", text: { content: "Go", heading: 0 } };
  const form: DocNode = { ...makeBox(), id: "f", semantic: "form", children: ["b"] };
  const outside: DocNode = { ...makeBox(), id: "b2", semantic: "button", text: { content: "Menu", heading: 0 } };
  const sw = makeSwitch();
  const r1: DocNode = { ...makeBox(), id: "r1", type: "field", attrId: "small", field: { kind: "radio", label: "S", group: "size", disabled: true } };
  const doc = docWith([form, outside, sw.root, r1]);
  for (const n of sw.nodes) doc.nodes[n.id] = n;
  doc.nodes.b = btn;
  const { files } = generateProject(doc);
  const page = Object.entries(files).find(([p]) => p.endsWith("page.tsx"))![1];
  // フォームの中のボタンは送信、外は普通のボタン
  assert.match(page, /<button[^>]*type="submit"/);
  assert.match(page, /<button[^>]*type="button"/);
  // スイッチは非表示のチェックボックスとオン・オフのボックス＋スクリプトで構成される
  assert.match(page, /id="toggle"[^>]*>[\s\S]*?<input type="checkbox" name="toggle" value="true"/);
  assert.match(page, /id="switch-off"/);
  assert.match(page, /id="switch-on"[^>]*data-toggle-show="flex"/);
  assert.match(page, /data-scripts=/);
  assert.match(page, /type="radio" name="size" value="S"[^/]* disabled/);
  // 2つ目のスイッチを追加したときは、チェックボックスとオン・オフのID・スクリプト参照が一括で付け替わる
  const sw2 = makeSwitch();
  refreshClonedIds(doc, "p", sw2.nodes);
  assert.ok(sw2.nodes.some((n) => n.attrId === "toggle-2"));
  assert.ok(sw2.nodes.some((n) => n.attrId === "switch-off-2"));
  assert.ok(sw2.nodes.some((n) => n.attrId === "switch-on-2"));
  assert.match(JSON.stringify(sw2.root.scripts), /toggle-2/);
  assert.match(JSON.stringify(sw2.root.scripts), /switch-off-2/);
  assert.match(JSON.stringify(sw2.root.scripts), /switch-on-2/);
  // SearchForm は data-* 属性を受け取れ、クエリ無し時は defaultChecked を保つ
  const searchForm = files["components/SearchForm.tsx"];
  assert.match(searchForm, /ComponentPropsWithoutRef<"form">/);
  assert.match(searchForm, /input\.defaultChecked/);
});

test("pageReadsQuery detects POST body variables and keeps ISR for array-field items", () => {
  const itemText: DocNode = { ...makeBox(), id: "it", text: { content: "{badge}", heading: 0 } };
  const list: DocNode = { ...makeBox(), id: "l", type: "list", list: { from: "items" }, children: ["it"] };
  const isrDoc = docWith([list], [
    {
      id: "ps",
      trigger: "load",
      pos: { x: 0, y: 0 },
      steps: [
        { id: "f1", kind: "fetch", url: "https://api.example.com/items", as: "items", sample: [{ id: 1 }] },
        { id: "af", kind: "array-field", array: "items", field: "badge", value: "NEW" },
      ],
    },
  ]);
  isrDoc.nodes.it = itemText;
  const isrPage = generateProject(isrDoc).files["app/page.tsx"];
  assert.match(isrPage, /export const revalidate = 60;/);

  const postDoc = docWith([ { ...makeBox(), id: "t", text: { content: "{res.ok}", heading: 0 } } ], [
    {
      id: "ps2",
      trigger: "load",
      pos: { x: 0, y: 0 },
      steps: [
        { id: "f2", kind: "fetch", url: "https://api.example.com/search", method: "POST", body: '{"q": "{q}"}', as: "res" },
      ],
    },
  ]);
  const postPage = generateProject(postDoc).files["app/page.tsx"];
  assert.match(postPage, /export const dynamic = "force-dynamic";/);
  assert.match(postPage, /await searchParams/);
});

test("slug page generateMetadata preserves description, noindex and openGraph", () => {
  const h1: DocNode = { ...makeBox(), id: "h", text: { content: "{post.title}", heading: 1 } };
  const doc: SiteDoc = {
    siteName: "Blog",
    pages: {
      p: {
        id: "p",
        name: "Post",
        slug: "posts/[slug]",
        title: "Fallback",
        description: "Article page",
        noindex: true,
        ogImage: { kind: "url", url: "https://example.com/og.png" },
        children: ["h"],
        pageScripts: [
          {
            id: "s",
            trigger: "load",
            pos: { x: 0, y: 0 },
            steps: [
              { id: "f", kind: "fetch", url: "https://api.example.com/posts", as: "posts", sample: [{ slug: "a", title: "Hello" }] },
              { id: "af", kind: "array-find", array: "posts", field: "slug", value: "{slug}", into: "post" },
            ],
          },
        ],
      },
    },
    pageOrder: ["p"],
    nodes: { h: h1 },
    assets: {},
  };
  const page = generateProject(doc).files["app/posts/[slug]/page.tsx"];
  assert.match(page, /export async function generateMetadata/);
  assert.match(page, /description: "Article page"/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /openGraph:/);
  assert.match(page, /twitter: \{ card: "summary_large_image" \}/);
});

test("obfuscateVarNames preserves array-field item keys and cloning renames grouped radio item IDs", () => {
  const itemText: DocNode = { ...makeBox(), id: "it", text: { content: "{label}", heading: 0 } };
  const list: DocNode = { ...makeBox(), id: "l", type: "list", list: { from: "items" }, children: ["it"] };
  const doc = docWith([list], [
    {
      id: "ps",
      trigger: "load",
      pos: { x: 0, y: 0 },
      steps: [
        { id: "f1", kind: "fetch", url: "https://api.example.com/items", as: "items" },
        { id: "af", kind: "array-field", array: "items", field: "label", value: "x" },
        { id: "sv", kind: "set-var", value: "y", into: "label" },
      ],
    },
  ]);
  doc.nodes.it = itemText;
  const obf = obfuscateVarNames(doc);
  assert.equal(obf.nodes.it.text?.content, "{label}");

  // ラジオボタンはデフォルトで group="radio", attrId="radio-1" を持ち、追加・複製時に個別ID（radio-2, radio-3）へ自動採番される
  const r1 = makeField("radio");
  const rDoc = docWith([r1]);
  const r2 = makeField("radio");
  refreshClonedIds(rDoc, "p", [r2]);
  assert.equal(r1.attrId, "radio-1");
  assert.equal(r2.attrId, "radio-2");
  assert.equal(r2.field?.group, "radio");

  // コンポーネント内の h1 と入力欄もチェック・変数候補で認識される
  const compH1: DocNode = { ...makeBox(), id: "ch1", type: "field", attrId: "comp-input", field: { kind: "input" } };
  const compRoot: DocNode = { ...makeBox(), id: "cr", text: { content: "Heading", heading: 1 }, children: ["ch1"] };
  const inst: DocNode = { ...makeBox(), id: "inst", type: "instance", componentId: "c1" };
  const cDoc: SiteDoc = {
    siteName: "Real Site",
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "Desc", children: ["inst"] } },
    pageOrder: ["p"],
    nodes: { cr: compRoot, ch1: compH1, inst },
    components: { c1: { id: "c1", name: "Hero", rootId: "cr" } },
    assets: {},
  };
  assert.ok(varNamesAt(cDoc, "p", "inst").includes("comp-input"));
  assert.ok(!runChecks(cDoc).some((w) => w.help === "seo-h1"));
  assert.equal(interpolateUrl("{img}", { img: "data:image/png;base64,AAAA" }), "data:image/png;base64,AAAA");
});
