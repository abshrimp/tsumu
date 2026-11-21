import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { makeText, createInitialDoc } from "../lib/presets";
import { type SiteDoc, type Asset, type ImageRef } from "../lib/types";
import { usedAdobeFonts, createCssValueResolver, uploadedFontsCss } from "../lib/generator/css";
import { adobeFontHead } from "../lib/generator/adobe-fonts";
import { generateExportProject } from "../lib/export-formats";
import { TOPICS } from "../lib/manualTopics";
import { parseAdobeEmbed, parseAdobeKitInput } from "../lib/adobe-fonts-embed";
import { adobeCssFamilies, adobePublishedFamilies, inspectAdobeProject } from "../lib/adobe-fonts-project";
import { registerAdobeFont, removeAdobeWebProject } from "../lib/adobe-fonts-registration";
import { useEditor } from "../lib/store";
import { css2FamilyToken, googleFontWeightAxis } from "../lib/google-font-weights";
import { GOOGLE_FONT_CATALOG, GOOGLE_FONT_CATEGORIES, SUGGESTED_GOOGLE_FONTS, searchGoogleFonts } from "../lib/google-font-catalog";
import { elements, importCallbacks } from "./helpers/pending-import";
import { buildAssetNames } from "../lib/generator/names";
import { scopedAssetIds } from "../lib/generator/scoped-assets";
import { validSiteAdditionalFields } from "../lib/document-value-shapes";

describe("adobe-fonts", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
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

test("oversized streamed Adobe metadata and CSS responses abort without unbounded buffering", async () => {
  const chunk = new Uint8Array(64 * 1024).fill(0x61);
  const hugeStream = () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(chunk); },
  }), { status: 200 });
  const { fake } = stubAdobeFetch(hugeStream(), hugeStream(), new Response(null, { status: 404 }));
  assert.deepEqual(await inspectAdobeProject("tud1nus", fake), { status: "unknown", fonts: [] });
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
});

describe("font stacks and variable weights", () => {
  test("the editor and exports request each family’s supported weight axis", () => {
    assert.equal(css2FamilyToken({ family: "Syne", weights: "variable" }), "family=Syne:wght@400..800");
    assert.equal(css2FamilyToken({ family: "Roboto Flex", weights: "variable" }), "family=Roboto+Flex:wght@100..1000");
    assert.equal(css2FamilyToken({ family: "Noto Serif JP", weights: "variable" }), "family=Noto+Serif+JP:wght@200..900");
    assert.equal(css2FamilyToken({ family: "Instrument Serif", weights: ["400"] }), "family=Instrument+Serif");
    assert.equal(css2FamilyToken({ family: "Space Mono", weights: ["700", "400"] }), "family=Space+Mono:wght@400;700");
    assert.equal(googleFontWeightAxis("Instrument Serif"), undefined);
    assert.equal(googleFontWeightAxis("Outside the catalog"), undefined);
  });

  test("all export formats load fonts in quoted stacks and retain the given fallback order", () => {
    const doc = createInitialDoc();
    doc.customFonts = [
      { family: "Syne", weights: "variable" }, { family: "Instrument Serif", weights: ["400"] },
      { family: "Space Mono", weights: ["400", "700"] }, { family: "sYnE", weights: "variable" },
    ];
    const page = doc.pages[doc.pageOrder[0]];
    const node = makeText("ODD/FORM");
    doc.pageOrder = [page.id];
    doc.pages = { [page.id]: page };
    doc.nodes = { [node.id]: node };
    page.children = [node.id];
    page.bodyDarkStyles = { base: { default: { fontFamily: '"Noto Sans JP", sans-serif' } } };
    node.styles.base = { default: {
      fontFamily: `'syne', "Fallback, With Comma", var(--theme, "Instrument Serif", serif), serif`,
      fontWeight: "725",
    } };
    for (const target of ["html", "single-html", "react", "vue", "nuxt", "sveltekit", "nextjs"] as const) {
      const files = generateExportProject(doc, target).files;
      const source = Object.values(files).join("\n");
      assert.ok(source.includes('var(--font-syne, "Syne"), "Fallback, With Comma", var(--theme, var(--font-instrument-serif, "Instrument Serif"), serif), serif'), target);
      if (target === "nextjs") {
        assert.match(files["app/layout.tsx"], /Syne\(\{[^}]+variable: "--font-syne", adjustFontFallback: false/);
        assert.match(files["app/layout.tsx"], /Noto_Sans_JP\(/);
        assert.doesNotMatch(files["app/layout.tsx"], /Space_Mono|sYnE/);
      } else {
        assert.match(source, /family=Syne:wght@400\.\.800/, target);
        assert.match(source, /family=Noto\+Sans\+JP:wght@100\.\.900/, target);
        assert.match(source, /family=Instrument\+Serif&display=swap/, target);
        assert.doesNotMatch(source, /family=Space\+Mono/, target);
        assert.match(source, /--font-syne: "Syne";/, target);
      }
    }
  });
});

describe("google-font-catalog", () => {
test("Google Fonts search covers diverse families without an API key", () => {
  assert.ok(GOOGLE_FONT_CATALOG.length > 1500);
  assert.deepEqual(searchGoogleFonts("Noto Sans JP").slice(0, 1), ["Noto Sans JP"]);
  assert.ok(searchGoogleFonts("potta", "japanese").includes("Potta One"));
  assert.ok(searchGoogleFonts("INTER")[0] === "Inter");
  assert.ok(searchGoogleFonts("", "japanese", 10).length <= 10);
  assert.ok(searchGoogleFonts("", "handwriting").length > 0);
});

test("font discovery prioritizes exact matches and category constraints", () => {
  const found = searchGoogleFonts("Roboto");
  assert.equal(found[0], "Roboto");
  assert.ok(found.length > 1);
  assert.ok(searchGoogleFonts("Roboto", "serif").every(name => /Roboto/.test(name)));
  assert.deepEqual(searchGoogleFonts("font_that_cannot_exist"), []);
  assert.deepEqual(searchGoogleFonts("", "all", 0), []);
});

test("unfiltered suggestions contain only the curated families, not alphabetical catalog filler", () => {
  const suggestions = searchGoogleFonts("");
  assert.deepEqual(suggestions, [...SUGGESTED_GOOGLE_FONTS]);
  assert.equal(suggestions.length, SUGGESTED_GOOGLE_FONTS.length);
  assert.equal(new Set(suggestions).size, suggestions.length);
  assert.deepEqual(searchGoogleFonts("", "all", 5), SUGGESTED_GOOGLE_FONTS.slice(0, 5));
  assert.ok(!suggestions.includes("ABeeZee"), "A-Z catalog entries must not appear as suggestions");
});

test("category suggestions only filter the curated list while actual searches use the full catalog", () => {
  for (const category of ["japanese", ...GOOGLE_FONT_CATEGORIES] as const) {
    const suggestions = searchGoogleFonts("", category);
    assert.ok(suggestions.length > 0, category + " should have useful suggestions");
    assert.ok(suggestions.every(name => SUGGESTED_GOOGLE_FONTS.includes(name as typeof SUGGESTED_GOOGLE_FONTS[number])));
    assert.deepEqual(searchGoogleFonts("", category, 2), suggestions.slice(0, 2));
  }
  assert.equal(searchGoogleFonts("ABeeZee")[0], "ABeeZee");
});
});

describe("pending-import", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
function open() {
  state().replaceDoc({
    siteName: "Imports", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] } },
    nodes: { a: { ...makeText("A"), id: "a" }, b: { ...makeText("B"), id: "b" } },
  });
  state().select("a");
  state().setBreakpoint("base");
  state().setStyleState("default");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const uploaded: Asset = { id: "new", name: "new.png", width: 1, height: 1, path: "assets/new.png" };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function imageFixture(apply: (v: ImageRef | null) => void = () => {}, setup = () => {}) {
  open();
  setup();
  const work = deferred<Asset>();
  const ui = importCallbacks("image", () => work.promise);
  const writes: (ImageRef | null)[] = [];
  const props = { value: { url: "https://example.test/original.png" } as ImageRef | null, editTarget: "a/base", onChange: (v: ImageRef | null) => { writes.push(v); apply(v); } };
  const render = () => elements(ui.render(props));
  render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
  const input = render().find((e) => e.type === "input" && e.props.type === "file");
  input.props.onChange({ target: { files: [new File(["image"], "new.png", { type: "image/png" })], value: "new.png" } });
  render();
  return { work, ui, writes, props, render };
}

test("image upload does not replace a newer chosen image or cleared value", async () => {
  for (const choose of [true, false]) {
    const f = imageFixture();
    if (choose) f.render().find((e) => e.props?.onPick).props.onPick({ id: "existing" });
    else f.render().find((e) => e.props?.["data-tip"] === "Clear").props.onClick();
    f.work.resolve(uploaded);
    await tick();
    assert.deepEqual(f.writes, [choose ? { assetId: "existing" } : null]);
    assert.deepEqual(state().doc.assets, { new: uploaded });
    f.ui.unmount();
  }
});

test("typing a URL cancels the pending image assignment before blur, including stale errors", async () => {
  for (const initial of [undefined, { url: "https://example.test/original.png" }]) {
    for (const fail of [false, true]) {
      open();
      if (initial) state().updatePage("p", { ogImage: initial });
      const work = deferred<Asset>();
      const ui = importCallbacks("image", () => work.promise);
      const render = () => elements(ui.render({
        editTarget: "p", value: state().doc.pages.p.ogImage,
        onChange: (value: ImageRef | null) => state().updatePage("p", { ogImage: value }),
      }));
      const urlInput = () => render().find((e) => e.type === "input" && e.props.className === "input");
      try {
        render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
        render().find((e) => e.type === "input" && e.props.type === "file").props.onChange({
          target: { files: [new File(["image"], "new.png", { type: "image/png" })], value: "new.png" },
        });
        const draft = "  https://example.test/newer.png  ";
        urlInput().props.onChange?.({ target: { value: draft } });
        assert.deepEqual(state().doc.pages.p.ogImage, initial, "typing does not commit the draft");
        if (fail) work.reject(new Error("stale upload failed"));
        else work.resolve(uploaded);
        await tick();
        assert.deepEqual(state().doc.pages.p.ogImage, initial, "completion cannot assign over the unblurred draft");
        assert.deepEqual(state().doc.assets, fail ? {} : { new: uploaded });
        assert.deepEqual(ui.alerts, []);
        assert.ok(urlInput(), "the URL field remains mounted");
        urlInput().props.onBlur({ target: { value: draft } });
        assert.deepEqual(state().doc.pages.p.ogImage, { url: draft.trim() });
      } finally { ui.unmount(); }
    }
  }
});

test("completed uploads stay in Assets without assignment after closing, unmounting, target changes, or new values", async () => {
  for (const stop of ["close", "unmount", "target", "value"]) {
    const f = imageFixture();
    if (stop === "close") f.render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
    if (stop === "unmount") f.ui.unmount();
    if (stop === "target") { f.props.editTarget = "a/mobile"; f.render(); }
    if (stop === "value") { f.props.value = { url: "https://example.test/newer.png" }; f.render(); }
    f.work.resolve(uploaded);
    await tick();
    assert.deepEqual(f.writes, [], stop);
    assert.deepEqual(state().doc.assets, { new: uploaded }, stop);
    f.ui.unmount();
  }
});

test("cancelled image errors stay silent and a retry owns the result and busy state", async () => {
  const f = imageFixture();
  f.render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
  f.work.reject(new Error("old upload failed"));
  await tick();
  assert.deepEqual(f.ui.alerts, []);
  f.ui.unmount();

  const first = deferred<Asset>(); const second = deferred<Asset>();
  let count = 0;
  const ui = importCallbacks("image", () => ++count === 1 ? first.promise : second.promise);
  const writes: unknown[] = [];
  const render = () => elements(ui.render({ value: null, onChange: (v: unknown) => writes.push(v) }));
  render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
  const input = () => render().find((e) => e.type === "input" && e.props.type === "file");
  const change = () => input().props.onChange({ target: { files: [new File([], "new.png")], value: "" } });
  change(); change();
  first.resolve({ ...uploaded, id: "old-request" }); await tick();
  assert.equal(render().find((e) => e.props?.className === "img-pick-cell is-upload").props.disabled, true);
  assert.deepEqual(writes, []);
  second.resolve(uploaded); await tick();
  assert.deepEqual(writes, [{ assetId: "new" }]);
  assert.deepEqual(Object.keys(state().doc.assets), ["old-request", "new"]);
  ui.unmount();
});


test("a failed old upload cannot clear a newer retry's busy state or show its error", async () => {
  open();
  const old = deferred<Asset>(); const current = deferred<Asset>();
  let count = 0;
  const ui = importCallbacks("image", () => ++count === 1 ? old.promise : current.promise);
  const writes: unknown[] = [];
  const render = () => elements(ui.render({ value: null, onChange: (v: unknown) => writes.push(v) }));
  const toggle = () => render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
  const chooseFile = () => render().find((e) => e.type === "input" && e.props.type === "file").props.onChange({
    target: { files: [new File([], "new.png")], value: "" },
  });
  toggle(); chooseFile(); toggle(); toggle(); chooseFile();
  old.reject(new Error("old upload failed")); await tick();
  assert.equal(render().find((e) => e.props?.className === "img-pick-cell is-upload").props.disabled, true);
  assert.deepEqual(ui.alerts, []);
  assert.deepEqual(writes, []);
  current.resolve(uploaded); await tick();
  assert.deepEqual(writes, [{ assetId: "new" }]);
  assert.deepEqual(state().doc.assets, { new: uploaded });
  ui.unmount();
});

test("late upload registration has its own undo step and preserves the newer image choice", async () => {
  const f = imageFixture((value) => state().updatePage("p", { ogImage: value }));
  try {
    f.render().find((e) => e.props?.onPick).props.onPick({ id: "existing" });
    const chosen = structuredClone(state().doc);
    f.work.resolve(uploaded); await tick();
    const completed = structuredClone(state().doc);
    assert.deepEqual(completed.pages.p.ogImage, { assetId: "existing" });
    assert.deepEqual(completed.assets.new, uploaded);
    state().undo(); assert.deepEqual(state().doc, chosen, "undo the completed upload without undoing the newer image choice");
    state().redo(); assert.deepEqual(state().doc, completed);
    state().undo(); state().undo(); assert.equal(state().doc.pages.p.ogImage, undefined);
    state().redo(); state().redo(); assert.deepEqual(state().doc, completed);
  } finally { f.ui.unmount(); }
});

test("uninterrupted image upload preserves unrelated edits and the complete undo/redo snapshots", async () => {
  const f = imageFixture((value) => state().updatePage("p", { ogImage: value }));
  try {
    state().updateNode("b", { name: "Edited while uploading" }); f.render();
    const before = structuredClone(state().doc);
    f.work.resolve(uploaded); await tick();
    const imported = structuredClone(state().doc);
    assert.deepEqual(imported.pages.p.ogImage, { assetId: "new" });
    assert.deepEqual(imported.assets.new, uploaded);
    assert.equal(imported.nodes.b.name, "Edited while uploading");
    state().undo(); state().undo(); assert.deepEqual(state().doc, before);
    state().redo(); state().redo(); assert.deepEqual(state().doc, imported);
  } finally { f.ui.unmount(); }
});


test("an upload interrupted by unrelated Undo retains its file without clearing Redo, even before a rerender", async () => {
  const f = imageFixture(undefined, () => state().updateNode("b", { name: "Redo this edit" }));
  try {
    const edited = structuredClone(state().doc);
    state().undo();
    assert.equal(state().future.length, 1);
    f.work.resolve(uploaded); await tick();
    assert.deepEqual(f.writes, []);
    assert.equal(state().past.length, 0); assert.equal(state().future.length, 1);
    assert.deepEqual(state().doc.assets.new, uploaded);
    state().redo(); assert.deepEqual(state().doc, { ...edited, assets: { new: uploaded } });
    state().undo(); assert.deepEqual(state().doc.assets.new, uploaded);
    state().redo(); assert.deepEqual(state().doc, { ...edited, assets: { new: uploaded } });
  } finally { f.ui.unmount(); }
});

test("Undo then Redo invalidates the old assignment even when its target and content return unchanged", async () => {
  const f = imageFixture(undefined, () => state().updateNode("b", { name: "Same when complete" }));
  try {
    const edited = structuredClone(state().doc);
    state().undo(); state().redo();
    f.work.resolve(uploaded); await tick();
    assert.deepEqual(f.writes, []);
    assert.equal(state().past.length, 1); assert.equal(state().future.length, 0);
    assert.deepEqual(state().doc, { ...edited, assets: { new: uploaded } });
    state().undo(); assert.deepEqual(state().doc.assets.new, uploaded);
  } finally { f.ui.unmount(); }
});

test("replacement, restoration, and reset retain the completed upload without applying an old picker", async () => {
  for (const boundary of ["replace", "restore", "reset"]) {
    const f = imageFixture();
    try {
      const replacement = structuredClone(state().doc);
      if (boundary === "replace") state().replaceDoc(replacement);
      if (boundary === "restore") { replacement.siteName = "Restored"; state().restoreDoc(replacement); }
      if (boundary === "reset") state().resetDoc();
      const before = structuredClone(state().doc);
      const past = state().past.length;
      f.work.resolve(uploaded); await tick();
      assert.deepEqual(f.writes, [], boundary);
      assert.deepEqual(state().doc, { ...before, assets: { ...before.assets, new: uploaded } });
      assert.equal(state().past.length, past);
    } finally { f.ui.unmount(); }
  }
});

test("an ineffective Undo or Redo leaves the pending upload valid and normally undoable", async () => {
  const f = imageFixture((value) => state().updatePage("p", { ogImage: value }));
  try {
    const before = structuredClone(state().doc);
    state().undo(); state().redo(); f.render();
    f.work.resolve(uploaded); await tick();
    assert.deepEqual(f.writes, [{ assetId: "new" }]);
    state().undo(); state().undo(); assert.deepEqual(state().doc, before);
    state().redo(); state().redo(); assert.deepEqual(state().doc.pages.p.ogImage, { assetId: "new" });
  } finally { f.ui.unmount(); }
});

function fontFixture(family = "New Font") {
  open();
  const work = deferred<Response>();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => work.promise;
  const ui = importCallbacks("font");
  const render = () => elements(ui.render({ inheritedValue: "Arial" }));
  render().find((e) => e.props?.["data-tip"] === "Add a font").props.onClick();
  render().find((e) => e.type === "input" && e.props.type === "search").props.onChange({ target: { value: family } });
  render().find((e) => e.type === "button" && e.props?.children === "Add").props.onClick();
  render();
  return { work, ui, render, close: () => { ui.unmount(); globalThis.fetch = oldFetch; } };
}

test("the font picker registers real variable axes and keeps fixed-weight families", async () => {
  for (const [name, weights] of [["Syne", "variable"], ["Space Mono", ["400", "700"]]] as const) {
    const f = fontFixture(name);
    try {
      f.work.resolve(new Response("@font-face { font-weight: 400; }"));
      await tick(); await tick();
      assert.deepEqual(state().doc.customFonts, [{ family: name, weights }]);
    } finally { f.close(); }
  }
});

test("pending fonts cannot write into a changed breakpoint, state, selection, or multiselection", async () => {
  for (const change of [
    () => state().setBreakpoint("sm"),
    () => state().setStyleState("hover"),
    () => state().select("b"),
    () => useEditor.setState({ selectedIds: ["a", "b"] }),
  ]) {
    const f = fontFixture();
    try {
      change(); f.render();
      const before = structuredClone(state().doc);
      f.work.resolve(new Response("@font-face { font-weight: 100 900; }")); await tick(); await tick();
      assert.deepEqual(state().doc, before);
    } finally { f.close(); }
  }
});

test("closing or editing a pending font request leaves styles and font registrations unchanged", async () => {
  for (const change of ["close", "edit", "unmount", "external"]) {
    const f = fontFixture();
    try {
      if (change === "close") f.render().find((e) => e.props?.["data-tip"] === "Add a font").props.onClick();
      if (change === "edit") f.render().find((e) => e.type === "input" && e.props.type === "search").props.onChange({ target: { value: "Different Font" } });
      if (change === "unmount") f.ui.unmount();
      if (change === "external") { state().setStyleProps("a", { fontFamily: "Arial" }); f.render(); }
      const before = structuredClone(state().doc);
      f.work.resolve(new Response("@font-face { font-weight: 100 900; }")); await tick(); await tick();
      assert.deepEqual(state().doc, before, change);
    } finally { f.close(); }
  }
});

test("uninterrupted font import preserves unrelated edits and undo/redo data", async () => {
  const f = fontFixture();
  try {
    state().updateNode("b", { name: "Edited while loading" }); f.render();
    const before = structuredClone(state().doc);
    f.work.resolve(new Response("@font-face { font-weight: 100 900; }")); await tick(); await tick();
    const imported = structuredClone(state().doc);
    assert.equal(imported.nodes.a.styles.base?.default?.fontFamily, "New Font");
    assert.equal(imported.nodes.b.name, "Edited while loading");
    assert.deepEqual(imported.customFonts, [{ family: "New Font", weights: "variable" }]);
    state().undo(); state().undo(); assert.deepEqual(state().doc, before);
    state().redo(); state().redo(); assert.deepEqual(state().doc, imported);
  } finally { f.close(); }
});


test("font validation cannot add a font after unrelated Undo or document replacement", async () => {
  for (const replace of [false, true]) {
    const f = fontFixture();
    try {
      if (replace) state().replaceDoc(structuredClone(state().doc));
      else { state().updateNode("b", { name: "Redo this edit" }); state().undo(); }
      const before = structuredClone(state().doc);
      const future = structuredClone(state().future);
      f.work.resolve(new Response("@font-face { font-weight: 100 900; }")); await tick(); await tick();
      assert.deepEqual(state().doc, before);
      assert.deepEqual(state().future, future);
    } finally { f.close(); }
  }
});
});

describe("uploaded-fonts", () => {
function fixture() {
  const doc = createInitialDoc();
  const node = Object.values(doc.nodes).find(node => !!node.text);
  assert.ok(node, "Expected a text node");
  node.styles.base ??= {};
  node.styles.base.default ??= {};
  node.styles.base.default.fontFamily = "My Local Font";
  doc.assets["asset_custom"] = {
    id: "asset_custom", name: "my-font.woff2", path: "assets/font-file.woff2",
    width: 0, height: 0, mimeType: "font/woff2",
  };
  doc.uploadedFonts = [{ family: "My Local Font", assetId: "asset_custom" }];
  return doc;
}

test("uploaded fonts validate as part of the site document", () => {
  const doc = fixture();
  assert.equal(validSiteAdditionalFields({ uploadedFonts: doc.uploadedFonts }), true);
  assert.equal(validSiteAdditionalFields({ uploadedFonts: [{ family: "Bad\" CSS", assetId: "asset_custom" }] }), false);
  assert.equal(validSiteAdditionalFields({ uploadedFonts: [{ family: "A", assetId: "../../../oops" }] }), false);
});

test("uploaded fonts are bundled and fall back to sans-serif without literal \\n escapes", () => {
  const doc = fixture();
  const textNodes = Object.values(doc.nodes).filter(node => !!node.text);
  assert.ok(textNodes.length >= 2, "Expected at least two text nodes");
  textNodes[1]!.styles.base = { default: { fontFamily: "Second Local Font" } };
  doc.assets["asset_second"] = {
    id: "asset_second", name: "second.woff2", path: "assets/second.woff2",
    width: 0, height: 0, mimeType: "font/woff2",
  };
  doc.uploadedFonts = [
    { family: "My Local Font", assetId: "asset_custom" },
    { family: "Second Local Font", assetId: "asset_second" },
  ];
  const names = buildAssetNames(doc);
  const css = uploadedFontsCss(doc, names);
  assert.equal((css.match(/@font-face/g) ?? []).length, 2);
  assert.doesNotMatch(css, /\\n/);
  assert.match(css, /}\n@font-face \{/);
  assert.match(css, /font-family: "My Local Font"/);
  assert.match(css, /font-family: "Second Local Font"/);
  assert.match(css, /format\("woff2"\)/);
  assert.match(css, /font-display: swap/);
  assert.match(css, /url\("\/assets\/[^"]+\.woff2"\)/);
  assert.equal(createCssValueResolver(doc, names)("fontFamily", "My Local Font"), '"My Local Font", sans-serif');
  assert.ok(scopedAssetIds(doc, doc.assets).has("asset_custom"));
});

test("Tailwind exports keep Google Fonts @import rules before Tailwind CSS imports", () => {
  const doc = createInitialDoc();
  const node = Object.values(doc.nodes).find(item => !!item.text);
  assert.ok(node);
  node.styles.base = { default: { fontFamily: "Inter" } };
  const project = generateExportProject(doc, {
    framework: "react", language: "typescript", style: "tailwind", scope: "project",
  });
  const css = project.files["src/globals.css"];
  assert.ok(css);
  const fontImportIndex = css.indexOf('@import url("https://fonts.googleapis.com/');
  const tailwindImportIndex = css.indexOf('@import "tailwindcss/theme.css";');
  assert.ok(fontImportIndex >= 0, "Expected Google Fonts @import");
  assert.ok(tailwindImportIndex > fontImportIndex, "Google Fonts @import must precede tailwindcss/theme.css");
});

test("Adobe and uploaded families work as entries in a mixed fallback list", () => {
  const doc = fixture();
  doc.adobeFonts = [{ family: "acumin-pro", kitId: "abc1234", loading: "css" }];
  const node = Object.values(doc.nodes).find(node => !!node.text)!;
  const family = `'My Local Font', acumin-pro, monospace`;
  node.styles.base.default!.fontFamily = family;
  const source = Object.values(generateExportProject(doc, "html").files).join("\n");
  assert.match(source, /@font-face \{ font-family: "My Local Font"/);
  assert.match(source, /use\.typekit\.net\/abc1234\.css/);
  assert.ok(source.includes('font-family: "My Local Font", "acumin-pro", monospace;'));
  node.styles.base.default!.fontFamily = `"other, My Local Font", var(--other, "acumin-pro, different", serif)`;
  assert.equal(uploadedFontsCss(doc, buildAssetNames(doc)), "");
  assert.equal(usedAdobeFonts(doc).length, 0);
});

test("unused or missing font assets are not emitted as CSS font faces", () => {
  const doc = fixture();
  doc.uploadedFonts = [{ family: "Other Font", assetId: "asset_custom" }];
  assert.equal(uploadedFontsCss(doc, buildAssetNames(doc)), "");
  doc.uploadedFonts = [{ family: "My Local Font", assetId: "missing" }];
  assert.equal(uploadedFontsCss(doc, buildAssetNames(doc)), "");
});
});
