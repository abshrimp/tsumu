import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCanvasCss, previewHtmlWithBodyStyles, type CanvasCssCache } from "../components/canvas/css";
import { applyBreakpoints } from "../lib/style";
import { canvasMoveDoc } from "./helpers/canvas-move";

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
