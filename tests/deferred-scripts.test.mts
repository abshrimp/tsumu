import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";
import { deferRunnableScripts } from "../lib/generator/defer-scripts";
import { generateProject } from "../lib/generator";
import type { SiteDoc } from "../lib/types";

const scriptsIn = (html: string) => {
  const fragment = parseFragment(html);
  const scripts: Html.Element[] = [];
  const walk = (nodes: Html.ChildNode[]) => {
    for (const node of nodes) {
      if (!("tagName" in node)) continue;
      if (node.tagName === "script") scripts.push(node);
      else if (node.tagName !== "template" && node.tagName !== "noscript") walk(node.childNodes);
    }
  };
  walk(fragment.childNodes);
  return scripts;
};

test("executable scripts are inert for SSR while data scripts remain unchanged", () => {
  const html = [
    '<div class="marquee"><span>WELCOME</span></div>',
    '<script src="/marquee.js" data-control="x"></script>',
    '<script type="module" nonce="a&amp;b">window.moduleLoaded = true;</script>',
    '<script type="text/javascript">window.classicLoaded = true;</script>',
    '<script type="application/ld+json">{"@type":"Thing"}</script>',
    '<script type="importmap">{"imports":{}}</script>',
    '<script type="text/plain">inert</script>',
    '<template><script>window.neverRun = true;</script></template>',
    '<textarea><script>literal</script></textarea>',
  ].join("");
  const output = deferRunnableScripts(html);
  const scripts = scriptsIn(output);
  assert.equal(scripts.length, 6);
  assert.deepEqual(scripts.slice(0, 3).map(s => s.attrs.find(a => a.name === "type")?.value),
    Array(3).fill("application/x-tsumu-deferred"));
  assert.equal(scripts[1].attrs.find(a => a.name === "data-tsumu-original-type")?.value, "module");
  assert.equal(scripts[2].attrs.find(a => a.name === "data-tsumu-original-type")?.value, "text/javascript");
  assert.deepEqual(scripts.slice(3).map(s => s.attrs.find(a => a.name === "type")?.value),
    ["application/ld+json", "importmap", "text/plain"]);
  assert.match(output, /<template><script>window\.neverRun = true;<\/script><\/template>/);
  assert.match(output, /<textarea><script>literal<\/script><\/textarea>/);
  assert.match(output, /<span>WELCOME<\/span>/);
});

test("script bodies, source order, and quoted attributes survive deferral", () => {
  const source = [
    '<script data-a="&quot;hello&quot;" type = \'text/javascript\' src="/first.js"></script>',
    '<script><!--\nconst s="<script>";\nconst marker=42;\n// --></script>',
    '<script type=module>import "/second.js";</script>',
    '<script type="application/json">{"count":1}</script>',
  ].join("\n");
  const deferred = deferRunnableScripts(source);
  assert.match(deferred, /data-tsumu-original-type="text\/javascript"/);
  assert.match(deferred, /data-tsumu-original-type="module"/);
  assert.match(deferred, /data-a="&quot;hello&quot;"/);
  assert.match(deferred, /const s="<script>";/);
  assert.match(deferred, /const marker=42;/);
  assert.match(deferred, /import "\/second\.js";/);
  assert.match(deferred, /<script type="application\/json">/);
  assert.equal((deferred.match(/data-tsumu-deferred/g) ?? []).length, 3);
});

test("Next.js page and site footer export inert HTML but preserve the authored script", () => {
  const doc: SiteDoc = {
    siteName: "Hydration regression",
    pages: {
      home: {
        id: "home", name: "Home", title: "Home", slug: "", description: "",
        children: [], customEndHtml: '<script>document.querySelector(".marquee-track").textContent += "WELCOME";</script>',
      },
    },
    pageOrder: ["home"], nodes: {}, assets: {},
    customBodyEndHtml: '<script src="/site.js"></script>',
  };
  const files = generateProject(doc).files;
  assert.ok(files["components/PageHtml.tsx"]);
  assert.match(files["app/page.tsx"], /<PageHtml html=/);
  assert.match(files["app/page.tsx"], /staticHtml=/);
  assert.match(files["app/page.tsx"], /application\/x-tsumu-deferred/);
  assert.match(files["app/layout.tsx"], /<PageHtml html=/);
  assert.match(files["app/layout.tsx"], /application\/x-tsumu-deferred/);
  assert.doesNotMatch(files["app/layout.tsx"], /<script src="\/site\.js">/);
});
