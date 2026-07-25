import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("custom HTML iframes cannot combine scripts with the editor's same-origin privileges", () => {
  const source = readFileSync(new URL("../lib/canvas-html.ts", import.meta.url), "utf8");
  const match = /const IFRAME_SANDBOX = "([^"]+)";/.exec(source);
  assert.ok(match, "custom HTML sanitization must set an explicit iframe sandbox");
  const permissions = new Set(match[1].split(/\s+/));
  assert.ok(permissions.has("allow-scripts"), "embedded preview scripts remain supported");
  assert.ok(!permissions.has("allow-same-origin"),
    "untrusted srcdoc/same-origin iframes must not escape their sandbox");
  assert.ok(!permissions.has("allow-top-navigation"));
  assert.ok(!permissions.has("allow-top-navigation-by-user-activation"));
  assert.match(source, /node\.setAttribute\("sandbox", IFRAME_SANDBOX\)/);
});
