import assert from "node:assert/strict";
import { test } from "node:test";
import type { SiteDoc } from "../lib/types";
import { exportLimitations, generateExportProject } from "../lib/export-formats";
import { reactSource } from "../lib/generator/react-export";
import { makeBox, makeImage } from "../lib/presets";

function fixture(): SiteDoc {
  const box = { ...makeBox(), id: "hero", text: { content: "Hello", heading: 1 } };
  const image = { ...makeImage(), id: "photo" };
  return {
    siteName: "Export Test",
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "Welcome", children: ["hero", "photo"] },
    },
    pageOrder: ["home"],
    nodes: { hero: box, photo: image },
    assets: {},
  };
}

test("Next.js export remains identical to the publish generator", async () => {
  const { generateProject } = await import("../lib/generator");
  assert.deepEqual(generateExportProject(fixture(), "nextjs"), generateProject(fixture()));
});

test("React output includes Vite entrypoints, routes, CSS and assets", () => {
  const result = generateExportProject(fixture(), "react");
  assert.match(result.files["package.json"], /"vite"/);
  assert.match(result.files["src/main.tsx"], /createRoot/);
  assert.match(result.files["src/App.tsx"], /const routes: Route\[\]/);
  assert.match(result.files["src/pages/Page0.tsx"], /Hello/);
  assert.match(result.files["src/pages/Page0.tsx"], /<img/);
  assert.doesNotMatch(result.files["src/pages/Page0.tsx"], /next\/image/);
  assert.ok(result.files["src/site.css"]);
  assert.ok(result.files["src/globals.css"]);
  assert.match(result.files["index.html"], /<div id="root"><\/div>/);
  assert.equal(result.files["next.config.mjs"], undefined);
});

test("HTML export configures Next static build without Cloudflare runtime", () => {
  const result = generateExportProject(fixture(), "html");
  assert.match(result.files["next.config.mjs"], /output: "export"/);
  assert.match(result.files["next.config.mjs"], /trailingSlash: true/);
  assert.match(result.files["README.md"], /out\//);
  assert.equal(result.files["wrangler.jsonc"], undefined);
  assert.equal(result.files["open-next.config.ts"], undefined);
  assert.equal(result.files["package.json"].includes("@opennextjs/cloudflare"), false);
});

test("unsupported dynamic routes and reverse proxies fail explicitly", () => {
  const doc = fixture();
  doc.pages.home.slug = "articles/[slug]";
  assert.ok(exportLimitations(doc, "react").some((x) => x.includes("[slug]")));
  assert.throws(() => generateExportProject(doc, "html"), /slug/);
  doc.pages.home.slug = "";
  doc.pages.home.rewriteTo = "https://example.com";
  assert.ok(exportLimitations(doc, "react").length);
  assert.throws(() => generateExportProject(doc, "react"));
});

test("server-side variables are blocked instead of emitting broken React", () => {
  const doc = fixture();
  doc.nodes.hero.text!.content = "Hello {username}";
  const messages = exportLimitations(doc, "react");
  assert.ok(messages.length > 0);
  assert.throws(() => generateExportProject(doc, "react"));
});

test("React JSX adaptation removes only framework-specific JSX wrappers", () => {
  const source = 'import type { Metadata } from "next";\n' +
    'import Link from "next/link";\nimport Image from "next/image";\n' +
    'export const metadata: Metadata = {\n  title: "X",\n};\n' +
    'export default function Page() { return <><Link href="/a">A</Link><Image src="/x" alt="X" width={10} height={10} /></>; }';
  const result = reactSource(source);
  assert.match(result, /<a href/);
  assert.match(result, /<img src/);
  assert.doesNotMatch(result, /next\/|export const metadata/);
  assert.throws(() => reactSource('import { notFound } from "next/navigation";'));
});
