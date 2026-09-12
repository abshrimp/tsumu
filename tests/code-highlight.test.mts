import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightCustomCode } from "../lib/code-highlight";

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
