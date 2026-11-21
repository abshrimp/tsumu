import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateExportProject } from "../lib/export-formats";
import type { SiteDoc } from "../lib/types";

const doc: SiteDoc = {
  siteName: "Native SSR export regression",
  pageOrder: ["home", "about"],
  pages: {
    home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] },
    about: { id: "about", name: "About", slug: "about", title: "About", description: "", children: [] },
  },
  nodes: {},
  assets: {},
};

for (const [framework, modulePath, pagePath, expectedBase] of [
  ["vue", "src/server-request.js", "src/entry-server.ts", "url.href"],
  ["nuxt", "app/generated/server-request.js", "app/pages/index.vue", "requestUrl.href"],
  ["sveltekit", "src/lib/server-request.js", "src/routes/+page.server.js", "url.href"],
] as const) {
  test(`${framework} resolves local SSR fetches relative to the requested page without losing the origin guard`, async () => {
    const files = generateExportProject(doc, framework).files;
    assert.match(files[pagePath], new RegExp("requestPublic\\(uri, init, " + expectedBase.replace(".", "\\.") + "|requestPublic\\(url, init, " + expectedBase.replace(".", "\\.")));
    const source = files[modulePath];
    assert.ok(source);
    const { requestPublic } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        local: (path: string, options: RequestInit) => Promise<Response>) => Promise<Response>;
    };
    const received: string[] = [];
    const local = async (path: string, options: RequestInit) => {
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "omit");
      received.push(path);
      return Response.json({ ok: true });
    };
    const base = "https://site.example/products/detail";
    for (const uri of ["./items?limit=2", "../api/orders?item=1", "/api/root"]) {
      const response = await requestPublic(uri, {}, base, local);
      assert.deepEqual(await response.json(), { ok: true });
    }
    assert.deepEqual(received, [
      "/products/items?limit=2",
      "/api/orders?item=1",
      "/api/root",
    ]);
    for (const invalid of ["//other.example/private", "/x/..//host/private", "..//host/private",
      "https://site.example/api/root", "../about"]) {
      await assert.rejects(requestPublic(invalid, {}, base, local), undefined, invalid);
    }
    assert.equal(received.length, 3, "blocked URLs must never reach the internal fetch");
  });
}

test("Vue SSR production commands are portable and serve binary resources with MIME types and byte ranges", async () => {
  const files = generateExportProject(doc, "vue").files;
  const scripts = JSON.parse(files["package.json"]).scripts;
  assert.equal(scripts.start, "node server.mjs --production");
  assert.equal(scripts.preview, "node server.mjs --production");
  assert.match(files["server.mjs"], /process\.argv\.includes\("--production"\)/);
  const dir = await mkdtemp(join(tmpdir(), "tsumu-vue-ssr-"));
  try {
    await mkdir(join(dir, "dist", "client", "assets"), { recursive: true });
    await mkdir(join(dir, "dist", "server"), { recursive: true });
    await writeFile(join(dir, "package.json"), '{"type":"module"}');
    await writeFile(join(dir, "dist", "client", "index.html"),
      "<title><!--page-title--></title><!--app-html--><!--app-data-->");
    await writeFile(join(dir, "dist", "server", "entry-server.js"),
      'export async function render() { return { status: 200, html: "<p>OK</p>", id: "home", vars: {}, title: "Home" }; }');
    const mimeCases = [
      [".wasm", "application/wasm"],
      [".m4a", "audio/mp4"],
      [".mov", "video/quicktime"],
    ];
    for (const [extension] of mimeCases) {
      await writeFile(join(dir, "dist", "client", "assets", "file" + extension), new Uint8Array([0, 1, 2]));
    }
    const serverFile = files["server.mjs"]
      .replace('process.env.NODE_ENV === "production" || process.argv.includes("--production")', "true")
      .replace(/^server\.listen\(.*$/m, "export { server };");
    await writeFile(join(dir, "server.mjs"), serverFile);
    const { server } = await import(pathToFileURL(join(dir, "server.mjs")).href);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      for (const [extension, mime] of mimeCases) {
        const response = await fetch(`http://127.0.0.1:${address.port}/assets/file${extension}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), mime);
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 1, 2]));
      }
      const sound = `http://127.0.0.1:${address.port}/assets/file.m4a`;
      for (const [range, contentRange, bytes] of [
        ["bytes=1-1", "bytes 1-1/3", [1]],
        ["bytes=1-", "bytes 1-2/3", [1, 2]],
        ["bytes=-1", "bytes 2-2/3", [2]],
        ["bytes=0-99", "bytes 0-2/3", [0, 1, 2]],
      ] as const) {
        const response = await fetch(sound, { headers: { Range: range } });
        assert.equal(response.status, 206);
        assert.equal(response.headers.get("content-range"), contentRange);
        assert.equal(response.headers.get("content-length"), String(bytes.length));
        assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], bytes);
      }
      const pastEnd = await fetch(sound, { headers: { Range: "bytes=3-" } });
      assert.equal(pastEnd.status, 416);
      assert.equal(pastEnd.headers.get("content-range"), "bytes */3");
      assert.equal(await pastEnd.text(), "");
      const head = await fetch(sound, { method: "HEAD" });
      assert.equal(head.headers.get("accept-ranges"), "bytes");
      assert.equal(head.headers.get("content-length"), "3");
      assert.equal(await head.text(), "");
      // A conditional or multipart request may fall back to the complete representation.
      const fullRequests: Record<string, string>[] = [
        { Range: "bytes=1-", "If-Range": '"old-version"' }, { Range: "bytes=0-0,2-2" },
      ];
      for (const headers of fullRequests) {
        const response = await fetch(sound, { headers });
        assert.equal(response.status, 200);
        assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 2]);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err: Error | undefined) => err ? reject(err) : resolve()));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
