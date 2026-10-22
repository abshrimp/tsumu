import assert from "node:assert/strict";
import { test } from "node:test";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { usedAdobeFonts } from "../lib/generator/css";
import { adobeFontHead } from "../lib/generator/adobe-fonts";
import { generateExportProject } from "../lib/export-formats";
import { TOPICS } from "../lib/manualTopics";
import { parseAdobeEmbed, parseAdobeKitInput } from "../lib/adobe-fonts-embed";
import { adobeCssFamilies, adobePublishedFamilies, inspectAdobeProject } from "../lib/adobe-fonts-project";
import { registerAdobeFont, removeAdobeWebProject } from "../lib/adobe-fonts-registration";
import { useEditor } from "../lib/store";

function fixture() {
  const doc: SiteDoc = {
    schemaVersion: 1,
    siteName: "Adobe Fonts",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", name: "Home", slug: "", title: "Home", description: "",
        children: ["adobeText"],
      },
    },
    nodes: {
      adobeText: {
        ...makeText("Font preview"),
        id: "adobeText",
        styles: { base: { default: { fontFamily: "acumin-pro" } } },
      },
    },
    assets: {},
  };
  doc.adobeFonts = [
    { family: "acumin-pro", kitId: "abc1234", loading: "css" },
    { family: "source-han-sans-japanese", kitId: "def5678", loading: "dynamic" },
  ];
  return doc;
}

test("Adobe Fonts are only embedded when referenced by node or body styles", () => {
  const doc = fixture();
  assert.deepEqual(usedAdobeFonts(doc).map(font => font.family), ["acumin-pro"]);
  assert.match(adobeFontHead(doc), /https:\/\/use\.typekit\.net\/abc1234\.css/);
  assert.doesNotMatch(adobeFontHead(doc), /def5678/);
  doc.pages[doc.pageOrder[0]].bodyStyles = { base: { default: { fontFamily: "source-han-sans-japanese" } } };
  assert.match(adobeFontHead(doc), /use\.typekit\.net\/def5678\.js/);
  assert.match(adobeFontHead(doc), /Typekit\.load/);
});

test("all export targets carry the correct Adobe CSS and dynamic embed", () => {
  const doc = fixture();
  doc.nodes.adobeText.styles.base.default!.fontFamily = "source-han-sans-japanese";
  doc.pages[doc.pageOrder[0]].bodyStyles = { base: { default: { fontFamily: "acumin-pro" } } };
  for (const framework of ["nextjs", "html", "single-html", "react", "vue", "nuxt", "sveltekit"] as const) {
    const generated = generateExportProject(doc, framework);
    const content = Object.values(generated.files).join("\n");
    assert.match(content, /use\.typekit\.net\/abc1234\.css/, framework);
    assert.match(content, /use\.typekit\.net\/def5678\.js/, framework);
    assert.match(content, /source-han-sans-japanese/, framework);
    assert.doesNotMatch(content, /use\.typekit\.net\/abc1234\.js/, framework);
  }
});

test("unused Adobe projects are omitted from exported files", () => {
  const doc = fixture();
  doc.nodes.adobeText.styles.base.default!.fontFamily = "system-ui";
  const content = Object.values(generateExportProject(doc, "html").files).join("\n");
  assert.doesNotMatch(content, /use\.typekit\.net/);
});

test("Adobe Fonts help explains Web Project creation, ID lookup and font selection", () => {
  const topic = TOPICS.find((entry) => entry.id === "text-adobe-fonts");
  assert.ok(topic, "Adobe Fonts must have a dedicated help topic");
  assert.equal(topic.cat, "text");
  const steps = topic.body?.find((block) => "list" in block && block.ordered);
  assert.ok(steps && "list" in steps);
  assert.equal(steps.list.length, 4);
  assert.match(steps.list.join(" "), /Project ID/);
  assert.match(steps.list.join(" "), /Adobe Fonts/);
  const official = topic.body?.find((block) => "external" in block);
  assert.ok(official && "external" in official);
  assert.equal(official.external.url, "https://fonts.adobe.com/my_fonts#web_projects-section");
  const note = topic.body?.find((block) => "note" in block);
  assert.ok(note && "note" in note);
  assert.match(note.note, /adobeFonts\[\]\.kitId/);
  const warning = topic.body?.find((block) => "warn" in block);
  assert.ok(warning && "warn" in warning);
  assert.match(warning.warn, /expired/);
});

test("Google Fonts help links to the Adobe Fonts instructions", () => {
  const topic = TOPICS.find((entry) => entry.id === "text-font");
  assert.ok(topic);
  assert.ok(topic.see?.includes("text-adobe-fonts"));
});

const adobeJapaneseSnippet = `<script>
  (function(d) {
    var config = { kitId: 'tudlnus', scriptTimeout: 3000, async: true },
      h = d.documentElement, t = setTimeout(function() {}, config.scriptTimeout),
      tk = d.createElement("script");
    tk.src = 'https://use.typekit.net/' + config.kitId + '.js';
    d.head.appendChild(tk);
  })(document);
</script>`;

test("extracts Adobe's standard Japanese dynamic-subsetting snippet without executing it", () => {
  assert.deepEqual(parseAdobeEmbed(adobeJapaneseSnippet), { kitId: "tudlnus", loading: "dynamic" });
  assert.deepEqual(parseAdobeEmbed(adobeJapaneseSnippet.replace("tudlnus", "abc1234")),
    { kitId: "abc1234", loading: "dynamic" });
  assert.deepEqual(parseAdobeEmbed(`<script src="https://use.typekit.net/abc1234.js"></script>`),
    { kitId: "abc1234", loading: "dynamic" });
});

test("extracts stylesheet embeds, including @import", () => {
  assert.deepEqual(parseAdobeEmbed('<link rel="stylesheet" href="https://use.typekit.net/abc1234.css">'),
    { kitId: "abc1234", loading: "css" });
  assert.deepEqual(parseAdobeEmbed('@import url("https://use.typekit.net/abc1234.css");'),
    { kitId: "abc1234", loading: "css" });
});

test("rejects unrelated hosts, ambiguous kits, and unsafe or malformed identifiers", () => {
  for (const text of [
    "",
    "kitId: 'abc1234'",
    "<script>var config = { kitId: 'abc1234' }; alert(1);</script>",
    '<script src="https://attacker.test/use.typekit.net/abc1234.js"></script>',
    '<script src="http://use.typekit.net/abc1234.js"></script>',
    '<script src="https://use.typekit.net/abc1234.js.evil"></script>',
    '<script src="https://use.typekit.net/abc12345.js"></script>',
    '<script src="https://use.typekit.net/abc1234.js"></script><link href="https://use.typekit.net/xyz5678.css">',
    '<script src="https://use.typekit.net/abc1234.js"></script><link href="https://use.typekit.net/abc1234.css">',
    adobeJapaneseSnippet.replace("kitId:", "otherId:"),
    adobeJapaneseSnippet.replace("use.typekit.net", "evil.test"),
    "x".repeat(30_001),
  ]) {
    assert.equal(parseAdobeEmbed(text), null, text.slice(0, 160));
  }
});

test("pasted scripts are never evaluated", () => {
  const key = "__tsumuAdobeEmbedProbe";
  delete (globalThis as Record<string, unknown>)[key];
  const snippet = `<script>globalThis.${key}=true;var kitId='abc1234';</script>`;
  assert.equal(parseAdobeEmbed(snippet), null);
  assert.equal((globalThis as Record<string, unknown>)[key], undefined);
});

test("Web Project ID or URL is enough; embedding the whole snippet is optional", () => {
  assert.deepEqual(parseAdobeKitInput(" abc1234 "), { kitId: "abc1234", loading: "css" });
  assert.deepEqual(parseAdobeKitInput("https://use.typekit.net/abc1234.css"),
    { kitId: "abc1234", loading: "css" });
  assert.deepEqual(parseAdobeKitInput("https://use.typekit.net/abc1234.js"),
    { kitId: "abc1234", loading: "dynamic" });
  assert.deepEqual(parseAdobeKitInput('<script src="https://use.typekit.net/abc1234.js"></script>'),
    { kitId: "abc1234", loading: "dynamic" });
  for (const bad of ["", "abc123", "abc12345", "https://evil.test/abc1234.js",
    "https://use.typekit.net/abc1234.js.evil", "abc1234;alert(1)", "../abc1234"]) {
    assert.equal(parseAdobeKitInput(bad), null, bad);
  }
});

const cssResponse = (css: string) => new Response(css, {
  status: 200, headers: { "Content-Type": "text/css" },
});
const unpublished = () => new Response("", { status: 404 });

function stubAdobeFetch(api: Response | Error, css: Response | Error, js: Response | Error) {
  const calls: { url: string; method: string }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const output = url.includes("typekit.com/api/v1/") ? api
      : url.endsWith(".css") ? css : js;
    if (output instanceof Error) throw output;
    return output.clone();
  }) as typeof fetch;
  return { fake, calls };
}

test("published kit names are validated, and mixed families use one dynamic loader", () => {
  const fonts = adobePublishedFamilies({
    kit: { families: [
      { name: "Japanese", css_names: ["poprumcute"], subset: "dynamic" },
      { name: "Latin", css_names: ["acumin-pro"], subset: "default" },
      { name: "Unsafe", css_names: ['x";alert(1)'], subset: "default" },
    ] },
  });
  assert.deepEqual(fonts, [
    { name: "Japanese", family: "poprumcute", loading: "dynamic" },
    { name: "Latin", family: "acumin-pro", loading: "dynamic" },
  ]);
  assert.equal(adobePublishedFamilies({ errors: ["Not found"] }), null);
});

test("Adobe CSS font-face fallback extracts names without executing remote code", () => {
  const fonts = adobeCssFamilies(
    '@font-face { font-family: "acumin-pro"; src: url("https://use.typekit.net/a.woff2"); }' +
    "@font-face { font-family: 'adobe-garamond-pro'; font-weight: 400; }" +
    "@font-face { font-family: 'acumin-pro'; font-style: italic; }" +
    "@font-face { font-family: 'x; background: url(evil)'; }",
  );
  assert.deepEqual(fonts, [
    { name: "acumin-pro", family: "acumin-pro", loading: "css" },
    { name: "adobe-garamond-pro", family: "adobe-garamond-pro", loading: "css" },
  ]);
});

test("public kit metadata is preferred when available", async () => {
  const { fake, calls } = stubAdobeFetch(Response.json({
    kit: { families: [{ name: "Poprum", css_names: ["poprumcute"], subset: "dynamic" }] },
  }), unpublished(), unpublished());
  const result = await inspectAdobeProject("tud1nus", fake);
  assert.deepEqual(result, {
    status: "available",
    fonts: [{ name: "Poprum", family: "poprumcute", loading: "dynamic" }],
  });
  assert.deepEqual(calls.map(call => ({ method: call.method, path: new URL(call.url).pathname })), [
    { method: "GET", path: "/api/v1/json/kits/tud1nus/published" },
  ]);
});

test("a published Japanese kit rejected by the CSS endpoint uses JavaScript", async () => {
  const { fake, calls } = stubAdobeFetch(Response.json({
    kit: { families: [
      { name: "Japanese font", css_names: ["poprumcute"], subset: "default" },
      { name: "Latin family", css_names: ["acumin-pro"], subset: "default" },
    ] },
  }), new Response("", { status: 412 }), new Response(null, { status: 200 }));
  assert.deepEqual(await inspectAdobeProject("jys5tkg", fake), {
    status: "available",
    fonts: [
      { name: "Japanese font", family: "poprumcute", loading: "dynamic" },
      { name: "Latin family", family: "acumin-pro", loading: "dynamic" },
    ],
    loading: "dynamic",
  });
  assert.deepEqual(calls.map(c => c.method), ["GET", "HEAD"]);
});

test("Adobe metadata failure does not hide a working CSS CDN project", async () => {
  const { fake, calls } = stubAdobeFetch(new Error("upstream DNS error"),
    cssResponse('@font-face { font-family: "acumin-pro"; }'), unpublished());
  assert.deepEqual(await inspectAdobeProject("abc1234", fake), {
    status: "available",
    fonts: [{ name: "acumin-pro", family: "acumin-pro", loading: "css" }],
    loading: "css",
  });
  assert.equal(calls.length, 2);
});

test("Japanese CDN script can be reachable even when metadata and CSS endpoints fail", async () => {
  const { fake, calls } = stubAdobeFetch(unpublished(), unpublished(), new Response(null, { status: 200 }));
  assert.deepEqual(await inspectAdobeProject("tud1nus", fake), {
    status: "reachable", fonts: [], loading: "dynamic",
  });
  assert.deepEqual(calls.map(call => call.method), ["GET", "GET", "HEAD"]);
  assert.deepEqual(calls.map(call => new URL(call.url).hostname),
    ["typekit.com", "use.typekit.net", "use.typekit.net"]);
});

test("a CSS response without font families still probes the Japanese dynamic script", async () => {
  const { fake } = stubAdobeFetch(new Error("endpoint blocked"),
    cssResponse("/* Fonts are dynamically subset by JavaScript */"),
    new Response(null, { status: 200 }));
  assert.deepEqual(await inspectAdobeProject("tud1nus", fake), {
    status: "reachable", fonts: [], loading: "dynamic",
  });
});

test("an unavailable API does not prove the project or subscription is expired", async () => {
  const unavailable = new Error("Adobe unavailable");
  const { fake } = stubAdobeFetch(unavailable, unavailable, unavailable);
  assert.deepEqual(await inspectAdobeProject("tud1nus", fake), { status: "unknown", fonts: [] });
});

test("only independently confirmed missing endpoints can mark a project missing", async () => {
  const all404 = stubAdobeFetch(unpublished(), unpublished(), unpublished());
  assert.deepEqual(await inspectAdobeProject("abc1234", all404.fake), { status: "missing", fonts: [] });
  const blocked = stubAdobeFetch(unpublished(), unpublished(), new Response("", { status: 403 }));
  assert.deepEqual(await inspectAdobeProject("abc1234", blocked.fake), { status: "unknown", fonts: [] });
});

test("kit IDs cannot inject external URLs or trigger arbitrary requests", async () => {
  const { fake, calls } = stubAdobeFetch(unpublished(), unpublished(), unpublished());
  assert.deepEqual(await inspectAdobeProject("../../../", fake), { status: "unknown", fonts: [] });
  assert.deepEqual(await inspectAdobeProject("foo?a=1", fake), { status: "unknown", fonts: [] });
  assert.equal(calls.length, 0);
});

function registrationFixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Adobe Project Removal", assets: {},
    pageOrder: ["p"],
    pages: { p: {
      id: "p", name: "Home", slug: "", title: "", description: "", children: ["a", "b", "c"],
      bodyStyles: { base: { default: { fontFamily: "poprumcute" } } },
    } },
    nodes: {
      a: { ...makeText("First"), id: "a", styles: {
        base: { default: { fontFamily: "poprumcute" } },
        sm: { hover: { fontFamily: "source-han-serif-japanese" } },
      } },
      b: { ...makeText("Second"), id: "b", styles: {
        base: { default: { fontFamily: "Lora" } },
      } },
      c: { ...makeText("Third"), id: "c", styles: {
        base: { default: { fontFamily: "acumin-pro" } },
      } },
    },
    adobeFonts: [
      { family: "poprumcute", kitId: "jys5tkg", loading: "dynamic" },
      { family: "source-han-serif-japanese", kitId: "jys5tkg", loading: "dynamic" },
      { family: "acumin-pro", kitId: "abc1234", loading: "css" },
    ],
  };
}

test("removing a Web Project deletes all its registered fonts and applied style references", () => {
  const doc = registrationFixture();
  assert.equal(removeAdobeWebProject(doc, "jys5tkg"), 2);
  assert.deepEqual(doc.adobeFonts, [{ family: "acumin-pro", kitId: "abc1234", loading: "css" }]);
  assert.equal(doc.pages.p.bodyStyles?.base?.default?.fontFamily, undefined);
  assert.equal(doc.nodes.a.styles.base.default?.fontFamily, undefined);
  assert.equal(doc.nodes.a.styles.sm.hover?.fontFamily, undefined);
  assert.equal(doc.nodes.b.styles.base.default?.fontFamily, "Lora");
  assert.equal(doc.nodes.c.styles.base.default?.fontFamily, "acumin-pro");
});

test("removal of the last Web Project clears the optional registration field", () => {
  const doc = registrationFixture();
  assert.equal(removeAdobeWebProject(doc, "jys5tkg"), 2);
  assert.equal(removeAdobeWebProject(doc, "abc1234"), 1);
  assert.equal(doc.adobeFonts, undefined);
  assert.equal(removeAdobeWebProject(doc, "notfound"), 0);
});

test("removing Adobe Fonts is one undoable editor change", () => {
  useEditor.getState().replaceDoc(registrationFixture());
  const original = structuredClone(useEditor.getState().doc);
  useEditor.getState().updateDoc(doc => { removeAdobeWebProject(doc, "jys5tkg"); });
  const edited = structuredClone(useEditor.getState().doc);
  assert.equal(edited.adobeFonts?.length, 1);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, original);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, edited);
});

test("adding a dynamic family upgrades every font in its Web Project", () => {
  const doc = registrationFixture();
  doc.adobeFonts = [
    { family: "acumin-pro", kitId: "jys5tkg", loading: "css" },
    { family: "other-kit-font", kitId: "abc1234", loading: "css" },
  ];
  registerAdobeFont(doc, { family: "poprumcute", kitId: "jys5tkg", loading: "dynamic" });
  assert.deepEqual(doc.adobeFonts, [
    { family: "acumin-pro", kitId: "jys5tkg", loading: "dynamic" },
    { family: "other-kit-font", kitId: "abc1234", loading: "css" },
    { family: "poprumcute", kitId: "jys5tkg", loading: "dynamic" },
  ]);
});

test("adding a CSS family to a dynamic Web Project preserves dynamic loading", () => {
  const doc = registrationFixture();
  registerAdobeFont(doc, { family: "new-family", kitId: "jys5tkg", loading: "css" });
  assert.ok(doc.adobeFonts?.filter(font => font.kitId === "jys5tkg")
    .every(font => font.loading === "dynamic"));
  assert.ok(doc.adobeFonts?.some(font => font.family === "new-family" && font.loading === "dynamic"));
});
