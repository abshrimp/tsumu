import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { generateExportProject } from "../lib/export-formats";
import { nativeDataModule } from "../lib/generator/native-data";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { fieldInitialValue } from "../lib/fields";
import { YOUTUBE_ALLOW } from "../lib/embed";
import { makeBox } from "../lib/presets";
import { interpolate, interpolateUrl, lookupVar, varText } from "../lib/vars";
import { safeNavigationUrl, safeResourceUrl } from "../lib/url-policy";
import type { DocNode, EmbedContent, SiteDoc } from "../lib/types";

const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
const module = { exports: {} as any };
runInNewContext(transformSync(nativeDataModule(), { format: "cjs" }).code, { module });
const native = module.exports;
const start = PAGE_DATA_RUNTIME.indexOf("  function interpolate(");
const end = PAGE_DATA_RUNTIME.indexOf("  function jsonBody(", start);
assert.ok(start >= 0 && end > start);
const browserInterpolate = runInNewContext(PAGE_DATA_RUNTIME.slice(start, end) + "\ninterpolate", { read: lookupVar, text: varText });

test("native links encode variable query/path components like Canvas and Next", () => {
  for (const value of ["a&admin=true#x", "my photo?.png", "日本/旅", "100%", '"quoted"', ""]) {
    for (const template of ["/search?q={value}", "/files/{value}", "{value}", "/[slug]", "\\{value}/{value}"]) {
      const vars = { value, slug: value };
      assert.equal(native.resolveUrl(template, vars), safeNavigationUrl(interpolateUrl(template, vars)), JSON.stringify({ template, value }));
    }
  }
});
test("whole URL handling matches editor, including inline image URLs for fetch interpolation", () => {
  for (const value of ["https://example.com/a?x=1&y=2", "/a?x=1", "#section", "mailto:a@example.com", "tel:+123", "//evil.test", "javascript:alert(1)", "https:evil", "data:image/png;base64,AAAA", "data:image/svg+xml;base64,AAAA", "data:audio/wav;base64,AAAA", "blob:https://example.com/id"]) {
    const vars = { value };
    assert.equal(browserInterpolate("{value}", vars, true), interpolateUrl("{value}", vars), value);
    assert.equal(native.resolveUrl("{value}", vars), safeNavigationUrl(interpolateUrl("{value}", vars)), value);
  }
});
test("resource URL helpers retain inline media and block executable protocols", () => {
  for (const value of ["data:image/png;base64,AAAA", "data:image/svg+xml;base64,AAAA", "data:audio/wav;base64,AAAA", "data:video/mp4;base64,AAAA", "blob:https://example.com/id", "javascript:alert(1)", "data:text/html;base64,AAAA", "//evil.test", "/\\evil.test", "https://example.com/image?a=1&b=2"]) {
    assert.equal(native.resolveResourceUrl("{value}", { value }), safeResourceUrl(interpolate("{value}", { value })), value);
  }
});
test("nested native scopes shadow outer values without mutating them", () => {
  const outer = { value: "outer", nested: { value: "outer" } };
  const row = { value: "a/b?c", nested: { value: "inner" } };
  assert.equal(native.resolveUrl("/x/{value}", outer, row), "/x/a%2Fb%3Fc");
  assert.equal(native.resolveText("{nested.value}", outer, row), "inner");
  assert.equal(native.resolveText("{value}", outer, row, { value: undefined }), "");
  assert.equal(outer.value, "outer");
});
test("text token recognition matches editor for backticks and literal escapes", () => {
  for (const template of ["{bad`name}", "\\{value}", "{value}{missing}", "[slug]"]) {
    const vars = { value: "hello", slug: "s", "bad`name": "wrong" };
    assert.equal(native.resolveText(template, vars), interpolate(template, vars));
  }
});

const nativePagePath = (framework: "vue" | "nuxt" | "sveltekit") =>
  framework === "nuxt" ? "app/generated/pages/Page0.vue" : framework === "vue" ? "src/pages/Page0.vue" : "src/lib/pages/Page0.svelte";

function markup(framework: "vue" | "nuxt" | "sveltekit", nodes: Record<string, DocNode>, children: string[]) {
  const doc: SiteDoc = { siteName: "Controls", assets: {}, pageOrder: ["p"], nodes,
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children } } };
  return parse(generateExportProject(doc, framework).files[nativePagePath(framework)]);
}
for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  test(`${framework}: scripted buttons do not submit their enclosing form`, () => {
    const button = (id: string): DocNode => ({ ...makeBox(), id, attrId: id, semantic: "button" });
    const tree = markup(framework, {
      form: { ...makeBox(), id: "form", semantic: "form", children: ["scripted", "ordinary", "onload", "explicit"] },
      scripted: { ...button("scripted"), scripts: [{ id: "click", trigger: "click", steps: [{ id: "set", kind: "set-var", into: "clicked", value: "yes" }] }] },
      ordinary: button("ordinary"),
      onload: { ...button("onload"), scripts: [{ id: "load", trigger: "load", steps: [] }] },
      explicit: { ...makeBox(), id: "explicit", attrId: "explicit", type: "field", field: { kind: "submit", label: "Go" } },
      outside: button("outside"),
    }, ["form", "outside"]);
    assert.equal(tree.querySelector("#scripted").getAttribute("type"), "button");
    assert.equal(tree.querySelector("#ordinary").getAttribute("type"), "submit");
    assert.equal(tree.querySelector("#onload").getAttribute("type"), "submit");
    assert.equal(tree.querySelector("#explicit").getAttribute("type"), "submit");
    assert.equal(tree.querySelector("#outside").getAttribute("type"), "button");
  });
  test(`${framework}: inline paragraph children keep p and block children retain paragraph styling`, () => {
    const paragraph = (id: string, child: string): DocNode => ({ ...makeBox(), id, attrId: id, text: { content: "Line one\nLine two", heading: 0 }, children: [child] });
    const tree = markup(framework, {
      inline: paragraph("inline", "span"),
      span: { ...makeBox(), id: "span", semantic: "custom", customTag: "span", text: { content: "bold", heading: 0 } },
      block: paragraph("block", "box"), box: { ...makeBox(), id: "box" },
    }, ["inline", "block"]);
    assert.equal(tree.querySelector("#inline").tagName.toLowerCase(), "p");
    assert.equal(tree.querySelector("#inline").hasAttribute("data-p"), false);
    assert.equal(tree.querySelector("#block").tagName.toLowerCase(), "div");
    assert.equal(tree.querySelector("#block").hasAttribute("data-p"), true);
  });
  test(`${framework}: instance visibility markup matches its responsive CSS without hiding sibling instances`, () => {
    const doc: SiteDoc = { siteName: "Visibility", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["hidden", "visible"] } },
      components: { card: { id: "card", name: "Card", rootId: "root" } },
      nodes: {
        root: { ...makeBox(), id: "root", text: { content: "Card", heading: 0 } },
        hidden: { ...makeBox(), id: "hidden", attrId: "hidden-use", type: "instance", componentId: "card", hiddenOn: ["sm"] },
        visible: { ...makeBox(), id: "visible", attrId: "visible-use", type: "instance", componentId: "card" },
      },
    };
    const { files } = generateExportProject(doc, framework);
    const tree = parse(files[nativePagePath(framework)]);
    const hidden = tree.querySelector("#hidden-use"), visible = tree.querySelector("#visible-use");
    const marker = hidden.getAttribute("data-instance-hidden");
    assert.ok(marker, "instance wrapper needs the selector marker used by shared responsive CSS");
    const css = Object.entries(files).filter(([name]) => name.endsWith(".css")).map(([, content]) => content).join("\n");
    assert.ok(css.includes(`[data-instance-hidden~=${JSON.stringify(marker)}]`));
    assert.match(css.slice(css.indexOf(`[data-instance-hidden~=${JSON.stringify(marker)}]`)), /display: none !important/);
    assert.equal(visible.hasAttribute("data-instance-hidden"), false);
    assert.equal(hidden.getAttribute("style"), "display:contents");
  });
}

{
  const queryDoc: SiteDoc = { siteName: "Query routes", nodes: {}, assets: {}, pageOrder: ["home", "special"], pages: {
    home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: [] },
    special: { id: "special", name: "Special", title: "Special", description: "", slug: "", query: "tab=details", children: [] },
  } };
  const files = generateExportProject(queryDoc, "nuxt").files;
  const queryLine = files["app/pages/index.vue"].match(/^const query = computed\(\(\) => (.+)\);$/m)?.[1];
  assert.ok(queryLine);
  const routesMod = { exports: {} as any };
  runInNewContext(transformSync(files["app/generated/site-routes.js"], { format: "cjs" }).code, { module: routesMod, URLSearchParams });
  const dataMod = { exports: {} as any };
  runInNewContext(transformSync(files["app/generated/site-data.js"], { format: "cjs" }).code, { module: dataMod, URLSearchParams, URL, fetch });
  for (const fullPath of ["/?q=alpha?beta", "/?tab=details#section", "/?q=alpha?beta#section", "/?q=a%3Fb%23c", "/?q=a+b&tag=one&tag=two", "/#section?not=a-query", "/"]) {
    test(`Nuxt query loader agrees with server URL parsing: ${fullPath}`, async () => {
      const expected = new URL(fullPath, "https://example.com").searchParams;
      const query = runInNewContext(queryLine, { route: { fullPath }, requestUrl: new URL("https://example.com"), URLSearchParams, URL });
      assert.deepEqual([...query.entries()], [...expected.entries()]);
      assert.equal(routesMod.exports.selectPage("/", query)?.id, routesMod.exports.selectPage("/", expected)?.id);
      const values = await dataMod.exports.loadPageData({ steps: [] }, query);
      assert.deepEqual({ ...values }, Object.fromEntries(expected));
    });
  }
}

function mediaFixture(kind: EmbedContent["kind"]): SiteDoc {
  return { siteName: "Media parity", pageOrder: ["p"], pages: { p: { id: "p", name: "P", slug: "", title: "P", description: "", children: ["embed"] } }, nodes: { embed: { ...makeBox(), id: "embed", type: "embed", embed: { kind, src: kind === "youtube" ? "https://youtu.be/abcdefghijk" : kind === "map" ? "Tokyo" : "https://example.com/player" } } }, assets: {} };
}
for (const framework of ["vue", "nuxt", "sveltekit"] as const) for (const kind of ["url", "youtube", "map"] as const) test(`${framework} ${kind} embed preserves editor fullscreen policy`, () => {
  const doc = mediaFixture(kind);
  const nativeFrame = generateExportProject(doc, framework).files[nativePagePath(framework)].match(/<iframe\b[^>]*>/)?.[0];
  const next = generateExportProject(doc, "nextjs").files["app/page.tsx"].match(/<iframe\b[\s\S]*?\/>/)?.[0];
  assert.ok(nativeFrame); assert.ok(next);
  assert.equal(/\ballowfullscreen\b/i.test(nativeFrame), /\ballowFullScreen\b/.test(next));
  assert.equal(/\ballowfullscreen\b/i.test(nativeFrame), kind !== "map");
  if (kind === "youtube") assert.ok(nativeFrame.includes(`allow="${YOUTUBE_ALLOW}"`));
  else assert.doesNotMatch(nativeFrame, /\ballow="/);
  assert.match(nativeFrame, /loading="lazy"/);
  assert.match(nativeFrame, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.equal(/\bsandbox\b/.test(nativeFrame), /\bsandbox\b/.test(next));
});

for (const framework of ["vue", "nuxt", "sveltekit"] as const) for (const priority of [true, false, undefined]) test(`${framework} image priority ${priority} is preserved`, () => {
  const doc = mediaFixture("url"); doc.nodes.embed = { ...makeBox(), id: "embed", type: "image", image: { src: "https://example.com/image.png", alt: "", width: 100, height: 100, priority } };
  const nativeImg = generateExportProject(doc, framework).files[nativePagePath(framework)].match(/<img\b[^>]*>/)?.[0];
  const next = generateExportProject(doc, "nextjs").files["app/page.tsx"];
  assert.ok(nativeImg);
  assert.equal(/fetchpriority="high"/.test(nativeImg), !!priority);
  assert.equal(/fetchPriority="high"/.test(next), !!priority);
  if (!priority) assert.doesNotMatch(nativeImg, /fetchpriority=/);
});

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  for (const label of ["Plan {choice}", "\\{choice}", "Static & safe"]) test(`${framework} radio submits the displayed resolved label: ${label}`, () => {
    const doc: SiteDoc = {
      siteName: "Radio", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["radio"] } },
      nodes: { radio: { ...makeBox(), id: "radio", type: "field", attrId: "selection", field: { kind: "radio", label, checked: true } } },
    };
    const source = generateExportProject(doc, framework).files[nativePagePath(framework)];
    const input = parse(source).querySelector('input[type="radio"]');
    assert.ok(input);
    const expression = framework === "sveltekit"
      ? /\bvalue=\{(resolveText\([^\n]*?\))\}/.exec(source)?.[1]
      : (() => { const match = /:value="([^"]*)"/.exec(source); return match ? parse(`<div data-code="${match[1]}"></div>`).querySelector("div").getAttribute("data-code") : undefined; })();
    const scope = { choice: 'A & "B"' };
    const actual = expression ? new Function("resolveText", "scope", `return ${expression}`)(native.resolveText, scope) : input.getAttribute("value");
    assert.equal(actual, native.resolveText(label, scope));
  });
}

const selectCases: Array<{ options: string[]; defaultValue: string; scope: Record<string, unknown>; row?: Record<string, unknown>; expectedIndex?: number }> = [
  { options: ["A", "B"], defaultValue: "{choice}", scope: { choice: "B" } },
  { options: ["A", "{second}"], defaultValue: "B", scope: { second: "B" } },
  { options: ["A", "{second}"], defaultValue: "{choice}", scope: { second: "B", choice: "B" } },
  { options: ["A", "{missing}"], defaultValue: "{choice}", scope: {} },
  { options: ["{first}", "B"], defaultValue: "{choice}", scope: { first: "Fallback", choice: "missing" } },
  { options: ["A", "\\{literal}"], defaultValue: "\\{literal}", scope: {} },
  { options: ["A", "B"], defaultValue: "B", scope: {} },
  { options: ["{first}", "{second}"], defaultValue: "{choice}", scope: { first: "B", second: "B", choice: "B" }, expectedIndex: 0 },
  { options: ["B", "A", "B"], defaultValue: "B", scope: {}, expectedIndex: 0 },
  { options: [], defaultValue: "{choice}", scope: { choice: "B" }, expectedIndex: -1 },
  { options: ["A", "{second}"], defaultValue: "{choice}", scope: { choice: "A", second: "Wrong" }, row: { choice: "B", second: "B" }, expectedIndex: 1 },
];
for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  selectCases.forEach((sample, i) => test(`${framework}: select resolves default and options before selecting (${i})`, () => {
    const field = { kind: "select" as const, options: sample.options.map(value => ({ label: value, value })), defaultValue: sample.defaultValue };
    const doc: SiteDoc = {
      schemaVersion: 1, siteName: "Select", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["select"] } },
      nodes: { select: { ...makeBox(), id: "select", type: "field", field } },
    };
    if (sample.row) {
      doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "rows" }, children: ["select"] };
      doc.pages.p.children = ["list"];
    }
    const source = generateExportProject(doc, framework).files[nativePagePath(framework)];
    const optionTags = [...source.matchAll(/<option\b([^>]*)>/g)].map(m => m[1]);
    const evaluate = (code: string) => runInNewContext(code, { ...native, scope: sample.scope, row0: sample.row });
    const selectedFlags = optionTags.map(attrs => {
      const dynamic = framework === "sveltekit" ? /selected=\{(.*)\}/.exec(attrs)?.[1] : /:selected="([^"]*)"/.exec(attrs)?.[1];
      if (dynamic) {
        const decoded = framework === "sveltekit" ? dynamic : parse(`<div data-code="${dynamic}"></div>`).querySelector("div").getAttribute("data-code");
        return evaluate(decoded);
      }
      return /\bselected\b/.test(attrs);
    });
    const selected = selectedFlags.indexOf(true);
    assert.equal(selectedFlags.filter(Boolean).length, sample.options.length ? 1 : 0, "select exactly one option");
    if (sample.expectedIndex !== undefined) assert.equal(selected, sample.expectedIndex);
    if (!sample.options.length) return;
    assert.ok(selected >= 0, "must select a matching option or first fallback");
    const scope = { ...sample.scope, ...sample.row };
    assert.equal(native.resolveText(sample.options[selected], scope), fieldInitialValue(field, scope));
  }));
}
