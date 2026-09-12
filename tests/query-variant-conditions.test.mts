import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, posix } from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../lib/generator";
import { runChecks } from "../lib/generator/checks";
import { makeText } from "../lib/presets";
import { pageHrefOf, pageQueryVars } from "../lib/vars";
import { previewNavigationFixture, previewQueryDoc } from "./helpers/preview-query-navigation";

const require = createRequire(import.meta.url);
const navigation = previewNavigationFixture();

function generatedRoute(files: Record<string, string>) {
  const cache = new Map<string, any>();
  function load(path: string): any {
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} as any };
    const code = transformSync(files[path], { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)(
      (name: string) => name.startsWith(".")
        ? load(posix.normalize(`${dirname(path)}/${name}.tsx`))
        : require(name), module, module.exports,
    );
    cache.set(path, module.exports);
    return module.exports;
  }
  const route = load("app/results/page.tsx");
  return async (url: string) => {
    const params = new URL(url, "https://query.test").searchParams;
    const searchParams = Object.fromEntries([...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    }));
    const props = { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
    return {
      html: renderToStaticMarkup(await route.default(props)),
      metadata: await route.generateMetadata(props),
    };
  };
}

for (const [query, first, reversed] of [
  ["category=books&category=music", "category=books", "category=music&category=books"],
  ["category=books&category=books", "category=books", "category=music&category=books"],
  ["q=hello+world&q=later", "q=hello%20world", "q=later&q=hello+world"],
  ["%71=hello%20world&q=later", "q=hello+world", "q=later&%71=hello%20world"],
  ["q=%26%3D%2B&q=other", "q=%26%3D%2B", "q=other&q=%26%3D%2B"],
  ["q=&q=later", "q=", "q=later&q="],
  ["flag&flag=later", "flag=", "flag=later&flag"],
  ["%E7%A8%AE%E9%A1%9E=%E6%9C%AC&種類=音楽", "種類=本", "種類=音楽&種類=本"],
] as const) {
  test(`ordinary page links preserve ${query} and select their page, metadata and preview`, async () => {
    const doc = previewQueryDoc("results", ["", query]);
    const selected = doc.pages.variant1;
    selected.description = "Selected page description";
    const link = { ...makeText("Open selected results"), id: "selected-link", link: { kind: "page" as const, pageId: selected.id } };
    doc.nodes[link.id] = link;
    doc.pages.home.children.push(link.id);
    const original = structuredClone(doc);
    assert.deepEqual(runChecks(doc).filter((c) => c.level === "error"), []);
    const { files } = generateProject(doc);
    const href = pageHrefOf(selected);
    assert.equal(href, `/results?${query}`);
    assert.ok(files["app/page.tsx"].includes(`href="${href.replaceAll("&", "&amp;")}"`));
    const visit = generatedRoute(files);
    const navigate = await navigation;
    for (const url of [href, `/results?${first}`, `${href}&extra=ignored#section`]) {
      const actual = await visit(url);
      assert.match(actual.html, /Page variant1/);
      assert.doesNotMatch(actual.html, /Page variant0/);
      assert.equal(actual.metadata.title, "variant1");
      assert.equal(actual.metadata.description, selected.description);
      assert.equal(navigate(doc, url), selected.id);
    }
    for (const url of [`/results?${reversed}`, "/results"]) {
      const actual = await visit(url);
      assert.match(actual.html, /Page variant0/);
      assert.equal(actual.metadata.title, "variant0");
      assert.equal(navigate(doc, url), "variant0");
    }
    assert.deepEqual(doc, original, "routing must not rewrite saved query strings");
  });
}

for (const [left, right] of [
  ["category=books", "category=books&category=books"],
  ["category=books", "category=books&category=music"],
  ["category=books&lang=ja", "lang=ja&category=books&category=music"],
  ["q=hello+world", "%71=hello%20world&q=other"],
  ["q=", "q&q=later"],
  ["", "=ignored"],
  ["q=first", "=ignored&q=first&q=last"],
]) {
  test(`publish checks reject equivalent routing conditions: ${left} and ${right}`, () => {
    const doc = previewQueryDoc("results", [left, right]);
    const errors = runChecks(doc).filter((c) => c.level === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].help, "page-url");
  });
}

test("different first values remain distinct, and repeated keys do not increase specificity", async () => {
  const doc = previewQueryDoc("results", ["", "q=first&q=last", "q=last&q=first", "q=first&lang=ja"]);
  assert.deepEqual(runChecks(doc).filter((c) => c.level === "error"), []);
  const navigate = await navigation;
  const visit = generatedRoute(generateProject(doc).files);
  for (const [url, expected] of [
    ["/results?q=first&q=last", "variant1"],
    ["/results?q=last&q=first", "variant2"],
    ["/results?q=first&q=last&lang=ja", "variant3"],
    ["/results?q=missing", "variant0"],
  ]) {
    assert.equal((await visit(url)).metadata.title, expected);
    assert.equal(navigate(doc, url), expected);
  }
});

test("first-page fallback and declaration-order ties are retained", async () => {
  const doc = previewQueryDoc("results", ["q=first&q=last", "q=other", "lang=ja"]);
  const navigate = await navigation;
  const visit = generatedRoute(generateProject(doc).files);
  for (const [url, expected] of [
    ["/results?q=missing", "variant0"],
    ["/results?q=other&lang=ja", "variant1"],
    ["/results?q=last&lang=ja", "variant2"],
  ]) {
    assert.equal((await visit(url)).metadata.title, expected);
    assert.equal(navigate(doc, url), expected);
  }
});

test("route selection does not change existing script/data query-variable semantics", () => {
  assert.deepEqual(pageQueryVars("q=first&q=last"), { q: "last" });
});

test("condition names are values, including object prototype property names", async () => {
  const doc = previewQueryDoc("results", ["", "__proto__=first&__proto__=last", "constructor=first&constructor=last"]);
  const navigate = await navigation;
  for (const [url, expected] of [
    ["/results?__proto__=first", "variant1"],
    ["/results?__proto__=last", "variant0"],
    ["/results?constructor=first", "variant2"],
  ]) {
    // Next.js と同じく、クエリを自身のプロパティにする（Object.prototype を通して代入しない）。
    assert.equal((await generatedRoute(generateProject(doc).files)(url)).metadata.title, expected);
    assert.equal(navigate(doc, url), expected);
  }
});
