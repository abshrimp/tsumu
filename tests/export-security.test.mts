import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function doc(): SiteDoc {
  return {
    siteName: "Site {1 + 2} </script>",
    lang: 'ja" onload="globalThis.__attributeExecuted=1',
    pages: {
      home: { id: "home", name: "Home", slug: "", title: 'Page </title><script>unsafe()</script>',
        description: "", children: ["text", "picture"] },
    },
    pageOrder: ["home"],
    nodes: {
      text: { ...makeBox(), id: "text", text: {
        content: "Literal {{ 3 + 4 }} and {1 + 2}", heading: 1,
      } },
      picture: { ...makeBox(), id: "picture", type: "image", image: {
        src: "data:image/png;base64,AQID",
        alt: "Image {1 + 2}", width: 1, height: 1,
      } },
    },
    assets: {},
  };
}

test("generated Vue and Svelte components never compile authored plain text into expressions", () => {
  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    const project = generateExportProject(doc(), framework);
    const path = framework === "nuxt" ? "app/generated/pages/Page0.vue" :
      framework === "vue" ? "src/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
    const source = project.files[path];
    assert.ok(source, path);
    // Entity-encoded braces are ordinary HTML text, not compiled expressions.
    assert.match(source, /Literal &#123;&#123; 3 \+ 4 &#125;&#125; and &#123;1 \+ 2&#125;/);
    assert.doesNotMatch(source, /Literal \{\{/);
    assert.match(source, /Image &#123;1 \+ 2&#125;/);
    if (framework === "sveltekit") {
      const route = project.files["src/routes/+page.svelte"];
      assert.doesNotMatch(route, /Site \{1 \+ 2\} <\/script>/);
      assert.match(route, /<title>\{data\.title\} \| \{/);
    }
    if (framework === "vue") {
      assert.doesNotMatch(project.files["index.html"], /onload="globalThis/);
      assert.match(project.files["index.html"], /ja&quot; onload=&quot;/);
      assert.doesNotMatch(project.files["server.mjs"], /req\.headers\.host/);
    }
  }
});

test("new #136 composite conditions and template operands use the current recipe semantics", () => {
  const ready = [{ status: "ready", price: 8 }, { status: "ready", price: 1 },
    { status: "draft", price: 9 }];
  const result = evaluateValueRecipe(ready, [{
    kind: "filter", field: "status", operation: "eq", operand: "ready",
    conditions: [{ field: "price", operation: "gte", operand: "5",
      and: true }],
  }], {});
  assert.equal(result.kind, "value");
  if (result.kind === "value") assert.deepEqual(result.value, [ready[0]]);
  const interpolated = evaluateValueRecipe("alphabet", [{
    kind: "compare", operation: "contains", operand: "{needle}",
  }], { needle: "pha" });
  assert.deepEqual(interpolated, { kind: "value", value: true });
});

test("single HTML preserves srcset data URLs and filenames containing commas", async () => {
  const source = {
    files: {
      "index.html": '<!doctype html><html><body><img srcset="data:image/png;base64,AQID 1x, assets/photo,one.png 2x"></body></html>',
    },
    binaries: { "assets/photo,one.png": "BAUG" },
    remoteAssets: {},
  };
  const project = await toSingleHtmlProject(source);
  const html = project.files["index.html"];
  assert.match(html, /data:image\/png;base64,AQID 1x, data:image\/png;base64,BAUG 2x/);
  assert.doesNotMatch(html, /assets\/photo,one\.png/);
  assert.deepEqual(Object.keys(project.files), ["index.html"]);
});

test("generated SSR request policy blocks reserved hosts, sensitive headers and Host-origin bypass", async () => {
  const site = doc();
  site.pages.home.pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "fetch", kind: "fetch", as: "data",
      url: "http://100.100.100.200/latest" }],
  }];
  const project = generateExportProject(site, "sveltekit");
  const serverModule = project.files["src/lib/server-request.js"];
  assert.ok(serverModule);
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(serverModule).toString("base64")) as {
    requestPublic: (uri: string, init: RequestInit, base: string,
      localFetch: (uri: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
  };
  let remoteCalls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    remoteCalls++;
    return new Response("{}", { status: 200 });
  };
  try {
    const localRequests: string[] = [];
    const local = async (uri: string) => {
      localRequests.push(uri);
      return new Response("{}", { status: 200 });
    };
    await assert.rejects(
      requestPublic("http://100.100.100.200/latest", {}, "https://site.example", local),
      /not allowed/);
    await assert.rejects(
      requestPublic("/private", { headers: { Authorization: "Bearer private" } },
        "https://site.example", local),
      /Sensitive headers/);
    await assert.rejects(
      requestPublic("https://site.example/private", {}, "https://site.example", local),
      /Absolute same-origin/);
    await requestPublic("/api/data?limit=1", {}, "https://site.example", local);
    assert.deepEqual(localRequests, ["/api/data?limit=1"]);
    assert.equal(remoteCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
