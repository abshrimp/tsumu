import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPublicUrl, BlockedUrlError, fetchPublic, isPrivateHost, readTextLimited, TooLargeError } from "../lib/safe-fetch";
import { activeContentNames, isOwnClip, parseClipPayload } from "../lib/clip-transfer";
import { normalizeSiteInput } from "../lib/sites";
import { makeBox } from "../lib/presets";

test("server-side fetches refuse private, loopback and metadata hosts in every spelling", async () => {
  const blocked = [
    "http://localhost/", "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/",
    "http://0.0.0.0/", "http://10.0.0.1/", "http://172.16.0.1/", "http://192.168.1.1/", "http://100.64.0.1/",
    "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::]/", "http://[::ffff:127.0.0.1]/",
    "http://[fd00::1]/", "http://[fe80::1]/", "http://metadata.google.internal/", "http://metadata/",
    "http://printer.local/", "http://app.localhost/", "ftp://example.com/", "file:///etc/passwd",
    "http://user:pass@example.com/",
  ];
  for (const url of blocked) {
    await assert.rejects(assertPublicUrl(url), BlockedUrlError, url);
  }
  assert.equal(isPrivateHost("example.com"), false);
  assert.equal(isPrivateHost("8.8.8.8"), false);
  assert.equal(isPrivateHost("[2606:4700::1111]"), false);
});

test("redirects to a private host are not followed", async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
  }) as typeof fetch;
  try {
    await assert.rejects(fetchPublic("http://93.184.215.14/", {}), BlockedUrlError);
    assert.deepEqual(seen, ["http://93.184.215.14/"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("redirects cannot send credentials, custom API keys or bodies to another origin", async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const location of ["https://8.8.8.8/collect", "http://93.184.215.14/collect", "https://93.184.215.14:8443/collect"]) {
      for (const init of [
        { headers: { Authorization: "Bearer secret" } },
        { headers: new Headers({ Cookie: "session=secret" }) },
        { headers: [["X-API-Key", "secret"]] },
        { method: "POST", body: "secret" },
        { method: "DELETE" },
      ] as RequestInit[]) {
        const seen: string[] = [];
        let cancelled = false;
        globalThis.fetch = (async (input: RequestInfo | URL) => {
          seen.push(String(input));
          return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
            status: 307, headers: { location },
          });
        }) as typeof fetch;
        await assert.rejects(fetchPublic("https://93.184.215.14/start", init), BlockedUrlError);
        assert.deepEqual(seen, ["https://93.184.215.14/start"]);
        assert.equal(cancelled, true);
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("same-origin redirects retain credentials and public cross-origin GETs still work", async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const sameOrigin of [true, false]) {
      const seen: { url: string; headers: Headers; method?: string; body?: BodyInit | null }[] = [];
      const location = sameOrigin ? "/next" : "https://8.8.8.8/next";
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), headers: new Headers(init?.headers), method: init?.method, body: init?.body });
        return seen.length === 1
          ? new Response(null, { status: 302, headers: { location } })
          : new Response("ok");
      }) as typeof fetch;
      const headers = new Headers({ Accept: "application/json" });
      if (sameOrigin) {
        headers.set("Authorization", "Bearer secret");
        headers.set("Content-Type", "application/json");
      }
      const res = await fetchPublic("https://93.184.215.14/start", {
        headers, ...(sameOrigin ? { method: "POST", body: "{}" } : {}),
      });
      assert.equal(await res.text(), "ok");
      assert.equal(seen.length, 2);
      assert.equal(seen[1].url, new URL(location, "https://93.184.215.14").href);
      assert.equal(seen[1].headers.get("authorization"), sameOrigin ? "Bearer secret" : null);
      assert.equal(seen[1].headers.get("accept"), "application/json");
      assert.equal(seen[1].headers.has("content-type"), false);
      assert.equal(seen[1].method, "GET");
      assert.equal(seen[1].body, undefined);
      assert.equal(headers.has("content-type"), sameOrigin, "caller headers stay unchanged");
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("response bodies are read only up to the limit", async () => {
  const big = new Response(new ReadableStream({
    start(c) {
      for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(1024));
      c.close();
    },
  }));
  await assert.rejects(readTextLimited(big, 4096), TooLargeError);
  assert.equal(await readTextLimited(new Response("ok"), 4096), "ok");
});

test("pasted clipboard data that this editor did not write needs confirmation for HTML elements", () => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
  };
  try {
    const code = { ...makeBox(), id: "c", name: "Widget", type: "code" as const, code: { html: "<img src=x onerror=alert(1)>" } };
    const raw = JSON.stringify({ v: 1, site: "evil", nodes: [code], rootIds: ["c"], assets: {}, components: {}, componentNodes: [], customFonts: [] });
    const payload = parseClipPayload(raw)!;
    assert.ok(payload);
    assert.equal(isOwnClip(raw), false);
    assert.deepEqual(activeContentNames(payload), ["Widget"]);
    // エディタがコピーしたときの控えと同じなら信用する
    store.set("tsumu-clipboard-v1", raw);
    assert.equal(isOwnClip(raw), true);
    // 子の参照が欠けた・形の崩れたデータは読まない
    assert.equal(parseClipPayload(JSON.stringify({ v: 1, nodes: [{ ...code, children: ["missing"] }], rootIds: ["c"], assets: {} })), null);
    assert.equal(parseClipPayload(JSON.stringify({ v: 1, nodes: [{ id: "x" }], rootIds: ["x"], assets: {} })), null);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("repository and branch names cannot walk to other GitHub API paths", () => {
  const base = { name: "Site", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null };
  for (const repo of ["owner/..", "../repo", "./x", "owner/."]) {
    assert.equal(normalizeSiteInput({ repo }, base).ok, false, repo);
  }
  for (const branch of ["a/../../..", "..", "a//b", "a/", "a.lock", "a/.hidden", "a@{1}"]) {
    assert.equal(normalizeSiteInput({ branch }, base).ok, false, branch);
  }
  assert.equal(normalizeSiteInput({ repo: "my.org/my.site", branch: "release/v1.2" }, base).ok, true);
});

test("signed asset URLs are tied to the path and expire", async () => {
  const { signAssetPath, verifyAssetToken, ASSET_TOKEN_TTL } = await import("../lib/asset-token");
  const prev = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-secret";
  try {
    const now = 1_700_000_000_000;
    const q = new URLSearchParams((await signAssetPath("assets/a.png", now))!);
    assert.equal(await verifyAssetToken("assets/a.png", q.get("exp"), q.get("sig"), now + 1000), true);
    // 別のファイル・期限切れ・改ざんは通さない
    assert.equal(await verifyAssetToken("assets/b.png", q.get("exp"), q.get("sig"), now + 1000), false);
    assert.equal(await verifyAssetToken("assets/a.png", q.get("exp"), q.get("sig"), now + ASSET_TOKEN_TTL + 1), false);
    assert.equal(await verifyAssetToken("assets/a.png", String(now + 10 * ASSET_TOKEN_TTL), q.get("sig"), now), false);
    assert.equal(await verifyAssetToken("assets/a.png", q.get("exp"), "AAAA", now), false);
    // ログインを使っていない（鍵が無い）ときは署名しない
    delete process.env.AUTH_SECRET;
    assert.equal(await signAssetPath("assets/a.png", now), null);
    assert.equal(await verifyAssetToken("assets/a.png", q.get("exp"), q.get("sig"), now), false);
  } finally {
    if (prev === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prev;
  }
});

test("API writes from another site are refused, the editor's own requests pass", async () => {
  const { isCrossSiteWrite } = await import("../lib/csrf");
  const req = (method: string, headers: Record<string, string>) => ({ method, headers: new Headers({ host: "editor.example.com", ...headers }), nextUrl: { host: "editor.example.com" } });
  assert.equal(isCrossSiteWrite(req("POST", { origin: "https://evil.example", "sec-fetch-site": "cross-site" })), true);
  assert.equal(isCrossSiteWrite(req("PUT", { origin: "https://evil.example" })), true);
  assert.equal(isCrossSiteWrite(req("POST", { origin: "null" })), true);
  assert.equal(isCrossSiteWrite(req("DELETE", { "sec-fetch-site": "same-site" })), true);
  assert.equal(isCrossSiteWrite(req("POST", { origin: "https://editor.example.com", "sec-fetch-site": "same-origin" })), false);
  assert.equal(isCrossSiteWrite(req("GET", { origin: "https://evil.example", "sec-fetch-site": "cross-site" })), false);
  // リバースプロキシが Host を書き換えていても、ブラウザが同じオリジンと言うなら通す
  assert.equal(isCrossSiteWrite({ ...req("POST", { origin: "https://editor.example.com", "sec-fetch-site": "same-origin" }), headers: new Headers({ host: "localhost:3000", origin: "https://editor.example.com", "sec-fetch-site": "same-origin" }) }), false);
  // ブラウザ以外（Origin なし）は CSRF にならない
  assert.equal(isCrossSiteWrite(req("POST", {})), false);
});

test("document values never become code or paths outside the exported project", async () => {
  const { generateProject } = await import("../lib/generator");
  const { headHtmlToJsx } = await import("../lib/generator/head");
  const text = { ...makeBox(), id: "t", text: { content: "x", heading: 0 }, styles: { base: { default: { fontFamily: 'Evil } from "fs"; //' } } } };
  const doc = {
    siteName: "s", pageOrder: ["p", "q"], assets: {}, nodes: { t: text },
    customFonts: [{ family: 'Evil } from "fs"; //', weights: ["400"] }],
    pages: {
      p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["t"] },
      q: { id: "q", name: "Up", slug: "../../.github/workflows", title: "Up", description: "", children: [] },
    },
  };
  const { files } = generateProject(doc as never);
  assert.doesNotMatch(files["app/layout.tsx"], /from "fs"/);
  assert.ok(Object.keys(files).every((path) => !path.split("/").includes("..")), Object.keys(files).join(","));
  // head の属性名に JSX の式を書いても、属性として出さない
  assert.doesNotMatch(headHtmlToJsx(`<meta x-{...globalThis.y} content="a">`, ""), /globalThis/);
});

test("embed URLs refuse javascript/data schemes and spoofed Google Maps origins", async () => {
  const { embedSrc } = await import("../lib/embed");
  // Googleマップの埋め込みを装った javascript: / data: / 外部ドメインはそのまま iframe に渡さない
  for (const malicious of [
    "javascript:alert(1)//google.com/maps/embed",
    "data:text/html,<script>alert(1)</script>?google.com/maps/embed",
    "https://evil.example/?q=google.com/maps/embed",
    "https://user@www.google.com/maps/embed?pb=1",
  ]) {
    const out = embedSrc({ kind: "map", src: malicious });
    assert.ok(out?.startsWith("https://www.google.com/maps?q="), malicious);
  }
  assert.equal(
    embedSrc({ kind: "map", src: "https://www.google.com/maps/embed?pb=!1m18" }),
    "https://www.google.com/maps/embed?pb=!1m18"
  );
  // URL埋め込みは http(s) のみ許可し、javascript: や data: は null にする
  assert.equal(embedSrc({ kind: "url", src: "javascript:alert(1)" }), null);
  assert.equal(embedSrc({ kind: "url", src: "data:text/html,<script>alert(1)</script>" }), null);
  assert.equal(embedSrc({ kind: "url", src: "https://example.com/widget" }), "https://example.com/widget");
});

test("URL interpolation and exported links refuse data:text/html, javascript: and protocol-relative redirects", async () => {
  const { interpolateUrl } = await import("../lib/vars");
  const { generateProject } = await import("../lib/generator");
  // data:text/html・data:image/svg+xml・//evil.example は URL そのものとして通さずエンコードする
  for (const unsafe of [
    "data:text/html,<script>alert(1)</script>",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "//evil.example/phish",
    "javascript:alert(1)",
  ]) {
    assert.equal(interpolateUrl("{u}", { u: unsafe }), encodeURIComponent(unsafe));
  }
  assert.equal(interpolateUrl("{u}", { u: "/about" }), "/about");
  assert.equal(interpolateUrl("{u}", { u: "https://example.com/a" }), "https://example.com/a");
  assert.equal(interpolateUrl("{u}", { u: "data:image/png;base64,AAAA" }), "data:image/png;base64,AAAA");

  // 「\」・制御文字はパスまでの中では拒み、クエリ・フラグメントの中はそのまま通す（生成サイトのランタイムも同じ）
  const { safeNavigationUrl, NAVIGATION_RUNTIME } = await import("../lib/url-policy");
  const runtime = new Function(`${NAVIGATION_RUNTIME}\nreturn safeNavigationUrl;`)() as (u: string) => string;
  for (const [url, expected] of [
    ["/\\evil.example", "#"],
    ["https:\\\\evil.example", "#"],
    ["https://example.com\\@evil.example/", "#"],
    ["https://example.com/?q=C:\\new", "https://example.com/?q=C:\\new"],
    ["/docs#a\\b", "/docs#a\\b"],
    ["java\nscript:alert(1)", "#"],
    ["https://example.com/\t?q=1", "#"],
  ]) {
    assert.equal(safeNavigationUrl(url), expected, url);
    assert.equal(runtime(url), expected, url);
  }

  // 要素のリンクに javascript: や data: が入っていても書き出しコードでは # に無害化される
  const linkNode = {
    ...makeBox(),
    id: "l1",
    text: { content: "Click", heading: 0 },
    link: { kind: "url" as const, url: "javascript:alert(1)" },
  };
  const doc = {
    siteName: "s",
    pageOrder: ["p"],
    assets: {},
    nodes: { l1: linkNode },
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["l1"] } },
  };
  const { files } = generateProject(doc as never);
  assert.doesNotMatch(files["app/page.tsx"], /javascript:/);
});

test("SSRF guards block multi-dot internal hosts, [slug] dynamic origins, and private IPv6 forms", async () => {
  const { dynamicOrigin } = await import("../lib/generator/render-helpers");
  for (const url of [
    "http://localhost../",
    "http://metadata../",
    "http://127.0.0.1./",
    "http://[2002:7f00:1::]/",
    "http://[fec0::1]/",
    "http://[0:0:0:0:0:0:0:1]/",
  ]) {
    await assert.rejects(assertPublicUrl(url), BlockedUrlError, url);
  }
  assert.equal(dynamicOrigin("http://[slug]/api"), true);
  assert.equal(dynamicOrigin("https://expected.com@[slug]/api"), true);
  assert.equal(dynamicOrigin("https://api.example.com/[slug]"), false);

  // 書き出したサイトも同じ assertPublicUrl（lib/safe-fetch.ts の写し）で宛先を確かめる
  for (const blocked of [
    "http://localhost./",
    "http://localhost../",
    "http://127.0.0.1./",
    "http://metadata./",
    "http://db.intranet/",
    "http://:secret@example.com/",
    "http://[0:0:0:0:0:ffff:7f00:1]/",
  ]) {
    await assert.rejects(assertPublicUrl(blocked), BlockedUrlError, blocked);
  }
  assert.equal(isPrivateHost("api.example.com"), false);
});

test("clipboard assets and exported asset names refuse HTML files and style tag breakouts", async () => {
  const { mergeClipDeps } = await import("../lib/clip-transfer");
  const { buildAssetNames } = await import("../lib/generator/names");
  const { rawHtmlWithBodyStyles } = await import("../lib/generator/css");
  const { previewHtmlWithBodyStyles } = await import("../components/canvas/css");

  const doc = {
    siteName: "s",
    pageOrder: ["p"],
    assets: {},
    nodes: {},
    pages: {
      p: {
        id: "p",
        name: "Home",
        slug: "",
        title: "Home",
        description: "",
        children: [],
        htmlBackground: "red;</style><script>alert(1)</script>",
      },
    },
  };
  mergeClipDeps(doc as never, {
    v: 1,
    site: "evil",
    nodes: [],
    rootIds: [],
    assets: {
      badHtml: { id: "badHtml", name: "evil.html", mimeType: "text/html", dataUrl: "data:text/html;base64,AAAA", width: 1, height: 1 },
      badPath: { id: "badPath", name: "a.png", mimeType: "image/png", path: "assets/../secret", width: 1, height: 1 },
      goodPng: { id: "goodPng", name: "ok.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA", width: 1, height: 1 },
    },
    components: {},
    componentNodes: [],
    customFonts: [],
  });
  assert.deepEqual(Object.keys(doc.assets), ["goodPng"]);

  // 万一 doc.assets に .html 名のアセットが入っていても公開ファイル名に .html を使わない
  const names = buildAssetNames({
    ...doc,
    assets: { x: { id: "x", name: "page.html", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA", width: 1, height: 1 } },
  } as never);
  assert.equal(names.get("x"), "page.png");

  // bodyStyles や htmlBackground に </style> が含まれても <style> タグを脱出できない
  const rawOut = rawHtmlWithBodyStyles(doc as never, doc.pages.p as never, "<head></head><body></body>", new Map());
  assert.doesNotMatch(rawOut, /<\/style><script>/);
  const previewOut = previewHtmlWithBodyStyles(
    "<head></head><body></body>",
    { base: { default: { backgroundImage: "url(a)</style><script>alert(1)</script>" } } },
    "base"
  );
  assert.doesNotMatch(previewOut, /<\/style><script>/);
});

