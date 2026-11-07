import { describe, before, test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve as resolve_2, resolve as resolve_3, resolve as resolve_4, resolve as resolve_5, resolve as resolve_6, resolve as resolve_7, resolve as resolve_8, resolve as resolve_9, resolve as resolve_10, resolve as resolve_11, resolve as resolve_12, resolve as resolve_13 } from "node:path";
import { transformSync } from "./helpers/bundle";
import { cssAssetReferences } from "../lib/css-assets";
import { searchSiteBody } from "../lib/body-search";
import { type SiteDoc, type Asset, type DocNode } from "../lib/types";
import { buildCanvasCss, previewHtmlWithBodyStyles, type CanvasCssCache } from "../components/canvas/css";
import { applyBreakpoints, bpRangeQuery, getProp, clearedValue, resolveStyles } from "../lib/style";
import { canvasMoveDoc } from "./helpers/canvas-move";
import { cssQuotedAttributeValue } from "../lib/css-selector";
import { generateSiteCss } from "../lib/generator/css";
import { generateProject } from "../lib/generator";
import { defaultAudioDoc, audioSource } from "./helpers/default-audio";
import * as React from "react";
import { createElement as createElement_2 } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildClassNames } from "../lib/generator/names";
import { makeBox, makeSwitch, createInitialDoc, makeMedia, makeText } from "../lib/presets";
import { canvasFallbackDrop } from "../lib/canvas-drop";
import { useEditor as useEditor_2, useEditor as useEditor_3, useEditor as useEditor_4, useEditor as useEditor_5, useEditor as useEditor_6, useEditor as useEditor_7, useEditor as useEditor_8, useEditor as useEditor_9 } from "../lib/store";
import { type UseCanvasDragDeps } from "../components/canvas/useCanvasDrag";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME } from "../lib/script-runtime";
import { ListDomNode } from "./helpers/list-runtime-dom";
import { highlightCustomCode } from "../lib/code-highlight";
import { shorthandSide, parseColor, composeColor, VarInput, CommitInput } from "../components/controls";
import { cssValueParts } from "../lib/css-value-parts";
import { flowMode } from "../components/style-panel/PositionSec";
import { parseGradient } from "../components/style-panel/BackgroundSec";
import { parseShadow, serializeShadow } from "../components/style-panel/EffectsSec";
import * as dialogs from "../lib/dialog";
import { showAlert, showConfirm, showPrompt, useDialogs } from "../lib/dialog";
import { parseJsonc, normalizeStorageConfig, storageBindings } from "../scripts/cloudflare.mjs";
import { isolatedPreviewConfig } from "../scripts/cloudflare-preview.mjs";
import { editFilterFunction } from "../lib/filter-edit";
import { filterFieldKind, filterFieldOperators, filterFieldSelection } from "../lib/filter-field-options";
import { matchesValueCondition } from "../lib/value-semantics";
import { startImageDrop, type ImageDropPoint } from "../lib/image-drop";
import { layerWindow, LAYER_ROW_HEIGHT, visibleLayerRows } from "../lib/layers-visible";
import { assetMediaUrl, validAssetSuffix } from "../lib/media-url";
import { mediaSrc, replaceEmbeddedAsset, detectSvgFilters } from "../lib/assets";
import { safeMediaUrl, safeResourceUrl } from "../lib/url-policy";
import { validSiteDoc } from "../lib/doc-tree";
import { validateImportedDoc } from "../lib/site-import-format";
import { trackPanelResize } from "../lib/panel-resize";
import { rewriteSrcsetUrls } from "../lib/srcset";
import { resolveZipReference } from "../lib/zip-references";
import { rewriteZipReferences } from "../lib/html-zip";
import { svgUsesBlurOrShadow } from "../lib/svg-effects";
import { cacheSvgEffect } from "../lib/svg-analysis-cache";
import { crispSvgSize } from "../lib/generator/render-helpers";
import { importCallbacks } from "./helpers/pending-import";
import { textStyleConfirmationDoc } from "./helpers/text-style-confirmation";
import { embedSrc } from "../lib/embed";
import { renderLeafNode } from "../components/canvas/render";
import { loadGeneratedRoute } from "./helpers/generated-route";

describe("background-image-controls", () => {
function render(image: string, assets = {}) {
  const writes: Record<string, string | null>[] = [];
  const path = resolve_2("components/style-panel/BackgroundSec.tsx");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const doc = { assets };
  const useEditor = Object.assign((select: (s: { doc: typeof doc }) => unknown) => select({ doc }), {
    getState: () => ({ doc }),
  });
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "../../lib/store") return { useEditor };
    if (id === "../ImagePicker") return { default: "ImagePicker", __esModule: true };
    if (id === "../controls") return {
      useInspector: () => ({ editTarget: "a", get: (prop: string) => ({ value: prop === "backgroundImage" ? image : undefined }),
        cleared: () => null, set: (props: Record<string, string | null>) => writes.push(props) }),
      Seg: "Seg", Grp: "Grp", Dropdown: "Dropdown", FillControl: "FillControl", NumField: "NumField", PropFill: "PropFill", PropSelect: "PropSelect",
    };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const elements: any[] = [];
  const visit = (value: any) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") { elements.push(value); visit(value.props?.children); }
  };
  visit(mod.exports.BackgroundSec());
  return { elements, writes, mode: elements.find(e => e.type === "Seg")?.props.value,
    picker: elements.find(e => e.type === "ImagePicker")?.props };
}

for (const image of ['url("https://example.test/gradient.png")', 'URL("https://example.test/photo.png")']) {
  test(`background controls recognize an image rather than matching URL contents: ${image}`, () => {
    const view = render(image);
    assert.equal(view.mode, "image");
    assert.equal(view.picker.value.url, cssAssetReferences(image)[0].url);
  });
}
for (const image of ['url("https://example.test/photo(1).png")', 'url("https://example.test/a\\\"b.png")', 'url(https://example.test/a\\(1\\).png)']) {
  test(`background picker preserves the complete decoded URL: ${image}`, () => {
    assert.equal(render(image).picker.value.url, cssAssetReferences(image)[0].url);
  });
}

test("changing a background escapes CSS string delimiters and round-trips the URL", () => {
  const view = render('url("before.png")');
  const url = 'https://example.test/a"b\\c(1).png';
  view.picker.onChange({ url });
  const value = view.writes[0].backgroundImage!;
  assert.deepEqual(cssAssetReferences(value).map(ref => ref.url), [url]);
  assert.equal(render(value).picker.value.url, url);
});

test("actual gradient functions still use gradient controls", () => {
  assert.equal(render("linear-gradient(90deg, #fff 0%, #000 100%)").mode, "gradient");
});


test("uppercase gradient function retains its angle and colors", () => {
  const view = render("LINEAR-GRADIENT(45DEG, #123456 0%, #abcdef 100%)");
  assert.equal(view.mode, "gradient");
  const angle = view.elements.find(e => e.type === "NumField");
  assert.equal(angle.props.value, "45deg");
  const colors = view.elements.filter(e => e.type === "FillControl");
  assert.deepEqual(colors.map(e => e.props.value), ["#123456", "#abcdef"]);
});
});

describe("body-search", () => {
const doc = {
  pageOrder: ["home", "article", "html"],
  pages: {
    home: { id: "home", name: "Home", children: ["title", "outer"] },
    article: { id: "article", name: "Article", children: ["second"] },
    html: { id: "html", name: "HTML", children: [], rawHtml: "<main><h1>日本語の本文</h1><script>秘密の本文</script></main>" },
  },
  nodes: {
    title: { id: "title", name: "Heading", type: "box", text: { content: "公開する本文", heading: 1 }, children: [] },
    outer: { id: "outer", name: "Container", type: "box", text: null, children: ["nested"] },
    nested: { id: "nested", name: "Nested", type: "box", text: { content: "本文中の文字列", heading: 0 }, children: [] },
    second: { id: "second", name: "Article text", type: "box", text: { content: "本文と関連する説明", heading: 0 }, children: [] },
  },
} as unknown as SiteDoc;

test("text search finds Japanese editable body content across pages in page order", () => {
  const results = searchSiteBody(doc, "本文");
  assert.deepEqual(results.map((r) => [r.pageId, r.nodeId]), [
    ["home", "title"], ["home", "nested"], ["article", "second"], ["html", null],
  ]);
  assert.match(results[0].excerpt, /公開する本文/);
});

test("body search excerpts preserve the authored spelling around normalization expansions and contractions", () => {
  const title = doc.nodes.title;
  const cases = [
    ["㍿".repeat(110), "Ｔｓｕｍｕガイド", "tsumuガイド", "後".repeat(300)],
    ["ｶﾞ".repeat(130), "Ｔｓｕｍｕガイド", "tsumuガイド", "後".repeat(300)],
    ["İ".repeat(140), "Ｔｓｕｍｕガイド", "tsumuガイド", "後".repeat(300)],
    ["ㄱㅏ".repeat(140), "Ｔｓｕｍｕガイド", "tsumuガイド", "後".repeat(300)],
    ["㍿".repeat(100), "ｺﾞ".repeat(180), "ゴ".repeat(180), "ｶﾞ".repeat(120)],
    ["前".repeat(100), "ａ" + "\u0315".repeat(200) + "\u0301", "á", "後".repeat(300)],
  ];
  for (const [prefix, spelling, query, suffix] of cases) {
    const content = prefix + spelling + suffix;
    const site = {
      ...doc, nodes: { ...doc.nodes, title: { ...title, text: { content, heading: 0 as const } } },
    };
    const [hit] = searchSiteBody(site, query);
    assert.ok(hit.excerpt.includes(spelling), hit.excerpt);
    assert.ok(hit.excerpt.startsWith("…") && hit.excerpt.endsWith("…"));
  }
});

test("text search excludes script contents, supports NFKC and bounds results", () => {
  assert.deepEqual(searchSiteBody(doc, "秘密"), []);
  assert.deepEqual(searchSiteBody(doc, ""), []);
  assert.equal(searchSiteBody(doc, "本文", 2).length, 2);
  assert.equal(searchSiteBody({
    ...doc,
    nodes: { ...doc.nodes, title: { ...doc.nodes.title, text: { content: "ＣＡＦＥ", heading: 0 } } },
  } as SiteDoc, "cafe").length, 1);
});

test("page kinds search only the content available in the editor", () => {
  for (const mode of [{ rawHtml: "<p>Imported body</p>" }, { rawHtml: "" }, { redirectTo: "" }, { rewriteTo: "/news" }]) {
    const page = { ...doc.pages.home, ...mode };
    const site = { ...doc, pages: { home: page }, pageOrder: ["home"] };
    assert.deepEqual(searchSiteBody(site, "本文"), []);
    assert.deepEqual(searchSiteBody(site, "Imported").map(hit => hit.nodeId), page.rawHtml ? [null] : []);
  }
});

test("raw HTML search reads body text, including entities and words spanning inline markup", () => {
  const page = {
    ...doc.pages.html,
    rawHtml: '<title>Metadata only</title><main><p title="a > b">Tsu<strong>mu</strong> &amp; Co</p>' +
      '<p>News<br>today</p><!-- Comment only --><template>Template only</template><i hidden>Hidden only</i></main>',
  };
  const site = { ...doc, pages: { html: page }, pageOrder: ["html"] };
  assert.deepEqual(searchSiteBody(site, "Tsumu & Co News today").map(hit => hit.excerpt), ["Tsumu & Co News today"]);
  for (const query of ["Metadata only", "Comment only", "Template only", "Hidden only", "CoNews", "a > b"]) {
    assert.deepEqual(searchSiteBody(site, query), []);
  }
  page.rawHtml = "<p>Updated body</p>";
  assert.equal(searchSiteBody(site, "Tsumu").length, 0);
  assert.equal(searchSiteBody(site, "Updated body").length, 1);
});
});

describe("canvas-css-declarations", () => {
describe("canvas-css-declarations", () => {
  function render(map: Record<string, any>, kind: "node" | "body" = "node") {
    const doc = canvasMoveDoc();
    if (kind === "node") doc.nodes.a.styles = { base: { default: map } };
    else doc.pages.p.bodyStyles = { base: { default: map } };
    return buildCanvasCss(doc, ["a"], "base", "preview", null, "default", doc.pages.p.bodyStyles);
  }

  test("canvas CSS preserves ordinary, escaped, and function-valued declarations", () => {
    const css = render({
      color: "rebeccapurple",
      backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"></svg>")',
      fontFamily: '"A; B", sans-serif',
      transform: "translate3d(1px, 2px, 3px)",
      "--brand-color": "#abc",
      WebkitLineClamp: "3",
    });
    assert.match(css, /color: rebeccapurple;/);
    assert.match(css, /font-family: "A; B", sans-serif;/);
    assert.match(css, /transform: translate3d\(1px, 2px, 3px\);/);
    assert.match(css, /--brand-color: #abc;/);
    assert.match(css, /-webkit-line-clamp: 3;/);
    assert.match(css, /data:image\/svg\+xml;charset/);
  });

  for (const [name, value] of Object.entries({
    ruleClose: "red; } body { pointer-events: none !important; } /*",
    quotedStyleClose: '"</style><script>window.__canvasInjected=1</script>"',
    nestedClose: 'url("a;b"); } .app { display: none; } /*',
    unbalancedFunction: "rgb(255, 0, 0",
    unexpectedType: 42,
    maliciousComment: "red/*'*/;}body{color:red",
  })) test(`canvas CSS isolates ${name} from editor UI selectors`, () => {
    const css = render({ color: value as string }, "node");
    assert.doesNotMatch(css, /pointer-events: none !important|__canvasInjected|\.app \{|body\s*\{\s*color:red/);
    assert.doesNotMatch(css, /color: red; \}/);
    assert.doesNotMatch(css, /color: 42;/);
  });

  test("canvas CSS ignores hostile property names rather than constructing selectors", () => {
    const css = render({
      "color; } body {": "red",
      "opacity: 0; } .app {": "0",
      "clip-path": "none",
      borderColor: "green",
      "--token": "blue",
    });
    assert.doesNotMatch(css, /body \{|\.app \{/);
    assert.match(css, /clip-path: none;/);
    assert.match(css, /border-color: green;/);
    assert.match(css, /--token: blue;/);
  });

  test("canvas body CSS and raw HTML preview reject a style-element breakout", () => {
    const value = '"</style><script>window.__canvasInjected=1</script>"';
    const css = render({ color: value, margin: "12px" }, "body");
    assert.doesNotMatch(css, /<\/style>|__canvasInjected/);
    assert.match(css, /margin: 12px;/);
    const html = previewHtmlWithBodyStyles("<html><head></head><body>Hello</body></html>",
      { base: { default: { color: value, margin: "12px" } } }, "base");
    assert.doesNotMatch(html, /__canvasInjected/);
    assert.match(html, /margin: 12px;/);
  });

  test("Canvas CSS uses the exported-site declaration validator without diverging", async () => {
    const { safeCssDeclaration } = await import("../lib/css-declaration");
    const styles = {
      borderColor: "green",
      "--accent": "blue",
      fontFamily: '"Family; With Semicolon"',
      invalidValue: "red;} .hostile { display:none;",
      "invalid; } a {": "blue",
      backgroundImage: 'url("data:image/svg+xml,<svg></svg>")',
    };
    const html = previewHtmlWithBodyStyles("<html><head></head><body></body></html>",
      { base: { default: styles } }, "base");
    for (const [key, value] of Object.entries(styles)) {
      const declaration = safeCssDeclaration(key, value);
      if (declaration) assert.ok(html.includes(declaration), key);
      else assert.ok(!html.includes(key + ": " + value), key);
    }
    assert.doesNotMatch(html, /\.hostile\s*\{|<script/i);
  });

  test("canvas CSS reuses unchanged nodes and updates an unchanged parent's containing block", () => {
    const doc = canvasMoveDoc();
    doc.nodes.a.children = ["b"];
    doc.nodes.c.motions = [{
      id: "motion", trigger: "load", keyframes: "custom",
      customKeyframes: "from { opacity: 0; } to { opacity: 1; }", duration: 1, delay: 0, easing: "linear",
    }];
    const roots = ["a", "c"];
    const cache: CanvasCssCache = new Map();
    const renderDoc = (snapshot: typeof doc) =>
      buildCanvasCss(snapshot, roots, "md", "preview", null, "default", undefined, cache);
    const initial = renderDoc(doc);
    assert.doesNotMatch(initial, /position: relative;/);
    assert.match(initial, /@keyframes /);
    const sibling = cache.get("c");
    assert.ok(sibling);

    const moved = { ...doc, nodes: { ...doc.nodes, b: {
      ...doc.nodes.b, styles: { lg: { default: { position: "absolute" } } },
    } } };
    const after = renderDoc(moved);
    assert.equal(after, buildCanvasCss(moved, roots, "md", "preview", null, "default"));
    assert.match(after, /position: relative;/);
    assert.equal(cache.get("c"), sibling);
    assert.equal(renderDoc(doc), initial);
    assert.doesNotMatch(buildCanvasCss(doc, ["a"], "md", "preview", null, "default", undefined, cache), /@keyframes /);
    assert.deepEqual([...cache.keys()].sort(), ["a", "b"]);
  });

  test("canvas CSS tracks the selected state, preview mode and custom breakpoint order", () => {
    const doc = canvasMoveDoc();
    doc.nodes.a.styles = {
      base: { default: { color: "black" }, hover: { color: "red" } },
      lg: { default: { color: "blue" } },
    };
    const cache: CanvasCssCache = new Map();
    const renderNode = (mode: "design" | "preview", selection: string | null) => {
      const css = buildCanvasCss(doc, ["a"], "md", mode, selection, "hover", undefined, cache);
      assert.equal(css, buildCanvasCss(doc, ["a"], "md", mode, selection, "hover"));
      return css;
    };
    assert.match(renderNode("design", null), /color: blue;/);
    assert.match(renderNode("design", "a"), /color: red;/);
    assert.match(renderNode("preview", "a"), /:hover \{ color: red; \}/);
    renderNode("design", null);
    try {
      applyBreakpoints({ breakpoints: [
        { id: "md", label: "Medium", maxWidth: 900 },
        { id: "lg", label: "Narrow", maxWidth: 600 },
      ] });
      assert.match(renderNode("design", null), /color: black;/);
    } finally {
      applyBreakpoints(undefined);
    }
  });
});

describe("canvas-selector-escaping", () => {
  test("node selectors quote CSS punctuation, HTML terminators, and control characters", () => {
    for (const id of [
      "normal-123",
      'a"] { } body { display:none } /*',
      'x</style><script>alert(1)</script>',
      'a\nb',
      'unicode-漢字-😀',
      'closing\\bracket',
    ]) {
      const selector = cssQuotedAttributeValue(id);
      assert.ok(selector.startsWith('"') && selector.endsWith('"'));
      assert.equal(selector.includes("</style>"), false);
      assert.equal(selector.includes('"] {'), false);
      const rebuilt = selector.slice(1, -1).replace(/\\([0-9a-f]+) /gi,
        (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
      assert.equal(rebuilt, id);

      const doc = canvasMoveDoc();
      const node = doc.nodes.a;
      delete doc.nodes.a;
      doc.nodes[id] = { ...node, id };
      doc.pages.p.children = [id];
      const css = buildCanvasCss(doc, [id], "base", "preview", null, "default");
      assert.ok(css.includes("[data-node=" + selector + "]"));
      assert.doesNotMatch(css, /<\/style>|body \{ display:none \}/i);
    }
  });

  test("simple IDs retain the same valid CSS selectors", () => {
    assert.equal(cssQuotedAttributeValue("node_123-abc"), '"node_123-abc"');
    assert.equal(cssQuotedAttributeValue("a.b"), '"a\\2e b"');
    assert.equal(cssQuotedAttributeValue("a/b"), '"a\\2f b"');
  });
});

describe("default-audio-height", () => {
  const audioRule = (css: string) => css.match(/(?:[^{}]*\[data-node="audio"\][^{}]*|\.audio)\s*\{([^}]*)\}/)?.[1] ?? '';
  for (const component of [false, true]) {
    for (const mode of ['design', 'preview', 'export'] as const) {
      const cssFor = (doc: ReturnType<typeof defaultAudioDoc>, bp = 'base') => mode === 'export'
        ? generateSiteCss(doc, new Map(Object.keys(doc.nodes).map(id => [id, id])), new Map())
        : buildCanvasCss(doc, doc.pages.p.children, bp, mode, 'audio', 'default');
      test(`${component ? 'component' : 'page'} ${mode} preserves native audio height without mutating saved styles`, () => {
        const doc = defaultAudioDoc(component); doc.nodes.audio.media!.src = audioSource;
        const before = structuredClone(doc);
        const rule = audioRule(cssFor(doc));
        assert.match(rule, /width: 100%;/);
        assert.match(rule, /max-width: 480px;/);
        assert.doesNotMatch(rule, /(?:^|[;\s])height:/);
        assert.deepEqual(doc, before);
      });
      for (const height of ['72px', 'auto', '0px']) test(`${component ? 'component' : 'page'} ${mode} retains explicit audio height ${height}`, () => {
        const doc = defaultAudioDoc(component);
        doc.nodes.audio.styles.base!.default!.height = height;
        assert.ok(audioRule(cssFor(doc)).includes(`height: ${height};`));
      });
      test(`${component ? 'component' : 'page'} ${mode} preserves responsive and custom audio heights`, () => {
        const doc = defaultAudioDoc(component);
        doc.nodes.audio.styles.lg = { default: { height: '64px', width: '80%' } };
        doc.nodes.audio.customCss = 'height: 76px';
        const css = cssFor(doc, 'lg');
        assert.match(css, /height: 64px;/);
        assert.match(css, /height: 76px;/);
        assert.match(css, /width: 80%;/);
      });
      for (const kind of ['video', 'image'] as const) test(`${component ? 'component' : 'page'} ${mode} keeps ${kind} height reset`, () => {
        const doc = defaultAudioDoc(component);
        if (kind === 'video') doc.nodes.audio.media!.kind = 'video';
        else doc.nodes.audio.type = 'image';
        assert.match(audioRule(cssFor(doc)), /height: auto;/);
      });
    }
    test(`${component ? 'component' : 'page'} generated project omits synthetic audio height`, () => {
      const doc = defaultAudioDoc(component); doc.nodes.audio.media!.src = audioSource;
      const { files } = generateProject(doc);
      const markup = Object.values(files).filter(code => code.includes('<audio')).join('\n');
      assert.match(markup, /controls/);
      const cls = markup.match(/<audio[\s\S]*?className="([^"]+)"/)?.[1];
      assert.ok(cls);
      const body = files['styles/site.css'].match(new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}'))?.[1];
      assert.ok(body);
      assert.doesNotMatch(body, /(?:^|[;\s])height:/);
    });
  }
});

describe("instance-visibility", () => {
  const require = createRequire(import.meta.url);
  function fixture(): SiteDoc {
    return {
      siteName: "Visibility",
      pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["hidden", "visible"] } },
      pageOrder: ["p"], assets: {},
      components: {
        card: { id: "card", name: "Card", rootId: "root" },
        inner: { id: "inner", name: "Inner", rootId: "innerRoot" },
      },
      nodes: {
        hidden: { ...makeBox(), id: "hidden", type: "instance", componentId: "card", styles: {}, hiddenOn: ["sm"] },
        visible: { ...makeBox(), id: "visible", type: "instance", componentId: "card", styles: {} },
        root: { ...makeBox(), id: "root", semantic: "div", children: ["nested"], styles: { base: { default: { display: "flex" }, hover: { display: "grid" } } } },
        nested: { ...makeBox(), id: "nested", type: "instance", componentId: "inner", styles: {}, hiddenOn: ["lg"] },
        innerRoot: { ...makeBox(), id: "innerRoot", semantic: "div", text: { content: "Inner content", heading: 0 } },
      },
    };
  }

  test("canvas visibility targets individual instances in design and preview at the exact breakpoint", () => {
    const doc = fixture();
    applyBreakpoints(doc);
    for (const mode of ["design", "preview"] as const) {
      for (const bp of ["base", "lg", "sm"] as const) {
        const css = buildCanvasCss(doc, doc.pages.p.children, bp, mode, null, "default");
        assert.equal(css.includes('[data-node="hidden"], [data-instance-node~="hidden"]) { display: none !important; }'), bp === "sm");
        assert.equal(css.includes('[data-node="nested"], [data-instance-node~="nested"]) { display: none !important; }'), bp === "lg");
        assert.ok(!css.includes('[data-node="visible"], [data-instance-node~="visible"]) { display: none'));
        assert.match(css, /display: flex/);
      }
    }
  });

  test("canvas nested ghosts retain instance IDs on the actual root without wrappers", () => {
    const doc = fixture();
    const filename = new URL("../components/canvas/NodeView.tsx", import.meta.url);
    const localRequire = createRequire(filename);
    const code = transformSync(readFileSync(filename, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    const mod = { exports: {} as { NodeView: any } };
    const state = { doc, mode: "design", selectedIds: [], editingText: null };
    new Function("require", "module", "exports", code)((id: string) =>
      id === "../../lib/store" ? { useEditor: (select: any) => select(state) } : localRequire(id),
      mod, mod.exports);
    const html = renderToStaticMarkup(createElement_2(mod.exports.NodeView, { id: "visible", isTop: true }));
    assert.match(html, /data-node="visible"/);
    assert.match(html, /data-ghost="innerRoot" data-instance-node="nested"/);
    assert.equal((html.match(/<div/g) ?? []).length, 2);
  });

  function renderExport(doc: SiteDoc): { html: string; css: string; files: Record<string, string> } {
    const { files } = generateProject(doc);
    const cache = new Map<string, any>();
    const load = (file: string): any => {
      if (cache.has(file)) return cache.get(file);
      const mod = { exports: {} as { default: any } };
      const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
      new Function("require", "module", "exports", code)((id: string) => {
        if (id.startsWith("@/components/")) return load(id.replace("@/", "") + ".tsx");
        if (id.startsWith("./")) return load("components/" + id.slice(2) + ".tsx");
        return require(id);
      }, mod, mod.exports);
      cache.set(file, mod.exports);
      return mod.exports;
    };
    return { html: renderToStaticMarkup(createElement_2(load("app/page.tsx").default)), css: files["styles/site.css"], files };
  }

  test("published instances forward independent visibility onto the component root", () => {
    const doc = fixture();
    const names = buildClassNames(doc);
    const { html, css } = renderExport(doc);
    assert.ok(html.includes('data-instance-hidden="' + names.get("hidden") + '"'));
    assert.equal((html.match(/data-instance-hidden=/g) ?? []).length, 3); // 非表示の外側のインスタンスと、入れ子の2つのインスタンス。
    assert.equal((html.match(/<div/g) ?? []).length, 4); // 表示を切り替えるための包みは無い。
    assert.ok(css.includes('@media ' + bpRangeQuery("sm") + ' {\n  [data-instance-hidden~="' + names.get("hidden") + '"] {\n    display: none !important;'));
    assert.ok(css.includes('@media ' + bpRangeQuery("lg") + ' {\n  [data-instance-hidden~="' + names.get("nested") + '"] {\n    display: none !important;'));
    assert.ok(!css.includes('[data-instance-hidden~="' + names.get("visible") + '"]'));
  });

  test("a component whose root is another instance forwards both visibility constraints", () => {
    const doc = fixture();
    doc.components!.card.rootId = "nested";
    const names = buildClassNames(doc);
    const { html } = renderExport(doc);
    assert.ok(html.includes('data-instance-hidden="' + names.get("nested") + " " + names.get("hidden") + '"'));
    assert.equal((html.match(/<div/g) ?? []).length, 2);
  });
});
});

describe("canvas-drop", () => {
  before(() => {
    useEditor_2.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(master = true, children = ["a", "b", "c"]): SiteDoc {
  const doc: SiteDoc = {
    siteName: "Canvas drop",
    pages: {
      p: {
        id: "p", name: "Home", slug: "", title: "Home",
        description: "", children: master ? [] : [...children],
      },
    },
    pageOrder: ["p"],
    nodes: Object.fromEntries(
      children.map((id) => [id, { ...makeBox(), id }]),
    ),
    assets: {},
  };
  if (master) {
    doc.nodes.root = {
      ...makeBox(), id: "root", children: [...children],
    };
    doc.components = {
      comp: { id: "comp", name: "Component", rootId: "root" },
    };
  }
  return doc;
}

function moveOnBlank(ids: string[], master = true) {
  const state = useEditor_2.getState();
  const drop = canvasFallbackDrop(
    state.doc,
    master ? state.doc.components!.comp : null,
    "p",
  );
  state.moveNodes(ids, drop.parent, drop.index);
}

for (const children of [[], ["a"], ["a", "b", "c"]]) {
  test(`master fallback counts ${children.length} actual children`, () => {
    const doc = fixture(true, children);
    assert.deepEqual(canvasFallbackDrop(doc, doc.components!.comp, "p"), {
      parent: { kind: "node", id: "root" },
      index: children.length,
    });
  });
}

test("page fallback counts page children", () => {
  const doc = fixture(false);
  for (const component of [null, undefined]) {
    assert.deepEqual(canvasFallbackDrop(doc, component, "p"), {
      parent: { kind: "page", id: "p" },
      index: 3,
    });
  }
});

const cases = [
  { ids: ["a"], expected: ["b", "c", "a"] },
  { ids: ["b"], expected: ["a", "c", "b"] },
  { ids: ["c"], expected: ["a", "b", "c"] },
  { ids: ["c", "a"], expected: ["b", "a", "c"] },
  { ids: ["b", "a"], expected: ["c", "a", "b"] },
];

for (const { ids, expected } of cases) {
  test(`blank master drop appends ${ids.join(",")} in document order`, () => {
    useEditor_2.getState().replaceDoc(fixture());
    moveOnBlank(ids);
    assert.deepEqual(useEditor_2.getState().doc.nodes.root.children, expected);
    assert.deepEqual(useEditor_2.getState().doc.pages.p.children, []);
  });
}

test("blank master drop moves a nested child to the end and can undo", () => {
  const doc = fixture();
  doc.nodes.d = { ...makeBox(), id: "d" };
  doc.nodes.a.children = ["d"];
  useEditor_2.getState().replaceDoc(doc);
  const before = structuredClone(useEditor_2.getState().doc);
  moveOnBlank(["d"]);
  assert.deepEqual(useEditor_2.getState().doc.nodes.root.children, ["a", "b", "c", "d"]);
  assert.deepEqual(useEditor_2.getState().doc.nodes.a.children, []);
  useEditor_2.getState().undo();
  assert.deepEqual(useEditor_2.getState().doc, before);
});

test("blank page drop still appends", () => {
  useEditor_2.getState().replaceDoc(fixture(false));
  moveOnBlank(["a"], false);
  assert.deepEqual(useEditor_2.getState().doc.pages.p.children, ["b", "c", "a"]);
});

test("blank master drop cannot move the master root into itself", () => {
  useEditor_2.getState().replaceDoc(fixture());
  const before = structuredClone(useEditor_2.getState().doc);
  moveOnBlank(["root"]);
  assert.deepEqual(useEditor_2.getState().doc, before);
});

test("missing fallback destinations remain harmless", () => {
  const doc = fixture();
  const missing = { id: "missing", name: "Missing", rootId: "missing" };
  for (const component of [null, missing]) {
    const drop = canvasFallbackDrop(doc, component, "missing");
    assert.equal(drop.index, 0);
    useEditor_2.getState().replaceDoc(doc);
    const before = structuredClone(useEditor_2.getState().doc);
    useEditor_2.getState().moveNodes(["a"], drop.parent, drop.index);
    assert.deepEqual(useEditor_2.getState().doc, before);
  }
});
});

describe("canvas-move-lifecycle", () => {
  before(() => {
    useEditor_3.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const hookPath = resolve_3("components/canvas/useCanvasDrag.ts");
const requireHookImport = createRequire(hookPath);
const hookCode = transformSync(readFileSync(hookPath, "utf8"), { loader: "ts", format: "cjs" }).code;
const loadHook = new Function("require", "module", "exports", "window", "document", "getComputedStyle", hookCode);

const state = () => useEditor_3.getState();
const snapshot = () => structuredClone({ doc: state().doc, past: state().past, future: state().future });

// 実際のフックと実際のストアを使う。DOM の寸法とフックの描画だけを固定し、ブラウザの操作は e2e で確かめる。
function mount() {
  state().replaceDoc(canvasMoveDoc());
  state().setActivePage("p");
  state().setMode("design");
  state().setBreakpoint("base");
  state().select(null);
  const win = new EventTarget();
  const rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  const elements: Record<string, any> = {};
  for (const id of ["a", "b", "c"]) elements[id] = {
    getAttribute: () => id, getBoundingClientRect: () => rect,
    closest: () => elements[id], parentElement: { closest: () => null },
  };
  let hit = "c";
  const doc = Object.assign(new EventTarget(), {
    visibilityState: "visible", elementFromPoint: () => elements[hit] ?? null,
  });
  const cleanups: (() => void)[] = [];
  const refs: { current: any }[] = [];
  let refIndex = 0, mounted = false;
  const hooks = {
    useRef: (value: any) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useLayoutEffect: (fn: () => () => void) => { if (!mounted) cleanups.push(fn()); },
  };
  const mod = { exports: {} as any };
  loadHook(
    (id: string) => id === "react" ? hooks : id === "../../lib/store" ? { ...requireHookImport(id), useEditor: useEditor_3 } :
      id === "../../lib/image-drop" ? { useImageDrop: () => ({ uploading: false, dropFiles() {} }) } : requireHookImport(id),
    mod, mod.exports, win, doc, () => ({ display: "block", flexDirection: "column" }),
  );
  const moveState: UseCanvasDragDeps["moveState"] = { current: null };
  const moveDropRef: UseCanvasDragDeps["moveDropRef"] = { current: null };
  const movedJustNow = { current: false };
  const ui: { drag: any } = { drag: null };
  let onDown: (event: any) => void;
  const render = () => {
    refIndex = 0;
    onDown = mod.exports.useCanvasDrag({
      ...state(), innerRef: { current: { getBoundingClientRect: () => rect } },
      frameRef: { current: null }, editingComp: null, moveState, moveDropRef, movedJustNow,
      scale: 1, setMoveDrag: (value: any) => { ui.drag = value; },
      setDropState() {}, setElemDropTarget() {}, elemDropTarget: null, dropState: "none",
    }).onCvPointerDown;
    mounted = true;
  };
  render();
  const pointer = (type: string, { id = 1, x = 50, y = 95, buttons = 1 } = {}) => {
    win.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: id, clientX: x, clientY: y, buttons,
    }));
  };
  const down = ({ id = 1, node = "a", button = 0, shiftKey = false } = {}) => {
    render();
    onDown!({ target: elements[node], pointerId: id, clientX: 0, clientY: 0, button, shiftKey });
  };
  return { win, doc, ui, moveState, moveDropRef, movedJustNow, pointer, down,
    start(move = true) { down(); if (move) pointer("pointermove"); },
    hit(id: string) { hit = id; },
    key(key: string) { const e = Object.assign(new Event("keydown", { cancelable: true }), { key }); win.dispatchEvent(e); return e; },
    close() { for (const fn of cleanups.splice(0).reverse()) fn(); },
  };
}

test("pointer movement reuses the dragged subtree and sibling positions for one gesture", () => {
  const m = mount();
  try {
    state().updateDoc(doc => {
      doc.pages.p.children = ["a", "b"];
      doc.nodes.b.children = ["c"];
    });
    const { doc } = state();
    const children = doc.nodes.a.children;
    let reads = 0;
    Object.defineProperty(doc.nodes.a, "children", {
      configurable: true, enumerable: true, get() { reads++; return children; },
    });
    try {
      m.start(false);
      m.pointer("pointermove", { x: 2, y: 2 });
      assert.equal(reads, 0, "clicks below the movement threshold never walk the subtree");
      m.pointer("pointermove");
      const firstMoveReads = reads;
      assert.ok(firstMoveReads > 0);
      for (let i = 0; i < 20; i++) {
        m.pointer("pointermove", { y: i % 2 ? 5 : 95 });
        assert.deepEqual(m.moveDropRef.current, {
          parent: { kind: "node", id: "b" }, index: i % 2 ? 0 : 1,
        });
      }
      assert.equal(reads, firstMoveReads, "subsequent pointer samples must reuse both tree lookups");
    } finally {
      Object.defineProperty(doc.nodes.a, "children", {
        configurable: true, enumerable: true, writable: true, value: children,
      });
    }
  } finally { m.close(); }
});

for (const active of [false, true]) {
  for (const end of ["pointercancel", "blur", "hidden", "released-outside", "escape", "unmount"]) {
    test(`${active ? "active" : "pending"} movement: ${end} removes the gesture without editing or destroying redo`, () => {
      const m = mount();
      try {
        state().updatePage("p", { title: "Undoable" }); state().undo();
        const before = snapshot();
        m.start(active);
        if (active) assert.ok(m.ui.drag);
        if (end === "pointercancel") m.pointer("pointercancel", { buttons: 0 });
        if (end === "blur") m.win.dispatchEvent(new Event("blur"));
        if (end === "hidden") { m.doc.visibilityState = "hidden"; m.doc.dispatchEvent(new Event("visibilitychange")); }
        if (end === "released-outside") m.pointer("pointermove", { buttons: 0 });
        if (end === "escape") assert.equal(m.key("Escape").defaultPrevented, true);
        if (end === "unmount") m.close();
        assert.equal(m.moveState.current, null); assert.equal(m.moveDropRef.current, null); assert.equal(m.ui.drag, null);
        m.pointer("pointermove"); m.pointer("pointerup", { buttons: 0 });
        assert.deepEqual(snapshot(), before);
        if (end !== "unmount") {
          m.start(); m.pointer("pointerup", { buttons: 0 });
          assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
          assert.equal(state().past.length, before.past.length + 1);
          assert.equal(state().future.length, 0);
          const moved = snapshot(); state().undo(); assert.deepEqual(state().doc, before.doc);
          state().redo(); assert.deepEqual(state().doc, moved.doc);
        }
      } finally { m.close(); }
    });
  }
}

for (const active of [false, true]) {
  for (const change of ["undo", "redo", "page", "replace", "remote", "edit", "component", "mode", "breakpoint", "style", "selection", "primary", "text"]) {
    test(`${active ? "active" : "pending"} movement: ${change} synchronously invalidates the old destination`, () => {
      const m = mount();
      try {
        state().updatePage("p", { title: "Changed" });
        if (change === "redo") state().undo();
        m.start(active);
        if (change === "undo") state().undo();
        if (change === "redo") state().redo();
        if (change === "page") state().setActivePage("q");
        if (change === "replace") state().replaceDoc(canvasMoveDoc());
        if (change === "remote") { const doc = structuredClone(state().doc); doc.nodes.b.name = "Remote"; state().applyRemoteDoc(doc); }
        if (change === "edit") state().updateNode("b", { name: "Newer edit" });
        if (change === "component") useEditor_3.setState({ editingComponentId: "component" });
        if (change === "mode") state().setMode("preview");
        if (change === "breakpoint") state().setBreakpoint("sm");
        if (change === "style") state().setStyleState("hover");
        if (change === "selection") state().selectMany(["b", "c"], "b");
        if (change === "primary") useEditor_3.setState({ selection: "b" });
        if (change === "text") state().setEditingText("b");
        const before = snapshot();
        assert.equal(m.moveState.current, null); assert.equal(m.moveDropRef.current, null); assert.equal(m.ui.drag, null);
        m.pointer("pointermove"); m.pointer("pointerup", { buttons: 0 });
        assert.deepEqual(snapshot(), before);
      } finally { m.close(); }
    });
  }
}

for (const active of [false, true]) test(`${active ? "active" : "pending"} movement ignores other pointers and commits only the owner`, () => {
  const m = mount();
  try {
    const before = snapshot(); m.start(active);
    const gesture = m.moveState.current, ui = m.ui.drag;
    m.down({ id: 2, node: "b" });
    for (const type of ["pointermove", "pointercancel", "pointerup"]) {
      m.pointer(type, { id: 2, buttons: 0, x: 0, y: 0 });
      assert.equal(m.moveState.current, gesture); assert.equal(m.ui.drag, ui); assert.deepEqual(snapshot(), before);
    }
    m.pointer("pointermove"); m.pointer("pointerup", { buttons: 0 });
    assert.equal(m.ui.drag, null); assert.equal(m.moveState.current, null);
    assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
    assert.equal(state().past.length, 1);
    state().undo(); assert.deepEqual(state().doc, before.doc);
    state().redo(); assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
  } finally { m.close(); }
});

for (const selected of [[], ["a"], ["b"]]) {
  for (const style of ["default", "hover", "active", "focus"] as const) {
    test(`own selection from ${selected.join() || "none"}/${style} does not cancel a normal move`, () => {
      const m = mount();
      try {
        state().select(selected[0] ?? null); state().setStyleState(style);
        m.start(); assert.ok(m.ui.drag); assert.deepEqual(state().selectedIds, ["a"]);
        m.pointer("pointerup", { buttons: 0 });
        assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
        assert.equal(state().past.length, 1);
      } finally { m.close(); }
    });
  }
}

for (const style of ["default", "hover", "active", "focus"] as const) test(`multi-selection in ${style} moves together in one reversible edit and excludes locked nodes`, () => {
  const m = mount();
  try {
    state().selectMany(["a", "b"], "a"); state().setStyleState(style);
    const before = snapshot(); m.start(); assert.deepEqual(m.ui.drag.dragIds, ["a", "b"]);
    m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(state().doc.pages.p.children, ["c", "a", "b"]);
    assert.deepEqual(state().selectedIds, ["a", "b"]); assert.equal(state().past.length, 1);
    const moved = snapshot(); state().undo(); assert.deepEqual(state().doc, before.doc);
    state().redo(); assert.deepEqual(state().doc, moved.doc);
    state().undo(); state().updateNode("b", { locked: true }); state().selectMany(["a", "b"], "a");
    m.start(); assert.deepEqual(m.ui.drag.dragIds, ["a"]); m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
  } finally { m.close(); }
});

test("a click and sub-threshold movement leave history, redo, and selection untouched", () => {
  const m = mount();
  try {
    state().selectMany(["a", "b"], "b"); state().updatePage("p", { title: "Undoable" }); state().undo();
    const before = snapshot(); const selection = state().selectedIds;
    m.start(false); m.pointer("pointermove", { x: 3, y: 4 }); m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(snapshot(), before); assert.equal(state().selectedIds, selection); assert.equal(m.ui.drag, null);
    m.start(false); m.pointer("pointercancel"); assert.deepEqual(snapshot(), before);
  } finally { m.close(); }
});

test("release coordinates replace the last preview and repeated pointerdown cannot leave duplicate listeners", () => {
  const m = mount();
  try {
    m.start(); m.down({ node: "b" }); m.pointer("pointermove");
    m.hit("a"); m.pointer("pointerup", { y: 1, buttons: 0 });
    assert.deepEqual(state().doc.pages.p.children, ["b", "a", "c"]);
    assert.equal(state().past.length, 1); assert.equal(m.moveState.current, null);
    const saved = snapshot(); m.pointer("pointermove"); m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(snapshot(), saved);
  } finally { m.close(); }
});

test("unrelated store updates do not invalidate movement", () => {
  const m = mount();
  try {
    m.start(); useEditor_3.setState({ cloudState: "saved" });
    assert.ok(m.ui.drag); m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
  } finally { m.close(); }
});
});

describe("canvas-node-resize-lifecycle", () => {
  before(() => {
    useEditor_4.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor_4.getState();
const width = () => state().doc.nodes.a.styles.base?.default?.width;

function mount() {
  state().replaceDoc(canvasMoveDoc());
  state().setActivePage("p");
  state().setMode("design");
  state().setBreakpoint("base");
  state().select("a");
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const target = Object.assign(new EventTarget(), {
    captured: new Set<number>(),
    setPointerCapture(id: number) { this.captured.add(id); },
    hasPointerCapture(id: number) { return this.captured.has(id); },
    releasePointerCapture(id: number) {
      this.captured.delete(id);
      this.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: id }));
    },
  });
  const element = { offsetWidth: 100, offsetHeight: 60 };
  const frameRef = { current: { querySelector: () => element } };
  const refs: { current: any }[] = [];
  const cleanups: (() => void)[] = [];
  let refIndex = 0, mounted = false;
  const hooks = {
    useRef: (value: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useLayoutEffect: (fn: () => () => void) => { if (!mounted) cleanups.push(fn()); },
  };
  const path = resolve_4("components/canvas/useCanvasDrag.ts");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", "window", "document", code)((id: string) => {
    if (id === "react") return hooks;
    if (id === "../../lib/store") return { ...require(id), useEditor: useEditor_4 };
    if (id === "../../lib/image-drop") return { useImageDrop: () => ({ uploading: false, dropFiles() {} }) };
    return require(id);
  }, mod, mod.exports, win, doc);

  let startResize: (event: any, dir: string) => void;
  const render = () => {
    refIndex = 0;
    startResize = mod.exports.useCanvasDrag({
      ...state(), frameRef, scale: 1, editingComp: null, editingText: null,
      innerRef: { current: null }, moveState: { current: null }, moveDropRef: { current: null },
      movedJustNow: { current: false }, setMoveDrag() {}, setDropState() {}, setElemDropTarget() {},
      elemDropTarget: null, dropState: "none",
    }).startResize;
    mounted = true;
  };
  render();
  const down = (id = 1, dir = "se", button = 0) => {
    render();
    startResize!({ currentTarget: target, pointerId: id, clientX: 0, clientY: 0, button,
      preventDefault() {}, stopPropagation() {} }, dir);
  };
  const event = (type: string, { id = 1, x = 0, y = 0, buttons = 1, key = "", shiftKey = false } = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: id, clientX: x, clientY: y, buttons, key, shiftKey,
      preventDefault() { Object.getPrototypeOf(e).preventDefault.call(this); },
    });
    win.dispatchEvent(e);
    return e;
  };
  const close = () => { for (const fn of cleanups.splice(0).reverse()) fn(); };
  return { win, doc, target, element, down, event, close };
}

test("canvas node resizing is owned by the initiating pointer and is one undo step", () => {
  const f = mount();
  try {
    const before = structuredClone(state().doc);
    f.down();
    f.event("pointermove", { x: 20, y: 10 });
    assert.equal(width(), "120px");
    f.down(2, "nw");
    f.event("pointermove", { id: 2, x: 90, y: 90 });
    f.event("pointerup", { id: 2, buttons: 0 });
    assert.equal(width(), "120px", "other pointers cannot hijack a resize");
    f.event("pointermove", { x: 30 });
    assert.equal(width(), "130px");
    f.event("pointerup", { buttons: 0 });
    assert.equal(f.target.captured.size, 0);
    assert.equal(state().past.length, 1);
    const after = structuredClone(state().doc);
    state().undo();
    assert.deepEqual(state().doc, before);
    state().redo();
    assert.deepEqual(state().doc, after);
  } finally { f.close(); }
});

for (const reason of ["cancel", "lost-capture", "blur", "hidden", "released-outside", "escape", "unmount"]) {
  test(`canvas node resize ${reason} stops without accepting delayed moves`, () => {
    const f = mount();
    try {
      f.down();
      f.event("pointermove", { x: 20 });
      assert.equal(width(), "120px");
      if (reason === "cancel") f.event("pointercancel", { buttons: 0 });
      if (reason === "lost-capture") f.target.releasePointerCapture(1);
      if (reason === "blur") f.win.dispatchEvent(new Event("blur"));
      if (reason === "hidden") { f.doc.visibilityState = "hidden"; f.doc.dispatchEvent(new Event("visibilitychange")); }
      if (reason === "released-outside") f.event("pointermove", { x: 40, buttons: 0 });
      if (reason === "escape") {
        const result = f.event("keydown", { key: "Escape" });
        assert.equal(result.defaultPrevented, true);
      }
      if (reason === "unmount") f.close();
      f.event("pointermove", { x: 100 });
      f.event("pointerup", { buttons: 0 });
      assert.equal(width(), "120px");
      assert.equal(f.target.captured.size, 0);
      if (reason !== "unmount") {
        f.down();
        f.event("pointermove", { x: 30 });
        f.event("pointerup", { buttons: 0 });
        assert.equal(width(), "130px");
      }
    } finally { f.close(); }
  });
}

test("remote edits invalidate the canvas resize without overwriting the new document", () => {
  const f = mount();
  try {
    f.down();
    f.event("pointermove", { x: 20 });
    const remote = structuredClone(state().doc);
    remote.nodes.b.name = "Collaborator edit";
    state().applyRemoteDoc(remote);
    assert.equal(f.target.captured.size, 0);
    f.event("pointermove", { x: 120 });
    f.event("pointerup", { buttons: 0 });
    assert.equal(width(), "120px");
    assert.equal(state().doc.nodes.b.name, "Collaborator edit");
    f.down();
    f.event("pointermove", { x: 30 });
    f.event("pointerup", { buttons: 0 });
    assert.equal(width(), "130px");
    assert.equal(state().doc.nodes.b.name, "Collaborator edit");
  } finally { f.close(); }
});

test("Shift-resizing a zero-width node never writes Infinity or NaN CSS", () => {
  const f = mount();
  try {
    f.element.offsetWidth = 0;
    f.down();
    f.event("pointermove", { x: 20, y: 10, shiftKey: true });
    f.event("pointerup", { buttons: 0 });
    assert.equal(width(), "20px");
    assert.equal(state().doc.nodes.a.styles.base?.default?.height, "70px");
    assert.doesNotMatch(JSON.stringify(state().doc.nodes.a.styles), /Infinity|NaN/);
    const after = structuredClone(state().doc);
    state().undo(); state().redo();
    assert.deepEqual(state().doc, after);
  } finally { f.close(); }
});
});

describe("canvas-preview-lifecycle", () => {
  before(() => {
    useEditor_5.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixtureDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Preview visits", assets: {}, nodes: {},
    pageOrder: ["a", "b", "html", "redirect", "rewrite"],
    pages: Object.fromEntries(["a", "b", "html", "redirect", "rewrite"].map(id => [id, {
      id, name: id, slug: id, title: "", description: "", children: [],
      ...(id === "html" ? { rawHtml: "<p>HTML</p>" } : {}),
      ...(id === "redirect" ? { redirectTo: "/a" } : {}),
      ...(id === "rewrite" ? { rewriteTo: "https://example.test/" } : {}),
      pageScripts: [{ id: `${id}-load`, trigger: "load", steps: [
        { id: `${id}-now`, kind: "open-url", url: `/${id}-load` },
        { id: `${id}-wait`, kind: "wait", seconds: 1 },
        { id: `${id}-late`, kind: "open-url", url: `/${id}-late` },
      ] }],
    }])),
  };
}

// Canvas の実際の描画・effect と、実際のスクリプトのランタイムを実行する。ここで制御するのは、
// React のスケジュール、データの取得、ホストの DOM だけ。React の差分の反映と
// ネイティブのイベントの配信は、ブラウザのテストで確かめる。
function mount(initialPage = "a", doc = fixtureDoc()) {
  useEditor_5.getState().replaceDoc(doc);
  useEditor_5.getState().setActivePage(initialPage);
  useEditor_5.getState().setMode("preview");
  useEditor_5.getState().setBreakpoint("base");
  let cursor = 0;
  const slots: any[] = [], effects: (() => void)[] = [];
  const hooks = {
    ...React,
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useMemo(fn: () => any, deps: unknown[]) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((dep, j) => !Object.is(dep, previous.deps[j]))) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback(fn: any, deps: unknown[]) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((dep, j) => !Object.is(dep, previous.deps[j]))) effects.push(() => {
        previous?.cleanup?.();
        slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const calls: string[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const observers = new Set<() => void>();
  let installs = 0, disposals = 0;
  const runtime = runInNewContext(`(${SCRIPT_RUNTIME})`, {
    MutationObserver: class {
      constructor(private callback: () => void) {}
      observe() { observers.add(this.callback); }
      disconnect() { observers.delete(this.callback); }
    },
    requestAnimationFrame: (fn: () => void) => fn(),
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    CSS: { escape: (value: string) => value },
  });
  const noop = () => {};
  const data = {
    fieldValues: {}, pageVars: {}, fieldVarNodes: [],
    setFieldValues: noop, setClientValues: noop, setLiveSamples: noop,
    setLiveTotals: noop, setFullData: noop, refreshData: noop,
    navigateTo: (url: string) => calls.push(url), setActivePage: useEditor_5.getState().setActivePage,
    plan: { clientVars: new Set(), listOps: {}, serverIds: new Set() },
  };
  const require = createRequire(resolve_5("components/Canvas.tsx"));
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync("components/Canvas.tsx", "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return hooks;
    if (id === "../lib/store") return { useEditor: Object.assign((select: any) => select(useEditor_5.getState()), useEditor_5) };
    if (id === "./canvas/useCanvasData") return { useCanvasData: () => data };
    if (id === "./canvas/useHtmlPreview") return { useHtmlPreview: () => ({ html: "" }) };
    if (id === "./canvas/useCanvasDrag") return { useCanvasDrag: () => ({ dropHandlers: {} }) };
    if (id === "../lib/script-runtime") return { createScriptRuntime: (env: unknown) => ({
      install(root: ListDomNode) {
        installs++;
        const dispose = runtime(env).install(root);
        return () => { disposals++; dispose(); };
      },
    }) };
    return require(id);
  }, mod, mod.exports);
  let root: ListDomNode | null = null, frameRef: { current: unknown } | null = null;
  const walk = (element: any, visit: (element: any) => void) => {
    if (!element || typeof element !== "object") return;
    if (Array.isArray(element)) { element.forEach(child => walk(child, visit)); return; }
    visit(element); walk(element.props?.children, visit);
  };
  const render = () => {
    cursor = 0;
    const tree = mod.exports.default();
    let frame: any;
    walk(tree, el => { if (el.props?.ref && el.props?.className?.startsWith("canvas-frame")) frame = el; });
    if (frameRef) frameRef.current = null;
    if (frame) {
      root ??= new ListDomNode(1, "DIV");
      let marker = root.children[0];
      walk(frame, el => {
        if (!el.props?.["data-scripts"]) return;
        if (!marker) { marker = new ListDomNode(1, "SPAN"); root!.appendChild(marker); }
        marker.setAttribute("data-scripts", el.props["data-scripts"]);
        if (el.props["data-page-body"]) marker.setAttribute("data-page-body", el.props["data-page-body"]);
      });
      frameRef = frame.props.ref; frameRef!.current = root;
    } else root = null;
    effects.splice(0).forEach(effect => effect());
    observers.forEach(callback => callback());
  };
  render();
  return {
    calls, render, counts: () => ({ installs, disposals }),
    page(id: string) { useEditor_5.getState().setActivePage(id); render(); },
    async finishWaits() {
      const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
      await new Promise<void>(done => setImmediate(done));
    },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test("each visual page visit runs its load scripts, including a return visit", () => {
  const m = mount();
  try {
    const before = useEditor_5.getState();
    assert.deepEqual(m.calls, ["/a-load"]);
    m.page("b"); m.page("a");
    assert.deepEqual(m.calls, ["/a-load", "/b-load", "/a-load"]);
    assert.equal(useEditor_5.getState().doc, before.doc);
    assert.equal(useEditor_5.getState().past, before.past);
    assert.equal(useEditor_5.getState().future, before.future);
  } finally { m.close(); }
});

test("a delayed script cannot navigate after its preview page was left", async () => {
  const m = mount();
  try {
    m.page("b"); await m.finishWaits();
    assert.ok(!m.calls.includes("/a-late"), "old page's wait must be cancelled");
    assert.ok(m.calls.includes("/b-late"));
  } finally { m.close(); }
});

for (const special of ["html", "redirect", "rewrite"]) {
  test(`${special}: remove the old runtime and install on the replacement frame`, () => {
    const m = mount();
    try {
      m.page(special);
      assert.deepEqual(m.counts(), { installs: 1, disposals: 1 });
      m.page("a");
      assert.deepEqual(m.calls, ["/a-load", "/a-load"]);
      assert.deepEqual(m.counts(), { installs: 2, disposals: 1 });
    } finally { m.close(); }
  });
  test(`${special}: entering preview there does not disable a later visual page`, () => {
    const m = mount(special);
    try { m.page("a"); assert.deepEqual(m.calls, ["/a-load"]); }
    finally { m.close(); }
  });
}

test("same-page document, viewport and selection changes do not replay load scripts", () => {
  const m = mount();
  try {
    useEditor_5.getState().updatePage("a", { title: "Edited title" }); m.render();
    useEditor_5.getState().setBreakpoint("sm"); m.render();
    useEditor_5.getState().select(null); m.render();
    assert.deepEqual(m.calls, ["/a-load"]);
    assert.deepEqual(m.counts(), { installs: 1, disposals: 0 });
  } finally { m.close(); }
});

test("same-page conversion to HTML and undo replace the runtime owner", () => {
  const m = mount();
  try {
    useEditor_5.getState().updatePage("a", { rawHtml: "<p>HTML</p>" }); m.render();
    assert.deepEqual(m.counts(), { installs: 1, disposals: 1 });
    useEditor_5.getState().undo(); m.render();
    assert.deepEqual(m.calls, ["/a-load", "/a-load"]);
  } finally { m.close(); }
});

test("Canvas preview dispatches a variable change to the active page script", () => {
  const doc = fixtureDoc();
  doc.pages.a.pageScripts = [
    { id: "init", trigger: "load",      steps: [{ id: "set", kind: "set-var", into: "count", value: "1" }] },
    { id: "watch", trigger: "change", changeVariable: "count",      steps: [{ id: "open", kind: "open-url", url: "/changed" }] },
  ];
  const m = mount("a", doc);
  try { assert.deepEqual(m.calls, ["/changed"]); }
  finally { m.close(); }
});
});

describe("code-highlight", () => {
const TOKEN_CLASSES = [
  "comment", "tag", "attribute", "string", "keyword",
  "number", "selector", "property", "punctuation",
] as const;

/**
 * Syntax highlighting may add only its own token spans. Every character from
 * the original input must survive as escaped text, never as executable HTML.
 * Avoid trying to identify unsafe tags with a regex: HTML can vary in casing,
 * attributes, whitespace, and quoting.
 */
function assertSourceIsEscaped(source: string, highlighted: string): void {
  let visibleText = highlighted.replaceAll("</span>", "");
  for (const kind of TOKEN_CLASSES) {
    visibleText = visibleText.replaceAll(`<span class="code-token-${kind}">`, "");
  }

  const escapedSource = source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  assert.equal(visibleText, escapedSource);
}

test("HTML snippets color HTML tags, CSS properties, JavaScript keywords, and comments", () => {
  const source = '<style>.card { color: #fff; }</style><script>const a = "ok";</script><!-- comment -->';
  const result = highlightCustomCode(source);
  assert.match(result, /code-token-tag">style/);
  assert.match(result, /code-token-property">color/);
  assert.match(result, /code-token-keyword">const/);
  assert.match(result, /code-token-comment">&lt;!-- comment --&gt;/);
  assertSourceIsEscaped(source, result);
});

test("source markup, quoted angle brackets, and event handlers stay escaped", () => {
  const source = '<img data-title="a > b" onerror="alert(1)"><script>alert("<img>")</script>';
  const result = highlightCustomCode(source);
  assert.match(result, /&quot;a &gt; b&quot;/);
  assert.match(result, /&lt;img/);
  assertSourceIsEscaped(source, result);
});

test("non-HTML less-than signs are preserved as visible text", () => {
  const source = "x < y";
  assert.equal(highlightCustomCode(source), "x &lt; y");
  assertSourceIsEscaped(source, highlightCustomCode(source));
});

test("uppercase tags and executable-looking attributes remain escaped", () => {
  const source = `<ScRiPt SRC="data:text/javascript,alert(1)" ONERROR='alert(1)'>window.value = "<IMG SRC=x ONERROR=alert(1)>";</ScRiPt><STYLE>.x::before { content: "<svg onload=alert(1)>"; }</STYLE><iframe srcdoc="<script>alert(1)</script>"></iframe>`;
  assertSourceIsEscaped(source, highlightCustomCode(source));
});

test("incomplete markup, attributes, entities, and unclosed tags stay escaped", () => {
  const source = `text & <DiV title="x > y" onClick='alert(1)'>ok</DiV> <ScRiPt src="<img>"`;
  assertSourceIsEscaped(source, highlightCustomCode(source));
});
});

describe("controls", () => {
describe("inline-grid-layout", () => {
  function render(section: "BoxSec" | "LayoutSec", styles: Record<string, string>) {
    const writes: any[] = [];
    const node = { ...makeBox(), styles: { base: { default: styles } } };
    const path = resolve_6(`components/style-panel/${section}.tsx`);
    const require = createRequire(path);
    const mod = { exports: {} as any };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
      if (id === "../../lib/store") return { useEditor: (select: any) => select({ breakpoint: "base" }) };
      if (id === "../controls") return {
        useInspector: () => ({ get: (p: string) => getProp(node, "base", "default", p), cleared: () => null, set: (v: any) => writes.push(v) }),
        shorthandSide, Grp: "Grp", NumField: "NumField", Seg: "Seg", PropNum: "PropNum", PropSeg: "PropSeg", PropSelect: "PropSelect",
      };
      if (id === "./PositionSec") return { ...require(id), useParentFlexDir: () => null, useHiddenState: () => "" };
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return require(id);
    }, mod, mod.exports);
    const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
    const elements = flatten(section === "BoxSec" ? mod.exports.SpacingSec() : mod.exports.LayoutSec());
    const target = elements.find(e => typeof e.type === "function" && (section === "BoxSec" ? e.props.shorthand === "padding" : e.type.name === "GridGap"));
    return { elements, gap: target, writes };
  }

  test("inline-grid exposes the same grid controls as grid without changing display", () => {
    const view = render("LayoutSec", { display: "inline-grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" });
    assert.ok(view.gap, "grid gap controls must be available");
    const flow = view.elements.find(e => e.type === "Seg");
    assert.equal(flow.props.value, "grid");
    assert.deepEqual(view.writes, []);
    const columns = view.elements.find(e => e.type === "NumField" && e.props.value === "3");
    assert.ok(columns);
    columns.props.onChange("4");
    assert.equal(view.writes.at(-1).gridTemplateColumns, "repeat(4, 1fr)");
    assert.equal(Object.hasOwn(view.writes.at(-1), "display"), false);
  });
  test("flow mode recognizes inline-grid as grid", () => {
    assert.equal(flowMode("inline-grid", undefined), "grid");
  });
});

describe("spacing-shorthand-preservation", () => {
  function render(section: "BoxSec" | "LayoutSec", styles: Record<string, string>) {
    const writes: any[] = [];
    const node = { ...makeBox(), styles: { base: { default: styles } } };
    const path = resolve_6(`components/style-panel/${section}.tsx`);
    const require = createRequire(path);
    const mod = { exports: {} as any };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
      if (id === "../../lib/store") return { useEditor: (select: any) => select({ breakpoint: "base" }) };
      if (id === "../controls") return {
        useInspector: () => ({ get: (p: string) => getProp(node, "base", "default", p), cleared: () => null, set: (v: any) => writes.push(v) }),
        shorthandSide, Grp: "Grp", NumField: "NumField", Seg: "Seg", PropNum: "PropNum", PropSeg: "PropSeg", PropSelect: "PropSelect",
      };
      if (id === "./PositionSec") return { ...require(id), useParentFlexDir: () => null, useHiddenState: () => "" };
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return require(id);
    }, mod, mod.exports);
    const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
    const elements = flatten(section === "BoxSec" ? mod.exports.SpacingSec() : mod.exports.LayoutSec());
    const target = elements.find(e => typeof e.type === "function" && (section === "BoxSec" ? e.props.shorthand === "padding" : e.type.name === "GridGap"));
    return { fields: flatten(target.type(target.props)), writes };
  }
  test("changing horizontal padding keeps existing top/bottom longhand overrides", () => {
    const view = render("BoxSec", { padding: "10px", paddingTop: "25px", paddingBottom: "30px" });
    view.fields.find(e => e.type === "NumField" && e.props.title === "Left & right").props.onChange("5px");
    assert.deepEqual(view.writes.at(-1), { padding: null, paddingTop: "25px", paddingRight: "5px", paddingBottom: "30px", paddingLeft: "5px" });
  });
  test("padding shorthand math survives editing another axis", () => {
    const view = render("BoxSec", { padding: "calc(1rem + 2px) 4px" });
    view.fields.find(e => e.type === "NumField" && e.props.title === "Left & right").props.onChange("5px");
    assert.equal(view.writes.at(-1).paddingTop, "calc(1rem + 2px)");
    assert.equal(view.writes.at(-1).paddingBottom, "calc(1rem + 2px)");
  });
  test("grid gap math is displayed and preserved when editing the other axis", () => {
    const view = render("LayoutSec", { display: "grid", gap: "calc(1rem + 2px) min(3vw, 20px)" });
    const fields = view.fields.filter(e => e.type === "NumField");
    assert.deepEqual(fields.map(e => e.props.value), ["min(3vw, 20px)", "calc(1rem + 2px)"]);
    fields[0].props.onChange("5px");
    assert.equal(view.writes.at(-1).rowGap, "calc(1rem + 2px)");
    assert.equal(view.writes.at(-1).columnGap, "5px");
  });
  test("shorthand splitter keeps nested, quoted, and commented function tokens intact", () => {
    assert.deepEqual(cssValueParts('calc(1px + var(--x, 2px)) /* gap */ "a b"'), ['calc(1px + var(--x, 2px))', '"a b"']);
    assert.equal(shorthandSide("calc(2px + 1vw) 3px 4px", 3), "3px");
  });
});

describe("color-hex-alpha", () => {
  for (const [value, hex, alpha] of [
    ["#1234", "#112233", 68 / 255],
    ["#12345678", "#123456", 120 / 255],
    [" #AbCf ", "#AAbbCC", 1],
    ["#ff880000", "#ff8800", 0],
  ] as const) {
    test(`opacity edits retain RGB from ${value}`, () => {
      const parsed = parseColor(value);
      assert.deepEqual(parsed, { hex, alpha });
      // FillControl の不透明度の欄は、読み取った RGB と新しいアルファ値を組み合わせる。
      assert.equal(composeColor(parsed.hex, 0.5),
        `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, 0.5)`);
    });
  }

  test("ordinary hex colors retain their opaque defaults", () => {
    assert.deepEqual(parseColor("#abc"), { hex: "#aabbcc", alpha: 1 });
    assert.deepEqual(parseColor("#123456"), { hex: "#123456", alpha: 1 });
    assert.deepEqual(parseColor("rgba(12, 34, 56, 0.5)"), { hex: "#0c2238", alpha: 0.5 });
  });

  test("non-hex CSS colors use the browser's canonical color before an opacity edit", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    const colors = new Map([
      ["red", "#ff0000"], ["transparent", "rgba(0, 0, 0, 0)"],
      ["hsl(120 100% 50% / 0.5)", "rgba(0, 255, 0, 0.5)"],
      ["rgb(100% 0% 0% / 50%)", "rgba(255, 0, 0, 0.5)"],
    ]);
    let created = 0;
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      createElement(tag: string) {
        assert.equal(tag, "canvas");
        created++;
        return { getContext: () => {
          let color = "#000000";
          return { set fillStyle(value: string) { color = colors.get(value) ?? value; }, get fillStyle() { return color; } };
        } };
      },
    } });
    try {
      assert.deepEqual(parseColor("rgba(12, 34, 56, 0.5)"), { hex: "#0c2238", alpha: 0.5 });
      assert.equal(created, 0);
      assert.deepEqual(parseColor("red"), { hex: "#ff0000", alpha: 1 });
      assert.deepEqual(parseColor("transparent"), { hex: "#000000", alpha: 0 });
      assert.deepEqual(parseColor("hsl(120 100% 50% / 0.5)"), { hex: "#00ff00", alpha: 0.5 });
      const color = parseColor("rgb(100% 0% 0% / 50%)");
      assert.equal(composeColor(color.hex, 0.25), "rgba(255, 0, 0, 0.25)");
      assert.equal(created, 1);
      const isolated = new Function("__name", `return (${parseColor.toString()})`)((fn: unknown) => fn) as typeof parseColor;
      assert.deepEqual(isolated("hsl(120 100% 50% / 0.5)"), { hex: "#00ff00", alpha: 0.5 });
      assert.equal(created, 1);
    } finally {
      if (original) Object.defineProperty(globalThis, "document", original);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });
});

describe("opacity-control", () => {
  const boxSecPath = resolve_6("components/style-panel/BoxSec.tsx");
  const boxSecRequire = createRequire(boxSecPath);
  const boxSecCode = transformSync(readFileSync(boxSecPath, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;

  function renderAppearance(node: any, bp = "base", state = "default") {
    const writes: any[] = [];
    const doc = { nodes: { [node.id]: node }, pages: {}, pageOrder: [] };
    const mod = { exports: {} as any };
    new Function("require", "module", "exports", boxSecCode)((id: string) => {
      if (id === "react") return { ...boxSecRequire(id), useState: (v: any) => [v, () => {}] };
      if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }), findParentOf: () => null, ancestorsOf: () => [] };
      if (id === "../controls") return {
        useInspector: () => ({ get: (p: string) => getProp(node, bp as any, state as any, p), cleared: (p: string) => clearedValue(node, bp as any, state as any, p),
          set: (v: any) => writes.push(v) }),
        Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect", PropNum: "PropNum", PropSeg: "PropSeg", PropFill: "PropFill", Seg: "Seg",
      };
      if (id === "./PositionSec") return { useHiddenState: () => "" };
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return boxSecRequire(id);
    }, mod, mod.exports);
    const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
    return { fields: flatten(mod.exports.AppearanceSec()), writes };
  }

  for (const value of ["50%", ".5", "0.5"]) test(`opacity display uses CSS numeric semantics: ${value}`, () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: value } } } };
    const view = renderAppearance(node);
    assert.equal(view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.value, "50%");
  });
  test("hover can explicitly become fully opaque despite a translucent default", () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: ".5" } } } };
    const view = renderAppearance(node, "base", "hover");
    view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.onChange("100%");
    const patch = Object.fromEntries(Object.entries(view.writes.at(-1)).filter(([, v]) => v !== null));
    const next = { ...node, styles: { base: { ...node.styles.base, hover: patch } } };
    assert.equal(resolveStyles(next as any, "base", "hover").opacity, "1");
  });
  for (const [value, expected] of [["12.5%", "12.5%"], ["1.25e-1", "12.5%"], ["150%", "100%"], ["-0.1", "0%"]]) test(`opacity ${value} displays ${expected}`, () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: value } } } };
    assert.equal(renderAppearance(node).fields.find(e => e.type === "NumField" && e.props.max === 100).props.value, expected);
  });
  test("fully opaque base value remains removable without forcing an unnecessary override", () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: ".5" } } } };
    const view = renderAppearance(node);
    view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.onChange("100%");
    assert.deepEqual(view.writes.at(-1), { opacity: null });
  });
  test("smaller breakpoint can explicitly become fully opaque", () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: "50%" } } } };
    const view = renderAppearance(node, "sm");
    view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.onChange("100%");
    assert.deepEqual(view.writes.at(-1), { opacity: "1" });
  });

  for (const angle of [-45, 22.5, -0.5, 0, 180, 360]) {
    test(`gradient controls retain ${angle} degree angles and both colors`, () => {
      const c1 = "rgba(12, 34, 56, 0.5)", c2 = "#123456";
      const value = `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 100%)`;
      const parsed = parseGradient(value);
      assert.deepEqual(parsed, { angle, c1, c2 });
      assert.deepEqual(parseGradient(`linear-gradient(${parsed.angle}deg, #abcdef 0%, ${parsed.c2} 100%)`),
        { angle, c1: "#abcdef", c2 });
    });
  }
  test("gradient controls preserve defaults for unset or unsupported backgrounds", () => {
    for (const value of [undefined, "none", 'url("photo.png")']) {
      assert.deepEqual(parseGradient(value), { angle: 180, c1: "#ffffff", c2: "#e4e4e7" });
    }
  });

  test("the built-in switch shadow survives an opacity/color-only edit", () => {
    const preset = makeSwitch();
    const shadows = Object.values(preset.nodes).map(n => n.styles.base?.default?.boxShadow).filter(Boolean) as string[];
    assert.equal(shadows.length, 2);
    for (const value of shadows) {
      const parsed = parseShadow(value);
      assert.deepEqual(parsed, { inset: false, x: 0, y: 1, blur: 2, spread: 0, color: "rgba(0, 0, 0, 0.25)" });
      assert.equal(serializeShadow({ ...parsed, color: "#123456" }), "0px 1px 2px 0px #123456");
    }
  });
  for (const value of ["0 0 red", "red 0px 0", "inset 0 0 0 0 red"]) test(`zero lengths and omitted blur are preserved: ${value}`, () => {
    assert.deepEqual(parseShadow(value), { inset: value.startsWith("inset"), x: 0, y: 0, blur: 0, spread: 0, color: "red" });
  });
  test("functional color channels are not mistaken for lengths", () => {
    assert.deepEqual(parseShadow("-1px 2px 3px 4px rgb(0 20 30 / 0.5) inset"), {
      inset: true, x: -1, y: 2, blur: 3, spread: 4, color: "rgb(0 20 30 / 0.5)",
    });
  });
  test("omitted shadow color uses CSS currentColor, without inventing opacity", () => {
    assert.deepEqual(parseShadow("0 1px"), { inset: false, x: 0, y: 1, blur: 0, spread: 0, color: "currentColor" });
  });
  test("nested color functions remain a single token", () => {
    assert.equal(parseShadow("0 0 2px var(--shadow, rgb(0 0 0))").color, "var(--shadow, rgb(0 0 0))");
  });

  {
    let values: Record<string, string> = {}, zWrites: Record<string, string | null>[] = [];
    const posRequire = createRequire(resolve_6("components/style-panel/PositionSec.tsx"));
    const posMod = { exports: {} as any };
    const posSource = transformSync(readFileSync("components/style-panel/PositionSec.tsx", "utf8") + "\nexport { ZIndexControl };", { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", posSource)((id: string) => {
      if (id === "../controls") return { ...posRequire(id), useInspector: () => ({ get: (prop: string) => ({ value: values[prop] }), set: (props: any) => zWrites.push(props) }) };
      return posRequire(id);
    }, posMod, posMod.exports);
    for (const position of [undefined, "static", "relative", "absolute", "fixed", "sticky"]) {
      test(`front/back controls respect ${position ?? "unset"} positioning`, () => {
        values = position ? { position, zIndex: "3" } : { zIndex: "3" }; zWrites = [];
        const tree = posMod.exports.ZIndexControl();
        const buttons = React.Children.toArray(tree.props.children).filter((el: any) => el.type === "button") as any[];
        buttons[0].props.onClick(); buttons[1].props.onClick();
        const patch = position === undefined || position === "static" ? { position: "relative" } : {};
        assert.deepEqual(zWrites, [{ zIndex: "2", ...patch }, { zIndex: "4", ...patch }]);
      });
    }
  }
});

describe("position-border-controls", () => {
  function render(file: string, name: string, base: Record<string, string>, props = {}, bp = "base", state = "hover") {
    const node = { ...makeBox(), styles: { base: { default: base } } };
    const writes: any[] = [], path = resolve_6(`components/style-panel/${file}.tsx`), require = createRequire(path);
    const mod = { exports: {} as any }, doc = { nodes: { [node.id]: node }, assets: {}, pages: {}, pageOrder: [] };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
      if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }) };
      if (id === "../../lib/assets") return { assetSrc: () => "" };
      if (id === "../ImagePicker") return { __esModule: true, default: "ImagePicker" };
      if (id === "../controls") return new Proxy({
        useInspector: () => ({ get: (p: string) => getProp(node, bp, state as any, p), cleared: (p: string) => clearedValue(node, bp, state as any, p), set: (v: any) => writes.push(v) }),
        unitConverter: () => undefined,
      } as any, { get: (o, k) => k in o ? o[k] : k });
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return require(id);
    }, mod, mod.exports);
    const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
    const result = () => {
      const patch = Object.fromEntries(Object.entries(writes.at(-1)).filter(([,v]) => v !== null));
      const next = structuredClone(node) as any;
      next.styles[bp] ??= {}; next.styles[bp][state] = patch;
      return resolveStyles(next, bp, state as any);
    };
    return { elements: flatten(mod.exports[name](props)), writes, result };
  }

  test("switching anchor from an automatic inset selects the requested edge", () => {
    const view = render("PositionSec", "PositionSec", { position: "absolute", left: "auto", right: "auto" }, {}, "base", "default");
    view.elements.find(e => e.type === "Seg" && e.props.value === "left").props.onChange("right");
    assert.equal(view.writes.at(-1).right, "0px");
  });
  test("setting hover rotation to zero disables the normal rotation", () => {
    const view = render("PositionSec", "PositionSec", { transform: "rotate(20deg)" });
    view.elements.find(e => e.type === "NumField" && e.props.units?.[0] === "deg").props.onChange("0deg");
    assert.equal(view.result().transform, "none");
  });
  test("setting border width turns an explicitly absent border into a visible line", () => {
    const view = render("BackgroundSec", "BorderSec", { borderStyle: "none", borderWidth: "0px" }, {}, "base", "default");
    view.elements.find(e => e.type === "NumField").props.onChange("2px");
    assert.equal(view.writes.at(-1).borderStyle, "solid");
  });
  test("resetting rotation preserves other transform components", () => {
    const view = render("PositionSec", "PositionSec", { transform: "rotate(20deg) scale(2)" });
    view.elements.find(e => e.type === "NumField" && e.props.units?.[0] === "deg").props.onChange("0deg");
    assert.equal(view.result().transform, "scale(2)");
  });
  test("anchor switching preserves a numeric offset", () => {
    const view = render("PositionSec", "PositionSec", { position: "absolute", left: "30%" });
    view.elements.find(e => e.type === "Seg" && e.props.value === "left").props.onChange("right");
    assert.equal(view.writes.at(-1).right, "30%");
    assert.equal(view.writes.at(-1).left, "auto");
  });
  test("width edits retain existing decorative border style", () => {
    const view = render("BackgroundSec", "BorderSec", { borderStyle: "dashed", borderColor: "red" }, {}, "base", "default");
    view.elements.find(e => e.type === "NumField").props.onChange("2px");
    assert.deepEqual(view.writes.at(-1), { borderWidth: "2px", borderStyle: "dashed", borderColor: "red" });
  });
  test("clearing the hover rotation field keeps its existing reset-to-inherited semantics", () => {
    const view = render("PositionSec", "PositionSec", { transform: "rotate(20deg)" });
    view.elements.find(e => e.type === "NumField" && e.props.units?.[0] === "deg").props.onChange(null);
    assert.equal(view.writes.at(-1).transform, null);
    assert.equal(view.result().transform, "rotate(20deg)");
  });
});

describe("shadow-length-units", () => {
  for (const [source, expected] of [
    ["inset .25em -1rem 2vh 0.5vw red", "inset .25em -1rem 2vh 0.5vw blue"],
    ["red 1cm 2mm 3pt 4pc", "1cm 2mm 3pt 4pc blue"],
    ["1dvh 2svw 3cqw 4lh rgb(0 0 0 / .5)", "1dvh 2svw 3cqw 4lh blue"],
    ["calc(1em + 2px) min(1vh, 3px) 2rem black", "calc(1em + 2px) min(1vh, 3px) 2rem 0px blue"],
    ["1e2px 2rem", "1e2px 2rem 0px 0px blue"],
    ["1e-2em 2rem", "1e-2em 2rem 0px 0px blue"],
  ]) test(`color edit preserves CSS shadow length units: ${source}`, () => {
    const parsed = parseShadow(source);
    assert.equal(serializeShadow({ ...parsed, color: "blue" }), expected);
  });

  test("editing one shadow dimension preserves the other dimensions", () => {
    const parsed = parseShadow(".5em 1rem 2vh 3vw #123");
    assert.equal(serializeShadow({ ...parsed, x: 4 }), "4px 1rem 2vh 3vw #123");
  });

  // 実際のカードを動かす。パーサーだけを確かめても、入力欄や、text-shadow の別の直列化で
  // 付く px の接尾辞を見逃してしまう。
  function renderShadow(prop: "boxShadow" | "textShadow") {
    const writes: any[] = [];
    const path = resolve_6("components/style-panel/EffectsSec.tsx");
    const require = createRequire(path);
    const mod = { exports: {} as any };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
      if (id === "../controls") return {
        useInspector: () => ({ get: (p: string) => ({ value: p === prop ? ".5em 1rem 2vh red" : undefined }), cleared: () => null,
          set: (v: any) => writes.push(v) }),
        Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect",
      };
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return require(id);
    }, mod, mod.exports);
    const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
    const card = flatten(mod.exports.EffectsSec()).find(e => typeof e.type === "function" && e.props.shadow);
    return { fields: flatten(card.type(card.props)), writes };
  }
  for (const prop of ["boxShadow", "textShadow"] as const) test(`${prop} controls display and save non-pixel dimensions`, () => {
    const view = renderShadow(prop);
    const x = view.fields.find(e => e.type === "NumField" && e.props.pre === "X");
    assert.equal(x.props.value, ".5em");
    x.props.onChange("2rem");
    assert.equal(view.writes.at(-1)[prop], prop === "boxShadow" ? "2rem 1rem 2vh 0px red" : "2rem 1rem 2vh red");
    view.fields.find(e => e.type === "FillControl").props.onChange("blue");
    assert.equal(view.writes.at(-1)[prop], prop === "boxShadow" ? ".5em 1rem 2vh 0px blue" : ".5em 1rem 2vh blue");
  });
});
});

describe("dialog-focus", () => {
const path = resolve_7("components/DialogHost.tsx");
const require = createRequire(path);
const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
const loadDialogHost = new Function("require", "module", "exports", "window", "document", "HTMLElement", code);

// 本番のコンポーネント・effect と、実際のダイアログのキューを動かす。ここで模擬するのは、
// React のレンダラーと、DOM のフォーカス・既定の Tab の移動だけ。対応する Playwright のテストが、
// ネイティブのフォーカス・伝播・アクセシブルな名前を確かめる。
function mount() {
  useDialogs.setState({ queue: [] });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { activeElement: null as Target | null });
  class Target {
    isConnected = true;
    disabled = false;
    selected = false;
    constructor(readonly name: string) {}
    focus() { if (this.isConnected && !this.disabled) doc.activeElement = this; }
    select() { this.selected = true; }
  }
  const opener = new Target("opener"), background = new Target("background");
  opener.focus();
  let cursor = 0;
  let cells: any[] = [];
  let effects: (() => void)[] = [];
  let nodes: any[] = [];
  let currentId: number | undefined;
  const targets = new Map<string, Target>();
  const hooks = {
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = initial;
      return [cells[i], (value: unknown) => { cells[i] = value; }];
    },
    useRef(initial: unknown) { return cells[cursor++] ??= { current: initial }; },
    useEffect(run: () => void | (() => void), deps: unknown[]) {
      const i = cursor++;
      if (!cells[i] || deps.some((dep, j) => !Object.is(dep, cells[i].deps[j]))) {
        effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: run() }; });
      }
    },
  };
  const module = { exports: {} as any };
  loadDialogHost(
    (id: string) => id === "react" ? hooks : id === "react-dom" ? { createPortal: (child: any) => child } :
      id === "../lib/dialog" ? { ...dialogs, useDialogs: (select: any) => select(useDialogs.getState()) } : require(id),
    module, module.exports, win, doc, Target,
  );
  const flatten = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
  function unmount() {
    for (const target of targets.values()) target.isConnected = false;
    if ([...targets.values()].includes(doc.activeElement!)) doc.activeElement = null;
    for (const cell of cells) cell?.cleanup?.();
    cells = []; targets.clear(); nodes = []; currentId = undefined;
  }
  function render() {
    const req = useDialogs.getState().queue[0];
    if (req?.id !== currentId) unmount();
    if (!req) return;
    currentId = req.id; cursor = 0; effects = [];
    const child = module.exports.default();
    nodes = flatten(child.type(child.props));
    for (const node of nodes.filter(node => node.type === "input" || node.type === "button")) {
      const name = node.type === "input" ? "input" : node.props.className.includes("btn-primary") ? "ok" : "cancel";
      const target = targets.get(name) ?? new Target(name);
      target.disabled = !!node.props.disabled;
      targets.set(name, target);
      if (node.props.ref) node.props.ref.current = target;
    }
    for (const effect of effects) effect();
  }
  function key(key: string, init: { shiftKey?: boolean; isComposing?: boolean; keyCode?: number } = {}) {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key, ...init });
    win.dispatchEvent(event);
    // ネイティブの Tab は、既定の動作を止めない限り、ポータルから背景へ移る。
    if (key === "Tab" && !event.defaultPrevented) {
      const order = [opener, background, ...targets.values()].filter(target => target.isConnected && !target.disabled);
      const i = order.indexOf(doc.activeElement!);
      order[(i + (init.shiftKey ? -1 : 1) + order.length) % order.length]?.focus();
    }
    return event;
  }
  return {
    opener, background, render, unmount, key,
    focused: () => doc.activeElement?.name,
    focus: (name: string) => targets.get(name)!.focus(),
    input: (value: string) => { nodes.find(n => n.type === "input").props.onChange({ target: { value } }); render(); },
    click: (name: "ok" | "cancel") => {
      const node = nodes.find(n => n.type === "button" && (name === "ok" ? n.props.className.includes("btn-primary") : !n.props.className.includes("btn-primary")));
      assert.ok(!node.props.disabled); node.props.onClick(); render();
    },
    nodes: () => nodes,
    strictReplay() {
      const mountedEffects = cells.filter(cell => cell?.deps);
      for (const cell of mountedEffects) cell.cleanup?.();
      cells = cells.map(cell => cell?.deps ? undefined : cell);
      render();
    },
  };
}

for (const kind of ["alert", "confirm", "danger", "prompt"] as const) {
  test(`${kind}: Tab and Shift+Tab stay inside the modal`, () => {
    const f = mount();
    try {
      if (kind === "alert") void showAlert("Notice");
      else if (kind === "prompt") void showPrompt("Type a name");
      else void showConfirm("Continue?", { danger: kind === "danger" });
      f.render();
      assert.equal(f.focused(), kind === "prompt" ? "input" : kind === "danger" ? "cancel" : "ok");
      f.focus("ok"); f.key("Tab");
      assert.equal(f.focused(), kind === "prompt" ? "input" : kind === "alert" ? "ok" : "cancel");
      f.key("Tab", { shiftKey: true }); assert.equal(f.focused(), "ok");
      f.background.focus(); f.key("Tab");
      assert.notEqual(f.focused(), "opener"); assert.notEqual(f.focused(), "background");
    } finally { f.unmount(); }
  });
}

test("prompt Tab order follows whether the expected text enables OK", () => {
  const f = mount();
  try {
    void showPrompt("Type DELETE", { expect: "DELETE" }); f.render();
    f.key("Tab"); assert.equal(f.focused(), "cancel");
    f.key("Tab"); assert.equal(f.focused(), "input");
    f.key("Tab", { shiftKey: true }); assert.equal(f.focused(), "cancel");
    f.input("DELETE"); f.key("Tab"); assert.equal(f.focused(), "ok");
    f.key("Tab"); assert.equal(f.focused(), "input");
    f.input("unfinished"); f.key("Tab", { shiftKey: true }); assert.equal(f.focused(), "cancel");
  } finally { f.unmount(); }
});

for (const close of ["ok", "cancel", "Escape"] as const) test(`${close} restores the trigger and resolves the same result`, async () => {
  const f = mount();
  try {
    const result = showConfirm("Continue?"); f.render();
    if (close === "Escape") { f.key(close); f.render(); } else f.click(close);
    assert.equal(await result, close === "ok");
    assert.equal(f.focused(), "opener");
  } finally { f.unmount(); }
});

test("queued dialogs retain the original trigger, including Strict Mode effect replay", async () => {
  const f = mount();
  try {
    const first = showConfirm("First?"); const second = showAlert("Second");
    f.render(); f.strictReplay(); assert.equal(f.focused(), "ok");
    f.click("cancel"); assert.equal(await first, false); assert.equal(f.focused(), "ok");
    f.key("Tab"); assert.equal(f.focused(), "ok");
    f.click("ok"); await second; assert.equal(f.focused(), "opener");
  } finally { f.unmount(); }
});

test("unmount does not focus a removed trigger", () => {
  const f = mount(); void showAlert("Notice"); f.render();
  f.opener.isConnected = false;
  f.unmount(); assert.notEqual(f.focused(), "opener");
});

test("IME Escape is not cancellation and prompt text is preserved", async () => {
  const f = mount();
  try {
    const result = showPrompt("Name"); f.render(); f.input("日本語");
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      assert.equal(f.key("Escape", init).defaultPrevented, false);
      assert.equal(useDialogs.getState().queue.length, 1); assert.equal(f.focused(), "input");
    }
    f.click("ok"); assert.equal(await result, "日本語");
  } finally { f.unmount(); }
});

test("prompt input has a persistent name and instructions even without a placeholder", () => {
  const f = mount();
  try {
    void showPrompt("Enter the site name", { title: "Rename site" }); f.render();
    const input = f.nodes().find(n => n.type === "input");
    for (const [attribute, text] of [["aria-labelledby", "Rename site"], ["aria-describedby", "Enter the site name"]]) {
      const id = input.props[attribute]; assert.ok(id, attribute);
      assert.equal(f.nodes().find(n => n.props.id === id)?.props.children, text);
    }
  } finally { f.unmount(); }
});
});

describe("documentation-preview", () => {
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const previewEnv = {
  PREVIEW_D1_DATABASE_ID: "test-db",
  PREVIEW_KV_NAMESPACE_ID: "test-kv",
};

// 別の設定の準備を保守すると、手順が壊れたままでも通ってしまう。
// そうならないよう、運用者がコピーできる例そのものを実行する。
for (const guide of ["docs/worker-previews.md", "docs/worker-previews.ja.md"]) {
  test(`${guide}: test-storage recipe supplies the complete document store`, () => {
    const examples = [...read(guide).matchAll(/```jsonc?\s*\n([\s\S]*?)\n```/g)]
      .map((match) => parseJsonc(match[1]));
    const recipe = examples.find((example) => example.previews);
    assert.ok(recipe, "The test-storage instructions need a copyable previews block");
    assert.deepEqual(Object.keys(recipe), ["previews"], "Keep production settings outside the replacement block");

    const production = parseJsonc(read("wrangler.jsonc"));
    const original = structuredClone(production);
    const source = { ...production, ...recipe };
    // クラウドでのプレビューのコマンドは、最初に本番の設定の正規化を実行する。
    const prepared = normalizeStorageConfig(source).config;
    const generated = isolatedPreviewConfig(prepared, previewEnv);
    const effective = { ...generated, ...generated.previews };
    assert.deepEqual(storageBindings(effective), { db: true, kv: true, doc: true });
    assert.deepEqual(generated.previews.durable_objects.bindings, [
      { name: "COLLAB_ROOM", class_name: "CollaborationRoom" },
      { name: "DOC_STORE", class_name: "DocumentRoom" },
    ]);
    assert.equal(effective.d1_databases[0].database_id, previewEnv.PREVIEW_D1_DATABASE_ID);
    assert.equal(effective.kv_namespaces[0].id, previewEnv.PREVIEW_KV_NAMESPACE_ID);
    assert.deepEqual(effective.vars, {}, "Shared storage must not opt into anonymous access");
    assert.deepEqual(production, original);
    for (const key of ["durable_objects", "exports", "d1_databases", "kv_namespaces", "vars"]) {
      assert.deepEqual(generated[key], prepared[key], `Preview setup must preserve top-level ${key}`);
    }
  });
}

test("default browser-only previews and incomplete custom storage have different requirements", () => {
  const config = parseJsonc(read("wrangler.jsonc"));
  const defaults = isolatedPreviewConfig(config, previewEnv);
  assert.deepEqual(defaults.previews.d1_databases, []);
  assert.deepEqual(defaults.previews.kv_namespaces, []);
  assert.equal(defaults.previews.vars.ALLOW_ANONYMOUS, "true");

  // 空の配列を取り除き、D1・KV の ID だけを渡す設定は、DOC_STORE が無いため拒否される。
  config.previews = { vars: {} };
  assert.throws(() => isolatedPreviewConfig(config, previewEnv), /DOC_STORE/);
});
});

describe("effect-hover-clear", () => {
function renderEffects(node: any, bp = "base", state = "default") {
  const writes: any[] = [];
  const doc = { nodes: { [node.id]: node }, pages: {}, pageOrder: [] };
  const path = resolve_8("components/style-panel/EffectsSec.tsx");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
    if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }), findParentOf: () => null, ancestorsOf: () => [] };
    if (id === "../controls") return {
      useInspector: () => ({ get: (p: string) => getProp(node, bp as any, state as any, p), cleared: (p: string) => clearedValue(node, bp as any, state as any, p),
        set: (v: any) => writes.push(v) }),
      Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect", PropNum: "PropNum", PropSeg: "PropSeg", PropFill: "PropFill", Seg: "Seg",
    };
    if (id === "./PositionSec") return { useHiddenState: () => "" };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
  return { fields: flatten(mod.exports.EffectsSec()), writes };
}




for (const prop of ["filter", "backdropFilter"]) test(`hover can remove the default ${prop} blur`, () => {
  const node = { ...makeBox(), styles: { base: { default: { [prop]: "blur(8px)" } } } };
  const view = renderEffects(node, "base", "hover");
  view.fields.find(e => e.type === "NumField" && e.props.value === "8px").props.onChange("0px");
  assert.deepEqual(view.writes.at(-1), { [prop]: "none" });
});
for (const prop of ["boxShadow", "textShadow"]) test(`hover can delete the default ${prop}`, () => {
  const node = { ...makeBox(), styles: { base: { default: { [prop]: "1px 2px 3px red" } } } };
  const view = renderEffects(node, "base", "hover");
  const card = view.fields.find(e => typeof e.type === "function" && e.props.shadow);
  card.props.onDelete();
  assert.deepEqual(view.writes.at(-1), { [prop]: "none" });
});
test("hover can remove the default transform without resetting to it", () => {
  const node = { ...makeBox(), styles: { base: { default: { transform: "rotate(20deg)" } } } };
  const view = renderEffects(node, "base", "hover");
  view.fields.find(e => typeof e.type === "function" && e.type.name === "TransformCard").props.onDelete();
  assert.equal(view.writes.at(-1).transform, "none");
});
for (const prop of ["filter", "backdropFilter"]) test(`smaller breakpoint can disable inherited ${prop}`, () => {
  const node = { ...makeBox(), styles: { base: { default: { [prop]: "blur(8px)" } } } };
  const view = renderEffects(node, "sm");
  view.fields.find(e => e.type === "NumField" && e.props.value === "8px").props.onChange("0px");
  assert.deepEqual(view.writes.at(-1), { [prop]: "none" });
});
test("turning off one inherited effect preserves other filter functions", () => {
  const node = { ...makeBox(), styles: { base: { default: { filter: "contrast(150%) blur(8px) opacity(.5)" } } } };
  const view = renderEffects(node, "base", "hover");
  view.fields.find(e => e.type === "NumField" && e.props.value === "8px").props.onChange("0px");
  assert.deepEqual(view.writes.at(-1), { filter: "contrast(150%) opacity(.5)" });
});
test("base effect removal still deletes the property instead of forcing none", () => {
  const node = { ...makeBox(), styles: { base: { default: { filter: "blur(8px)" } } } };
  const view = renderEffects(node);
  view.fields.find(e => e.type === "NumField" && e.props.value === "8px").props.onChange("0px");
  assert.deepEqual(view.writes.at(-1), { filter: null });
});
test("right-click reset retains inheritance semantics", () => {
  const node = { ...makeBox(), styles: { base: { default: { backdropFilter: "blur(8px)" }, hover: { backdropFilter: "none" } } } };
  const view = renderEffects(node, "base", "hover");
  view.fields.find(e => e.type === "Grp" && e.props.label === "Background blur").props.onReset();
  assert.deepEqual(view.writes.at(-1), { backdropFilter: null });
});
});

describe("explicit-style-mode", () => {
function render(file: string, name: string, base: Record<string, string>, props = {}, bp = "base", state = "hover") {
  const node = { ...makeBox(), styles: { base: { default: base } } };
  const writes: any[] = [], path = resolve_9(`components/style-panel/${file}.tsx`), require = createRequire(path);
  const mod = { exports: {} as any }, doc = { nodes: { [node.id]: node }, assets: {}, pages: {}, pageOrder: [] };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
    if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }) };
    if (id === "../controls") return new Proxy({
      useInspector: () => ({ get: (p: string) => getProp(node, bp, state as any, p), cleared: (p: string) => clearedValue(node, bp, state as any, p), set: (v: any) => writes.push(v) }),
      unitConverter: () => undefined,
    } as any, { get: (o, k) => k in o ? o[k] : k });
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
  const result = () => {
    const patch = Object.fromEntries(Object.entries(writes.at(-1)).filter(([,v]) => v !== null));
    const next = structuredClone(node) as any;
    next.styles[bp] ??= {}; next.styles[bp][state] = patch;
    return resolveStyles(next, bp, state as any);
  };
  return { elements: flatten(mod.exports[name](props)), writes, result };
}
test("hover can choose automatic positioning over absolute positioning", () => {
  const view = render("PositionSec", "PositionSec", { position: "absolute", left: "30px", top: "20px" });
  view.elements.find(e => e.type === "Seg" && e.props.value === "custom").props.onChange("auto");
  assert.equal(view.result().position, "static"); assert.equal(view.result().left, "auto");
});
test("hover fixed size overrides inherited fill instead of keeping flex-grow", () => {
  const view = render("PositionSec", "MainSizeField", { flexGrow: "1", flexBasis: "0%", minWidth: "0" }, { prop: "width", pre: "W", axis: "main" });
  view.elements.find(e => e.type === "NumField").props.onChange("100px");
  assert.equal(view.result().flexGrow, "0"); assert.equal(view.result().flexBasis, "auto"); assert.equal(view.result().width, "100px");
});
for (const mode of ["none", "color"]) test(`hover background can switch from image to ${mode}`, () => {
  const view = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")', backgroundColor: "red" });
  view.elements.find(e => e.type === "Seg").props.onChange(mode);
  assert.equal(view.result().backgroundImage, "none");
  if (mode === "none") assert.equal(view.result().backgroundColor, "transparent");
});
for (const [bp, state] of [["sm", "default"], ["base", "focus"]]) test(`${bp}/${state} mode switches override inherited background and placement`, () => {
  const bg = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")', backgroundColor: "red" }, {}, bp, state);
  bg.elements.find(e => e.type === "Seg").props.onChange("none");
  assert.equal(bg.result().backgroundImage, "none"); assert.equal(bg.result().backgroundColor, "transparent");
  const pos = render("PositionSec", "PositionSec", { position: "absolute", top: "20px" }, {}, bp, state);
  pos.elements.find(e => e.type === "Seg" && e.props.value === "custom").props.onChange("auto");
  assert.equal(pos.result().position, "static");
});
test("hover fill toggle explicitly disables inherited flex-grow", () => {
  const view = render("PositionSec", "MainSizeField", { flexGrow: "1", flexBasis: "0%" }, { prop: "width", pre: "W", axis: "main" });
  view.elements.find(e => e.type === "button" && e.props["aria-label"] === "Fill remaining space").props.onClick();
  assert.equal(view.result().flexGrow, "0"); assert.equal(view.result().flexBasis, "auto");
});
test("base background mode deletion and context reset still remove local overrides", () => {
  const view = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")' }, {}, "base", "default");
  view.elements.find(e => e.type === "Seg").props.onChange("none");
  assert.equal(view.writes.at(-1).backgroundImage, null);
  const hover = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")' });
  hover.elements.find(e => e.type === "Grp" && e.props.onReset).props.onReset();
  assert.equal(hover.writes.at(-1).backgroundImage, null);
});
for (const mode of ["auto", "custom", "sticky"]) test(`position ${mode} unhides inherited display:none without imposing a display type`, () => {
  const view = render("PositionSec", "PositionSec", { display: "none" });
  view.elements.find(e => e.type === "Seg" && e.props.options.some((o: any) => o.value === "sticky")).props.onChange(mode);
  assert.equal(view.result().display, "revert");
});
test("clearing the hover image picker removes the image; group reset restores inheritance", () => {
  const view = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")' });
  view.elements.find(e => typeof e.type === "function" && e.type.name === "ImagePicker").props.onChange(null);
  assert.equal(view.writes.at(-1).backgroundImage, "none");
  view.elements.find(e => e.type === "Grp" && e.props.onReset).props.onReset();
  assert.equal(view.writes.at(-1).backgroundImage, null);
});
});

describe("filter-controls-preservation", () => {
const effectsPath = resolve_10("components/style-panel/EffectsSec.tsx");
const effectsRequire = createRequire(effectsPath);
const effectsCode = transformSync(readFileSync(effectsPath, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;

function renderEffects(prop: "filter" | "backdropFilter", value: string) {
  const writes: any[] = [];
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", effectsCode)((id: string) => {
    if (id === "react") return { ...effectsRequire(id), useState: (v: any) => [v, () => {}] };
    if (id === "../controls") return {
      useInspector: () => ({ get: (p: string) => ({ value: p === prop ? value : undefined }), cleared: () => null,
        set: (v: any) => writes.push(v) }),
      Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect",
    };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return effectsRequire(id);
  }, mod, mod.exports);
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
  return { fields: flatten(mod.exports.EffectsSec()), writes };
}

test("brightness control preserves other filters, source order, and repeated effects", () => {
  const view = renderEffects("filter", "contrast(200%) brightness(150%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)");
  view.fields.find(e => e.type === "NumField" && e.props.value === "150%").props.onChange("180%");
  assert.equal(view.writes.at(-1).filter, "contrast(200%) brightness(180%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)");
});
test("backdrop blur control keeps other effects on change and clear", () => {
  const view = renderEffects("backdropFilter", "saturate(2) blur(4px) opacity(.8)");
  const blur = view.fields.find(e => e.type === "NumField" && e.props.value === "4px");
  blur.props.onChange("6px");
  assert.equal(view.writes.at(-1).backdropFilter, "saturate(2) blur(6px) opacity(.8)");
  blur.props.onChange(null);
  assert.equal(view.writes.at(-1).backdropFilter, "saturate(2) opacity(.8)");
});
test("backdrop blur accepts CSS math without crashing or deleting other effects", () => {
  const view = renderEffects("backdropFilter", "blur(4px) saturate(2)");
  view.fields.find(e => e.type === "NumField" && e.props.value === "4px").props.onChange("calc(1rem + 2px)");
  assert.equal(view.writes.at(-1).backdropFilter, "blur(calc(1rem + 2px)) saturate(2)");
});
test("display and editing agree on the first real filter outside comments and nested expressions", () => {
  const source = '/* brightness(2) */ url("brightness(3)") var(--filter, brightness(4)) BRIGHTNESS(150%) brightness(120%)';
  const view = renderEffects("filter", source);
  view.fields.find(e => e.type === "NumField" && e.props.value === "150%").props.onChange("180%");
  assert.equal(view.writes.at(-1).filter, source.replace("BRIGHTNESS(150%)", "brightness(180%)"));
});
test("backdrop display and edit select the same uppercase non-comment blur", () => {
  const source = '/* blur(2px) */ url("blur(3px)") BLUR(4px) saturate(2)';
  const view = renderEffects("backdropFilter", source);
  view.fields.find(e => e.type === "NumField" && e.props.value === "4px").props.onChange("6px");
  assert.equal(view.writes.at(-1).backdropFilter, source.replace("BLUR(4px)", "blur(6px)"));
});

test("filter editing preserves order, repeated functions, and unsupported effects", () => {
  assert.equal(editFilterFunction('contrast(200%) brightness(150%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)', 'brightness', 'brightness(180%)'),
    'contrast(200%) brightness(180%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)');
});
test("nested and quoted filter text is not treated as a top-level effect", () => {
  const src = 'url("data:image/svg+xml;brightness(20%)") var(--effect, brightness(50%))';
  assert.equal(editFilterFunction(src, 'brightness', 'brightness(200%)'), src + ' brightness(200%)');
});
test("replacing nested math keeps the rest of the filter chain", () => {
  assert.equal(editFilterFunction('blur(calc(1rem + var(--extra))) saturate(2)', 'blur', 'blur(4px)'), 'blur(4px) saturate(2)');
});
test("removing blur preserves other backdrop filters", () => {
  assert.equal(editFilterFunction('saturate(2) blur(4px) opacity(.8)', 'blur', null), 'saturate(2) opacity(.8)');
});
test("adding an effect handles none and CSS wide keyword values", () => {
  for (const raw of [undefined, 'none', 'NONE', 'inherit', 'revert-layer'])
    assert.equal(editFilterFunction(raw, 'blur', 'blur(4px)'), 'blur(4px)');
});
test("matches function names case insensitively and preserves unrelated source", () => {
  assert.equal(editFilterFunction('BLUR(4px) contrast(200%)', 'blur', 'blur(6px)'), 'blur(6px) contrast(200%)');
});
test("comments containing filter names are preserved, not edited", () => {
  assert.equal(editFilterFunction('/* blur(2px) */ contrast(2)', 'blur', 'blur(4px)'), '/* blur(2px) */ contrast(2) blur(4px)');
  assert.equal(editFilterFunction('/* blur(2px) */ blur(3px) contrast(2)', 'blur', 'blur(4px)'), '/* blur(2px) */ blur(4px) contrast(2)');
});

const categories = {
  "出展カテゴリ": ["物販"],
  "投票カテゴリ": ["物販"],
  "大分類": ["かう"],
};

test("filter field type hints retain singleton arrays and distinguish records", () => {
  assert.equal(filterFieldKind(categories), "record");
  assert.equal(filterFieldKind(categories["出展カテゴリ"]), "array");
  assert.equal(filterFieldKind("物販"), "scalar");
  assert.equal(filterFieldKind(undefined), "unknown");
  assert.deepEqual(filterFieldOperators(categories), ["has-key", "empty", "eq"]);
  assert.deepEqual(filterFieldOperators(categories["出展カテゴリ"]), ["contains", "contains-any", "empty", "eq"]);
  assert.equal(filterFieldOperators(undefined), undefined);
});

test("switching filter fields chooses valid predicates and preserves compatible edits", () => {
  const scalar = { field: "title", op: "eq" as const, value: "物販" };
  const record = filterFieldSelection(scalar, "categories", "商品", categories);
  assert.deepEqual(record, { field: "categories", op: "has-key", value: "" });
  const array = filterFieldSelection(record, "categories.出展カテゴリ", categories, categories["出展カテゴリ"]);
  assert.deepEqual(array, { field: "categories.出展カテゴリ", op: "contains", value: "" });
  const sameArray = filterFieldSelection({ ...array, value: "物販" }, "categories.投票カテゴリ", categories["出展カテゴリ"], categories["投票カテゴリ"]);
  assert.deepEqual(sameArray, { field: "categories.投票カテゴリ", op: "contains", value: "物販" });
  const scalarToArray = filterFieldSelection(scalar, "categories.出展カテゴリ", "商品", categories["出展カテゴリ"]);
  assert.equal(scalarToArray.value, "物販");
  assert.equal(scalarToArray.op, "contains");
  assert.deepEqual(filterFieldSelection(scalar, "later", "商品", undefined), { ...scalar, field: "later" });
});

test("record-key and singleton-list membership comparisons use existing shared runtime semantics", () => {
  assert.equal(matchesValueCondition(categories, "has-key", "出展カテゴリ"), true);
  assert.equal(matchesValueCondition(categories, "has-key", "別のカテゴリ"), false);
  assert.equal(matchesValueCondition(categories["出展カテゴリ"], "contains", "物販"), true);
  assert.equal(matchesValueCondition(categories["出展カテゴリ"], "contains", "飲食"), false);
  assert.equal(matchesValueCondition(categories, "empty", ""), false);
  assert.equal(matchesValueCondition({}, "empty", ""), true);
  assert.equal(matchesValueCondition(categories, "eq", JSON.parse(JSON.stringify(categories))), true);
});

test("contains-any matches overlapping list values and rejects disjoint values", () => {
  assert.equal(matchesValueCondition(["物販", "展示"], "contains-any", ["飲食", "展示"]), true);
  assert.equal(matchesValueCondition(["物販", "展示"], "contains-any", ["飲食"]), false);
  assert.equal(matchesValueCondition(["物販", "展示"], "contains-any", "飲食, 物販"), true);
  assert.equal(matchesValueCondition([], "contains-any", ["物販"]), false);
  assert.equal(matchesValueCondition(["物販"], "contains-any", []), false);
  assert.equal(matchesValueCondition([{ id: 1 }], "contains-any", [{ id: "1" }]), true);
});
});

describe("image-drop", () => {
  before(() => {
    useEditor_6.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(): SiteDoc {
  return {
    siteName: "Image drop", assets: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: ["c"] },
    },
    nodes: Object.fromEntries(["a", "b", "c", "root"].map((id) => [id, { ...makeBox(), id }])),
    components: { comp: { id: "comp", name: "Component", rootId: "root" } },
  };
}
const state = () => useEditor_6.getState();
const originalFetch = globalThis.fetch;
const originalImage = globalThis.Image;
const pending: ((ok?: boolean) => void)[] = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const files = (...names: string[]) => names.map((name) => new File(["fixture"], name, { type: name.endsWith(".txt") ? "text/plain" : "image/png" }));
const point = { parent: { kind: "page" as const, id: "p" } };

beforeEach(() => {
  state().endGesture();
  state().replaceDoc(fixture());
  state().setActivePage("p");
  state().setMode("design");
  state().select("a");
  useDialogs.setState({ queue: [] });
  pending.length = 0;
  globalThis.Image = class {
    naturalWidth = 10; naturalHeight = 20; onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  } as unknown as typeof Image;
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/assets");
    return new Promise<Response>((resolve) => {
      const index = pending.length;
      pending.push((ok = true) => resolve(ok
        ? Response.json({ path: `assets/drop-${index}.png` })
        : Response.json({ error: "upload failed" }, { status: 400 })));
    });
  };
});
afterEach(() => { state().endGesture(); globalThis.fetch = originalFetch; globalThis.Image = originalImage; });
async function begin(names = ["new.png"], target: ImageDropPoint = point) {
  const task = startImageDrop(files(...names), target);
  await tick();
  return task;
}
function nodeNames(ids: string[]) { return ids.map((id) => state().doc.nodes[id].name); }
function withoutAssets(doc: SiteDoc) { return { ...doc, assets: {} }; }

test("one drop inserts every image in order and is one complete Undo/Redo action", async () => {
  const before = structuredClone(state().doc);
  const task = await begin(["one.png", "ignore.txt", "two.png"], { ...point, index: 1 });
  pending[0](); await tick();
  assert.deepEqual(state().doc, before, "do not expose half a batch while the next upload is pending");
  assert.equal(pending.length, 2);
  pending[1](); await task.done;
  assert.deepEqual(nodeNames(state().doc.pages.p.children), ["Box", "one.png", "two.png", "Box"]);
  assert.equal(Object.keys(state().doc.assets).length, 2);
  assert.equal(state().past.length, 1);
  const after = structuredClone(state().doc);
  state().undo(); assert.deepEqual(state().doc, before);
  state().redo(); assert.deepEqual(state().doc, after);
});

for (const change of ["page", "selection", "component", "away-and-back", "multi-selection", "preview"] as const) {
  test(`a later ${change} never loses its selection to an old completed drop`, async () => {
    const task = await begin();
    if (change === "page") { state().setActivePage("q"); state().select("c"); }
    if (change === "selection") state().select("b");
    if (change === "component") state().setEditingComponent("comp");
    if (change === "away-and-back") { state().select("b"); state().select("a"); }
    if (change === "multi-selection") state().selectMany(["a", "b"], "a");
    if (change === "preview") state().setMode("preview");
    const selection = state().selection; const selectedIds = [...state().selectedIds];
    pending[0](); await task.done;
    assert.equal(state().doc.pages.p.children.length, 3, "keep the original valid drop destination");
    assert.deepEqual(state().doc.pages.q.children, ["c"]);
    assert.equal(state().selection, selection);
    assert.deepEqual(state().selectedIds, selectedIds);
  });
}

test("leaving a component preserves the destination and the page's newer selection", async () => {
  state().setEditingComponent("comp");
  const task = await begin(["component.png"], { parent: { kind: "node", id: "root" } });
  state().setActivePage("q"); state().select("c");
  pending[0](); await task.done;
  assert.deepEqual(nodeNames(state().doc.nodes.root.children), ["component.png"]);
  assert.deepEqual(state().doc.pages.q.children, ["c"]);
  assert.equal(state().selection, "c");
});

test("site name and unrelated node edits do not cancel a valid drop or get overwritten", async () => {
  const task = await begin();
  state().updateDoc((doc) => { doc.siteName = "Renamed"; doc.nodes.b.name = "Edited"; });
  const edited = structuredClone(state().doc);
  pending[0](); await task.done;
  assert.equal(state().doc.siteName, "Renamed");
  assert.equal(state().doc.nodes.b.name, "Edited");
  assert.equal(state().doc.pages.p.children.length, 3);
  state().undo(); assert.deepEqual(state().doc, edited);
});

test("a pending sibling insertion follows its anchor when unrelated siblings change", async () => {
  const task = await begin(["new.png"], { ...point, index: 1 });
  state().updateDoc((doc) => {
    doc.nodes.extra = { ...makeBox(), id: "extra", name: "Extra" };
    doc.pages.p.children.unshift("extra");
  });
  pending[0](); await task.done;
  assert.deepEqual(nodeNames(state().doc.pages.p.children), ["Extra", "Box", "new.png", "Box"]);
});

for (const destination of ["page", "node", "component"] as const) {
  test(`deleted ${destination} retains the successful upload without inserting orphan nodes`, async () => {
    if (destination === "component") state().setEditingComponent("comp");
    const task = await begin(["new.png"], destination === "page" ? point : { parent: { kind: "node", id: destination === "node" ? "a" : "root" } });
    if (destination === "page") state().deletePage("p");
    if (destination === "node") state().deleteNode("a");
    if (destination === "component") state().deleteComponent("comp");
    const before = structuredClone(state().doc);
    pending[0](); await task.done;
    assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
    assert.equal(Object.keys(state().doc.assets).length, 1);
    assert.equal(useDialogs.getState().queue.length, 0);
    state().undo(); assert.equal(Object.keys(state().doc.assets).length, 1, "the uploaded file also survives undoing deletion");
  });
}

test("Undo during a batch cancels placement, retains successful files and preserves Redo", async () => {
  state().updateNode("b", { name: "Edited" });
  const edited = structuredClone(state().doc);
  const task = await begin(["one.png", "two.png", "three.png"]);
  pending[0](); await tick();
  assert.equal(pending.length, 2);
  state().undo();
  const undone = structuredClone(state().doc);
  assert.equal(state().future.length, 1);
  pending[1](); await task.done;
  assert.deepEqual(withoutAssets(state().doc), withoutAssets(undone));
  assert.equal(pending.length, 2, "do not start further uploads after cancellation");
  assert.equal(Object.keys(state().doc.assets).length, 2);
  assert.equal(state().future.length, 1);
  state().redo(); assert.deepEqual(withoutAssets(state().doc), withoutAssets(edited));
  assert.equal(Object.keys(state().doc.assets).length, 2);
});

test("a failed second upload keeps only completed files in Assets and leaves the drop atomic", async () => {
  const before = structuredClone(state().doc);
  const task = await begin(["one.png", "two.png", "three.png"]);
  pending[0](); await tick(); pending[1](false); await task.done;
  assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
  assert.equal(Object.keys(state().doc.assets).length, 1);
  assert.equal(state().past.length, 0);
  assert.equal(useDialogs.getState().queue.length, 1);
  const retry = await begin(["retry.png"]);
  pending[2](); await retry.done;
  assert.equal(state().doc.pages.p.children.length, 3);
});

test("cancel and unmount retain an in-flight success without placing or starting remaining files", async () => {
  const before = structuredClone(state().doc);
  const task = await begin(["one.png", "two.png"]);
  task.cancel(); pending[0](); await task.done;
  assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
  assert.equal(Object.keys(state().doc.assets).length, 1);
  assert.equal(pending.length, 1);
});

test("a canceled failed upload is quiet", async () => {
  const task = await begin(); task.cancel(); pending[0](false); await task.done;
  assert.equal(useDialogs.getState().queue.length, 0);
  assert.equal(Object.keys(state().doc.assets).length, 0);
});

for (const olderFirst of [true, false]) {
  test(`overlapping drops preserve both batches and the newer selection (${olderFirst ? "old" : "new"} finishes first)`, async () => {
    const older = await begin(["old.png"]);
    const newer = await begin(["new.png"]);
    pending[olderFirst ? 0 : 1](); await (olderFirst ? older : newer).done;
    const firstSelection = state().selection;
    if (olderFirst) assert.equal(firstSelection, "a");
    pending[olderFirst ? 1 : 0](); await (olderFirst ? newer : older).done;
    assert.equal(state().doc.pages.p.children.length, 4);
    assert.equal(state().doc.nodes[state().selection!].name, "new.png");
    state().undo(); assert.equal(state().doc.pages.p.children.length, 3);
    state().undo(); assert.equal(state().doc.pages.p.children.length, 2);
  });
}

test("unsupported files do not mutate the document or upload anything", async () => {
  const before = structuredClone(state().doc);
  await startImageDrop(files("ignore.txt"), point).done;
  assert.deepEqual(state().doc, before);
  assert.equal(pending.length, 0);
});

for (const change of ["undo-redo", "redo", "replace", "restore"] as const) {
  test(`${change} while uploading never revives a pending placement`, async () => {
    state().updateNode("b", { name: "Edited" });
    if (change === "redo") state().undo();
    const task = await begin();
    if (change === "undo-redo") { state().undo(); state().redo(); }
    if (change === "redo") state().redo();
    if (change === "replace") state().replaceDoc(structuredClone(state().doc));
    if (change === "restore") { const doc = structuredClone(state().doc); doc.siteName = "Restored"; state().restoreDoc(doc); }
    const before = structuredClone(state().doc); const future = state().future.length;
    pending[0](); await task.done;
    assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
    assert.equal(Object.keys(state().doc.assets).length, 1);
    assert.equal(state().future.length, future);
  });
}

test("no-op Undo does not cancel a valid pending placement", async () => {
  const task = await begin(); state().undo(); pending[0](); await task.done;
  assert.equal(state().doc.pages.p.children.length, 3);
});

test("a destination moved to a different page no longer receives a delayed drop", async () => {
  const task = await begin(["new.png"], { parent: { kind: "node", id: "a" } });
  state().moveNodes(["a"], { kind: "page", id: "q" }, 1);
  const before = structuredClone(state().doc);
  pending[0](); await task.done;
  assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
  assert.equal(Object.keys(state().doc.assets).length, 1);
});

test("invalid files or destinations do not steal selection from an earlier valid drop", async () => {
  const task = await begin();
  await startImageDrop(files("ignore.txt"), point).done;
  await startImageDrop(files("orphan.png"), { parent: { kind: "node", id: "missing" } }).done;
  pending[0](); await task.done;
  assert.equal(state().doc.nodes[state().selection!].name, "new.png");
  assert.equal(pending.length, 1);
});

for (const reason of ["unmount", "undo", "deleted target"] as const) {
  test(`${reason} releases the pending store subscription before the network completes`, async () => {
    const subscribe = useEditor_6.subscribe;
    let subscriptions = 0;
    useEditor_6.subscribe = (listener) => {
      subscriptions++;
      const unsubscribe = subscribe(listener);
      let listening = true;
      return () => {
        unsubscribe();
        if (listening) { listening = false; subscriptions--; }
      };
    };
    try {
      if (reason === "undo") state().updateNode("b", { name: "Edited" });
      const task = await begin();
      assert.equal(subscriptions, 1);
      if (reason === "unmount") task.cancel();
      if (reason === "undo") state().undo();
      if (reason === "deleted target") state().deletePage("p");
      assert.equal(subscriptions, 0, "do not wait for a slow or stalled response to unsubscribe");
      pending[0](); await task.done;
      task.cancel();
      assert.equal(subscriptions, 0, "settling and repeated cancellation are safe");
      assert.equal(Object.keys(state().doc.assets).length, 1, "completed upload is retained without a live subscription");
    } finally { useEditor_6.subscribe = subscribe; }
  });
}

for (const transient of [false, true]) {
  test(`a completed upload waits for the active ${transient ? "transient" : "ordinary"} gesture and gets its own Undo`, async () => {
    const before = structuredClone(state().doc);
    const task = await begin();
    state().beginGesture();
    state().setStyleProps("a", { paddingLeft: "10px" }, { transient });
    pending[0](); await tick();
    assert.equal(state().doc.pages.p.children.length, 2, "do not insert while the control still owns a gesture");
    assert.equal(state().gestureActive, true);
    state().setStyleProps("a", { paddingLeft: "20px" }, { transient });
    const edited = structuredClone(state().doc);
    state().endGesture();
    assert.equal(state().doc.pages.p.children.length, 2, "endGesture does not synchronously change the control's selection");
    await task.done;
    const after = structuredClone(state().doc);
    assert.equal(after.pages.p.children.length, 3);
    assert.equal(state().past.length, 2);
    state().undo(); assert.deepEqual(state().doc, edited);
    state().undo(); assert.deepEqual(state().doc, before);
    state().redo(); assert.deepEqual(state().doc, edited);
    state().redo(); assert.deepEqual(state().doc, after);
  });
}

test("a new gesture started before the release microtask keeps placement waiting", async () => {
  const task = await begin();
  state().beginGesture(); state().updateNode("a", { name: "First" });
  pending[0](); await tick();
  state().endGesture(); state().beginGesture();
  await tick(); assert.equal(state().doc.pages.p.children.length, 2);
  state().updateNode("a", { name: "Second" });
  const edited = structuredClone(state().doc);
  state().endGesture(); await task.done;
  state().undo(); assert.deepEqual(state().doc, edited);
});

for (const reason of ["unmount", "undo", "delete"] as const) {
  test(`${reason} releases an already uploaded batch without waiting for gesture end`, async () => {
    const task = await begin();
    state().beginGesture(); state().updateNode("b", { name: "Edited" });
    pending[0](); await tick();
    assert.equal(Object.keys(state().doc.assets).length, 0);
    if (reason === "unmount") task.cancel();
    if (reason === "undo") state().undo();
    if (reason === "delete") state().deletePage("p");
    await task.done;
    assert.equal(state().gestureActive, reason !== "undo",
      "only Undo ends the gesture; cancelling the drop itself must not end another control's gesture");
    assert.equal(Object.keys(state().doc.assets).length, 1);
    assert.equal(Object.values(state().doc.nodes).filter((node) => node.type === "image").length, 0);
    if (reason === "undo") assert.equal(state().future.length, 1);
    state().endGesture(); await tick();
    assert.equal(Object.values(state().doc.nodes).filter((node) => node.type === "image").length, 0);
  });
}

test("an empty gesture adds no history entry when the waiting drop resumes", async () => {
  const task = await begin(); state().beginGesture(); pending[0](); await tick();
  state().endGesture(); await task.done;
  assert.equal(state().past.length, 1);
  state().undo(); assert.equal(state().doc.pages.p.children.length, 2);
});

test("overlapping gesture owners share the original checkpoint and all must finish before placement", async () => {
  const before = structuredClone(state().doc);
  const task = await begin();
  const first = state().beginGesture(); state().setStyleProps("a", { paddingLeft: "10px" });
  const second = state().beginGesture(); state().setStyleProps("a", { borderRadius: "10px" }, { transient: true });
  pending[0](); await tick();
  first(); first(); await tick();
  assert.equal(state().gestureActive, true);
  assert.equal(state().doc.pages.p.children.length, 2);
  state().setStyleProps("a", { borderRadius: "20px" }, { transient: true });
  const edited = structuredClone(state().doc);
  second(); await task.done;
  assert.equal(state().past.length, 2);
  state().undo(); assert.deepEqual(state().doc, edited);
  state().undo(); assert.deepEqual(state().doc, before);
});

test("stale owner endings cannot release a new gesture after endGesture clears all owners", async () => {
  const first = state().beginGesture();
  const second = state().beginGesture();
  state().endGesture();
  const current = state().beginGesture();
  const task = await begin(); pending[0](); await tick();
  first(); second(); await tick();
  assert.equal(state().gestureActive, true);
  assert.equal(state().doc.pages.p.children.length, 2);
  current(); await task.done;
  assert.equal(state().gestureActive, false);
  assert.equal(state().doc.pages.p.children.length, 3);
});

test("endGesture explicitly releases all owners and resumes the pending drop once", async () => {
  const task = await begin();
  const first = state().beginGesture(); state().updateNode("a", { name: "Changed" });
  const second = state().beginGesture();
  pending[0](); await tick();
  state().endGesture(); await task.done;
  assert.equal(state().gestureActive, false);
  assert.equal(state().doc.pages.p.children.length, 3);
  first(); second(); state().endGesture();
  assert.equal(state().doc.pages.p.children.length, 3);
  state().undo(); assert.equal(state().doc.nodes.a.name, "Changed");
});

for (const change of ["page", "undo", "delete", "unmount"] as const) {
  test(`deferred clipboard decoding captures intent before ${change}`, async () => {
    const { startImageInsertion } = await import("../lib/image-drop");
    let decoded!: (files: File[]) => void;
    if (change === "undo") state().updateNode("b", { name: "Edited" });
    const task = startImageInsertion(() => new Promise<File[]>((resolve) => { decoded = resolve; }), point, { quiet: true });
    if (change === "page") { state().setActivePage("q"); state().select("c"); }
    if (change === "undo") state().undo();
    if (change === "delete") state().deletePage("p");
    if (change === "unmount") task.cancel();
    decoded(files("decoded.png")); await tick();
    if (change === "page") { pending[0](); } else assert.equal(pending.length, 0, "cancel before starting an upload");
    const result = await task.done;
    assert.equal(result.inserted, change === "page");
    if (change === "page") { assert.equal(state().doc.pages.p.children.length, 3); assert.equal(state().selection, "c"); }
    if (change === "undo") assert.equal(state().future.length, 1);
  });
}

test("a rejected clipboard decoder is returned without a drop alert or history entry", async () => {
  const { startImageInsertion } = await import("../lib/image-drop");
  const error = new Error("cannot decode");
  const task = startImageInsertion(async () => { throw error; }, point, { quiet: true });
  assert.equal((await task.done).error, error);
  assert.equal(pending.length, 0);
  assert.equal(state().past.length, 0);
  assert.equal(useDialogs.getState().queue.length, 0);
});

function deepDropTarget(depth: number) {
  const doc = fixture();
  for (let i = 1; i <= depth; i++) {
    const id = `deep-${i}`;
    doc.nodes[id] = { ...makeBox(), id, children: i < depth ? [`deep-${i + 1}`] : [] };
  }
  doc.pages.p.children = ["deep-1"];
  state().replaceDoc(doc);
  return { parent: { kind: "node" as const, id: `deep-${depth}` } };
}

test("image drops reject an already maximal-depth destination before upload", async () => {
  const target = deepDropTarget(256);
  const before = state().doc;
  const task = await begin(["too-deep.png"], target);
  assert.equal(pending.length, 0);
  await task.done;
  assert.equal(state().doc, before);
});

test("image drops preserve exact-depth placement and undo", async () => {
  const target = deepDropTarget(255);
  const before = state().doc;
  const task = await begin(["valid.png"], target);
  pending[0]();
  await task.done;
  assert.equal(state().doc.nodes[target.parent.id].children.length, 1);
  state().undo();
  assert.deepEqual(state().doc, before);
});

test("a destination deepened during upload retains the asset without inserting an invalid tree", async () => {
  const target = deepDropTarget(255);
  const task = await begin(["pending.png"], target);
  state().updateDoc(doc => {
    doc.nodes.wrapper = { ...makeBox(), id: "wrapper", children: ["deep-1"] };
    doc.pages.p.children = ["wrapper"];
  });
  const before = withoutAssets(state().doc);
  pending[0]();
  const result = await task.done;
  assert.equal(result?.inserted, false);
  assert.deepEqual(withoutAssets(state().doc), before);
  assert.equal(Object.keys(state().doc.assets).length, 1);
});
});

describe("image-source-commit", () => {
  before(() => {
    useEditor_7.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const require = createRequire(resolve_11("components/SettingsPanel.tsx"));
const mod = { exports: {} as any };
const source = transformSync(readFileSync("components/SettingsPanel.tsx", "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
new Function("require", "module", "exports", source)((id: string) => {
  if (id === "react") return { ...React, useState: (value: unknown) => [value, () => {}] };
  if (id === "../lib/store") return { ...require(id), useEditor: Object.assign((select: any) => select(useEditor_7.getState()), useEditor_7) };
  return require(id);
}, mod, mod.exports);
const findSource = (tree: any): any => {
  if (!tree || typeof tree !== "object") return undefined;
  if (String(tree.key).includes("-src-")) return tree;
  for (const child of React.Children.toArray(tree.props?.children)) {
    const found = findSource(child);
    if (found) return found;
  }
};
for (const asset of [false, true]) test(`image source ${asset ? "preserves an untouched asset placeholder" : "can be cleared with undo and redo"}`, () => {
  const doc = createInitialDoc();
  const image = { src: asset ? "/api/assets/file?path=image" : "https://example.test/image.png", alt: "Keep alt", width: 40, height: 30,
    ...(asset ? { assetId: "image", assetSuffix: "#view" } : {}) };
  const node = { ...makeBox(), id: "image", type: "image" as const, image };
  doc.nodes.image = node;
  doc.pages[doc.pageOrder[0]].children = [node.id];
  useEditor_7.getState().replaceDoc(doc);
  const field = findSource(mod.exports.default({ nodeId: "image" }));
  assert.ok(field);
  assert.equal(field.type, VarInput);
  field.props.onCommit("  ");
  if (asset) {
    assert.deepEqual(useEditor_7.getState().doc.nodes.image.image, image);
    assert.equal(useEditor_7.getState().past.length, 0);
  } else {
    assert.deepEqual(useEditor_7.getState().doc.nodes.image.image, { ...image, src: "", assetId: undefined, assetSuffix: undefined });
    useEditor_7.getState().undo();
    assert.deepEqual(useEditor_7.getState().doc.nodes.image.image, image);
    useEditor_7.getState().redo();
    assert.equal(useEditor_7.getState().doc.nodes.image.image?.src, "");
  }
});
});

describe("layers-visible", () => {
test("visible layers preserve preorder, depth, and page-root semantics", () => {
  const doc = canvasMoveDoc();
  doc.pages.p.children = ["a", "c"];
  doc.nodes.a.children = ["b"];
  const rows = visibleLayerRows(doc, doc.pages.p.children, new Set(), 1, true);
  assert.deepEqual(rows, [
    { id: "a", depth: 1, isTop: true },
    { id: "b", depth: 2, isTop: false },
    { id: "c", depth: 1, isTop: true },
  ]);
  assert.deepEqual(visibleLayerRows(doc, ["a"], new Set(), 0, false), [
    { id: "a", depth: 0, isTop: false },
    { id: "b", depth: 1, isTop: false },
  ]);
  assert.deepEqual(visibleLayerRows(doc, ["a", "c"], new Set(["a"]), 1, true).map((r) => r.id), ["a", "c"]);
});

test("visible layer traversal ignores missing nodes and corrupt cycles", () => {
  const doc = canvasMoveDoc();
  doc.nodes.a.children = ["b", "missing"];
  doc.nodes.b.children = ["a"];
  assert.deepEqual(visibleLayerRows(doc, ["a"], new Set(), 1, true).map((r) => r.id), ["a", "b"]);
});

test("viewport window is bounded and aligned to the fixed row height", () => {
  assert.deepEqual(layerWindow(0, 0, 600), { start: 0, end: 0 });
  assert.deepEqual(layerWindow(10000, 2800, 560), { start: 92, end: 128 });
  assert.deepEqual(layerWindow(10000, 0, 560), { start: 0, end: 28 });
  assert.deepEqual(layerWindow(10000, 9999 * LAYER_ROW_HEIGHT, 560), { start: 9991, end: 10000 });
  assert.deepEqual(layerWindow(10, -100, 560), { start: 0, end: 10 });
});

test("12,000 deeply nested elements traverse without recursion or mounting 12,000 rows", () => {
  const doc = canvasMoveDoc();
  const base = doc.nodes.a;
  const count = 12000;
  doc.nodes = Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const id = `n${i}`;
    return [id, { ...base, id, children: i + 1 < count ? [`n${i + 1}`] : [] }];
  }));
  const rows = visibleLayerRows(doc, ["n0"], new Set(), 0, false);
  assert.equal(rows.length, count);
  assert.equal(rows.at(-1)?.depth, count - 1);
  const range = layerWindow(rows.length, 10000 * LAYER_ROW_HEIGHT, 448);
  assert.ok(range.end - range.start <= 32);
});
});

describe("media-asset-suffix", () => {
function fixture() {
  const doc = createInitialDoc();
  const node = makeMedia("video");
  node.media = { kind: "video", src: "", assetId: "movie", assetSuffix: "?v=a%26b#t=3,7",
    sources: [{ src: "", assetId: "movie", assetSuffix: "#t=1", type: "video/mp4", media: "(min-width: 1px)" }] };
  doc.assets.movie = { id: "movie", name: "movie.mp4", mimeType: "video/mp4", dataUrl: "data:video/mp4;base64,AQID", width: 1, height: 1 };
  doc.nodes[node.id] = node;
  doc.pages[doc.pageOrder[0]].children = [node.id];
  return { doc, node };
}

test("media asset suffixes preserve bytes without replacing the resource URL", () => {
  const suffix = "?v=a%26b&lang=ja#t=3,7";
  assert.equal(assetMediaUrl("/assets/movie.mp4", suffix), "/assets/movie.mp4" + suffix);
  assert.equal(assetMediaUrl("/api/assets/file?path=movie", suffix), "/api/assets/file?path=movie&v=a%26b&lang=ja#t=3,7");
  assert.equal(assetMediaUrl("data:video/mp4;base64,AQID", suffix), "data:video/mp4;base64,AQID#t=3,7");
  assert.equal(assetMediaUrl("", suffix), "");
  for (const invalid of ["javascript:alert(1)", "//evil.test/", "file.mp4", "#a\nb", "?a\u0000", {}, 123]) {
    assert.equal(validAssetSuffix(invalid), false);
    assert.equal(assetMediaUrl("/assets/movie.mp4", invalid), "/assets/movie.mp4");
  }
  assert.equal(safeResourceUrl("data:video/mp4;base64,AQID#t=3,7"), "data:video/mp4;base64,AQID#t=3,7");
  assert.equal(safeResourceUrl("data:text/html;base64,AQID#t=3,7"), "#");
  assert.equal(safeResourceUrl("data:video/mp4;base64,AQID#t=3\n7"), "#");
  assert.equal(safeMediaUrl("https://example.com/{name}/\\{name}/%7Bname%7D"), "https://example.com/{name}/\\{name}/%7Bname%7D");
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "https:\\evil.test/x", "https://good.test\\@evil.test/x", "https://good.test/\nx", "/\\evil.test/x", "data:text/html;base64,AQID"]) {
    assert.equal(safeMediaUrl(bad), "#");
  }
});

test("native source suffixes survive persistence and storage relocation", () => {
  const { doc, node } = fixture();
  assert.equal(validSiteDoc(doc), true);
  assert.deepEqual(validateImportedDoc(JSON.parse(JSON.stringify(doc))), doc);
  assert.equal(mediaSrc(doc, node.media!), "data:video/mp4;base64,AQID#t=3,7");
  replaceEmbeddedAsset(doc, "movie", "assets/restored.mp4");
  assert.equal(mediaSrc(doc, node.media!), "/api/assets/file?path=assets%2Frestored.mp4&v=a%26b#t=3,7");
  assert.equal(mediaSrc(doc, node.media!.sources![0]), "/api/assets/file?path=assets%2Frestored.mp4#t=1");
  assert.equal(validSiteDoc(doc), true);
});

test("import and persistence reject malformed suffixes and dangling source assets", () => {
  for (const change of [
    (m: any) => { m.assetSuffix = "javascript:alert(1)"; },
    (m: any) => { delete m.assetId; },
    (m: any) => { m.sources[0].assetSuffix = "#bad\nfragment"; },
    (m: any) => { m.sources[0].assetId = "missing"; },
    (m: any) => { m.sources[0].type = {}; },
    (m: any) => { m.sources = {}; },
  ]) {
    const { doc, node } = fixture();
    change(node.media);
    assert.equal(validSiteDoc(doc), false);
    assert.throws(() => validateImportedDoc(doc));
  }
});


test("source alternatives relocate on restore and participate in publication checks and copying", async () => {
  const { rebindImportedAssetUrls } = await import("../lib/imported-asset-urls");
  const { runChecks } = await import("../lib/generator/checks");
  const { buildClipPayload, remapAssetIds } = await import("../lib/clip-transfer");
  const { doc, node } = fixture();
  node.media!.assetId = undefined;
  node.media!.assetSuffix = undefined;
  node.media!.sources!.push({ src: "data:video/mp4;base64,AQID#t=9" });
  const original = structuredClone(doc);
  doc.assets.movie.path = "assets/restored.mp4";
  delete doc.assets.movie.dataUrl;
  rebindImportedAssetUrls(original, doc);
  assert.equal(node.media!.sources![1].src, "/api/assets/file?path=assets%2Frestored.mp4#t=9");
  const payload = buildClipPayload(doc, { nodes: [node], rootIds: [node.id] });
  assert.ok(payload.assets!.movie);
  const moved = remapAssetIds(node, new Map([["movie", "copy-movie"]]));
  assert.equal(moved.media!.sources![0].assetId, "copy-movie");
  assert.equal(moved.media!.sources![0].assetSuffix, "#t=1");
  delete doc.assets.movie;
  assert.ok(runChecks(doc).some(check => check.level === "error" && check.help === "img-add"));
});
});

describe("media-source-commit", () => {
  before(() => {
    useEditor_8.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const require = createRequire(resolve_12("components/SettingsPanel.tsx"));
const mod = { exports: {} as any };
const source = transformSync(readFileSync("components/SettingsPanel.tsx", "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
new Function("require", "module", "exports", source)((id: string) => {
  if (id === "react") return { ...React, useState: (value: unknown) => [value, () => {}] };
  if (id === "../lib/store") return { ...require(id), useEditor: Object.assign((select: any) => select(useEditor_8.getState()), useEditor_8) };
  return require(id);
}, mod, mod.exports);
const findSource = (tree: any): any => {
  if (!tree || typeof tree !== "object") return undefined;
  if (String(tree.key).includes("-msrc-")) return tree;
  for (const child of React.Children.toArray(tree.props?.children)) {
    const found = findSource(child);
    if (found) return found;
  }
};
for (const kind of ["video", "audio"] as const) test(`${kind} source only commits deliberate edits and supports undo`, () => {
  const doc = createInitialDoc();
  const node = { ...makeBox(), id: "media", type: "media" as const, media: { kind, src: "/api/assets/file?path=movie", assetId: "movie", assetSuffix: "#t=4", sources: [{src:"alternative.mp4"}], loop: true } };
  doc.nodes.media = node;
  doc.pages[doc.pageOrder[0]].children = [node.id];
  useEditor_8.getState().replaceDoc(doc);
  const field = findSource(mod.exports.default({ nodeId: "media" }));
  assert.ok(field);
  // CommitInput については、操作していないときの blur、外からの更新、履歴の再生を、commit-fields.test.mts で確かめる。
  field.props.onBlur?.({ target: { value: "" } });
  assert.deepEqual(useEditor_8.getState().doc.nodes.media.media, node.media, "untouched empty asset placeholder must preserve the selected asset");
  assert.equal(field.type, CommitInput);
  assert.equal(field.props.value, "");
  assert.equal(field.props.onBlur, undefined, "no unconditional blur write can detach the asset");
  field.props.onCommit(" https://example.test/media ");
  assert.deepEqual(useEditor_8.getState().doc.nodes.media.media, { kind, src: "https://example.test/media", assetId: undefined, assetSuffix: undefined, sources: undefined, loop: true });
  useEditor_8.getState().undo();
  assert.deepEqual(useEditor_8.getState().doc.nodes.media.media, node.media);
  useEditor_8.getState().redo();
  const changed = findSource(mod.exports.default({ nodeId: "media" }));
  assert.equal(changed.props.value, "https://example.test/media");
  changed.props.onCommit("");
  assert.equal(useEditor_8.getState().doc.nodes.media.media?.src, "");
});
});

describe("panel-resize", () => {
function pointer(type: string, id = 1, x = 10, buttons = 1) {
  return Object.assign(new Event(type), { pointerId: id, clientX: x, buttons }) as PointerEvent;
}

function fixture() {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const classes = new Set<string>();
  const body = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
  };
  Object.assign(documentEvents, { body, visibilityState: "visible" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowEvents });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentEvents });
  const makeTarget = () => Object.assign(new EventTarget(), {
    captured: new Set<number>(),
    setPointerCapture(id: number) { this.captured.add(id); },
    hasPointerCapture(id: number) { return this.captured.has(id); },
    releasePointerCapture(id: number) {
      this.captured.delete(id);
      this.dispatchEvent(pointer("lostpointercapture", id, 0, 0));
    },
  });
  const target = makeTarget();
  const widths: number[] = [], finishes: number[] = [];
  const releasedWidths: (number | null)[] = [];
  const start = (id = 1, element = target, initialWidth = 280, dir: 1 | -1 = 1) =>
    trackPanelResize(pointer("pointerdown", id, 10), element as unknown as HTMLElement,
      initialWidth, dir, (width) => widths.push(width), (releasedWidth) => {
        finishes.push(id);
        releasedWidths.push(releasedWidth);
      });
  const move = (id = 1, x = 50, buttons = 1) =>
    windowEvents.dispatchEvent(pointer("pointermove", id, x, buttons));
  const release = (type = "pointerup", id = 1) =>
    windowEvents.dispatchEvent(pointer(type, id, 50, 0));
  const restore = () => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  };
  return { windowEvents, documentEvents, body, classes, target, makeTarget, widths, finishes, releasedWidths, start, move, release, restore };
}

test("panel resize only follows its own pointer and stops after release", () => {
  const f = fixture();
  try {
    f.start();
    assert.ok(f.body.classList.contains("is-resizing-panel"));
    f.move(2, 999);
    f.release("pointercancel", 2);
    f.release("pointerup", 2);
    f.target.dispatchEvent(pointer("lostpointercapture", 2));
    assert.deepEqual(f.widths, []);
    assert.deepEqual(f.finishes, []);
    f.move(1, 60);
    assert.deepEqual(f.widths, [330]);
    f.release();
    f.move(1, 120);
    f.release();
    assert.deepEqual(f.widths, [330]);
    assert.deepEqual(f.finishes, [1]);
    assert.deepEqual(f.releasedWidths, [320]);
    assert.equal(f.target.captured.size, 0);
    assert.equal(f.body.classList.contains("is-resizing-panel"), false);
  } finally { f.restore(); }
});

for (const end of ["pointercancel", "blur", "hidden", "released-outside", "capture-loss", "unmount"] as const) {
  test(`panel resize ${end} cleans up and permits subsequent edits`, () => {
    const f = fixture();
    try {
      const dispose = f.start();
      f.move(1, 45);
      assert.deepEqual(f.widths, [315]);
      if (end === "pointercancel") f.release("pointercancel");
      if (end === "blur") f.windowEvents.dispatchEvent(new Event("blur"));
      if (end === "hidden") {
        (f.documentEvents as any).visibilityState = "hidden";
        f.documentEvents.dispatchEvent(new Event("visibilitychange"));
      }
      if (end === "released-outside") f.move(1, 120, 0);
      if (end === "capture-loss") f.target.releasePointerCapture(1);
      if (end === "unmount") dispose();
      f.move(1, 150);
      f.release();
      dispose();
      assert.deepEqual(f.widths, [315]);
      assert.deepEqual(f.finishes, [1]);
      assert.deepEqual(f.releasedWidths, [null]);
      assert.equal(f.target.captured.size, 0);
      assert.equal(f.body.classList.contains("is-resizing-panel"), false);
      (f.documentEvents as any).visibilityState = "visible";
      const again = f.start();
      f.move(1, 55);
      f.release();
      assert.deepEqual(f.widths, [315, 325]);
      assert.deepEqual(f.finishes, [1, 1]);
      again();
    } finally { f.restore(); }
  });
}

test("simultaneous panel drags keep the shared resize cursor until both end", () => {
  const f = fixture();
  try {
    const right = f.makeTarget();
    const leftStop = f.start(1);
    const rightStop = f.start(2, right, 300, -1);
    assert.equal(f.body.classList.contains("is-resizing-panel"), true);
    f.move(1, 40);
    f.move(2, 20);
    assert.deepEqual(f.widths, [310, 290]);
    f.release("pointercancel", 1);
    assert.equal(f.body.classList.contains("is-resizing-panel"), true);
    f.move(2, 30);
    f.release("pointerup", 2);
    assert.deepEqual(f.widths, [310, 290, 280]);
    assert.equal(f.body.classList.contains("is-resizing-panel"), false);
    assert.deepEqual(f.finishes, [1, 2]);
    leftStop(); rightStop();
  } finally { f.restore(); }
});
});

describe("srcset", () => {
const urls = new Map([
  ["photo,wide.png", "/assets/wide.png"], ["small.png", "/assets/small.png"],
  ["large.png", "/assets/large.png"], ["space\u00a0name.png", "/assets/nbsp.png"],
]);
const rewrite = (value: string) => rewriteSrcsetUrls(value, url => resolveZipReference(url, "index.html", urls));

test("srcset URLs retain internal commas and inline data while archive paths are rewritten", () => {
  const data = "data:image/svg+xml,%3Csvg%3E,%3C/svg%3E";
  assert.equal(rewrite(`${data} 1x, photo,wide.png 2x`), `${data} 1x, /assets/wide.png 2x`);
  assert.equal(rewrite("photo,wide.png 320w, large.png 640w"), "/assets/wide.png 320w, /assets/large.png 640w");
  assert.equal(rewrite("photo%2Cwide.png?rev=1#paint 2x"), "/assets/wide.png?rev=1#paint 2x");
});

test("srcset rewriting retains original whitespace, separators and descriptor text", () => {
  assert.equal(rewrite(" \t,small.png,\n large.png\t2x,  "), " \t,/assets/small.png,\n /assets/large.png\t2x,  ");
  assert.equal(rewrite("small.png 100w 50h,large.png 200w 100h"), "/assets/small.png 100w 50h,/assets/large.png 200w 100h");
  assert.equal(rewrite("small.png invalid(foo,bar) 2x, large.png 3x"), "/assets/small.png invalid(foo,bar) 2x, /assets/large.png 3x");
  assert.equal(rewrite("space\u00a0name.png 1x"), "/assets/nbsp.png 1x");
});

test("srcset rewriting does not reinterpret missing or external candidates", () => {
  for (const value of ["", " , \n,,", "data:image/png;base64,AAAA", "https://example.test/a,b.png 2x, missing.png 3x", "small.png,large.png", "small.png bad(unclosed,large.png 2x"]) {
    const expected = value.startsWith("small.png bad") ? value.replace("small.png", "/assets/small.png") : value;
    assert.equal(rewrite(value), expected);
  }
});

test("the HTML ZIP rewrite applies candidate parsing to img and source without changing data URLs", () => {
  const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  // 実際のブラウザでの解析は、ネイティブの回帰テストで確かめる。この代わりの部品で、取り込みの処理を手元で動かす。
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: class {
    parseFromString(html: string) {
      const root = parse(html);
      return { querySelectorAll: (selector: string) => root.querySelectorAll(selector), documentElement: root.querySelector("html") };
    }
  } });
  try {
    const value = "data:image/png;base64,AAAA 1x, photo,wide.png 2x";
    const output = rewriteZipReferences(`<html><body><picture><source srcset="${value}"><img srcset="${value}"></picture></body></html>`, "index.html", urls);
    const elements = parse(output.html).querySelectorAll("[srcset]");
    assert.equal(elements.length, 2);
    for (const element of elements) {
      assert.equal(element.getAttribute("srcset"), "data:image/png;base64,AAAA 1x, /assets/wide.png 2x");
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  }
});
});

describe("svg-effects", () => {
const filter = (primitive: string, markup = '<rect filter="url(#shadow)" />') =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">' +
  '<defs><filter id="shadow">' + primitive + '</filter></defs>' + markup + '</svg>';

const cases: [string, string, boolean][] = [
  ["used gaussian blur", filter('<feGaussianBlur stdDeviation="3"/>'), true],
  ["gaussian blur with one nonzero axis", filter('<feGaussianBlur stdDeviation="0 3"/>'), true],
  ["zero gaussian blur", filter('<feGaussianBlur stdDeviation="0"/>'), false],
  ["used drop shadow", filter('<feDropShadow dx="2" dy="3" stdDeviation="2"/>'), true],
  ["color transform only", filter('<feColorMatrix type="saturate" values="0.5"/>'), false],
  ["unused blur filter", filter('<feGaussianBlur stdDeviation="3"/>', "<rect width='40'/>"), false],
  ["missing reference", filter('<feGaussianBlur stdDeviation="3"/>', '<rect filter="url(#missing)"/>'), false],
  ["commented filter", '<svg><!-- <filter id="shadow"><feGaussianBlur stdDeviation="3"/></filter> --><rect/></svg>', false],
  ["css inline url", filter('<feGaussianBlur stdDeviation="3"/>', '<rect style="filter: url( #shadow )"/>'), true],
  ["css inline quoted url", filter('<feGaussianBlur stdDeviation="3"/>', "<rect style=\"filter: url('#shadow')\"/>"), true],
  ["css drop-shadow function", '<svg><rect style="filter: drop-shadow(2px 3px 2px #000)"/></svg>', true],
  ["css blur function", '<svg><rect style="filter: blur(2px)"/></svg>', true],
  ["zero css blur", '<svg><rect style="filter: blur(0px)"/></svg>', false],
  ["css colors only", '<svg><rect style="filter: saturate(2) brightness(0.5)"/></svg>', false],
  ["defined but unused css selector", filter('<feGaussianBlur stdDeviation="3"/>', '<style>.missing { filter: url(#shadow); }</style><rect class="present"/>'), false],
  ["matching css class selector", filter('<feGaussianBlur stdDeviation="3"/>', '<style>.present { filter: url(#shadow); }</style><rect class="present"/>'), true],
  ["matching css descendant selector", filter('<feGaussianBlur stdDeviation="3"/>', '<style>g .present { filter: url(#shadow); }</style><g><rect class="present"/></g>'), true],
  ["css comment ignored", '<svg><style>/* .present { filter: drop-shadow(1px 1px 3px red); } */</style><rect class="present"/></svg>', false],
  ["presentation filter overridden with none", filter('<feGaussianBlur stdDeviation="3"/>', '<rect filter="url(#shadow)" style="filter:none"/>'), false],
  ["unused definition containing filtered shapes", filter('<feGaussianBlur stdDeviation="3"/>', '<defs><g filter="url(#shadow)" id="unused"><rect/></g></defs><rect/>'), false],
  ["referenced definition with shadow", filter('<feGaussianBlur stdDeviation="3"/>', '<defs><g filter="url(#shadow)" id="shape"><rect/></g></defs><use href="#shape"/>'), true],
  ["inherited SVG filter", '<svg><defs><filter id="base"><feGaussianBlur stdDeviation="2"/></filter><filter id="second" href="#base"/></defs><rect filter="url(#second)"/></svg>', true],
  ["unreferenced CSS shadow", '<svg><defs><filter id="s"><feGaussianBlur stdDeviation="2"/></filter></defs><rect/></svg>', false],
];
for (const [label, svg, expected] of cases) {
  test("SVG effect detection: " + label, () => {
    assert.equal(svgUsesBlurOrShadow(svg), expected);
  });
}

test("saved flags do not override SVG content on publication", async () => {
  const source = filter('<feColorMatrix type="saturate" values="0.5"/>');
  const old: Asset = {
    id: "old", name: "color.svg", mimeType: "image/svg+xml",
    width: 120, height: 40, svgFilter: true,
    dataUrl: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source),
  };
  const result = await detectSvgFilters({ old });
  assert.deepEqual(result.old, { svgFilter: false });
  assert.deepEqual(await detectSvgFilters({ old: { ...old, ...result.old } }), result);
});

test("the effect scan also detects CSS blur missed by the old filter-tag check", async () => {
  const asset: Asset = {
    id: "css", name: "css.svg", mimeType: "image/svg+xml", width: 30, height: 20, svgFilter: false,
    dataUrl: "data:image/svg+xml," + encodeURIComponent('<svg><rect style="filter:blur(2px)"/></svg>'),
  };
  assert.deepEqual((await detectSvgFilters({ css: asset })).css, { svgFilter: true });
});

test("the per-image override can force crisp rendering on or off", () => {
  const asset: Asset = { id: "s", name: "s.svg", mimeType: "image/svg+xml", width: 120, height: 40, svgFilter: false };
  const doc = { assets: { s: asset } } as SiteDoc;
  const node = { type: "image", image: { assetId: "s", width: 120, height: 40, src: "", alt: "" } } as DocNode;
  assert.equal(crispSvgSize(doc, node), null);
  node.image!.crispShadow = true;
  assert.deepEqual(crispSvgSize(doc, node), { width: 120, height: 40 });
  node.image!.crispShadow = false;
  asset.svgFilter = true;
  assert.equal(crispSvgSize(doc, node), null);
  node.image!.crispShadow = true;
  asset.mimeType = "image/png";
  asset.name = "s.png";
  assert.equal(crispSvgSize(doc, node), null);
});


test("remote SVGs are fetched once for repeated exports, duplicate aliases, and unchanged assets", async () => {
  const svg = filter('<feGaussianBlur stdDeviation="2"/>');
  const asset: Asset = {
    id: "cached-one", name: "cached.svg", mimeType: "image/svg+xml", width: 120, height: 40,
    // The saved flag is intentionally outdated; the first scan must replace it.
    svgFilter: false, path: "assets/svg-effect-cache-20261112-a.svg",
  };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.includes("assets%2Fsvg-effect-cache-20261112-")) throw Error("Unexpected fetch: " + url);
    requests += 1;
    return new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml" } });
  };
  try {
    const alias = { ...asset, id: "cached-two" };
    const [first, second] = await Promise.all([
      detectSvgFilters({ a: asset, b: alias }),
      detectSvgFilters({ a: asset }),
    ]);
    assert.equal(first["cached-one"].svgFilter, true);
    assert.equal(first["cached-two"].svgFilter, true);
    assert.equal(second["cached-one"].svgFilter, true);
    assert.equal(requests, 1, "Concurrent aliases must share one remote download");

    const another = await detectSvgFilters({ a: asset });
    assert.equal(another["cached-one"].svgFilter, true);
    assert.equal(requests, 1, "Repeated exports must use the cached analysis");

    const changedPath = { ...asset, path: "assets/svg-effect-cache-20261112-b.svg" };
    await detectSvgFilters({ a: changedPath });
    assert.equal(requests, 2, "A replaced asset with a new path must be scanned");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analysis seeded by the SVG upload is reused without downloading its new path", async () => {
  const path = "assets/svg-effect-cache-20261112-precomputed.svg";
  cacheSvgEffect(path, { svgFilter: true, width: 90, height: 30 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("An uploaded SVG must not be fetched again"); };
  try {
    const asset: Asset = { id: "precomputed", path, name: "precomputed.svg", mimeType: "image/svg+xml", width: 0, height: 0 };
    const result = await detectSvgFilters({ precomputed: asset });
    assert.deepEqual(result.precomputed, { svgFilter: true, width: 90, height: 30 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed SVG downloads are not cached and are retried on the next export", async () => {
  const asset: Asset = { id: "retry", path: "assets/svg-effect-cache-20261112-retry.svg", name: "retry.svg",
    mimeType: "image/svg+xml", width: 90, height: 30 };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(calls === 1 ? "missing" : '<svg><rect style="filter:blur(2px)"/></svg>', { status: calls === 1 ? 404 : 200 });
  };
  try {
    assert.deepEqual(await detectSvgFilters({ retry: asset }), {});
    assert.deepEqual((await detectSvgFilters({ retry: asset })).retry, { svgFilter: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
});

describe("text-style-confirmation", () => {
  before(() => {
    useEditor_9.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor_9.getState();
const selected = () => ({ nodeId: "a", start: 5, end: 9, text: "echo" });
function fixture() {
  state().replaceDoc(textStyleConfirmationDoc());
  state().setActivePage("p"); state().setMode("design"); state().setBreakpoint("base");
  state().select("a"); state().setRightTab("style"); state().setTextSel(selected());
  const ui = importCallbacks("style");
  const render = () => ui.render({ nodeId: state().selection ?? "a" });
  const change = (props = { fontStyle: "italic" }) => render().props.value.set(props);
  return { ui, render, change };
}
const snapshot = () => {
  const { doc, past, future, selection, selectedIds, textSel } = state();
  return structuredClone({ doc, past, future, selection, selectedIds, textSel });
};
async function resolve(f: ReturnType<typeof fixture>, ok: boolean, index = 0) {
  f.ui.confirmations[index].resolve(ok);
  await Promise.resolve();
}

for (const ok of [true, false]) {
  for (const interruption of [
    "remote-text", "remote-move-match", "remote-unrelated", "local-text", "children", "delete",
    "undo", "undo-redo", "replace", "restore", "page", "page-return", "selection", "selection-return",
    "breakpoint", "breakpoint-return", "state", "state-return", "new-range", "unmount",
  ]) test(`${ok ? "split" : "whole-text"} approval ignores obsolete ${interruption}`, async () => {
    const f = fixture();
    try {
      // 「元に戻す」の前後で本文が同じでも、前の確認を復活させない。
      state().updateNode("a", { name: "Undo this" });
      f.change();
      assert.equal(f.ui.confirmations.length, 1);
      if (interruption.startsWith("remote")) {
        const remote = structuredClone(state().doc);
        if (interruption === "remote-text") remote.nodes.a.text!.content = "echo gone";
        if (interruption === "remote-move-match") remote.nodes.a.text!.content = "new echo echo";
        if (interruption === "remote-unrelated") remote.nodes.b.name = "Collaborator renamed this";
        state().applyRemoteDoc(remote);
      }
      if (interruption === "local-text") state().updateNode("a", { text: { content: "echo gone", heading: 0 } });
      if (interruption === "children") state().updateDoc(d => {
        d.nodes.child = { ...makeText("Keep this child"), id: "child", semantic: "span" };
        d.nodes.a.children = ["child"];
      });
      if (interruption === "delete") state().deleteNodes(["a"]);
      if (interruption.startsWith("undo")) state().undo();
      if (interruption === "undo-redo") state().redo();
      if (interruption === "replace") state().replaceDoc(structuredClone(state().doc));
      if (interruption === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
      if (interruption.startsWith("page")) state().setActivePage("q");
      if (interruption === "page-return") { f.render(); state().setActivePage("p"); state().select("a"); }
      if (interruption.startsWith("selection")) state().select("b");
      if (interruption === "selection-return") { f.render(); state().select("a"); }
      if (interruption.startsWith("breakpoint")) state().setBreakpoint("sm");
      if (interruption === "breakpoint-return") { f.render(); state().setBreakpoint("base"); }
      if (interruption.startsWith("state")) state().setStyleState("hover");
      if (interruption === "state-return") { f.render(); state().setStyleState("default"); }
      if (interruption === "new-range") state().setTextSel({ nodeId: "a", start: 0, end: 4, text: "echo" });
      if (interruption === "unmount") f.ui.unmount();
      const before = snapshot();
      // 最新のストアを確かめるため、上の一部は再描画の前に解決する。
      await resolve(f, ok);
      assert.deepEqual(snapshot(), before);
    } finally { f.ui.unmount(); }
  });

  test(`${ok ? "split" : "whole-text"} approval preserves unrelated local edits and one undo step`, async () => {
    const f = fixture();
    try {
      f.change();
      state().updateDoc(d => {
        d.nodes.a.name = "Renamed while waiting";
        d.nodes.a.styles.base!.default!.padding = "8px";
        d.nodes.b.text!.content = "Other updated text";
      });
      f.render();
      const before = structuredClone(state().doc);
      const past = state().past.length;
      await resolve(f, ok);
      const after = structuredClone(state().doc);
      assert.equal(after.nodes.a.name, before.nodes.a.name);
      assert.equal(after.nodes.a.styles.base!.default!.padding, "8px");
      assert.deepEqual(after.nodes.b, before.nodes.b);
      if (ok) {
        const parts = after.nodes.a.children.map(id => after.nodes[id]);
        assert.deepEqual(parts.map(n => n.text!.content), ["echo ", "echo"]);
        assert.deepEqual(parts.map(n => n.styles.base?.default?.fontStyle), [undefined, "italic"]);
        assert.equal(after.nodes.a.styles.base!.default!.fontStyle, undefined);
      } else {
        assert.equal(after.nodes.a.text!.content, "echo echo");
        assert.deepEqual(after.nodes.a.children, []);
        assert.equal(after.nodes.a.styles.base!.default!.fontStyle, "italic");
      }
      assert.equal(state().past.length, past + 1);
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); assert.deepEqual(state().doc, after);
    } finally { f.ui.unmount(); }
  });
}

test("a new formatting request supersedes an older pending confirmation", async () => {
  const f = fixture();
  try {
    f.change(); f.change({ fontStyle: "oblique" });
    const before = snapshot();
    await resolve(f, true, 0);
    assert.deepEqual(snapshot(), before);
    await resolve(f, true, 1);
    assert.equal(state().doc.nodes[state().selection!].styles.base!.default!.fontStyle, "oblique");
    assert.equal(state().past.length, 1);
  } finally { f.ui.unmount(); }
});

test("a failed split never falls back to styling the whole text", async () => {
  const f = fixture();
  try {
    state().setTextSel({ nodeId: "a", start: 5, end: 9, text: "missing" });
    f.change();
    const before = snapshot();
    await resolve(f, true);
    assert.deepEqual(snapshot(), before);
  } finally { f.ui.unmount(); }
});

for (const [content, start, end, text] of [
  ["echo gone", 5, 9, "echo"], ["new echo echo", 5, 9, "echo"], ["echo echo", -4, 9, "echo"],
  ["echo echo", 5, 20, "echo"], ["echo echo", 0, 9, "echo echo"], ["echo echo", 0, 0, ""],
] as const) test(`the store refuses invalid split ${JSON.stringify([content, start, end, text])}`, () => {
  const f = fixture();
  try {
    state().updateNode("a", { text: { content, heading: 0 } });
    const before = snapshot();
    assert.equal(state().splitTextSpan("a", start, end, text, { fontStyle: "italic" }), null);
    assert.deepEqual(snapshot(), before);
  } finally { f.ui.unmount(); }
});

test("an identical selection notification does not invalidate an unchanged request", async () => {
  const f = fixture();
  try {
    f.change(); state().setTextSel(selected()); f.render();
    await resolve(f, true);
    const parts = state().doc.nodes.a.children.map(id => state().doc.nodes[id]);
    assert.deepEqual(parts.map(n => n.text!.content), ["echo ", "echo"]);
    assert.equal(parts[1].styles.base!.default!.fontStyle, "italic");
  } finally { f.ui.unmount(); }
});
});

describe("typography-clamp-transition", () => {
function renderTypography(node: any, bp = "sm", state = "default") {
  const writes: any[] = [];
  const doc = { nodes: { [node.id]: node }, pages: {}, pageOrder: [] };
  const path = resolve_13("components/style-panel/TypographySec.tsx");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
    if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }), findParentOf: () => null, ancestorsOf: () => [] };
    if (id === "../controls") return {
      useInspector: () => ({ get: (p: string) => getProp(node, bp as any, state as any, p), cleared: (p: string) => clearedValue(node, bp as any, state as any, p),
        set: (v: any) => writes.push(v) }),
      Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect", PropNum: "PropNum", PropSeg: "PropSeg", PropFill: "PropFill", Seg: "Seg",
    };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
  return { fields: flatten(mod.exports.TypographySec({ node })), writes };
}


const baseClamp = { WebkitLineClamp: "2", WebkitBoxOrient: "vertical", display: "-webkit-box", overflow: "hidden" };
for (const mode of ["wrap", "nowrap"]) test(`inherited line clamp can switch to ${mode}`, () => {
  const node = { ...makeText(), styles: { base: { default: baseClamp } } };
  const view = renderTypography(node);
  view.fields.find(e => e.type === "Seg" && e.props.value === "clamp").props.onChange(mode);
  const patch = view.writes.at(-1);
  const actual = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null));
  const next = { ...node, styles: { ...node.styles, sm: { default: actual } } };
  const resolved = resolveStyles(next as any, "sm", "default");
  assert.equal(resolved.WebkitLineClamp, "none");
  assert.notEqual(resolved.display, "-webkit-box");
  assert.notEqual(resolved.overflow, "hidden");
  assert.equal(renderTypography(next).fields.find(e => e.type === "Seg" && e.props.options.some((o: any) => o.value === "clamp")).props.value, mode);
});
test("base clamp to nowrap removes the layout and overflow added by clamping", () => {
  const node = { ...makeText(), styles: { base: { default: baseClamp } } };
  const view = renderTypography(node, "base");
  view.fields.find(e => e.type === "Seg" && e.props.value === "clamp").props.onChange("nowrap");
  assert.equal(view.writes.at(-1).display, null);
  assert.equal(view.writes.at(-1).overflow, null);
});
test("ordinary wrapping changes do not erase unrelated layout and overflow", () => {
  const node = { ...makeText(), styles: { base: { default: { display: "grid", overflow: "auto" } } } };
  for (const mode of ["wrap", "nowrap"]) {
    const view = renderTypography(node, "base");
    view.fields.find(e => e.type === "Seg" && e.props.options.some((o: any) => o.value === "clamp")).props.onChange(mode);
    assert.equal(Object.hasOwn(view.writes.at(-1), "display"), false);
    assert.equal(Object.hasOwn(view.writes.at(-1), "overflow"), false);
  }
});
test("an explicit none clamp is shown as normal wrapping without the line count field", () => {
  const node = { ...makeText(), styles: { base: { default: { WebkitLineClamp: "none" } } } };
  const view = renderTypography(node, "base");
  assert.equal(view.fields.find(e => e.type === "Seg" && e.props.options.some((o: any) => o.value === "clamp")).props.value, "wrap");
  assert.equal(view.fields.some(e => e.props?.prop === "WebkitLineClamp"), false);
});

for (const mode of ["wrap", "nowrap"]) test(`hover can explicitly turn default clamping into ${mode}`, () => {
  const node = { ...makeText(), styles: { base: { default: baseClamp } } };
  const view = renderTypography(node, "base", "hover");
  view.fields.find(e => e.type === "Seg" && e.props.value === "clamp").props.onChange(mode);
  assert.equal(view.writes.at(-1).WebkitLineClamp, "none");
  assert.equal(view.writes.at(-1).overflow, "visible");
});
for (const [prop, value, tip, expected] of [["fontStyle", "italic", "Italic", "normal"], ["textDecoration", "underline", "Underline", "none"], ["textDecoration", "line-through", "Strikethrough", "none"]]) test(`hover can toggle off default ${value}`, () => {
  const node = { ...makeText(), styles: { base: { default: { [prop]: value } } } };
  const view = renderTypography(node, "base", "hover");
  view.fields.find(e => e.type === "button" && e.props["data-tip"] === tip).props.onClick();
  assert.equal(view.writes.at(-1)[prop], expected);
});
test("hover wrap explicitly overrides default nowrap", () => {
  const node = { ...makeText(), styles: { base: { default: { whiteSpace: "nowrap" } } } };
  const view = renderTypography(node, "base", "hover");
  view.fields.find(e => e.type === "Seg" && e.props.value === "nowrap").props.onChange("wrap");
  assert.equal(view.writes.at(-1).whiteSpace, "pre-wrap");
});
});

describe("youtube-embed", () => {
const id = "dQw4w9WgXcQ";
const target = `https://www.youtube-nocookie.com/embed/${id}`;
const urls = [
  `https://www.youtube.com/watch?v=${id}`,
  `https://www.youtube.com/watch?v=${id}&rv=abcdefghijk`,
  `https://www.youtube.com/watch?rv=abcdefghijk&v=${id}&other_v=XXXXXXXXXXX`,
  `https://www.youtube.com/watch?v=${id}#v=abcdefghijk`,
  `https://www.youtube.com/watch?feature=shared&v=${id}&v=abcdefghijk`,
  `https://www.youtube.com/watch?%76=${id}`,
  `https://www.youtube.com/watch?v=%64Qw4w9WgXcQ`,
  `https://youtu.be/${id}?si=example`,
  `https://www.youtube.com/shorts/${id}`,
  `https://www.youtube.com/live/${id}`,
  `https://www.youtube.com/embed/${id}`,
  `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
  id,
];

for (const src of urls) {
  test(`YouTube input selects its video in preview and generated output: ${src}`, async () => {
    assert.equal(embedSrc({ kind: "youtube", src }), target);
    const doc = createInitialDoc();
    const home = doc.pageOrder.find((pid) => doc.pages[pid].slug === "")!;
    const node: DocNode = { ...makeBox(), id: "youtube", type: "embed", embed: { kind: "youtube", src } };
    doc.nodes[node.id] = node;
    doc.pages[home].children = [node.id];
    const before = structuredClone(doc);
    const preview = renderToStaticMarkup(renderLeafNode(node, {}));
    const { files } = generateProject(doc);
    const route = loadGeneratedRoute(files, "app/page.tsx");
    const published = renderToStaticMarkup(await route.default({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    for (const html of [preview, published]) {
      assert.equal(/<iframe\b[^>]*\bsrc="([^"]*)"/.exec(html)?.[1], target);
      assert.match(html, /allowFullScreen=""/);
      assert.match(html, /referrerPolicy="strict-origin-when-cross-origin"/);
    }
    assert.deepEqual(doc, before);
  });
}

test("watch URLs do not obtain an ID from unrelated parameters or fragments", () => {
  for (const query of ["rv=abcdefghijk", "other_v=abcdefghijk", "x=1#v=abcdefghijk", "v=&rv=abcdefghijk", "v=short&rv=abcdefghijk", "v=bad%20video&rv=abcdefghijk"]) {
    assert.equal(embedSrc({ kind: "youtube", src: `https://www.youtube.com/watch?${query}` }), null, query);
  }
});
});
