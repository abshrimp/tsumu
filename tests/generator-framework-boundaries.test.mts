import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { generateProject } from "../lib/generator";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { generateStandaloneHtml } from "../lib/generator/html-export";
import { assetSrc } from "../lib/assets";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function fixture(slug = ""): SiteDoc {
  return {
    siteName: "Framework boundaries", lang: "en", nodes: {
      text: { ...makeText("Ordinary page"), id: "text" },
    }, assets: {}, pageOrder: ["home"], pages: {
      home: { id: "home", name: "Home", title: "Home", description: "", slug,
        children: ["text"] },
    },
  };
}

async function routeHtml(source: string): Promise<string> {
  const mod = { exports: {} as { GET: () => Response } };
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
  new Function("module", "exports", code)(mod, mod.exports);
  return mod.exports.GET().text();
}

for (const slug of ["_preview", "guides/_draft", "日本語", "café"]) {
  test(`imported HTML does not depend on Next.js route filenames: ${slug}`, async () => {
    const doc = fixture(slug);
    doc.pages.home.rawHtml = '<!doctype html><html><head></head><body>Imported page</body></html>';
    const before = structuredClone(doc);
    const next = generateProject(doc);
    const route = Object.entries(next.files).find(([path]) => path.endsWith("/route.ts"))!;
    assert.ok(route);
    const expected = await routeHtml(route[1]);
    const exported = generateExportProject(doc, "html");
    assert.equal(exported.files["index.html"], expected);
    assert.deepEqual(doc, before);
  });
}

for (const separator of ["\u2028", "\u2029"]) {
  test(`imported HTML preserves Unicode separator U+${separator.codePointAt(0)!.toString(16)}`, async () => {
    const doc = fixture();
    doc.pages.home.rawHtml = '<!doctype html><html><head></head><body><p>Before' + separator +
      'after</p><script>window.message = "first' + separator + 'last";</script></body></html>';
    const expected = await routeHtml(generateProject(doc).files["app/route.ts"]);
    assert.equal(generateExportProject(doc, "html").files["index.html"], expected);
    const single = await prepareExportProject(doc, "single-html");
    assert.ok(single.files["index.html"].includes("Before" + separator + "after"));
    assert.ok(single.files["index.html"].includes("first" + separator + "last"));
  });
}

test("distinct static HTML routes preserve their content when Next.js filenames collide", () => {
  const doc = fixture("--");
  doc.pages.home.rawHtml = '<html><head></head><body>ASCII route</body></html>';
  doc.pages.other = { ...doc.pages.home, id: "other", slug: "日本",
    rawHtml: '<html><head></head><body>Japanese route</body></html>' };
  doc.pageOrder.push("other");
  const output = generateExportProject(doc, "html");
  assert.match(output.files["--/index.html"], /ASCII route/);
  assert.doesNotMatch(output.files["--/index.html"], /Japanese route/);
  assert.match(output.files["日本/index.html"], /Japanese route/);
});

test("React keeps distinct public routes when Next.js groups their generated JSX", () => {
  const doc = fixture("caf-");
  doc.nodes.other = { ...makeText("Accented route"), id: "other" };
  doc.pages.other = { ...doc.pages.home, id: "other", slug: "café", children: ["other"] };
  doc.pageOrder.push("other");
  const output = generateExportProject(doc, "react");
  assert.match(output.files["src/pages/Page0.tsx"], /Ordinary page/);
  assert.doesNotMatch(output.files["src/pages/Page0.tsx"], /Accented route/);
  assert.match(output.files["src/pages/Page1.tsx"], /Accented route/);
  assert.ok(output.files["src/App.tsx"].includes('path: "/caf-"'));
  assert.ok(output.files["src/App.tsx"].includes('path: "/café"'));
});

test("imported HTML has output parity with published HTML using only shared styles and assets", async () => {
  const doc = fixture();
  doc.breakpoints = [{ id: "mobile", label: "Mobile", maxWidth: 640 }];
  doc.assets.logo = { id: "logo", name: "logo.svg", width: 10, height: 10,
    mimeType: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" };
  doc.assets.remote = { ...doc.assets.logo, id: "remote", name: "remote.svg",
    dataUrl: undefined, path: "assets/remote.svg" };
  const source = assetSrc(doc.assets.logo);
  doc.pages.home.rawHtml = '<!doctype html><html><head><title>Keep &amp; preserve</title></head>' +
    '<body><img src="' + source + '"><script>window.literal = "/assets/keep";</script></body></html>';
  doc.pages.home.htmlBackground = "#f0f0f0";
  doc.pages.home.bodyStyles = {
    base: { default: { backgroundImage: 'url("' + source + '")', color: "red" } },
    mobile: { default: { padding: "12px" } },
  };
  const before = structuredClone(doc);
  const next = generateProject(doc);
  const expected = (await routeHtml(next.files["app/route.ts"]))
    .replace('src="/assets/logo.svg"', 'src="./assets/logo.svg"')
    .replace('url("/assets/logo.svg")', 'url("./assets/logo.svg")');
  const shared = { ...next, files: Object.fromEntries(Object.entries(next.files).filter(([path]) =>
    path.startsWith("public/") || path === "styles/site.css" || path === "app/globals.css")) };
  const output = generateStandaloneHtml(doc, shared);
  assert.equal(output.files["index.html"], expected);
  assert.match(expected, /padding: 12px/);
  assert.match(expected, /window.literal = "\/assets\/keep"/);
  assert.deepEqual(output.binaries, { "assets/logo.svg": "PHN2Zy8+" });
  assert.deepEqual(output.remoteAssets, { "assets/remote.svg": "assets/remote.svg" });
  assert.deepEqual(output, generateExportProject(doc, "html"));
  assert.deepEqual(output, await prepareExportProject(doc, "html"));
  assert.deepEqual(next, generateExportProject(doc, "nextjs"));
  assert.deepEqual(doc, before);
});

test("raw-page styles and robots metadata preserve authored head text and the doctype", async () => {
  const doc = fixture();
  doc.pages.home.noindex = true;
  const comment = "<!-- header example: <head> -->";
  const script = '<script>const headEnd = "</head>";</script>';
  for (const source of [
    comment + '<!doctype html><html><head>' + script + '</head><body>Page</body></html>',
    comment + '<!doctype html>' + script + '<main>Page</main>',
  ]) {
    doc.pages.home.rawHtml = source;
    const next = generateProject(doc);
    const production = generateExportProject(doc, "html");
    const preview = await prepareExportProject(doc, "html", "test");
    for (const [output, target] of [
      [await routeHtml(next.files["app/route.ts"]), "production"],
      [production.files["index.html"], "production"], [preview.files["index.html"], "test"],
    ]) {
      assert.ok(output.startsWith(comment + "<!doctype html>"));
      assert.ok(output.includes(script));
      assert.match(output, /<style data-editor-body-style>/);
      const robots = output.match(/<meta name="robots" content="([^"]+)">/g) ?? [];
      assert.equal(robots.length, 1);
      assert.match(robots[0], target === "test" ? /noarchive/ : /noindex,\s*nofollow/);
    }
  }
});

test("test-target HTML is independent of Next.js publication route removal", async () => {
  const doc = fixture("robots.txt");
  doc.pages.home.rawHtml = '<html><head></head><body>Authored page</body></html>';
  assert.equal(generateProject(doc, "test").files["app/robots.txt/route.ts"], undefined);
  const output = await prepareExportProject(doc, "html", "test");
  assert.match(output.files["index.html"], /Authored page/);
  assert.match(output.files["index.html"], /<meta name="robots" content="noindex, nofollow/);
  assert.equal(output.files["robots.txt"], "User-agent: *\nDisallow: /\n");
});

for (const slug of ["_preview", "guides/_draft", "日本語", "café"]) {
  for (const variants of [false, true]) {
    test(`React locates Next.js-generated JSX while retaining its public route: ${slug}, variants=${variants}`, async () => {
      const doc = fixture(slug);
      if (variants) {
        doc.nodes.variant = { ...makeText("Query variant"), id: "variant" };
        doc.pages.variant = { ...doc.pages.home, id: "variant", query: "mode=detail", children: ["variant"] };
        doc.pageOrder.push("variant");
      }
      const before = structuredClone(doc);
      const output = generateExportProject(doc, "react");
      assert.match(output.files["src/pages/Page0.tsx"], /Ordinary page/);
      assert.ok(output.files["src/App.tsx"].includes('path: ' + JSON.stringify("/" + slug)));
      if (variants) assert.match(output.files["src/pages/Page1.tsx"], /Query variant/);
      assert.deepEqual(await prepareExportProject(doc, "react"), output);
      assert.deepEqual(doc, before);
    });
  }
}
