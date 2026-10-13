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
        id: "load", trigger: "load",        steps: [
          { id: "fetch", kind: "fetch", as: "items", url: "https://api.example.test/items?type={category}" },
          { id: "count", kind: "transform", source: "items", into: "count", transform: { kind: "length" } },
        ],
      }] } },
    pageOrder: ["home"],
    nodes: { heading, image, input, item, list, instance, reusable },
    components: { card: { id: "card", name: "Reusable card", rootId: "reusable" } },
    assets: {},
  };
}

test("native template generators preserve safe imported HTML classes and attributes", () => {
  const doc = site();
  doc.nodes.heading.htmlClass = "external-heading";
  doc.nodes.heading.htmlAttrs = {
    "data-source": "imported",
    "aria-label": "Imported heading",
    "title": "Original {literal}",
    "tabIndex": "4",
    "onmouseover": "alert(1)",
    "data-tsumu-scripts": "untrusted",
  };
  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    const files = generateExportProject(doc, framework).files;
    const base = framework === "nuxt" ? "app/generated/" :
      framework === "sveltekit" ? "src/lib/" : "src/";
    const suffix = framework === "sveltekit" ? ".svelte" : ".vue";
    const source = files[base + "pages/Page0" + suffix];
    assert.ok(source, framework);
    assert.match(source, /class="[^"]*external-heading/);
    assert.match(source, /data-source="imported"/);
    assert.match(source, /aria-label="Imported heading"/);
    assert.match(source, /title="Original &#123;literal&#125;"/);
    assert.match(source, /tabindex="4"/);
    assert.doesNotMatch(source, /onmouseover|data-tsumu-scripts/);
  }
});

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
    const code = Object.entries(project.files).filter(([path]) =>
      !/\.md$/i.test(path) && path !== "vendor/picomatch/package.json");
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
    const routeModule = await import("data:text/javascript;base64," + Buffer.from(routes).toString("base64"));
    const plan = routeModule.pages[0].plan;
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
  assert.match(svelte.files["vite.config.ts"], /adapter-node/);
  assert.equal(svelte.files["svelte.config.js"], undefined);
  assert.match(svelte.files["src/routes/+page.server.js"], /export async function load/);
  assert.match(svelte.files["src/routes/+page.server.js"], /requestPublic/);
  assert.match(svelte.files["src/routes/+page.svelte"], /<Page0/);
  assert.match(svelte.files["src/routes/[...path]/+page.svelte"], /<Page0/);
  assert.match(svelte.files["src/routes/+layout.ts"] ?? svelte.files["src/routes/+layout.js"], /ssr = true/);
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

test("native exports keep image alt, media src and embed src literal while interpolating image src", () => {
  const doc = site();
  const literalText = "Photo {name} \\{name}";
  const literalMedia = "https://example.com/{name}/\\{name}/clip.mp4";
  const literalEmbed = "https://example.com/embed/{name}";
  doc.nodes.image.image = { src: "/images/{name}.png", alt: literalText, width: 120, height: 80 };
  doc.nodes.video = {
    ...makeBox(), id: "video", name: "Video", type: "media",
    media: { kind: "video", src: literalMedia, sources: [{ src: literalMedia, type: "video/mp4" }] },
  };
  doc.nodes.frame = {
    ...makeBox(), id: "frame", name: "Embed", type: "embed",
    embed: { kind: "url", src: literalEmbed },
  };
  doc.pages.home.children.push("video", "frame");

  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    const files = generateExportProject(doc, framework).files;
    const base = framework === "nuxt" ? "app/generated/" : framework === "sveltekit" ? "src/lib/" : "src/";
    const suffix = framework === "sveltekit" ? ".svelte" : ".vue";
    const page = files[base + "pages/Page0" + suffix];
    assert.match(page, /resolveResourceUrl\((?:&quot;|")\/images\/\\u007bname\\u007d\.png(?:&quot;|")/);
    assert.match(page, /alt="Photo &#123;name&#125; \\&#123;name&#125;"/);
    assert.match(page, /<video[^>]* src="https:\/\/example\.com\/&#123;name&#125;\/\\&#123;name&#125;\/clip\.mp4"/);
    assert.match(page, /<source src="https:\/\/example\.com\/&#123;name&#125;\/\\&#123;name&#125;\/clip\.mp4"/);
    assert.match(page, /<iframe src="https:\/\/example\.com\/embed\/%7Bname%7D"/);
  }
});

test("native exports normalize /404 custom page and avoid orphan else blocks when only 404 exists", () => {
  const doc = site();
  doc.pages.home.slug = "/404/";
  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    const files = generateExportProject(doc, framework).files;
    const base = framework === "nuxt" ? "app/generated/" : framework === "sveltekit" ? "src/lib/" : "src/";
    const suffix = framework === "sveltekit" ? ".svelte" : ".vue";
    assert.ok(files[base + "pages/NotFound" + suffix], framework);
    assert.equal(files[base + "pages/Page0" + suffix], undefined);
    if (framework === "sveltekit") {
      assert.doesNotMatch(files["src/routes/+page.svelte"], /\{:else\}/);
      assert.match(files["src/routes/+page.svelte"], /<NotFound \{scope\} \/>/);
      assert.match(files["src/routes/+error.svelte"], /<NotFound scope=\{\{\}\} \/>/);
    } else {
      const entry = framework === "nuxt" ? files["app/pages/index.vue"] : files["src/App.vue"];
      assert.doesNotMatch(entry, /v-else/);
      assert.match(entry, /<NotFound :scope="vars" \/>/);
    }
  }
});

test("React and native exports emit open-url handler in scripts.js for unnested inner links", () => {
  const outer = { ...makeBox(), id: "outer", name: "Outer", link: { kind: "url" as const, url: "https://example.com/outer" }, children: ["inner"] };
  const inner = { ...makeBox(), id: "inner", name: "Inner", link: { kind: "url" as const, url: "https://example.com/inner" }, text: { content: "Inner", heading: 0 } };
  const doc: SiteDoc = {
    siteName: "Nested link site",
    pageOrder: ["home"],
    pages: {
      home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["outer"] },
    },
    nodes: { outer, inner },
    assets: {},
  };
  for (const framework of ["react", "vue", "nuxt", "sveltekit", "html"] as const) {
    const files = generateExportProject(doc, framework).files;
    const scriptPath = framework === "sveltekit" ? "static/scripts.js" : framework === "html" ? "scripts.js" : "public/scripts.js";
    assert.ok(files[scriptPath], `${framework}: ${scriptPath} should be emitted`);
    assert.match(files[scriptPath], /case "open-url":/, framework);
  }
});

