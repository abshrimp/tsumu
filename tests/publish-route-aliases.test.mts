import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, posix } from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../lib/generator";
import { runChecks } from "../lib/generator/checks";
import { createInitialDoc, makeText } from "../lib/presets";

function fixture() {
  const doc = createInitialDoc();
  for (const [id, slug, text] of [
    ["first", "about/team", "The original team page"],
    ["second", "about//team", "The other team page"],
  ]) {
    const node = makeText(text);
    doc.nodes[node.id] = node;
    doc.pages[id] = { id, name: id, slug, title: id, description: "", children: [node.id] };
    doc.pageOrder.push(id);
  }
  return doc;
}

const errors = (doc: ReturnType<typeof fixture>) => runChecks(doc).filter((c) => c.level === "error");

function loadGenerated(files: Record<string, string>, path: string): any {
  const require = createRequire(import.meta.url);
  const loaded = new Map<string, any>();
  const load = (path: string): any => {
    if (loaded.has(path)) return loaded.get(path);
    const module = { exports: {} };
    const code = transformSync(files[path], { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((name: string) => {
      if (name.startsWith(".")) return load(posix.normalize(`${dirname(path)}/${name}.tsx`));
      return require(name);
    }, module, module.exports);
    loaded.set(path, module.exports);
    return module.exports;
  };
  return load(path);
}

test("publish and export checks reject URLs that produce the same generated route", () => {
  for (const slug of ["about//team", "/about///team/", "about/./team", "about/../team"]) {
    const doc = fixture();
    doc.pages.second.slug = slug;
    const result = errors(doc);
    assert.equal(result.length, 1, slug);
    assert.match(result[0].message, /重複/);
    assert.match(result[0].message, /first/);
    assert.match(result[0].message, /second/);
  }
});

test("aliases cannot bypass conflicts for raw HTML and redirect pages", () => {
  for (const patch of [{ rawHtml: "<html><body>Other</body></html>" }, { redirectTo: "/" }, { rewriteTo: "https://example.com/" }]) {
    const doc = fixture();
    Object.assign(doc.pages.second, patch, { query: "tab=other" });
    assert.ok(errors(doc).some((c) => /重複/.test(c.message)));
  }
});

test("unpublished aliases stay excluded and unrelated underscore routes stay distinct", () => {
  const doc = fixture();
  doc.pages.second.unpublished = true;
  assert.deepEqual(errors(doc), []);
  doc.pages.second.unpublished = false;
  doc.pages.first.slug = "_team";
  doc.pages.second.slug = "team";
  assert.deepEqual(errors(doc), []);
  const { files } = generateProject(doc);
  assert.ok(files["app/%5Fteam/page.tsx"]);
  assert.ok(files["app/team/page.tsx"]);
});

test("query variants sharing an output route both render through the generated dispatcher", async () => {
  const doc = fixture();
  doc.pages.second.query = "tab=other";
  const before = structuredClone(doc);
  assert.deepEqual(errors(doc), []);
  const { files } = generateProject(doc);
  const route = loadGenerated(files, "app/about/team/page.tsx");
  for (const [query, expected, unexpected] of [
    [{}, "The original team page", "The other team page"],
    [{ tab: "other" }, "The other team page", "The original team page"],
  ] as const) {
    const props = { params: Promise.resolve({}), searchParams: Promise.resolve(query) };
    const html = renderToStaticMarkup(await route.default(props));
    assert.ok(html.includes(expected));
    assert.ok(!html.includes(unexpected));
    assert.equal((await route.generateMetadata(props)).title, query.tab ? "second" : "first");
  }
  assert.deepEqual(doc, before, "generation does not rewrite the saved document");
});


test("the special not-found page is separate from normal /404 routes", async () => {
  for (const query of [undefined, "tab=other"]) {
    const doc = fixture();
    doc.pages.first.slug = "404/.";
    doc.pages.first.query = query;
    doc.pages.second.unpublished = true;
    // The initial document already has a special 404 page.
    assert.ok(doc.pageOrder.some((id) => doc.pages[id].slug === "404"));
    assert.deepEqual(errors(doc), []);
    const { files } = generateProject(doc);
    assert.ok(files["app/not-found.tsx"]);
    assert.ok(files["app/404/page.tsx"]);
    assert.equal(files["app/404/_q/p1.tsx"], undefined);
    assert.match(renderToStaticMarkup(await loadGenerated(files, "app/404/page.tsx").default({
      params: Promise.resolve({}), searchParams: Promise.resolve({}),
    })), /The original team page/);
  }
});

test("HTML /404 routes remain distinct from not-found but collide with normal /404 routes", () => {
  const doc = fixture();
  doc.pages.first.slug = "404";
  doc.pages.first.rawHtml = "<html><body>Explicit 404 URL</body></html>";
  doc.pages.second.unpublished = true;
  assert.deepEqual(errors(doc), []);
  const { files } = generateProject(doc);
  assert.ok(files["app/not-found.tsx"]);
  assert.match(files["app/404/route.ts"], /Explicit 404 URL/);
  doc.pages.second.unpublished = false;
  doc.pages.second.slug = "404/.";
  assert.ok(errors(doc).some((c) => /重複/.test(c.message)));
});
