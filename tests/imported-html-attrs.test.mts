import assert from "node:assert/strict";
import { test } from "node:test";
import { importedAttributes, importedClass } from "../lib/imported-html-attrs";

test("safe imported HTML attributes preserve original CSS and accessibility hooks", () => {
  const attrs = importedAttributes({
    "class": "ignored-in-extra-map",
    "data-topic": "billing",
    "aria-label": "Download site",
    "title": "Edit",
    "role": "button",
    "for": "query",
    "lang": "ja",
    "tabindex": "0",
  });
  assert.deepEqual(attrs, {
    "data-topic": "billing",
    "aria-label": "Download site",
    title: "Edit",
    role: "button",
    htmlFor: "query",
    lang: "ja",
    tabIndex: "0",
  });
  // The same attributes must remain valid when read again from a SiteDoc.
  assert.deepEqual(importedAttributes(attrs), attrs);
  assert.equal(importedClass("  btn  sm:hover:bg-gray-100  "), "btn  sm:hover:bg-gray-100");
});

test("untrusted HTML cannot override editor markers or inject handlers and URLs", () => {
  const attrs = importedAttributes({
    "onclick": "alert(1)",
    "onmouseover": "alert(1)",
    "src": "javascript:alert(1)",
    "href": "javascript:alert(1)",
    "style": "background:red",
    "data-node": "overwritten",
    "data-ghost": "overwritten",
    "data-tpl": "broken",
    "data-scripts": "run",
    "data-tsumu-secret": "x",
    "data-allowed": "safe",
  });
  assert.deepEqual(attrs, { "data-allowed": "safe" });
});
