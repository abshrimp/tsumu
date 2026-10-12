import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { prepareExportProject } from "../lib/export-formats";
import { generateProject, type GeneratedProject } from "../lib/generator";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

type MatchOptions = Record<string, boolean | number>;
interface Matcher {
  (pattern: string, options?: MatchOptions): (input: string) => boolean;
  isMatch(input: string, pattern: string, options?: MatchOptions): boolean;
  makeRe(pattern: string, options?: MatchOptions): RegExp;
}

function fixture(): SiteDoc {
  return {
    siteName: "Generated matcher", pageOrder: ["home"], assets: {},
    pages: { home: { id: "home", name: "Home", slug: "", title: "Home",
      description: "", children: ["heading"] } },
    nodes: { heading: { ...makeBox(), id: "heading", text: { content: "Hello", heading: 1 } } },
  };
}

async function loadGeneratedMatcher(t: TestContext, project: GeneratedProject): Promise<Matcher> {
  const pkg = JSON.parse(project.files["package.json"]);
  assert.equal(pkg.devDependencies.picomatch, "file:vendor/picomatch");
  assert.equal(pkg.overrides.picomatch, "$picomatch");
  const root = await mkdtemp(join(tmpdir(), "generated-picomatch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(project.files)) {
    if (path !== "package.json" && !path.startsWith("vendor/picomatch/")) continue;
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  return createRequire(join(root, "package.json"))("./vendor/picomatch") as Matcher;
}

test("the published matcher removes nested unbounded repetition across parser options", async t => {
  const match = await loadGeneratedMatcher(t, generateProject(fixture()));
  const options: MatchOptions[] = [
    {}, { nobracket: true }, { bash: true }, { capture: true }, { windows: true },
    { posix: true }, { posix: false }, { unescape: true }, { keepQuotes: true },
    { literalBrackets: true }, { literalBrackets: false }, { regex: true }, { regex: false },
    { maxExtglobRecursion: false }, { maxExtglobRecursion: 1 }, { fastpaths: false },
    { dot: true }, { strictSlashes: true }, { nobracket: true, capture: true, windows: true },
  ];
  for (const opts of options) {
    for (const pattern of ["+(*)", "*(*)", "+(*a)", "*(a*)", "+(@(*a))", "+(*a|b)", "+(*[.-0])"]) {
      // Check the compiled source, without evaluating costly matching inputs.
      assert.equal(match.makeRe(pattern, opts).source, "^(?:" + RegExp.escape(pattern) + ")$",
        JSON.stringify({ pattern, opts }));
    }
  }
  for (const [pattern, opts] of [
    ["+([*a])", { nobracket: true }], ["+([*a])", { nobracket: true, capture: true }],
    ["+(a{1,})", { nobrace: true }], ["+(\\*)", { unescape: true }], ["+(\\+)", { unescape: true }],
  ] as const) {
    assert.equal(match.makeRe(pattern, opts).source, "^(?:" + RegExp.escape(pattern) + ")$");
  }

  for (const opts of options.filter(opts => !opts.nobracket && !opts.unescape && !opts.keepQuotes)) {
    for (const [input, pattern] of [
      ["***", "+(\\*)"], ["***", '+("*")'], ["+++", "+([+])"], ["***", "+([*])"],
      ["abcabc", "+(abc)"], ["foobar", "*(foo|bar)"],
    ]) assert(match.isMatch(input, pattern, opts), JSON.stringify({ input, pattern, opts }));
    assert.equal(match.makeRe("+(*(a)|*(b))", opts).source,
      opts.capture ? "^(?:(?=.)([ab]*))$" : "^(?:(?=.)[ab]*)$");
    assert(match.isMatch("abba", "+(*(a)|*(b))", opts));
  }
  assert(match.isMatch("src/app.ts", "**/*.{ts,js}"));
  assert(match.isMatch("src/app.js", "**.js"));
  assert(!match.isMatch("b", "[!a]", { posix: false }));
  assert(match.isMatch("b", "[!a]", { posix: true }));
  for (const opts of [{ noext: true }, { noextglob: true }]) {
    assert.equal(match.makeRe("+(*a)", opts).source, "^(?:\\+([^/]*?a))$");
  }
});

test("every framework keeps the usable patched dependency through language and style conversion", async t => {
  for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
    for (const language of ["typescript", "javascript"] as const) {
      for (const style of ["css", "css-modules", "tailwind"] as const) {
        const project = await prepareExportProject(fixture(), { framework, language, style, scope: "project" });
        const match = await loadGeneratedMatcher(t, project);
        const context = `${framework} ${language} ${style}`;
        assert(match("**/*.ts")("src/app.ts"), context);
        assert.equal(match.makeRe("+([*a])", { nobracket: true }).source,
          "^(?:" + RegExp.escape("+([*a])") + ")$", context);
      }
    }
  }
});

test("HTML exports omit the build-only matcher and its package manifest", async () => {
  for (const framework of ["html", "single-html"] as const) {
    const project = await prepareExportProject(fixture(), framework);
    assert.equal(project.files["package.json"], undefined);
    assert(!Object.keys(project.files).some(path => path.startsWith("vendor/")), framework);
    assert.match(project.files["index.html"], /Hello/);
  }
});
