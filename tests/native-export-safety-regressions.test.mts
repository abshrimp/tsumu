import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    siteName: "Export regression",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", name: "Home", slug: "", title: "Home", description: "",
        children: ["heading", "audio", "video"],
      },
    },
    nodes: {
      heading: {
        ...makeBox(), id: "heading", text: {
          content: "It's <script>not code</script>", heading: 1,
        },
        htmlAttrs: { title: "Owner's & friends" },
      },
      audio: {
        ...makeBox(), id: "audio", type: "media",
        media: { kind: "audio", src: "data:audio/wav;base64,AQID" },
      },
      video: {
        ...makeBox(), id: "video", type: "media",
        media: { kind: "video", src: "data:video/mp4;base64,AQID" },
      },
    },
    assets: {},
  };
}

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  const sourcePath = framework === "nuxt"
    ? "app/generated/pages/Page0.vue"
    : framework === "sveltekit" ? "src/lib/pages/Page0.svelte" : "src/pages/Page0.vue";

  test(framework + " preserves apostrophes in escaped native text and attributes", () => {
    const source = generateExportProject(fixture(), framework).files[sourcePath];
    assert.ok(source, sourcePath);
    assert.match(source, /It&#39;s &lt;script&gt;not code&lt;\/script&gt;/);
    assert.match(source, /title="Owner&#39;s &amp; friends"/);
    assert.doesNotMatch(source, /Itundefineds|Ownerundefineds/);
    assert.doesNotMatch(source, /<script>not code<\/script>/);
  });

  test(framework + " preserves valid inline audio and video without allowing scripts", () => {
    const doc = fixture();
    const source = generateExportProject(doc, framework).files[sourcePath];
    assert.match(source, /src="data:audio\/wav;base64,AQID"/);
    assert.match(source, /src="data:video\/mp4;base64,AQID"/);
    doc.nodes.audio.media!.src = "javascript:alert(1)";
    const denied = generateExportProject(doc, framework).files[sourcePath];
    assert.match(denied, /<audio[^>]*src="#"/);
    assert.doesNotMatch(denied, /javascript:alert/);
  });
}

test("HTML export keeps inline image, audio, and video resources without allowing active schemes", () => {
  const doc = fixture();
  doc.nodes.picture = {
    ...makeBox(), id: "picture", type: "image",
    image: { src: "data:image/png;base64,AQID", alt: "Pixel", width: 1, height: 1 },
  };
  doc.pages.home.children.push("picture");
  const html = generateExportProject(doc, "html").files["index.html"];
  assert.match(html, /<img[^>]*src="data:image\/png;base64,AQID"/);
  assert.match(html, /<audio[^>]*src="data:audio\/wav;base64,AQID"/);
  assert.match(html, /<video[^>]*src="data:video\/mp4;base64,AQID"/);
  doc.nodes.picture.image!.src = "data:text/html;base64,PHNjcmlwdD4=";
  doc.nodes.audio.media!.src = "javascript:alert(1)";
  const denied = generateExportProject(doc, "html").files["index.html"];
  assert.doesNotMatch(denied, /data:text\/html|javascript:alert/);
  assert.match(denied, /<audio[^>]*src="#"/);
});

test("Next.js export applies the same media URL restrictions", () => {
  const doc = fixture();
  const source = generateExportProject(doc, "nextjs").files["app/page.tsx"];
  assert.match(source, /data:audio\/wav;base64,AQID/);
  assert.match(source, /data:video\/mp4;base64,AQID/);
  doc.nodes.audio.media!.src = "javascript:alert(1)";
  const denied = generateExportProject(doc, "nextjs").files["app/page.tsx"];
  assert.doesNotMatch(denied, /javascript:alert/);
});

test("Nuxt internal requests stream responses and retain bodyless HTTP statuses", async () => {
  const files = generateExportProject(fixture(), "nuxt").files;
  const page = files["app/pages/index.vue"];
  const source = page.match(/const requestLocal = async \(path, init\) => \{[\s\S]*?\n\};/)?.[0];
  assert.ok(source, "Nuxt generated page should define the internal request adapter");
  type RawFetch = (path: string, init: Record<string, unknown>) => Promise<Response>;
  const makeLocal = (raw: RawFetch): ((path: string, init?: RequestInit) => Promise<Response>) =>
    new Function("$fetch", source + "\nreturn requestLocal;")({ raw });

  for (const status of [204, 205, 304]) {
    const requestLocal = makeLocal(async (_path, init) => {
      assert.equal(init.responseType, "stream");
      return new Response(null, { status });
    });
    const response = await requestLocal("/api/no-content", {});
    assert.equal(response.status, status);
    assert.equal(response.body, null);
  }

  const head = makeLocal(async () => new Response("some data"));
  assert.equal((await head("/api/metadata", { method: "HEAD" })).body, null);

  const module = files["app/generated/server-request.js"];
  assert.ok(module);
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(module).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        localFetch: (path: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
    };

  let pulls = 0, cancellations = 0;
  const local = makeLocal(async (_path, init) => {
    assert.equal(init.responseType, "stream");
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() { cancellations++; },
    }), { headers: { "content-type": "application/json" } });
  });
  await assert.rejects(
    requestPublic("/api/large", {}, "https://site.example", local),
    /SSR response exceeds 5 MB/,
  );
  assert.equal(cancellations, 1);
  assert.ok(pulls <= 8, "the response is cancelled near the configured limit");
});

test("HTML media paths are not page routes even when the asset path matches a slug", () => {
  const doc = fixture();
  doc.pages.home.slug = "blog";
  doc.pages.resource = {
    id: "resource", name: "Resource", slug: "audio", title: "Resource",
    description: "", children: [],
  };
  doc.pageOrder.push("resource");
  doc.nodes.audio.media!.src = "/audio";
  const files = generateExportProject(doc, "html").files;
  const html = files["blog/index.html"];
  assert.ok(html);
  assert.match(html, /<audio[^>]*src="\.\.\/audio"/);
  assert.doesNotMatch(html, /<audio[^>]*src="[^"]*audio\/index\.html"/);
});

test("Nuxt client navigation uses browser fetch without bypassing the SSR origin allowlist", async () => {
  const doc = fixture();
  doc.pages.home.pageScripts = [{
    id: "page-data", trigger: "load", pos: { x: 0, y: 0 }, steps: [
      { id: "request", kind: "fetch", url: "https://api.example/public", as: "records" },
    ],
  }];
  const module = generateExportProject(doc, "nuxt").files["app/generated/server-request.js"];
  assert.ok(module);
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(module).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        localFetch: (path: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
    };

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousFetch = globalThis.fetch;
  let requests = 0;
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    globalThis.fetch = async (url, init) => {
      requests++;
      assert.equal(String(url), "https://api.example/public");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    };
    const fromBrowser = await requestPublic("https://api.example/public", {},
      "https://site.example", async () => { throw new Error("unexpected same-origin request"); });
    assert.deepEqual(await fromBrowser.json(), { ok: true });
    assert.equal(requests, 1);
    await assert.rejects(
      requestPublic("https://another.example/private", {}, "https://site.example",
        async () => { throw new Error("unexpected request"); }),
      /not allowed/,
    );
    assert.equal(requests, 1, "disallowed origins must never reach the browser transport");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
