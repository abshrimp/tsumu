import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightCustomCode } from "../lib/code-highlight";

test("HTML snippets color HTML tags, CSS properties, JavaScript keywords, and comments", () => {
  const source = '<style>.card { color: #fff; }</style><script>const a = "ok";</script><!-- comment -->';
  const result = highlightCustomCode(source);
  assert.match(result, /code-token-tag">style/);
  assert.match(result, /code-token-property">color/);
  assert.match(result, /code-token-keyword">const/);
  assert.match(result, /code-token-comment">&lt;!-- comment --&gt;/);
  assert.doesNotMatch(result, /<script>|<style>/);
});

test("source markup, quoted angle brackets, and event handlers stay escaped", () => {
  const source = '<img data-title="a > b" onerror="alert(1)"><script>alert("<img>")</script>';
  const result = highlightCustomCode(source);
  assert.match(result, /&quot;a &gt; b&quot;/);
  assert.match(result, /&lt;img/);
  assert.doesNotMatch(result, /<img\b|<script\b|onerror="alert/);
});

test("non-HTML less-than signs are preserved as visible text", () => {
  assert.equal(highlightCustomCode("x < y"), "x &lt; y");
});
