import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { parse } from "parse5";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { runInNewContext } from "node:vm";
import { singleHtmlResources, EXPORT_BASE } from "../lib/generator/single-html-resources";
import { createHash } from "node:crypto";

describe("single-html-svg-image", () => {
  for (const attribute of ["href", "xlink:href"]) {
    test(`single HTML embeds SVG image ${attribute} instead of dropping the referenced asset`, async () => {
      const project = await toSingleHtmlProject({
        files: { "index.html": `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image ${attribute}="picture.png" width="30" height="20"/></svg>` },
        binaries: { "picture.png": "AQID" }, remoteAssets: {},
      });
      assert.match(project.files["index.html"], new RegExp(`${attribute}="data:image/png;base64,AQID"`));
      assert.match(project.files["index.html"], /width="30" height="20"\/>/);
      const tree = parse(project.files["index.html"]);
      const elements: any[] = [];
      const visit = (node: any) => { if (node.tagName === "image") elements.push(node); node.childNodes?.forEach(visit); };
      visit(tree);
      assert.equal(elements.length, 1);
      assert.equal(elements[0].namespaceURI, "http://www.w3.org/2000/svg");
      assert.deepEqual(project.binaries, {});
    });
  }

  test("SVG image fragments remain internal and ordinary hyperlinks are not downloaded", async () => {
    const html = '<svg><image href="#local"/><a href="https://example.com/"><text>link</text></a></svg>';
    const project = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} }, async () => {
      throw new Error("Unexpected download");
    });
    assert.equal(project.files["index.html"], html);
  });

  test("SVG href takes precedence over an unused xlink source", async () => {
    const project = await toSingleHtmlProject({
      files: { "index.html": '<svg><image href="picture.png" xlink:href="missing.png"/></svg>' },
      binaries: { "picture.png": "AQID" }, remoteAssets: {},
    });
    assert.match(project.files["index.html"], /href="data:image\/png;base64,AQID"/);
  });
});

describe("single-html-script-types", () => {
  const legacyTypes = ["text/jscript", "text/livescript", ...Array.from({ length: 6 }, (_, i) => `text/javascript1.${i}`)];
  for (const type of legacyTypes) {
    test(`single HTML embeds executable ${type} scripts`, async () => {
      const result = await toSingleHtmlProject({ files: {
        "index.html": `<script type="${type}" src="./legacy.js" defer></script>`,
        "legacy.js": "globalThis.answer = 42;",
      }, binaries: {}, remoteAssets: {} }, async () => { throw new Error("Unexpected network request"); });
      const scripts: any[] = [];
      const visit = (node: any) => { if (node.tagName === "script") scripts.push(node); node.childNodes?.forEach(visit); };
      visit(parse(result.files["index.html"]));
      const attrs = Object.fromEntries(scripts[0].attrs.map((a: any) => [a.name, a.value]));
      assert.match(attrs.src, /^data:/);
      assert.equal(attrs.type, type);
      assert.ok(Object.hasOwn(attrs, "defer"));
      const context: any = {};
      runInNewContext(Buffer.from(attrs.src.split(",")[1].split("#")[0], "base64").toString(), context);
      assert.equal(context.answer, 42);
    });
  }
  test("single HTML preserves non-executable script type data blocks without fetching", async () => {
    for (const type of ["application/json", "text/javascript; charset=utf-8", "text/javascript1.6"]) {
      const html = `<script type="${type}" src="https://example.invalid/data">data</script>`;
      const result = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} }, async () => { throw new Error("Unexpected network request"); });
      assert.equal(result.files["index.html"], html);
    }
  });

  for (const type of legacyTypes) {
    test(`single HTML accepts fetched script MIME ${type}`, async () => {
      const result = await toSingleHtmlProject({ files: { "index.html": '<script src="https://cdn.example/script.js"></script>' }, binaries: {}, remoteAssets: {} }, async () => new Response("globalThis.answer = 42;", { headers: { "Content-Type": type } }));
      assert.ok(result.files["index.html"].includes(`data:${type};base64,`));
    });
  }
});

describe("single-html-inline-modules", () => {
  const noRequest = async () => { throw new Error("Unexpected network request"); };
  const run = (source: string) => import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  test("inline modules resolve static and dynamic dependencies relative to the document base", async () => {
    const resources = singleHtmlResources({ files: {
      "dir/entry.mjs": 'import { value } from "./child.mjs"; export const n = value + 1;',
      "dir/child.mjs": "export const value = 40;",
    }, binaries: {}, remoteAssets: {} }, noRequest, false);
    const text = await resources.inlineModule('import { n } from "./entry.mjs"; export const result = n + (await import("./child.mjs")).value;', new URL("dir/page.html", EXPORT_BASE));
    assert.ok(!text.includes('"./entry.mjs"'));
    assert.ok(!text.includes('"./child.mjs"'));
    assert.equal((await run(text)).result, 81);
  });
  test("inline modules reuse cached dependencies and retain data URL imports", async () => {
    const resources = singleHtmlResources({ files: { "value.mjs": "export const n = {};" }, binaries: {}, remoteAssets: {} }, noRequest, false);
    const text = await resources.inlineModule('import { n as a } from "./value.mjs"; import { n as b } from "./value.mjs"; import { n as c } from "data:text/javascript,export const n=2"; export const result = a === b && c === 2;', EXPORT_BASE);
    assert.equal((await run(text)).result, true);
  });
  test("inline modules reject circular dependencies and non-static resolution just like external modules", async () => {
    const resources = singleHtmlResources({ files: { "a.mjs": 'import "./b.mjs";', "b.mjs": 'import "./a.mjs";' }, binaries: {}, remoteAssets: {} }, noRequest, false);
    await assert.rejects(resources.inlineModule('import "./a.mjs";', EXPORT_BASE), /circular/);
    await assert.rejects(resources.inlineModule('import(location.href);', EXPORT_BASE), /runtime resolution/);
    await assert.rejects(resources.inlineModule('console.log(import.meta.url);', EXPORT_BASE), /runtime resolution/);
  });
  test("inline scripts with no imports retain their bytes while authored import maps fail closed", async () => {
    const resources = singleHtmlResources({ files: {}, binaries: {}, remoteAssets: {} }, noRequest, true);
    const plain = 'const text = "<script>not an import</script>";';
    assert.equal(await resources.inlineModule(plain, EXPORT_BASE), plain);
    await assert.rejects(resources.inlineModule('import "./x.mjs";', EXPORT_BASE), /import map/);
  });

  test("single HTML rewrites inline module bodies and preserves surrounding markup", async () => {
    const { toSingleHtmlProject } = await import("../lib/generator/single-html");
    const { parse } = await import("parse5");
    const html = '<!doctype html><base href="/dir/"><script type="module" nonce="test">import { n } from "./entry.mjs"; export const answer = n;</script><p>After</p>';
    const project = await toSingleHtmlProject({ files: { "index.html": html, "dir/entry.mjs": "export const n = 42;" }, binaries: {}, remoteAssets: {} }, noRequest);
    const output = project.files["index.html"];
    assert.match(output, /nonce="test"/);
    assert.ok(output.endsWith("</script><p>After</p>"));
    const scripts: any[] = [];
    const visit = (node: any) => { if (node.tagName === "script") scripts.push(node); node.childNodes?.forEach(visit); };
    visit(parse(output));
    assert.equal(scripts.length, 1);
    const source = scripts[0].childNodes.map((node: any) => node.value ?? "").join("");
    assert.equal((await run(source)).answer, 42);
    assert.deepEqual(Object.keys(project.files), ["index.html"]);
  });

  test("an EOF-terminated inline module still embeds its dependencies", async () => {
    const { toSingleHtmlProject } = await import("../lib/generator/single-html");
    const prefix = '<script type="module">';
    const project = await toSingleHtmlProject({ files: { "index.html": prefix + 'import { n } from "./entry.mjs"; export const answer = n;', "entry.mjs": "export const n = 7;" }, binaries: {}, remoteAssets: {} }, noRequest);
    assert.equal((await run(project.files["index.html"].slice(prefix.length))).answer, 7);
  });
});

describe("single-html-svg-resources", () => {
  for (const attribute of ["href", "xlink:href"]) {
    test(`single HTML embeds SVG filter image ${attribute}`, async () => {
      const result = await toSingleHtmlProject({
        files: {
          "index.html": `<svg><defs><filter id="texture"><feImage ${attribute}="texture.png" result="texture" preserveAspectRatio="xMidYMid slice"/></filter></defs><rect filter="url(#texture)" width="100" height="100"/></svg>`,
        },
        binaries: { "texture.png": "AQID" }, remoteAssets: {},
      });
      assert.match(result.files["index.html"], new RegExp(`<feImage ${attribute}="data:image/png;base64,AQID"`));
      assert.match(result.files["index.html"], /result="texture" preserveAspectRatio="xMidYMid slice"\/>/);
      assert.match(result.files["index.html"], /filter="url\(#texture\)"/);
      assert.deepEqual(result.binaries, {});
    });
  }

  test("SVG filter images use the document base and fetch remote resources once", async () => {
    const seen: string[] = [];
    const result = await toSingleHtmlProject({
      files: {
        "index.html": '<base href="https://cdn.example/art/"><svg><filter id="texture"><feImage href="paper.png"/><feImage xlink:href="paper.png"/></filter></svg>',
      },
      binaries: {}, remoteAssets: {},
    }, async url => {
      seen.push(url);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    });
    assert.deepEqual(seen, ["https://cdn.example/art/paper.png"]);
    assert.equal((result.files["index.html"].match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
  });

  test("SVG filter href takes precedence over unused xlink:href", async () => {
    const result = await toSingleHtmlProject({
      files: { "index.html": '<svg><filter><feImage href="texture.png" xlink:href="missing.png"/></filter></svg>' },
      binaries: { "texture.png": "AQID" }, remoteAssets: {},
    });
    assert.match(result.files["index.html"], /href="data:image\/png;base64,AQID" xlink:href="missing.png"/);
  });

  test("SVG filter internal references, existing data URLs and empty href stay unchanged", async () => {
    const html = '<svg><filter><feImage href="#local"/><feImage xlink:href="#legacy"/><feImage href="data:image/png;base64,AQID"/><feImage href="" xlink:href="missing.png"/></filter></svg>';
    const result = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} }, async () => {
      throw new Error("Unexpected download");
    });
    assert.equal(result.files["index.html"], html);
  });

  test("single HTML does not treat an HTML feimage lookalike as an SVG resource", async () => {
    const html = '<feimage href="missing.png"></feimage>';
    const result = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} });
    assert.equal(result.files["index.html"], html);
  });

  test("SVG image URLs ignore removed xml:base attributes and retain the HTML base", async () => {
    // SVG 2 では xml:base が削除されたため、HTML の文書の基準だけを使う。
    // https://www.w3.org/TR/SVG2/changes.html#struct
    const result = await toSingleHtmlProject({
      files: {
        "index.html": '<base href="./art/"><svg xml:base="https://wrong.example/"><g xml:base="nested/"><image href="picture.png"/><image xlink:href="picture.png"/></g></svg>',
      },
      binaries: { "art/picture.png": "AQID" }, remoteAssets: {},
    }, async () => { throw new Error("Unexpected download"); });
    assert.equal((result.files["index.html"].match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
    assert.match(result.files["index.html"], /xml:base="https:\/\/wrong\.example\/"/);
    assert.match(result.files["index.html"], /xml:base="nested\/"/);
  });
});

describe("single-html-script-encoding", () => {
  const empty = { files: {}, binaries: {}, remoteAssets: {} };
  const scriptUrl = "https://cdn.example/legacy.js";
  const latinScript = Buffer.from('globalThis.answer = "caf\xe9 \x80";', "latin1");
  const expected = "café €";
  const response = (bytes: Uint8Array, type: string) => new Response(bytes, { headers: { "Content-Type": type } });
  const noRequest = async () => { throw new Error("Unexpected network request"); };

  function scriptAttributes(html: string): Record<string, string> {
    const scripts: any[] = [];
    const visit = (node: any) => { if (node.tagName === "script") scripts.push(node); node.childNodes?.forEach(visit); };
    visit(parse(html));
    assert.equal(scripts.length, 1);
    return Object.fromEntries(scripts[0].attrs.map((attr: any) => [attr.name, attr.value]));
  }

  async function embedded(bytes: Uint8Array, type: string, attributes = "") {
    const result = await toSingleHtmlProject({ ...empty, files: {
      "index.html": `<meta charset="utf-8"><script src="${scriptUrl}" ${attributes}></script>`,
    } }, async () => response(bytes, type));
    const attrs = scriptAttributes(result.files["index.html"]);
    const fetched = await fetch(attrs.src);
    return { attrs, bytes: new Uint8Array(await fetched.arrayBuffer()), type: fetched.headers.get("content-type")! };
  }

  // HTML の classic script のデコードの順序: BOM → 応答の charset → 要素や文書の文字コード。
  // https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-script
  function execute(bytes: Uint8Array, contentType: string, fallback = "utf-8"): unknown {
    let decoder = new TextDecoder(fallback);
    const charset = /;charset=([^;]+)/i.exec(contentType)?.[1];
    if (charset) { try { decoder = new TextDecoder(charset); } catch { /* 無効なラベルはフォールバックを使う。 */ } }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) decoder = new TextDecoder();
    if (bytes[0] === 0xff && bytes[1] === 0xfe) decoder = new TextDecoder("utf-16le");
    if (bytes[0] === 0xfe && bytes[1] === 0xff) decoder = new TextDecoder("utf-16be");
    const context: { answer?: unknown } = {};
    runInNewContext(decoder.decode(bytes), context);
    return context.answer;
  }

  for (const [type, label] of [
    ["text/javascript; charset=windows-1252", "windows-1252"],
    ['application/javascript; CHARSET = "ISO-8859-1"', "ISO-8859-1"],
    ['text/javascript; note="ignore; charset=utf-8"; charset=windows-1252', "windows-1252"],
    ['text/javascript; charset=" windows-1252 "; charset=utf-8', "windows-1252"],
    ['text/javascript; charset="windows\\-1252"', "windows-1252"],
  ]) {
    test(`classic scripts preserve HTTP charset and executable strings: ${type}`, async () => {
      const result = await embedded(latinScript, type, 'charset="utf-8" defer async');
      assert.ok(result.attrs.src.includes(`;charset=${label};base64,`));
      assert.deepEqual(result.bytes, new Uint8Array(latinScript));
      assert.equal(execute(result.bytes, result.type), expected);
      assert.equal(execute(result.bytes, "text/javascript"), "caf� �");
      assert.equal(result.attrs.charset, "utf-8");
      assert.ok(Object.hasOwn(result.attrs, "defer"));
      assert.ok(Object.hasOwn(result.attrs, "async"));
    });
  }

  test("classic scripts preserve Shift_JIS source text", async () => {
    const bytes = Buffer.concat([Buffer.from('globalThis.answer = "'), Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]), Buffer.from('";')]);
    const result = await embedded(bytes, "text/javascript; charset=Shift_JIS");
    assert.equal(execute(result.bytes, result.type), "日本語");
  });

  for (const type of ["text/javascript", "text/javascript; charset=unknown-encoding"]) {
    test(`missing or invalid HTTP charset retains the script element fallback: ${type}`, async () => {
      const result = await embedded(latinScript, type, 'charset="windows-1252"');
      assert.equal(result.attrs.charset, "windows-1252");
      assert.equal(execute(result.bytes, result.type, result.attrs.charset), expected);
    });
  }

  for (const encoding of ["utf-8", "utf-16le", "utf-16be"] as const) {
    test(`classic ${encoding} BOM still overrides the retained HTTP charset`, async () => {
      const source = `globalThis.answer = "${expected}";`;
      const bytes = encoding === "utf-8" ? Buffer.from(source) : Buffer.from(source, "utf16le");
      if (encoding === "utf-16be") bytes.swap16();
      const bom = Buffer.from(encoding === "utf-8" ? [0xef, 0xbb, 0xbf] : encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff]);
      const original = Buffer.concat([bom, bytes]);
      const result = await embedded(original, "text/javascript; charset=windows-1252");
      assert.deepEqual(result.bytes, new Uint8Array(original));
      assert.equal(execute(result.bytes, result.type), expected);
    });
  }

  test("retaining classic script encoding preserves SRI over the original bytes", async () => {
    const integrity = "sha256-" + createHash("sha256").update(latinScript).digest("base64");
    const result = await embedded(latinScript, "text/javascript; charset=windows-1252", `integrity="${integrity}" crossorigin="anonymous"`);
    assert.equal(result.attrs.integrity, integrity);
    assert.equal(result.attrs.crossorigin, "anonymous");
    assert.equal("sha256-" + createHash("sha256").update(result.bytes).digest("base64"), integrity);
    await assert.rejects(embedded(Buffer.from("different source"), "text/javascript; charset=windows-1252", `integrity="${integrity}"`), /integrity/i);
  });

  test("script and ordinary asset caches do not discard the script charset in either access order", async () => {
    for (const firstScript of [false, true]) {
      let requests = 0;
      const resources = singleHtmlResources(empty, async () => { requests++; return response(latinScript, "text/javascript; charset=windows-1252"); }, false);
      const first = await resources.embed(scriptUrl + "#first", EXPORT_BASE, "", firstScript);
      const second = await resources.embed(scriptUrl + "#second", EXPORT_BASE, "", !firstScript);
      const script = firstScript ? first : second;
      const asset = firstScript ? second : first;
      assert.match(script, /^data:text\/javascript;charset=windows-1252;base64,/);
      assert.match(asset, /^data:text\/javascript;base64,/);
      assert.ok(first.endsWith("#first"));
      assert.ok(second.endsWith("#second"));
      assert.equal(await resources.embed(scriptUrl + "#first", EXPORT_BASE, "", firstScript), first);
      assert.equal(requests, 1);
    }
  });

  test("generated script strings declare UTF-8 while raw binaries retain the element fallback", async () => {
    const text = `globalThis.answer = "${expected}";`;
    const resources = singleHtmlResources({ files: { "generated.js": text }, binaries: { "raw.js": latinScript.toString("base64") }, remoteAssets: {} }, noRequest, false);
    const generated = await resources.embed("generated.js", EXPORT_BASE, "", true);
    assert.match(generated, /^data:text\/javascript;charset=utf-8;base64,/);
    const generatedResponse = await fetch(generated);
    assert.equal(execute(new Uint8Array(await generatedResponse.arrayBuffer()), generatedResponse.headers.get("content-type")!, "windows-1252"), expected);
    const raw = await resources.embed("raw.js", EXPORT_BASE, "", true);
    assert.match(raw, /^data:text\/javascript;base64,/);
    const rawResponse = await fetch(raw);
    assert.equal(execute(new Uint8Array(await rawResponse.arrayBuffer()), rawResponse.headers.get("content-type")!, "windows-1252"), expected);
  });

  test("unusable charset values cannot inject data URL parameters or markup", async () => {
    for (const charset of ['utf-8;base64,alert(1)', 'utf-8\"><script>', 'utf 8', 'utf-8\u0001', '']) {
      const result = await embedded(Buffer.from('globalThis.answer = 42;'), `text/javascript; charset="${charset.replaceAll('"', '\\"')}"`);
      assert.match(result.attrs.src, /^data:text\/javascript;base64,/);
      assert.equal(execute(result.bytes, result.type), 42);
    }
  });

  test("non-ASCII whitespace does not turn an invalid HTTP label into a valid encoding", async () => {
    for (const charset of ['"\u00a0utf-8\u00a0"', '\u00a0utf-8\u00a0']) {
      const result = await embedded(latinScript, 'text/javascript; charset=' + charset, 'charset="windows-1252"');
      assert.match(result.attrs.src, /^data:text\/javascript;base64,/);
      assert.equal(execute(result.bytes, result.type, result.attrs.charset), expected);
    }
  });

  test("legacy labels that TextDecoder can reject remain available to the browser", async () => {
    const result = await embedded(latinScript, "text/javascript; charset=iso-2022-cn");
    assert.match(result.attrs.src, /^data:text\/javascript;charset=iso-2022-cn;base64,/);
    assert.deepEqual(result.bytes, new Uint8Array(latinScript));
  });

  test("module scripts continue to use UTF-8 regardless of an HTTP charset", async () => {
    const source = `globalThis.answer = "${expected}";`;
    const result = await embedded(Buffer.from(source), "text/javascript; charset=windows-1252", 'type="module"');
    assert.equal(result.attrs.type, "module");
    assert.match(result.attrs.src, /^data:text\/javascript;base64,/);
    assert.equal(new TextDecoder().decode(result.bytes), source);
  });
});

describe("single-html-css-encoding", () => {
  const empty = { files: {}, binaries: {}, remoteAssets: {} };
  const sheetUrl = new URL("https://cdn.example/main.css");
  const latinCss = Buffer.from('.caf\xe9::before{content:"\x80"}', "latin1");
  const expectedCss = '.café::before{content:"€"}';
  const utf8Css = Buffer.from(expectedCss);
  const cssResponse = (bytes: Uint8Array, type = "text/css") => new Response(bytes, { headers: { "Content-Type": type } });
  const decode = async (bytes: Uint8Array, type = "text/css") => {
    const resources = singleHtmlResources(empty, async () => cssResponse(bytes, type), false);
    return resources.stylesheet(sheetUrl, new Set());
  };
  function cssDataUrls(text: string) {
    return [...text.matchAll(/data:text\/css(?:;charset=utf-8)?;base64,([a-z0-9+/=]+)/gi)].map(match => ({
      url: match[0], bytes: Buffer.from(match[1], "base64"),
    }));
  }

  for (const type of [
    "text/css; charset=windows-1252",
    'text/css; CHARSET = "ISO-8859-1"',
    'text/css; note="ignore; charset=utf-8"; charset=windows-1252',
    'text/css; charset="windows-1252"; charset=utf-8',
  ]) {
    test(`external CSS honors HTTP encoding: ${type}`, async () => {
      assert.equal(latinCss.toString("hex"), "2e636166e93a3a6265666f72657b636f6e74656e743a2280227d");
      assert.equal(await decode(latinCss, type), expectedCss);
    });
  }

  test("HTTP CSS charset takes precedence over @charset and invalid HTTP labels fall back", async () => {
    const prefix = '@charset "utf-8";';
    assert.equal(await decode(Buffer.concat([Buffer.from(prefix), latinCss]), "text/css; charset=windows-1252"), prefix + expectedCss);
    const legacyPrefix = '@charset "windows-1252";';
    assert.equal(await decode(Buffer.concat([Buffer.from(legacyPrefix), latinCss]), "text/css; charset=not-an-encoding"), legacyPrefix + expectedCss);
  });

  for (const encoding of ["utf-8", "utf-16le", "utf-16be"] as const) {
    test(`CSS ${encoding} BOM overrides HTTP charset and @charset`, async () => {
      const text = '@charset "windows-1252";' + expectedCss;
      const bytes = encoding === "utf-8" ? Buffer.from(text) : Buffer.from(text, "utf16le");
      if (encoding === "utf-16be") bytes.swap16();
      const bom = Buffer.from(encoding === "utf-8" ? [0xef, 0xbb, 0xbf] : encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff]);
      assert.equal(await decode(Buffer.concat([bom, bytes]), "text/css; charset=windows-1252"), text);
    });
  }

  for (const label of ["windows-1252", "ISO-8859-1", " latin1 "]) {
    test(`CSS detects a strict leading @charset ${label}`, async () => {
      const prefix = `@charset "${label}";`;
      assert.equal(await decode(Buffer.concat([Buffer.from(prefix), latinCss])), prefix + expectedCss);
    });
  }

  for (const prefix of [
    '\n@charset "windows-1252";',
    '/* comment */@charset "windows-1252";',
    '@CHARSET "windows-1252";',
    "@charset 'windows-1252';",
    '@charset  "windows-1252";',
    '@charset\t"windows-1252";',
    '@charset "windows-1252" ;',
    '@charset "windows-1252"',
    '@charset "not-an-encoding";',
    '@charset "windows-1252\x80";',
  ]) {
    test(`nonstandard CSS encoding declaration is not sniffed: ${JSON.stringify(prefix)}`, async () => {
      const bytes = Buffer.concat([Buffer.from(prefix), utf8Css]);
      assert.equal(await decode(bytes), prefix + expectedCss);
    });
  }

  test("CSS encoding sniff is bounded to the first 1024 bytes, including the semicolon", async () => {
    const prefix = '@charset "' + " ".repeat(1000) + 'windows-1252";';
    assert.equal(Buffer.byteLength(prefix), 1024);
    assert.equal(await decode(Buffer.concat([Buffer.from(prefix), latinCss])), prefix + expectedCss);
    const tooLong = '@charset "' + " ".repeat(1001) + 'windows-1252";';
    assert.equal(await decode(Buffer.concat([Buffer.from(tooLong), utf8Css])), tooLong + expectedCss);
  });

  for (const label of ["utf-16", "utf-16le", "utf-16be"]) {
    test(`ASCII @charset ${label} uses UTF-8`, async () => {
      const prefix = `@charset "${label}";`;
      assert.equal(await decode(Buffer.concat([Buffer.from(prefix), utf8Css])), prefix + expectedCss);
    });
  }

  test("CSS without an encoding defaults to UTF-8 and malformed bytes use replacement characters", async () => {
    assert.equal(await decode(utf8Css), expectedCss);
    assert.equal(await decode(latinCss), '.caf�::before{content:"�"}');
  });

  test("generated CSS strings stay UTF-8 when imported by a legacy stylesheet", async () => {
    const text = '@charset "windows-1252";' + expectedCss;
    const resources = singleHtmlResources({
      files: { "generated.css": text }, binaries: { "legacy.css": latinCss.toString("base64") }, remoteAssets: {},
    }, async () => cssResponse(Buffer.from('@import "https://export.invalid/generated.css";@import "https://export.invalid/legacy.css";'), "text/css; charset=windows-1252"), false);
    const [generated, legacy] = cssDataUrls(await resources.stylesheet(sheetUrl, new Set()));
    assert.equal(generated.bytes.toString("utf8"), text);
    assert.equal(legacy.bytes.toString("utf8"), expectedCss);
  });

  test("raw CSS binaries use their own @charset before the referring encoding", async () => {
    const prefix = '@charset "windows-1252";';
    const resources = singleHtmlResources({
      files: {}, binaries: { "legacy.css": Buffer.concat([Buffer.from(prefix), latinCss]).toString("base64") }, remoteAssets: {},
    }, async () => { throw new Error("Unexpected request"); }, false);
    assert.equal(await resources.stylesheet(new URL("https://export.invalid/legacy.css"), new Set()), prefix + expectedCss);
  });

  test("nested imports inherit the decoded parent encoding and remain UTF-8 data URLs", async () => {
    const seen: string[] = [];
    const resources = singleHtmlResources(empty, async url => {
      seen.push(url);
      if (url.endsWith("main.css")) return cssResponse(Buffer.from('@charset "windows-1252";@import "child.css";'));
      if (url.endsWith("/child.css")) return cssResponse(Buffer.concat([Buffer.from('@import "grandchild.css";'), latinCss]));
      if (url.endsWith("grandchild.css")) return cssResponse(latinCss, "text/css; charset=invalid");
      throw new Error("Unexpected request: " + url);
    }, false);
    const text = await resources.stylesheet(sheetUrl, new Set());
    const [child] = cssDataUrls(text);
    assert.ok(child);
    assert.match(child.url, /^data:text\/css;charset=utf-8;base64,/);
    assert.ok(child.bytes.toString("utf8").endsWith(expectedCss));
    const [grandchild] = cssDataUrls(child.bytes.toString("utf8"));
    assert.ok(grandchild);
    assert.match(grandchild.url, /^data:text\/css;charset=utf-8;base64,/);
    assert.deepEqual(grandchild.bytes, utf8Css);
    assert.deepEqual(seen, [sheetUrl.href, "https://cdn.example/child.css", "https://cdn.example/grandchild.css"]);
  });

  test("imported CSS can override its parent's encoding with HTTP, @charset or BOM", async () => {
    const cases = [
      { bytes: utf8Css, type: "text/css; charset=utf-8", expected: expectedCss },
      { bytes: Buffer.concat([Buffer.from('@charset "utf-8";'), utf8Css]), type: "text/css", expected: '@charset "utf-8";' + expectedCss },
      { bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8Css]), type: "text/css", expected: expectedCss },
    ];
    for (const fixture of cases) {
      const resources = singleHtmlResources(empty, async url => url.endsWith("main.css")
        ? cssResponse(Buffer.from('@import "child.css";'), "text/css; charset=windows-1252")
        : cssResponse(fixture.bytes, fixture.type), false);
      const [child] = cssDataUrls(await resources.stylesheet(sheetUrl, new Set()));
      assert.equal(child.bytes.toString("utf8"), fixture.expected);
    }
  });

  test("CSS text and data URL caches distinguish shared imports in different encoding environments", async () => {
    const seen: string[] = [];
    const resources = singleHtmlResources(empty, async url => {
      seen.push(url);
      if (url.endsWith("legacy.css")) return cssResponse(Buffer.from('@import "shared.css";'), "text/css; charset=windows-1252");
      if (url.endsWith("modern.css")) return cssResponse(Buffer.from('@import "shared.css";'), "text/css; charset=utf-8");
      return cssResponse(utf8Css);
    }, false);
    const legacy = await resources.stylesheet(new URL("legacy.css", sheetUrl), new Set());
    const modern = await resources.stylesheet(new URL("modern.css", sheetUrl), new Set());
    const [legacyChild] = cssDataUrls(legacy), [modernChild] = cssDataUrls(modern);
    assert.equal(legacyChild.bytes.toString("utf8"), new TextDecoder("windows-1252").decode(utf8Css));
    assert.equal(modernChild.bytes.toString("utf8"), expectedCss);
    assert.notEqual(legacyChild.url, modernChild.url);
    assert.equal(await resources.stylesheet(new URL("legacy.css", sheetUrl), new Set()), legacy);
    assert.equal(await resources.stylesheet(new URL("modern.css", sheetUrl), new Set()), modern);
    assert.equal(seen.filter(url => url.endsWith("shared.css")).length, 1);
  });

  test("generated HTML preserves legacy selectors, strings and non-ASCII asset URLs after integrity verification", async () => {
    const css = Buffer.from('.caf\xe9::before{content:"\x80";background:url(caf\xe9.png)}', "latin1");
    const integrity = "sha256-" + createHash("sha256").update(css).digest("base64");
    const seen: string[] = [];
    const project = await toSingleHtmlProject({ files: {
      "index.html": `<link rel="stylesheet" href="${sheetUrl}" integrity="${integrity}"><p class="café">After</p>`,
    }, binaries: {}, remoteAssets: {} }, async url => {
      seen.push(url);
      return url.endsWith("main.css") ? cssResponse(css, "text/css; charset=windows-1252")
        : new Response(Uint8Array.of(1, 2, 3), { headers: { "Content-Type": "image/png" } });
    });
    const html = project.files["index.html"];
    assert.ok(html.includes('.café::before{content:"€";background:url(data:image/png;base64,AQID)}'));
    assert.ok(html.endsWith('<p class="café">After</p>'));
    assert.doesNotMatch(html, /�|integrity=/);
    assert.deepEqual(seen, [sheetUrl.href, "https://cdn.example/caf%C3%A9.png"]);
    assert.deepEqual(project.binaries, {});
    assert.deepEqual(project.remoteAssets, {});
  });

  test("retained stylesheet links explicitly encode UTF-8 despite an original legacy @charset", async () => {
    const prefix = '@charset "windows-1252";';
    const sourceCss = Buffer.concat([Buffer.from(prefix), latinCss]);
    const project = await toSingleHtmlProject({ files: {
      "index.html": `<link rel="stylesheet" title="Theme" href="${sheetUrl}"><p class="café">After</p>`,
    }, binaries: {}, remoteAssets: {} }, async () => cssResponse(sourceCss));
    const html = project.files["index.html"];
    const [embedded] = cssDataUrls(html);
    assert.ok(embedded);
    assert.match(embedded.url, /^data:text\/css;charset=utf-8;base64,/);
    assert.deepEqual(embedded.bytes, Buffer.from(prefix + expectedCss));
    const doc = parse(html);
    const nodes: any[] = [];
    const visit = (node: any) => { if (node.tagName === "link") nodes.push(node); node.childNodes?.forEach(visit); };
    visit(doc);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].attrs.find((attr: any) => attr.name === "href").value, embedded.url);
  });
});

describe("single-html-raw-content-security", () => {
  test("single HTML never includes untrusted Content-Type as HTML attribute syntax", async () => {
    const project = await toSingleHtmlProject({
      files: {
        "index.html": '<!doctype html><html><body><img src="./assets/remote.png"></body></html>',
      },
      binaries: {},
      remoteAssets: { "assets/remote.png": "assets/upload-id" },
    }, async () => new Response(Uint8Array.from([1, 2, 3]), {
      headers: {
        // この値は、src="data:..." から抜け出して、onerror のハンドラーを作ろうとする。
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
    const match = /@import "data:text\/css;charset=utf-8;base64,([^"]+)" layer\(colors\) print;/.exec(html);
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

  test("CSS and srcset token budgets stop scanning before an oversized resource list is expanded", async () => {
    for (const [markup, error] of [
      ['<style>' + "url(#x) ".repeat(100001) + '</style>', /Too many CSS resource references/],
      ['<style>' + "x(".repeat(513) + "0" + ")".repeat(513) + '</style>', /CSS function nesting/],
      ['<img srcset="' + "absent.png 1x, ".repeat(100001) + '">', /Too many single HTML srcset candidates/],
    ] as const) {
      await assert.rejects(toSingleHtmlProject({ files: { "index.html": markup }, binaries: {}, remoteAssets: {} }), error);
    }
  });
});
