import assert from "node:assert/strict";
import { test } from "node:test";
import { toSingleHtmlProject } from "../lib/generator/single-html";

test("single HTML never includes untrusted Content-Type as HTML attribute syntax", async () => {
  const project = await toSingleHtmlProject({
    files: {
      "index.html": '<!doctype html><html><body><img src="./assets/remote.png"></body></html>',
    },
    binaries: {},
    remoteAssets: { "assets/remote.png": "assets/upload-id" },
  }, async () => new Response(Uint8Array.from([1, 2, 3]), {
    headers: {
      // This used to break out of src="data:..." and create an onerror handler.
      "Content-Type": 'image/png" onerror="globalThis.__tsumuInjected=1" fake="',
    },
  }));
  const html = project.files["index.html"];
  assert.match(html, /<img src="data:image\/png;base64,AQID">/);
  assert.doesNotMatch(html, /onerror=|fake=|__tsumuInjected/);
});

test("single HTML does not interpret tags or style text inside inline scripts", async () => {
  const authoredScript = [
    "window.template = '<img src=\"./missing.png\" style=\"background:url(./missing-bg.png)\">';",
    "window.styleText = 'style=\"background:url(./missing-css.png)\"';",
    "window.linkText = '<link rel=\"stylesheet\" href=\"./missing.css\">';",
  ].join("\n");
  const project = await toSingleHtmlProject({
    files: {
      "index.html": [
        "<!doctype html><html><head></head><body>",
        "<script>", authoredScript, "</script>",
        '<img src="./assets/pixel.png" style="background:url(./assets/pixel.png)">',
        "</body></html>",
      ].join("\n"),
    },
    binaries: { "assets/pixel.png": "AQID" },
    remoteAssets: {},
  });
  const html = project.files["index.html"];
  assert.ok(html.includes(authoredScript), "authored script content must remain byte-for-byte identical");
  assert.match(html, /<img src="data:image\/png;base64,AQID" style="background:url\(data:image\/png;base64,AQID\)">/);
  assert.equal((html.match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
});

test("single HTML leaves comments and textarea raw text untouched", async () => {
  const comment = '<!-- <img src="./missing.png"> <script src="./missing.js"></script> -->';
  const rawText = '<textarea><img src="./missing-textarea.png"><script src="./missing-textarea.js"></script></textarea>';
  const project = await toSingleHtmlProject({
    files: { "index.html": '<!doctype html><html><body>' + comment + rawText + "</body></html>" },
    binaries: {},
    remoteAssets: {},
  });
  assert.ok(project.files["index.html"].includes(comment));
  assert.ok(project.files["index.html"].includes(rawText));
});

test("lookalike attributes and quoted tag text cannot become executable script sources", async () => {
  const authored = '<div title="literal <script src=\'./evil.js\'></script>"></div>' +
    '<script data-src="./evil.js"></script><img data-src=./missing.png alt=">">';
  const project = await toSingleHtmlProject({
    files: { "index.html": authored, "evil.js": "globalThis.payloadRan = true;" }, binaries: {}, remoteAssets: {},
  });
  assert.equal(project.files["index.html"], authored);
});

test("embedding respects character references, unquoted attributes and SVG fragments", async () => {
  const project = await toSingleHtmlProject({
    files: { "index.html": '<img alt=">" src=pics/a&amp;b.svg#mark>' }, binaries: { "pics/a&b.svg": "PHN2Zy8+" }, remoteAssets: {},
  });
  assert.match(project.files["index.html"], /src="data:image\/svg\+xml;base64,PHN2Zy8\+#mark"/);
});

test("CSS text and comments cannot cause resource downloads", async () => {
  const css = '/* @import "absent.css"; */ .x{content:"url(missing.svg)"}';
  const project = await toSingleHtmlProject({
    files: { "index.html": "<style>" + css + "</style>" }, binaries: {}, remoteAssets: {},
  });
  assert.equal(project.files["index.html"], "<style>" + css + "</style>");
});

test("an integrity mismatch never becomes an executable inline resource", async () => {
  for (const tag of [
    '<script src="code.js" integrity="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="></script>',
    '<link rel=stylesheet href=theme.css integrity="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=">',
  ]) {
    await assert.rejects(toSingleHtmlProject({
      files: { "index.html": tag, "code.js": "attack()", "theme.css": ".h{}" }, binaries: {}, remoteAssets: {},
    }), /integrity/i);
  }
});

test("only a registered asset can use editor credentials", async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://editor.example") });
  const calls: [string, RequestInit][] = [];
  const request = async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } });
  };
  try {
    const source = { files: { "index.html": '<img src="local.png"><img src="https://cdn.example/img.png">' },
      remoteAssets: { "local.png": "assets/file" }, binaries: {} };
    await toSingleHtmlProject(source, request);
    assert.deepEqual(calls, [
      ["/api/assets/file?path=assets%2Ffile", { credentials: "same-origin", redirect: "error" }],
      ["https://cdn.example/img.png", { credentials: "omit", referrerPolicy: "no-referrer" }],
    ]);
    calls.length = 0;
    source.files["index.html"] = '<img src="https://editor.example/api/doc?site=private">';
    await assert.rejects(toSingleHtmlProject(source, request));
    assert.deepEqual(calls, []);
  } finally {
    if (before) Object.defineProperty(globalThis, "location", before);
    else Reflect.deleteProperty(globalThis, "location");
  }
});

test("nested stylesheets retain conditions, use their own base and ignore a template base", async () => {
  const project = await toSingleHtmlProject({
    files: {
      "index.html": '<template><base href="https://wrong.example/"></template><link rel=stylesheet href="css/main.css">',
      "css/main.css": '@import "sub/child.css" layer(colors) print;',
      "css/sub/child.css": 'p{background:image-set("../images/a.svg#mark" 1x)}',
    },
    binaries: { "css/images/a.svg": "PHN2Zy8+" }, remoteAssets: {},
  }, async () => { throw new Error("unexpected network request"); });
  const html = project.files["index.html"];
  const match = /@import "data:text\/css;base64,([^"]+)" layer\(colors\) print;/.exec(html);
  assert.ok(match);
  assert.match(atob(match[1]), /data:image\/svg\+xml;base64,PHN2Zy8\+#mark/);
});

test("CSS import alias cycles and deep chains stop before further reads", async () => {
  const files: Record<string, string> = { "index.html": "<link rel=stylesheet href='0.css'>", "0.css": '@import "0.css?cache";' };
  await assert.rejects(toSingleHtmlProject({ files, binaries: {}, remoteAssets: {} }), /Recursive CSS/);
  for (let i = 0; i < 34; i++) files[i + ".css"] = '@import "' + (i + 1) + '.css";';
  await assert.rejects(toSingleHtmlProject({ files, binaries: {}, remoteAssets: {} }), /depth/);
});

test("matching integrity is checked against source bytes before rewriting CSS", async () => {
  const css = "p { color: navy }";
  const sha = await crypto.subtle.digest("SHA-384", new TextEncoder().encode(css));
  const integrity = "sha384-" + Buffer.from(sha).toString("base64");
  const files = { "index.html": '<link rel=stylesheet media=print href=main.css integrity="' + integrity + '">', "main.css": css };
  const project = await toSingleHtmlProject({ files, binaries: {}, remoteAssets: {} });
  assert.match(project.files["index.html"], /<style media="print">\s*p \{ color: navy \}/);
  files["index.html"] = files["index.html"].replace(integrity, integrity + " sha512-AAAA");
  await assert.rejects(toSingleHtmlProject({ files, binaries: {}, remoteAssets: {} }), /integrity/i);
});

test("repeated references stop at the output limit before fetching subsequent resources", async () => {
  const files = { "index.html": '<img src=pic.png>'.repeat(50) + '<img src="https://cdn.example/last.png">' };
  let calls = 0;
  await assert.rejects(toSingleHtmlProject({ files, binaries: { "pic.png": "A".repeat(1024 * 1024) }, remoteAssets: {} },
    async () => { calls++; return new Response(); }), /48 MB/);
  assert.equal(calls, 0);
});

test("a redirected external stylesheet resolves references at the response URL", async () => {
  const seen: string[] = [];
  const project = await toSingleHtmlProject({
    files: { "index.html": '<link rel=stylesheet href="https://cdn.example/start">' }, binaries: {}, remoteAssets: {},
  }, async url => {
    seen.push(url);
    if (seen.length === 1) {
      const res = new Response('.a{background:url(icon.png)}', { headers: { "Content-Type": "text/css" } });
      Object.defineProperty(res, "url", { value: "https://cdn.example/assets/css/main.css" });
      return res;
    }
    return new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } });
  });
  assert.deepEqual(seen, ["https://cdn.example/start", "https://cdn.example/assets/css/icon.png"]);
  assert.match(project.files["index.html"], /data:image\/png;base64,AQ==/);
});

test("repeated candidates in one srcset fail before an oversized attribute is assembled", async () => {
  const files = { "index.html": '<img srcset="' + "pic.png 1x, ".repeat(80) + '">' };
  await assert.rejects(toSingleHtmlProject({ files, binaries: { "pic.png": "A".repeat(1024 * 1024) }, remoteAssets: {} }),
    /srcset exceeds/);
});

test("non-HTTP base schemes cannot redirect resource resolution", async () => {
  for (const href of ["vbscript:ignored", "javascript:ignored", "data:text/plain,ignored", "file:///tmp/"]) {
    const { files } = await toSingleHtmlProject({
      files: { "index.html": '<base href="' + href + '"><img src=pic.png>' },
      binaries: { "pic.png": "AQ==" }, remoteAssets: {},
    });
    assert.match(files["index.html"], /src="data:image\/png;base64,AQ=="/);
  }
});

test("module graphs reject unsafe dependencies, invalid integrity and non-portable imports", async () => {
  const files = { "index.html": '<script type=module src="entry.mjs"></script>', "entry.mjs": 'import "./entry.mjs"' };
  const project = { files, binaries: {}, remoteAssets: {} };
  await assert.rejects(toSingleHtmlProject(project), /circular/i);
  for (const code of ['import("./" + name)', 'import.meta.resolve("./x")', 'import a from "./a.json" with {type:"json"}']) {
    files["entry.mjs"] = code;
    await assert.rejects(toSingleHtmlProject(project), /HTML ZIP/);
  }
  files["entry.mjs"] = 'import "./bad.txt"';
  await assert.rejects(toSingleHtmlProject({ ...project, files: { ...files, "bad.txt": "attack()" } }), /media type/i);
  files["index.html"] = '<script type=module src="entry.mjs" integrity="sha256-AAAA"></script>';
  await assert.rejects(toSingleHtmlProject(project), /integrity/i);
  files["index.html"] = '<script type=importmap>{"imports":{"./bad.txt":"./safe.mjs"}}</script><script type=module src="entry.mjs"></script>';
  await assert.rejects(toSingleHtmlProject(project), /import map/);
});

test("a remote filename cannot promote a response with a missing or malformed active media type", async () => {
  for (const tag of ['<script src="https://cdn.example/a.js"></script>', '<link rel=stylesheet href="https://cdn.example/a.css">']) {
    for (const headers of [new Headers(), new Headers({ "Content-Type": 'invalid"type' })]) {
      await assert.rejects(toSingleHtmlProject({ files: { "index.html": tag }, remoteAssets: {}, binaries: {} },
        async () => new Response(new Uint8Array([97]), { headers })), /media type/);
    }
  }
});

test("module specifier rewriting does not publish signed resource URLs", async () => {
  const project = await toSingleHtmlProject({ files: { "index.html": '<script type=module src="https://cdn.example/e.js?token=private-marker"></script>' },
    remoteAssets: {}, binaries: {} }, async () => new Response("export default 1", { headers: { "Content-Type": "text/javascript" } }));
  assert.doesNotMatch(project.files["index.html"], /private-marker|cdn\.example/);
});
