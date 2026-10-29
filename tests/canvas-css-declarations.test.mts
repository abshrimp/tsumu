import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { buildCanvasCss, previewHtmlWithBodyStyles, type CanvasCssCache } from "../components/canvas/css";
import { applyBreakpoints, bpRangeQuery } from "../lib/style";
import { canvasMoveDoc } from "./helpers/canvas-move";
import { cssQuotedAttributeValue } from "../lib/css-selector";
import { generateSiteCss } from "../lib/generator/css";
import { generateProject } from "../lib/generator";
import { defaultAudioDoc, audioSource } from "./helpers/default-audio";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildClassNames } from "../lib/generator/names";
import { makeBox } from "../lib/presets";
import { type SiteDoc } from "../lib/types";

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
    const html = renderToStaticMarkup(createElement(mod.exports.NodeView, { id: "visible", isTop: true }));
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
    return { html: renderToStaticMarkup(createElement(load("app/page.tsx").default)), css: files["styles/site.css"], files };
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
