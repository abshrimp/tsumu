import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

test("generated Vue/Nuxt/SvelteKit SSR cannot recursively fetch its own page routes", async () => {
  const doc: SiteDoc = {
    siteName: "Guard self-fetch", pageOrder: ["home", "about"],
    pages: {
      home: { id: "home", name: "Home", title: "Home", slug: "", description: "",
        children: ["box"], pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [{ id: "f", kind: "fetch", url: "/api/items", as: "items" }] }] },
      about: { id: "about", name: "About", title: "About", slug: "about",
        description: "", children: [] },
    },
    nodes: { box: { ...makeBox(), id: "box" } }, assets: {},
  };
  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    const project = generateExportProject(doc, framework);
    const modulePath = framework === "vue" ? "src/server-request.js"
      : framework === "nuxt" ? "app/generated/server-request.js" : "src/lib/server-request.js";
    const source = project.files[modulePath];
    assert.ok(source, modulePath);
    const { requestPublic } = await import("data:text/javascript;base64," +
      Buffer.from(source).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        local: (uri: string) => Promise<Response>) => Promise<Response>;
    };
    let localRequests = 0;
    const local = async () => {
      localRequests++;
      return new Response("{}", { status: 200 });
    };
    for (const uri of ["/", "/?refresh=1", "/about", "/about/", "/about/?query=x"]) {
      await assert.rejects(
        requestPublic(uri, {}, "https://published.example", local),
        /Recursive generated page fetch/, framework + ": " + uri,
      );
    }
    assert.equal(localRequests, 0, framework);
    await requestPublic("/api/items?limit=2", {}, "https://published.example", local);
    assert.equal(localRequests, 1, framework);
  }
});

test("generated SSR never passes a normalized network-path reference to a local fetch", async () => {
  const doc: SiteDoc = {
    siteName: "Relative fetch", pageOrder: ["home"], assets: {}, nodes: {},
    pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: [] } },
  };
  for (const [format, path] of [
    ["vue", "src/server-request.js"], ["nuxt", "app/generated/server-request.js"],
    ["sveltekit", "src/lib/server-request.js"],
  ] as const) {
    const code = generateExportProject(doc, format).files[path];
    const { requestPublic } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
    const destinations: string[] = [];
    const base = "https://published.example";
    const local = async (url: string) => {
      destinations.push(new URL(url, base).href);
      return new Response("{}");
    };
    for (const uri of ["/a/..//127.0.0.1/private", "/a/%2e%2e//127.0.0.1/private"]) {
      await assert.rejects(requestPublic(uri, {}, base, local));
    }
    assert.deepEqual(destinations, [], format);
    await requestPublic("/api/items", {}, base, local);
    assert.deepEqual(destinations, [base + "/api/items"], format);
  }
});

test("generated Vue HTTP server rejects invalid request targets before rendering", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { request } = await import("node:http");
  const dir = await mkdtemp(join(tmpdir(), "vue-request-target-"));
  const doc: SiteDoc = {
    siteName: "Request target", pageOrder: ["home"], assets: {}, nodes: {},
    pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: [] } },
  };
  const project = generateExportProject(doc, "vue");
  const source = project.files["server.mjs"];
  try {
    await mkdir(join(dir, "dist/client"), { recursive: true });
    await mkdir(join(dir, "dist/server"), { recursive: true });
    await writeFile(join(dir, "package.json"), '{"type":"module"}');
    await writeFile(join(dir, "dist/client/index.html"), "<title><!--page-title--></title><!--app-html--><!--app-data-->");
    const result = {
      id: "home", title: "$& <title>", html: "<p>$&</p><!--app-data-->",
      vars: { value: "$' and $` and $$ <test>" }, description: "", status: 200,
    };
    await writeFile(join(dir, "dist/server/entry-server.js"),
      "export function render() { return " + JSON.stringify(result) + "; }");
    // Keep the generated handler intact and let the test select an ephemeral port.
    await writeFile(join(dir, "server.mjs"), source.replace('process.env.NODE_ENV === "production"', "true")
      .replace(/^server\.listen\(.*$/m, "export { server };"));
    const { server } = await import(pathToFileURL(join(dir, "server.mjs")).href);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const get = (path: string) => new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: server.address().port, path }, res => {
          res.resume(); resolve(res.statusCode!);
        });
        req.on("error", reject); req.end();
      });
      assert.equal(await get("/\\127.0.0.2/"), 400);
      assert.equal(await get("//["), 400);
      assert.equal(await get("/"), 200);
      const html = await (await fetch("http://127.0.0.1:" + server.address().port + "/")).text();
      assert.ok(html.includes("<title>$&amp; &lt;title&gt;</title>" + result.html));
      const payload = /<script id="site-payload" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
      assert.ok(payload);
      assert.deepEqual(JSON.parse(payload[1]), { id: result.id, vars: result.vars });
    } finally { await new Promise<void>(resolve => server.close(resolve)); }
  } finally { await rm(dir, { force: true, recursive: true }); }
});
