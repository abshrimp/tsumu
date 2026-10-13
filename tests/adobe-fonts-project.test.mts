import assert from "node:assert/strict";
import { test } from "node:test";
import { adobeCssFamilies, adobePublishedFamilies, inspectAdobeProject } from "../lib/adobe-fonts-project";

const cssResponse = (css: string) => new Response(css, {
  status: 200, headers: { "Content-Type": "text/css" },
});

function stub(
  api: Response | Error,
  css: Response | Error,
  js: Response | Error,
) {
  const calls: { url: string; method: string }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const output = url.includes("typekit.com/api/v1/") ? api
      : url.endsWith(".css") ? css : js;
    if (output instanceof Error) throw output;
    return output.clone();
  }) as typeof fetch;
  return { fake, calls };
}

const unpublished = () => new Response("", { status: 404 });

test("published kit names are validated, and mixed families use one dynamic loader", () => {
  const fonts = adobePublishedFamilies({
    kit: { families: [
      { name: "Japanese", css_names: ["poprumcute"], subset: "dynamic" },
      { name: "Latin", css_names: ["acumin-pro"], subset: "default" },
      { name: "Unsafe", css_names: ['x";alert(1)'], subset: "default" },
    ] },
  });
  assert.deepEqual(fonts, [
    { name: "Japanese", family: "poprumcute", loading: "dynamic" },
    { name: "Latin", family: "acumin-pro", loading: "dynamic" },
  ]);
  assert.equal(adobePublishedFamilies({ errors: ["Not found"] }), null);
});

test("Adobe CSS font-face fallback extracts names without executing remote code", () => {
  const fonts = adobeCssFamilies(
    '@font-face { font-family: "acumin-pro"; src: url("https://use.typekit.net/a.woff2"); }' +
    "@font-face { font-family: 'adobe-garamond-pro'; font-weight: 400; }" +
    "@font-face { font-family: 'acumin-pro'; font-style: italic; }" +
    "@font-face { font-family: 'x; background: url(evil)'; }",
  );
  assert.deepEqual(fonts, [
    { name: "acumin-pro", family: "acumin-pro", loading: "css" },
    { name: "adobe-garamond-pro", family: "adobe-garamond-pro", loading: "css" },
  ]);
});

test("public kit metadata is preferred when available", async () => {
  const { fake, calls } = stub(Response.json({
    kit: { families: [{ name: "Poprum", css_names: ["poprumcute"], subset: "dynamic" }] },
  }), unpublished(), unpublished());
  const result = await inspectAdobeProject("tud1nus", fake);
  assert.deepEqual(result, {
    status: "available",
    fonts: [{ name: "Poprum", family: "poprumcute", loading: "dynamic" }],
  });
  assert.deepEqual(calls.map(call => ({ method: call.method, path: new URL(call.url).pathname })), [
    { method: "GET", path: "/api/v1/json/kits/tud1nus/published" },
  ]);
});

test("a published Japanese kit rejected by the CSS endpoint uses JavaScript", async () => {
  const { fake, calls } = stub(Response.json({
    kit: { families: [
      { name: "Japanese font", css_names: ["poprumcute"], subset: "default" },
      { name: "Latin family", css_names: ["acumin-pro"], subset: "default" },
    ] },
  }), new Response("", { status: 412 }), new Response(null, { status: 200 }));
  assert.deepEqual(await inspectAdobeProject("jys5tkg", fake), {
    status: "available",
    fonts: [
      { name: "Japanese font", family: "poprumcute", loading: "dynamic" },
      { name: "Latin family", family: "acumin-pro", loading: "dynamic" },
    ],
    loading: "dynamic",
  });
  assert.deepEqual(calls.map(c => c.method), ["GET", "HEAD"]);
});

test("legacy Adobe metadata failure does not hide a working CSS CDN project", async () => {
  const { fake, calls } = stub(new Error("upstream DNS error"),
    cssResponse('@font-face { font-family: "acumin-pro"; }'), unpublished());
  assert.deepEqual(await inspectAdobeProject("abc1234", fake), {
    status: "available",
    fonts: [{ name: "acumin-pro", family: "acumin-pro", loading: "css" }],
    loading: "css",
  });
  assert.equal(calls.length, 2);
});

test("Japanese CDN script can be reachable even when metadata and CSS endpoints fail", async () => {
  const { fake, calls } = stub(unpublished(), unpublished(), new Response(null, { status: 200 }));
  assert.deepEqual(await inspectAdobeProject("tud1nus", fake), {
    status: "reachable", fonts: [], loading: "dynamic",
  });
  assert.deepEqual(calls.map(call => call.method), ["GET", "GET", "HEAD"]);
  assert.deepEqual(calls.map(call => new URL(call.url).hostname),
    ["typekit.com", "use.typekit.net", "use.typekit.net"]);
});

test("a CSS response without font families still probes the Japanese dynamic script", async () => {
  const { fake } = stub(new Error("legacy endpoint blocked"),
    cssResponse("/* Fonts are dynamically subset by JavaScript */"),
    new Response(null, { status: 200 }));
  assert.deepEqual(await inspectAdobeProject("tud1nus", fake), {
    status: "reachable", fonts: [], loading: "dynamic",
  });
});

test("an unavailable API does not prove the project or subscription is expired", async () => {
  const unavailable = new Error("Adobe unavailable");
  const { fake } = stub(unavailable, unavailable, unavailable);
  assert.deepEqual(await inspectAdobeProject("tud1nus", fake), { status: "unknown", fonts: [] });
});

test("only independently confirmed missing endpoints can mark a project missing", async () => {
  const all404 = stub(unpublished(), unpublished(), unpublished());
  assert.deepEqual(await inspectAdobeProject("abc1234", all404.fake), { status: "missing", fonts: [] });
  const blocked = stub(unpublished(), unpublished(), new Response("", { status: 403 }));
  assert.deepEqual(await inspectAdobeProject("abc1234", blocked.fake), { status: "unknown", fonts: [] });
});

test("kit IDs cannot inject external URLs or trigger arbitrary requests", async () => {
  const { fake, calls } = stub(unpublished(), unpublished(), unpublished());
  assert.deepEqual(await inspectAdobeProject("../../../", fake), { status: "unknown", fonts: [] });
  assert.deepEqual(await inspectAdobeProject("foo?a=1", fake), { status: "unknown", fonts: [] });
  assert.equal(calls.length, 0);
});
