import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { DocNode, SiteDoc } from "../lib/types";

function site(): SiteDoc {
  const box = (id: string, name: string) => ({ ...makeBox(), id, name });
  const heading = { ...box("heading", "Headline"),
    text: { content: "Results {count}", heading: 1 } };
  const image: DocNode = {
    ...box("image", "Photo"), type: "image",
    image: { src: "/assets/example.svg", alt: "Example", width: 120, height: 80 },
  };
  const input: DocNode = {
    ...box("input", "Search"), type: "field", attrId: "query",
    field: { kind: "input", inputType: "text", placeholder: "Search {category}", defaultValue: "" },
  };
  const item = { ...box("item", "Item"), text: { content: "{name}", heading: 0 } };
  const list: DocNode = { ...box("list", "List"), type: "list", list: { from: "items", limit: 10 },
    children: ["item"] };
  const reusable = box("reusable", "Reusable card");
  reusable.text = { content: "Reusable {count}", heading: 0 };
  const instance: DocNode = { ...box("instance", "Card instance"), type: "instance", componentId: "card" };
  return {
    siteName: "Native view",
    pages: { home: { id: "home", name: "Home", title: "Home", slug: "",
      description: "Rendered on the server", children: ["heading", "image", "input", "list", "instance"],
      pageScripts: [{
        id: "load", trigger: "load", pos: { x: 0, y: 0 },
        steps: [
          { id: "fetch", kind: "fetch", as: "items", url: "https://api.example.test/items?type={category}" },
          { id: "count", kind: "count", array: "items", into: "count" },
        ],
      }] } },
    pageOrder: ["home"],
    nodes: { heading, image, input, item, list, instance, reusable },
    components: { card: { id: "card", name: "Reusable card", rootId: "reusable" } },
    assets: {},
  };
}

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  test(framework + " emits native components, scoped lists, text and fields", () => {
    const project = generateExportProject(site(), framework);
    const base = framework === "nuxt" ? "app/generated/" :
      framework === "sveltekit" ? "src/lib/" : "src/";
    const suffix = framework === "sveltekit" ? ".svelte" : ".vue";
    const component = project.files[base + "pages/Page0" + suffix];
    const widget = project.files[base + "components/Widget0" + suffix];
    assert.ok(component);
    assert.ok(widget);
    assert.match(component, /<h1|<div/);
    assert.match(component, /resolveText/);
    assert.match(component, /<img/);
    assert.match(component, /<input/);
    assert.match(component, /<Widget0/);
    assert.match(widget, /Reusable/);
    if (framework === "sveltekit") {
      assert.match(component, /\{#each listItems/);
      assert.match(component, /\{resolveText/);
      assert.doesNotMatch(component, /\{@html html\}/);
    } else {
      assert.match(component, /v-for=/);
      assert.match(component, /\{\{ resolveText/);
      assert.doesNotMatch(component, /v-html/);
    }
    const code = Object.entries(project.files).filter(([path]) => !/\.md$/i.test(path));
    for (const [path, content] of code) assert.doesNotMatch(content, /tsumu/i, path);
  });

  test(framework + " includes an environment-neutral SSR-capable data interpreter", async () => {
    const project = generateExportProject(site(), framework);
    const base = framework === "nuxt" ? "app/generated/" :
      framework === "sveltekit" ? "src/lib/" : "src/";
    const source = project.files[base + "site-data.js"];
    assert.ok(source);
    assert.doesNotMatch(source, /document\.|window\.|location\.search/);
    const url = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
    const module = await import(url) as {
      loadPageData: (plan: unknown, query: string, request: typeof fetch) => Promise<Record<string, unknown>>;
    };
    const routes = project.files[base + "site-routes.js"];
    const match = /^export const pages = (.*);$/m.exec(routes);
    assert.ok(match);
    const plan = JSON.parse(match[1])[0].plan;
    const calls: string[] = [];
    const vars = await module.loadPageData(plan, "?category=books", async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify([{ name: "Alpha" }, { name: "Beta" }]), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    assert.deepEqual(calls, ["https://api.example.test/items?type=books"]);
    assert.ok(Object.values(vars).includes(2));
    assert.ok(Object.values(vars).some((x) => Array.isArray(x) && x.length === 2));
  });
}

test("Nuxt and SvelteKit enable SSR with server-side route data loading", () => {
  const nuxt = generateExportProject(site(), "nuxt");
  assert.match(nuxt.files["nuxt.config.ts"], /ssr: true/);
  assert.match(nuxt.files["app/pages/index.vue"], /useAsyncData/);
  assert.match(nuxt.files["app/pages/index.vue"], /<Page0/);
  assert.match(nuxt.files["app/pages/[...slug].vue"], /useAsyncData/);
  const svelte = generateExportProject(site(), "sveltekit");
  assert.match(svelte.files["svelte.config.js"], /adapter-node/);
  assert.match(svelte.files["src/routes/+page.server.js"], /export async function load/);
  assert.match(svelte.files["src/routes/+page.server.js"], /requestPublic/);
  assert.match(svelte.files["src/routes/+page.svelte"], /<Page0/);
  assert.match(svelte.files["src/routes/[...path]/+page.svelte"], /<Page0/);
  assert.doesNotMatch(svelte.files["src/routes/+layout.js"], /ssr = false/);
});

test("Vue with Vite also builds an SSR entry with hydration and native components", () => {
  const vue = generateExportProject(site(), "vue");
  assert.match(vue.files["src/App.vue"], /onMounted/);
  assert.ok(vue.files["src/pages/Page0.vue"]);
  assert.match(vue.files["src/App.vue"], /<Page0/);
  assert.match(vue.files["src/entry-server.ts"], /renderToString/);
  assert.match(vue.files["src/entry-client.ts"], /createSSRApp/);
  assert.match(vue.files["server.mjs"], /app-html/);
  assert.match(vue.files["package.json"], /vite build --ssr/);
  assert.doesNotMatch(vue.files["src/pages/Page0.vue"], /v-html/);
});
