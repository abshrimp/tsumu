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

  test(framework + " escapes native text and attributes and validates inline media URLs", () => {
    const doc = fixture();
    const source = generateExportProject(doc, framework).files[sourcePath];
    assert.ok(source, sourcePath);
    assert.match(source, /It&#39;s &lt;script&gt;not code&lt;\/script&gt;/);
    assert.match(source, /title="Owner&#39;s &amp; friends"/);
    assert.doesNotMatch(source, /Itundefineds|Ownerundefineds/);
    assert.doesNotMatch(source, /<script>not code<\/script>/);
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

test("Nuxt internal requests preserve the fetch policy, stream limit and bodyless statuses", async () => {
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
  // Nuxt runs this module on client navigation too, without Node's Buffer global.
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from("const Buffer = undefined;\n" + module).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        localFetch: (path: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
    };

  const data = await requestPublic("/api/records?page=2", {}, "https://site.example",
    makeLocal(async (path, init) => {
      assert.equal(path, "/api/records?page=2");
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      assert.equal(init.responseType, "stream");
      return Response.json({ title: "京都" });
    }));
  assert.deepEqual(await data.json(), { title: "京都" });

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
    id: "page-data", trigger: "load", steps: [
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

test("Native SSR socket lookup supports both Node { all: true } and single-address callbacks while blocking private DNS answers", async () => {
  const doc = fixture();
  doc.pages.home.pageScripts = [{
    id: "page-data", trigger: "load", steps: [
      { id: "request", kind: "fetch", url: "https://api.example/public", as: "records" },
    ],
  }];
  const module = generateExportProject(doc, "vue").files["src/server-request.js"];
  assert.ok(module);
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(module).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        localFetch: (path: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
    };

  const prevGetBuiltin = process.getBuiltinModule;
  let capturedLookup: ((host: string, flags: { all?: boolean }, cb: (...args: any[]) => void) => void) | undefined;
  let dnsAnswers: Array<{ address: string; family: number }> = [{ address: "93.184.216.34", family: 4 }];
  try {
    process.getBuiltinModule = ((id: string) => {
      if (id === "node:dns") {
        return {
          lookup(_host: string, _opts: unknown, cb: (err: Error | null, res: Array<{ address: string; family: number }>) => void) {
            cb(null, dnsAnswers);
          },
        };
      }
      if (id === "node:https") {
        return {
          request(_target: URL, opts: { lookup: typeof capturedLookup }, onRes: (res: any) => void) {
            capturedLookup = opts.lookup;
            setImmediate(() => {
              onRes({
                statusCode: 200,
                headers: { "content-type": "application/json" },
                destroy() {},
                async *[Symbol.asyncIterator]() { yield Buffer.from('{"ok":1}'); },
              });
            });
            return { on() {}, end() {}, destroy() {} };
          },
        };
      }
      return prevGetBuiltin(id);
    }) as typeof process.getBuiltinModule;

    const res = await requestPublic("https://api.example/public", {}, "https://site.example",
      async () => { throw new Error("unexpected"); });
    assert.deepEqual(await res.json(), { ok: 1 });
    assert.ok(capturedLookup);

    capturedLookup!("api.example", { all: true }, (err, list) => {
      assert.equal(err, null);
      assert.deepEqual(list, [{ address: "93.184.216.34", family: 4 }]);
    });
    capturedLookup!("api.example", {}, (err, addr, family) => {
      assert.equal(err, null);
      assert.equal(addr, "93.184.216.34");
      assert.equal(family, 4);
    });

    dnsAnswers = [{ address: "127.0.0.1", family: 4 }];
    capturedLookup!("api.example", { all: true }, (err, list) => {
      assert.match(String(err), /Private DNS address blocked/);
      assert.deepEqual(list, []);
    });
    capturedLookup!("api.example", {}, (err, addr, family) => {
      assert.match(String(err), /Private DNS address blocked/);
      assert.equal(addr, "");
      assert.equal(family, 4);
    });
  } finally {
    process.getBuiltinModule = prevGetBuiltin;
  }
});

test("Native components render span icons, guard input attributes by type, and fall back unsafe dynamic image URLs to EMPTY_GIF", async () => {
  const doc = fixture();
  doc.nodes.icon = {
    ...makeBox(), id: "icon", type: "icon",
    icon: { name: "check", svg: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' },
  };
  doc.nodes.textInput = {
    ...makeBox(), id: "textInput", type: "field",
    field: { kind: "input", inputType: "text", min: "1", max: "10", step: "2", maxLength: 20, placeholder: "Name" },
  };
  doc.nodes.colorInput = {
    ...makeBox(), id: "colorInput", type: "field",
    field: { kind: "input", inputType: "color", maxLength: 7, placeholder: "Ignored" },
  };
  doc.assets.logo = {
    id: "logo", name: "logo.svg", mimeType: "image/svg+xml",
    width: 48, height: 24, svgFilter: true, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
  };
  doc.nodes.svgLogo = {
    ...makeBox(), id: "svgLogo", type: "image",
    image: { src: "/logo.svg", assetId: "logo", alt: "Logo", width: 48, height: 24 },
  };
  doc.nodes.unsafeImg = {
    ...makeBox(), id: "unsafeImg", type: "image",
    image: { src: "javascript:alert(1)", alt: "Blocked", width: 10, height: 10 },
  };
  doc.pages.home.children.push("icon", "textInput", "colorInput", "svgLogo", "unsafeImg");

  const vueFiles = generateExportProject(doc, "vue").files;
  const page = vueFiles["src/pages/Page0.vue"];
  assert.match(page, /<span[^>]*aria-hidden="true"[^>]*v-html=/);
  assert.match(page, /type="text"[^>]*placeholder="Name"[^>]*maxlength="20"/);
  const textInputTag = page.match(/<input[^>]*type="text"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(textInputTag, /\b(?:min|max|step)=/);
  const colorInputTag = page.match(/<input[^>]*type="color"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(colorInputTag, /\b(?:placeholder|maxlength)=/);
  assert.match(page, /--crisp-svg-width:48px;--crisp-svg-ratio:48\/24/);
  assert.match(page, /<img[^>]*src="data:image\/gif;base64,[^"]*"[^>]*alt="Blocked"/);

  const siteData = vueFiles["src/site-data.js"];
  const { resolveResourceUrl } = await import("data:text/javascript;base64," +
    Buffer.from(siteData).toString("base64")) as {
      resolveResourceUrl: (template: string, scope: Record<string, unknown>) => string;
    };
  assert.equal(resolveResourceUrl("{img}", { img: "javascript:alert(1)" }), "#");
  assert.equal(resolveResourceUrl("{img}", { img: "" }), "#");
  assert.equal(resolveResourceUrl("{img}", { img: "https://example.com/pic.png" }), "https://example.com/pic.png");
});

