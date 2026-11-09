import { describe, before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { validSiteDoc, validNodeForest, MAX_NODE_DEPTH, maxSubtreeDepth } from "../lib/doc-tree";
import { makeBox, createInitialDoc, makeText, makeField, makeImage, makeSwitch, makeIcon } from "../lib/presets";
import { ancestorsOf, useEditor } from "../lib/store";
import { type SiteDoc, type DocNode } from "../lib/types";
import { buildCanvasCss } from "../components/canvas/css";
import { generateExportProject } from "../lib/export-formats";
import { parseSiteImport } from "../lib/site-import";
import { applyBreakpoints, normalizeBreakpoints, BP_INFO, BP_ORDER, parseTransform, serializeTransform, parseFilter, serializeFilter, extractPartStyles } from "../lib/style";
import { elements, importCallbacks } from "./helpers/pending-import";
import { spawnSync, execFileSync } from "node:child_process";
import { loadDicts, translate } from "../lib/i18n";
import { validateDocValue, InvalidDocPatchError, readCurrentDoc, saveCurrentDoc, saveDocPatch, DocTooLargeError, validateDocBody } from "../lib/doc-storage";
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createDocPatch, applyDocPatch, applyDocPatchAtRevision, isDocPatch, MAX_PATCH_OPS, type DocPatch, docPatchSqlPath } from "../lib/doc-patch";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import * as sites from "../lib/sites";
import { insertSite } from "../lib/sites";
import { DEFAULT_BRANCH, DEFAULT_PREVIEW_BRANCH, isSiteId, normalizeSiteInput } from "../lib/site-model";
import { DatabaseSync } from "node:sqlite";
import { build as esbuildBuild } from "esbuild";
import { transformSync } from "./helpers/bundle";
import { userMessage } from "../lib/errors";
import { StructuredDocumentStore, type DocumentSqlStorage, type SiteSaveResult, type SiteSnapshot } from "../lib/structured-document-store";
import { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited } from "../lib/api-json";
import { extractAssetReferences } from "../lib/asset-gc-plan";
import { edit, isRoomLookup, load, original, replacement, setup, sqlOf } from "./helpers/document-generation-api";
import { sameDocContent, shareUnchangedDoc } from "../lib/doc-share";
import { IMPORT_LIMITS, validateImportedDoc } from "../lib/site-import-format";
import { runInNewContext } from "node:vm";
import { codeLiteral } from "../lib/generator/code-literal";
import { mergeDocs } from "../lib/merge";
import { safeNavigationUrl, safeResourceUrl, NAVIGATION_RUNTIME } from "../lib/url-policy";
import { matchesValueCondition, setVarPath, withinScriptValueLimit } from "../lib/value-semantics";
import { readLocalStorage } from "../lib/local-storage";
import { pageScriptsOf } from "../lib/script";
import { connectEditorPageHistory } from "../lib/editor-page-history";
import { interpolateJson, interpolateUrl } from "../lib/vars";
import { fetchRequestOf, bodyJsonError } from "../lib/fetch-request";
import { fieldDefaults, fieldInitialValue, fieldStateValues, fieldValuePatch, fieldVarName } from "../lib/fields";
import { applyCommentAction, parseCommentAction, type CommentThread } from "../lib/comments";
import { obfuscateVarNames, varNamesAt } from "../lib/data";
import { refreshClonedIds } from "../lib/cloneIds";
import { generateProject } from "../lib/generator";
import { generateStandaloneHtml } from "../lib/generator/html-export";
import { runChecks } from "../lib/generator/checks";
import { mediaSrc, nodeAssetSrc, replaceEmbeddedAsset } from "../lib/assets";
import { usesLiveFields } from "../lib/script-runtime";
import { readRestoreJson } from "../lib/publish-security";
import { sanitizeImportedInlineIcons } from "../lib/imported-svg";
import { createRequire } from "node:module";
import { headHtmlToJsx } from "../lib/generator/head";
import { useDialogs, closeDialog } from "../lib/dialog";

describe("batch-node-operations", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();

function fixture(): SiteDoc {
  const children: Record<string, string[]> = {
    left: ["a", "b"], a: [], b: ["nested"], nested: [],
    right: ["c", "d"], c: [], d: [], destination: [], locked: [],
  };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Batch operations", assets: {}, pageOrder: ["p"],
    pages: {
      p: { id: "p", name: "Home", slug: "", title: "", description: "",
        children: ["left", "right", "destination", "locked"] },
    },
    nodes: Object.fromEntries(Object.entries(children).map(([id, children]) =>
      [id, { ...makeBox(), id, name: id, children, ...(id === "locked" ? { locked: true } : {}) }]
    )),
  };
  state().replaceDoc(doc);
  state().setActivePage("p");
  return doc;
}

test("batch moves retain tree order across parents, include descendants once, and undo atomically", () => {
  const before = fixture();
  state().moveNodes(["d", "nested", "a", "b", "locked", "b"], { kind: "node", id: "destination" }, 0);
  const moved = state().doc;
  assert.deepEqual(moved.nodes.destination.children, ["a", "b", "d"]);
  assert.deepEqual(moved.nodes.left.children, []);
  assert.deepEqual(moved.nodes.right.children, ["c"]);
  assert.deepEqual(moved.nodes.b.children, ["nested"]);
  assert.deepEqual(moved.pages.p.children, before.pages.p.children);
  assert.equal(state().past.length, 1);
  assert.ok(validSiteDoc(moved));
  assert.deepEqual(before.nodes.left.children, ["a", "b"]);
  state().undo();
  assert.deepEqual(state().doc, before);
  state().redo();
  assert.deepEqual(state().doc, moved);
});

test("batch moves reject a selected root's descendant as destination without changing history", () => {
  const before = fixture();
  state().moveNodes(["d", "left", "a"], { kind: "node", id: "nested" }, 0);
  assert.equal(state().doc, before);
  assert.equal(state().past.length, 0);
});

test("batch duplicates stay beside each original and clone overlapping or repeated selections once", () => {
  const before = fixture();
  state().duplicateNodes(["d", "nested", "b", "a", "b"]);
  const copied = state().doc;
  const [a, b, d] = state().selectedIds;
  assert.deepEqual(state().selectedIds.map(id => copied.nodes[id].name), ["a", "b", "d"]);
  assert.deepEqual(copied.nodes.left.children, ["a", a, "b", b]);
  assert.deepEqual(copied.nodes.right.children, ["c", "d", d]);
  assert.equal(copied.nodes[b].children.length, 1);
  assert.notEqual(copied.nodes[b].children[0], "nested");
  assert.equal(copied.nodes[copied.nodes[b].children[0]].name, "nested");
  assert.equal(Object.keys(copied.nodes).length, Object.keys(before.nodes).length + 4);
  assert.ok(validSiteDoc(copied));
  state().undo();
  assert.deepEqual(state().doc, before);
  state().redo();
  assert.deepEqual(state().doc, copied);
});

test("batch copy and deletion share nested selection boundaries without losing unrelated nodes", () => {
  const before = fixture();
  state().selectMany(["d", "nested", "b", "a", "b"], "b");
  state().copyNode("b");
  assert.deepEqual(state().clipboard!.rootIds, ["a", "b", "d"]);
  assert.deepEqual(state().clipboard!.nodes.map(node => node.id), ["a", "b", "nested", "d"]);
  state().deleteNodes(["d", "nested", "b", "a", "locked", "b"]);
  assert.deepEqual(state().doc.nodes.left.children, []);
  assert.deepEqual(state().doc.nodes.right.children, ["c"]);
  assert.equal(state().doc.nodes.nested, undefined);
  assert.equal(state().doc.nodes.locked.locked, true);
  assert.ok(validSiteDoc(state().doc));
  state().undo();
  assert.deepEqual(state().doc, before);
});

test("successive moves, duplication and undo always use the current parent relationships", () => {
  const before = fixture();
  state().moveNodes(["a", "b"], { kind: "node", id: "right" }, 1);
  assert.deepEqual(ancestorsOf(state().doc, "nested"), ["right", "b"]);
  state().duplicateNodes(["a", "b"]);
  const [a, b] = state().selectedIds;
  assert.deepEqual(state().doc.nodes.right.children, ["c", "a", a, "b", b, "d"]);
  state().undo();
  state().moveNodes(["a", "b"], { kind: "node", id: "left" }, 0);
  assert.deepEqual(state().doc.nodes.left.children, ["a", "b"]);
  assert.deepEqual(ancestorsOf(state().doc, "nested"), ["left", "b"]);
  assert.deepEqual(state().doc, before);
  assert.ok(validSiteDoc(state().doc));
});
});

describe("breakpoint-compatibility", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
describe("breakpoint-compatibility", () => {
  for (const id of ["phone.landscape", "wide:layout", "スマホ", "custom-" + "x".repeat(200)]) {
    test(`existing safe breakpoint spelling survives import, editing, and export: ${id}`, async () => {
      const doc = createInitialDoc();
      const breakpoint = { id, label: "Custom width", maxWidth: 600 };
      doc.breakpoints = [breakpoint];
      const nodeId = Object.keys(doc.nodes)[0];
      doc.nodes[nodeId].styles[id] = { default: { color: "rgb(11, 22, 33)" } };
      assert.equal(validSiteDoc(doc), true);
      assert.deepEqual(normalizeBreakpoints(doc.breakpoints), [breakpoint]);
      const imported = await parseSiteImport(new TextEncoder().encode(JSON.stringify(doc)), "doc");
      assert.deepEqual(imported.doc, doc);
      try {
        useEditor.getState().replaceDoc(imported.doc);
        useEditor.getState().setCustomWidth(550);
        assert.equal(useEditor.getState().breakpoint, id);
        assert.equal(useEditor.getState().doc.nodes[nodeId].styles[id]?.default?.color, "rgb(11, 22, 33)");
        useEditor.getState().setStyleProps(nodeId, { color: "rgb(44, 55, 66)" });
        const edited = useEditor.getState().doc;
        assert.equal(edited.nodes[nodeId].styles[id]?.default?.color, "rgb(44, 55, 66)");
        assert.equal(validSiteDoc(edited), true);
        const project = generateExportProject(edited, "nextjs");
        assert.ok(Object.values(project.files).some(source =>
          source.includes("@media (max-width: 600px)") && source.includes("color: rgb(44, 55, 66)")));
      } finally {
        useEditor.getState().replaceDoc(createInitialDoc());
        applyBreakpoints(undefined);
      }
    });
  }

  test("breakpoint IDs remain data rather than generated CSS or executable source", () => {
    const marker = "__breakpoint_id_marker__";
    const ids = [
      `bp\"><script>${marker}()</script>`,
      `bp};.${marker}{color:red}/*`,
      `bp\");${marker}();//`,
    ];
    try {
      for (const id of ids) {
        const doc: SiteDoc = {
          schemaVersion: 1, siteName: "Breakpoint data", pageOrder: ["home"], assets: {},
          pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["box"] } },
          nodes: { box: { ...makeBox(), id: "box", styles: { [id]: { default: { color: "rgb(11, 22, 33)" } } } } },
          breakpoints: [{ id, label: "Custom width", maxWidth: 600 }],
        };
        assert.equal(validSiteDoc(doc), true);
        applyBreakpoints(doc);
        const canvasCss = buildCanvasCss(doc, ["box"], id, "preview", null, "default");
        assert.ok(canvasCss.includes("color: rgb(11, 22, 33)"));
        assert.ok(!canvasCss.includes(marker));
        for (const format of ["nextjs", "react", "vue", "nuxt", "sveltekit", "html"] as const) {
          const project = generateExportProject(doc, format);
          for (const [path, source] of Object.entries(project.files)) {
            if (path.endsWith(".json")) continue;
            assert.ok(!source.includes(marker), `${format}: ${path} must not emit breakpoint IDs as source`);
          }
          assert.ok(Object.values(project.files).some(source =>
            source.includes("@media (max-width: 600px)") && source.includes("color: rgb(11, 22, 33)")));
        }
      }
    } finally {
      applyBreakpoints(undefined);
    }
  });
});

describe("breakpoint-confirmation", () => {
  const state = () => useEditor.getState();
  function fixture() {
    const doc = createInitialDoc();
    doc.breakpoints = [{ id: "custom", label: "Custom", maxWidth: 800 }];
    doc.nodes.box = { ...makeBox(), id: "box", styles: { custom: { default: { color: "red" } } } };
    doc.pages[doc.pageOrder[0]].children = ["box"];
    state().replaceDoc(doc);
    const ui = importCallbacks("breakpoints");
    const buttons = elements(ui.render()).filter(e => e.type === "button");
    return { ui, remove: () => buttons.find(e => e.props["aria-label"] === "Delete Custom").props.onClick(),
      reset: () => buttons.find(e => elements(e).some(x => x.props?.children?.includes?.("Reset to defaults"))).props.onClick() };
  }
  for (const action of ["remove", "reset"] as const) for (const change of ["edit", "replace", "unmount", "unchanged"] as const) {
    test(`breakpoint ${action} confirmation handles ${change}`, async () => {
      const f = fixture(); const original = state().doc;
      const pending = f[action]();
      assert.equal(f.ui.confirmations.length, 1);
      if (change === "edit") state().updateDoc(d => { d.nodes.box.styles.custom.default.color = "blue"; });
      if (change === "replace") state().replaceDoc({ ...original, siteName: "Another document" });
      if (change === "unmount") f.ui.unmount();
      const before = state().doc;
      f.ui.confirmations[0].resolve(true); await pending;
      if (change === "unchanged") {
        assert.equal(state().doc.nodes.box.styles.custom, undefined);
        state().undo(); assert.deepEqual(state().doc, original);
      } else assert.equal(state().doc, before);
      f.ui.unmount();
    });
  }
});

describe("breakpoint-labels", () => {
  const prototypeNames = ["__proto__", "constructor", "toString", "hasOwnProperty"];

  test("translation falls back to literal labels for inherited dictionary names", async () => {
    const dictionaries = await loadDicts("en");
    for (const label of prototypeNames) {
      assert.equal(translate(dictionaries, label), label);
      assert.equal(translate(dictionaries, label, {}), label);
    }
  });

  test("translation uses only own entries while retaining dictionary priority and interpolation", () => {
    const primary = Object.assign(Object.create({ inherited: "Not a translation" }), {
      greeting: "Hello {name}",
    });
    const fallback = JSON.parse('{"inherited":"Fallback","constructor":"Own translation"}');
    const ja = (messages: Record<string, string>) => ({ lang: "ja" as const, messages });
    const en = (messages: Record<string, string>) => ({ lang: "en" as const, messages });
    assert.equal(translate([ja(primary), en(fallback)], "inherited"), "Fallback");
    assert.equal(translate([ja(primary), en(fallback)], "constructor"), "Own translation");
    assert.equal(translate([ja(primary), en({ greeting: "Fallback" })], "greeting", { name: "Tsumu" }), "Hello Tsumu");
    assert.equal(translate([ja(primary)], "Missing {name}", { name: "Tsumu" }), "Missing Tsumu");
  });

  for (const lang of ["ja", "en"]) {
    test(`${lang}: custom breakpoint labels remain renderable after editing and document reload`, () => {
      // 言語の判定と、翻訳した定数は、モジュールの初期化のときに決まる。
      // 再読み込みと同じく、対応するエディタの言語ごとに、新しいプロセスを使う。
      const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
        import assert from "node:assert/strict";
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        globalThis.window = { localStorage: { getItem: () => ${JSON.stringify(lang)} } };
        const { loadLocale } = await import("./lib/i18n.ts");
        await loadLocale();
        const { applyBreakpoints, BP_INFO } = await import("./lib/style.ts");
        const { updateBreakpoint } = await import("./lib/breakpoints.ts");
        const { createInitialDoc } = await import("./lib/presets.ts");
        const { validSiteDoc } = await import("./lib/doc-tree.ts");
        const doc = createInitialDoc();
        for (const label of ${JSON.stringify([...prototypeNames, "Custom width"])}) {
          updateBreakpoint(doc, "md", { label });
          const restored = JSON.parse(JSON.stringify(doc));
          assert.equal(validSiteDoc(restored), true);
          applyBreakpoints(restored);
          assert.equal(BP_INFO.md.label, label);
          assert.equal(BP_INFO.md.short, label);
          assert.equal(renderToStaticMarkup(createElement("button", { title: BP_INFO.md.label }, BP_INFO.md.short)),
            '<button title="' + label + '">' + label + '</button>');
          assert.ok(BP_INFO.lg.scope.includes(label));
        }
        applyBreakpoints(undefined);
        assert.equal(BP_INFO.md.label, ${JSON.stringify(lang === "ja" ? "スマホ横向き" : "Phone (landscape)")});
        assert.equal(typeof BP_INFO.md.short, "string");
        assert.ok(BP_INFO.md.short.length > 0);
      `], { cwd: process.cwd(), encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
  }
});

describe("breakpoint-security", () => {
  const unsafeIds = [...new Set(["prototype", ...Object.getOwnPropertyNames(Object.prototype)])];

  for (const id of unsafeIds) {
    test(`saved breakpoint IDs cannot address the object prototype: ${id}`, () => {
      const doc = createInitialDoc();
      doc.breakpoints = [{ id, label: "Imported width", maxWidth: 600 }];
      assert.equal(validSiteDoc(doc), false);
      assert.deepEqual(normalizeBreakpoints(doc.breakpoints), []);
    });
  }

  test("safe custom breakpoint IDs preserve their labels, widths, and style edits", () => {
    const doc = createInitialDoc();
    const breakpoint = { id: "bp_custom-1", label: "Custom width", maxWidth: 600 };
    doc.breakpoints = [breakpoint];
    assert.equal(validSiteDoc(doc), true);
    assert.deepEqual(normalizeBreakpoints(doc.breakpoints), [breakpoint]);
    useEditor.getState().replaceDoc(doc);
    useEditor.getState().setCustomWidth(550);
    const id = Object.keys(doc.nodes)[0];
    useEditor.getState().setStyleProps(id, { color: "red" });
    assert.equal(useEditor.getState().breakpoint, breakpoint.id);
    assert.equal(useEditor.getState().doc.nodes[id].styles[breakpoint.id]?.default?.color, "red");
  });

  test("resizing an imported document cannot make style editing mutate Object.prototype", () => {
    const originalPrototype = Object.getPrototypeOf(BP_INFO);
    const originalDefault = Object.getOwnPropertyDescriptor(Object.prototype, "default");
    const doc = createInitialDoc();
    doc.breakpoints = [{ id: "__proto__", label: "Imported width", maxWidth: 600 }];
    try {
      // エディタは、取り込みや API の検証を先に通っていない、自身の変更の経路から渡された
      // メモリの中の文書も正規化する。
      useEditor.getState().replaceDoc(doc);
      useEditor.getState().setCustomWidth(550);
      const id = Object.keys(doc.nodes)[0];
      useEditor.getState().setStyleProps(id, { color: "red" });
      assert.equal(Object.hasOwn(Object.prototype, "default"), !!originalDefault,
        "editing an element must never create an inherited style map");
      assert.equal(Object.getPrototypeOf(BP_INFO), originalPrototype);
      assert.deepEqual(BP_ORDER, ["base"]);
      assert.equal(useEditor.getState().breakpoint, "base");
      assert.equal(useEditor.getState().doc.nodes[id].styles.base?.default?.color, "red");
    } finally {
      // 脆弱な状態を基準として確かめる間も、テストのプロセスは壊さない。
      if (originalDefault) Object.defineProperty(Object.prototype, "default", originalDefault);
      else Reflect.deleteProperty(Object.prototype, "default");
      Object.setPrototypeOf(BP_INFO, originalPrototype);
      useEditor.getState().replaceDoc(createInitialDoc());
      applyBreakpoints(undefined);
    }
  });
});
});

describe("data-integrity", () => {
const node = (id: string) => ({ ...makeBox(), id });
function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Integrity",
    pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: [] } },
    pageOrder: ["home"],
    nodes: {},
    assets: {},
    components: {},
  };
}
function withMasters(): SiteDoc {
  const doc = fixture();
  doc.nodes.a = node("a");
  doc.nodes.b = node("b");
  doc.components = {
    A: { id: "A", name: "A", rootId: "a" },
    B: { id: "B", name: "B", rootId: "b" },
  };
  return doc;
}
function instance(id: string, componentId: string) {
  return { ...node(id), type: "instance" as const, componentId };
}

test("complete documents reject missing component references, including a missing component map", () => {
  const doc = fixture();
  doc.nodes.use = instance("use", "absent");
  doc.pages.home.children.push("use");
  assert.equal(validateDocValue(doc), "不正なリクエスト");
  delete doc.components;
  assert.equal(validateDocValue(doc), "不正なリクエスト");
  assert.equal(validNodeForest(doc.pages, doc.nodes), true, "clipboard fragments can lack definitions");
});

test("component definitions cannot share or nest their master trees", () => {
  const doc = withMasters();
  assert.equal(validateDocValue(doc), null);
  doc.components!.B.rootId = "a";
  assert.notEqual(validateDocValue(doc), null);
  doc.components!.B.rootId = "b";
  doc.nodes.a.children = ["b"];
  assert.notEqual(validateDocValue(doc), null);
});

test("component instances reject both direct and indirect reference cycles", () => {
  const doc = withMasters();
  doc.nodes.ab = instance("ab", "B");
  doc.nodes.a.children = ["ab"];
  assert.equal(validateDocValue(doc), null);
  const self = structuredClone(doc);
  self.nodes.ab.componentId = "A";
  assert.notEqual(validateDocValue(self), null);
  const mutual = structuredClone(doc);
  mutual.nodes.ba = instance("ba", "A");
  mutual.nodes.b.children = ["ba"];
  assert.notEqual(validateDocValue(mutual), null);
  const external = structuredClone(doc);
  external.nodes.use = instance("use", "A");
  external.pages.home.children.push("use");
  assert.equal(validateDocValue(external), null, "repeated use outside masters is valid");
});

test("structural collection IDs cannot shadow inherited object properties", () => {
  for (const collection of ["nodes", "pages", "assets", "components"] as const) {
    const doc = fixture() as any;
    const dangerous = "__proto__";
    if (collection === "nodes") doc.nodes = JSON.parse('{"__proto__":{"id":"__proto__","children":[]}}');
    if (collection === "pages") doc.pages = JSON.parse('{"home":{"id":"home","name":"Home","slug":"","children":[]},"__proto__":{"id":"__proto__","slug":"","children":[]}}');
    if (collection === "assets") doc.assets = JSON.parse('{"__proto__":{"id":"__proto__","name":"Asset"}}');
    if (collection === "components") {
      doc.nodes.root = node("root");
      doc.components = JSON.parse('{"__proto__":{"id":"__proto__","name":"C","rootId":"root"}}');
    }
    assert.notEqual(validateDocValue(doc), null, collection);
  }
});

test("long acyclic component dependency chains validate without recursive traversal", () => {
  const doc = fixture();
  for (let i = 0; i < 1500; i++) {
    const root = "r" + i;
    doc.nodes[root] = node(root);
    doc.components!["c" + i] = { id: "c" + i, name: "C", rootId: root };
    if (i) {
      const id = "i" + i;
      doc.nodes[id] = instance(id, "c" + i);
      doc.nodes["r" + (i - 1)].children.push(id);
    }
  }
  assert.equal(validateDocValue(doc), null);
});
});

describe("data-integrity-patch", () => {
function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Component integrity",
    pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: ["use"] } },
    pageOrder: ["p"],
    nodes: {
      root: { ...makeBox(), id: "root" },
      use: { ...makeBox(), id: "use", type: "instance", componentId: "C" },
    },
    components: { C: { id: "C", name: "Card", rootId: "root" } },
    assets: {},
  };
}

async function withDatabase(testBody: (db: Db, statements: string[]) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-graph-patch-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const rawDb = await getDbFromBinding(nodeDatabase()!);
    await insertSite(rawDb, "audit", {
      name: "Audit", repo: null, branch: "main", previewBranch: "preview",
      siteUrl: null, previewUrl: null,
    });
    const statements: string[] = [];
    const db: Db = {
      ...rawDb,
      execute: async statement => {
        statements.push(typeof statement === "string" ? statement : statement.sql);
        return rawDb.execute(statement);
      },
    };
    await testBody(db, statements);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an atomic patch cannot introduce component cycles or dangling definitions", async () => {
  await withDatabase(async (db, statements) => {
    const original = fixture();
    assert.equal(validateDocValue(original), null);
    assert.equal((await saveCurrentDoc(db, "audit", JSON.stringify(original), null)).kind, "saved");
    const attempts = [
      { ...structuredClone(original),
        components: { C: { ...original.components!.C, rootId: "absent" } } },
      { ...structuredClone(original), components: {} },
      { ...structuredClone(original),
        nodes: { ...original.nodes,
          root: { ...original.nodes.root, children: ["nested"] },
          nested: { ...makeBox(), id: "nested", type: "instance" as const, componentId: "C" } } },
    ];
    for (const bad of attempts) {
      assert.notEqual(validateDocValue(bad), null);
      await assert.rejects(saveDocPatch(db, "audit", createDocPatch(original, bad as SiteDoc)!, "1"), InvalidDocPatchError);
      const current = await readCurrentDoc(db, "audit");
      assert.equal(current!.rev, "1", "invalid revisions never advance");
      assert.deepEqual(JSON.parse(current!.body), original);
    }
    assert.ok(statements.some(sql => sql.includes("SELECT rev, saved_at, body")), "graph changes use base-revision preflight");
  });
});

test("an ordinary leaf update avoids loading the complete document", async () => {
  await withDatabase(async (db, statements) => {
    const original = fixture();
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);
    const next = structuredClone(original);
    next.nodes.root.name = "Renamed";
    statements.length = 0;
    assert.equal((await saveDocPatch(db, "audit", createDocPatch(original, next)!, "1")).kind, "saved");
    assert.equal(statements.some(sql => sql.includes("SELECT rev, saved_at, body")), false);
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "audit"))!.body), next);
  });
});

test("preflight rejects a stale base as a conflict rather than validating against a different revision", async () => {
  await withDatabase(async db => {
    const original = fixture();
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);
    const updated = { ...original, siteName: "Updated" };
    assert.equal((await saveCurrentDoc(db, "audit", JSON.stringify(updated), "1")).kind, "saved");
    const next = structuredClone(original);
    next.components!.C.name = "Another name";
    const result = await saveDocPatch(db, "audit", createDocPatch(original, next)!, "1");
    assert.equal(result.kind, "conflict");
    if (result.kind === "conflict") {
      assert.equal(result.current.rev, "2");
      assert.deepEqual(JSON.parse(result.current.body), updated);
    }
  });
});

test("page folders cannot disappear while assigned pages still reference them", async () => {
  await withDatabase(async db => {
    const original = fixture();
    original.pageFolders = [{ id: "folder", name: "Folder" }];
    original.pages.p.folderId = "folder";
    assert.equal(validateDocValue(original), null);
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);
    const invalid = [
      { ...original, pageFolders: [] },
      { ...original, pageFolders: [{ id: "folder", name: "One" }, { id: "folder", name: "Two" }] },
      { ...original, pages: { p: { ...original.pages.p, folderId: "missing" } } },
    ];
    for (const bad of invalid) {
      assert.notEqual(validateDocValue(bad), null);
      await assert.rejects(saveDocPatch(db, "audit", createDocPatch(original, bad as SiteDoc)!, "1"), InvalidDocPatchError);
      assert.equal((await readCurrentDoc(db, "audit"))!.rev, "1");
    }
    const move = structuredClone(original);
    delete move.pages.p.folderId;
    move.pageFolders = [];
    assert.equal((await saveDocPatch(db, "audit", createDocPatch(original, move)!, "1")).kind, "saved");
    assert.equal(validateDocValue(JSON.parse((await readCurrentDoc(db, "audit"))!.body)), null);
  });
});

test("asset removal and references are checked together before advancing the revision", async () => {
  await withDatabase(async db => {
    const original = fixture();
    original.assets.picture = { id: "picture", name: "photo.png", width: 10, height: 10 };
    original.nodes.picture = {
      ...makeBox(), id: "picture", type: "image",
      image: { src: "", assetId: "picture", alt: "", width: 10, height: 10 },
    };
    original.pages.p.children.push("picture");
    original.favicon = { assetId: "picture" };
    assert.equal(validateDocValue(original), null);
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);

    const dangling = structuredClone(original);
    delete dangling.assets.picture;
    assert.notEqual(validateDocValue(dangling), null);
    await assert.rejects(
      saveDocPatch(db, "audit", createDocPatch(original, dangling)!, "1"), InvalidDocPatchError);
    assert.equal((await readCurrentDoc(db, "audit"))!.rev, "1");

    const fixed = structuredClone(dangling);
    fixed.nodes.picture.image!.assetId = undefined;
    fixed.favicon = null;
    assert.equal(validateDocValue(fixed), null);
    assert.equal((await saveDocPatch(db, "audit", createDocPatch(original, fixed)!, "1")).kind, "saved");
    assert.equal(validateDocValue(JSON.parse((await readCurrentDoc(db, "audit"))!.body)), null);
  });
});

test("new image and metadata references to nonexistent assets are rejected", async () => {
  await withDatabase(async db => {
    const original = fixture();
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);
    const bad = structuredClone(original);
    bad.nodes.use.image = { src: "", assetId: "missing", alt: "", width: 1, height: 1 };
    assert.notEqual(validateDocValue(bad), null);
    await assert.rejects(saveDocPatch(db, "audit", createDocPatch(original, bad)!, "1"), InvalidDocPatchError);
    assert.equal((await readCurrentDoc(db, "audit"))!.rev, "1");
  });
});

test("API revisions reject invalid node and page shapes before accepting a PATCH", async () => {
  await withDatabase(async db => {
    const base = fixture();
    await saveCurrentDoc(db, "audit", JSON.stringify(base), null);
    const edits: SiteDoc[] = [];
    const mutate = (change: (d: SiteDoc) => void) => {
      const next = structuredClone(base);
      change(next);
      edits.push(next);
    };
    mutate(d => { (d.nodes.use as any).type = "unknown-element"; });
    mutate(d => { (d.nodes.use as any).semantic = "invalid"; });
    mutate(d => { (d.nodes.use as any).styles = null; });
    mutate(d => { (d.nodes.use.styles.base ??= {}).default = { color: 123 } as any; });
    mutate(d => { (d.nodes.use as any).text = { content: 5, heading: 0 }; });
    mutate(d => { (d.pages.p as any).name = null; });
    mutate(d => { (d.pages.p as any).title = []; });
    mutate(d => { (d.pages.p as any).description = 12; });
    mutate(d => { (d.pages.p as any).bodyStyles = { base: { default: { backgroundColor: false } } }; });
    for (const invalid of edits) {
      assert.notEqual(validateDocValue(invalid), null, JSON.stringify(invalid).slice(0,300));
      const patch = createDocPatch(base, invalid);
      assert.ok(patch?.length, "the malformed field still produces a delta");
      await assert.rejects(saveDocPatch(db, "audit", patch!, "1"), InvalidDocPatchError);
      assert.equal((await readCurrentDoc(db, "audit"))!.rev, "1");
    }
  });
});

test("site-level SQL patches cannot persist malformed optional settings", async () => {
  await withDatabase(async db => {
    const original = fixture();
    assert.equal((await saveCurrentDoc(db, "audit", JSON.stringify(original), null)).kind, "saved");
    const badPatches = [
      { path: ["baseWidth"], value: "1280" },
      { path: ["dataRevalidate"], value: -1 },
      { path: ["siteUrl"], value: 404 },
      { path: ["customFonts"], value: [{ family: "Example", weights: [400] }] },
      { path: ["pwa"], value: { enabled: "true" } },
    ];
    for (const op of badPatches) {
      await assert.rejects(saveDocPatch(db, "audit", [op], "1"), InvalidDocPatchError);
      assert.equal((await readCurrentDoc(db, "audit"))?.rev, "1");
      assert.deepEqual(JSON.parse((await readCurrentDoc(db, "audit"))!.body), original);
    }
    const ok = await saveDocPatch(db, "audit", [
      { path: ["baseWidth"], value: 1280 },
    ], "1");
    assert.equal(ok.kind, "saved");
    assert.equal(JSON.parse((await readCurrentDoc(db, "audit"))!.body).baseWidth, 1280);
  });
});
});

describe("doc-get-error-privacy", () => {
class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), {
      ...init, headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}

type ReadStep = "database" | "site" | "metadata" | "snapshot";
type Snapshot = { rev: string; savedAt: number; body: string };
const snapshot: Snapshot = { rev: "4", savedAt: 123, body: '{"siteName":"test document"}' };
const url = "https://editor.example.test/api/doc?site=test-site";
const code = transformSync(readFileSync(new URL("../app/api/doc/route.ts", import.meta.url), "utf8"), {
  loader: "ts", format: "cjs", target: "es2022",
}).code;

function fixture(options: {
  failStage?: ReadStep;
  error?: unknown;
  denied?: Response;
  configured?: boolean;
  siteExists?: boolean;
  document?: Snapshot | null;
  readSnapshot?: () => Snapshot | null;
  translate?: (value: string) => string;
} = {}) {
  const calls: string[] = [];
  const document = options.document === undefined ? snapshot : options.document;
  const step = (stage: ReadStep) => {
    calls.push(stage);
    if (options.failStage === stage) throw options.error;
  };
  const shared: Record<string, unknown> = {
    NextResponse,
    serverTr: async () => options.translate ?? ((value: string) => value),
    requireAuth: async () => { calls.push("auth"); return options.denied ?? null; }, requireSiteAccess: async () => null,
    dbConfigured: () => { calls.push("configured"); return options.configured ?? true; },
    dbUnavailable: async () => NextResponse.json({ unavailable: true }, { status: 503 }),
    siteIdOf: async (value: unknown) => {
      calls.push("siteId");
      return isSiteId(value) ? value : NextResponse.json({ error: "invalid site" }, { status: 400 });
    },
    getDb: async () => { step("database"); return { backend: "sqlite" }; },
    getSite: async () => { step("site"); return options.siteExists === false ? null : { id: "test-site" }; },
    readSiteDocumentMeta: async () => {
      step("metadata");
      return document && { rev: document.rev, savedAt: document.savedAt };
    },
    readSiteDocument: async () => {
      step("snapshot");
      return options.readSnapshot ? options.readSnapshot() : document;
    },
    userMessage: userMessage,
  };
  const module = { exports: {} as { GET: (req: Request) => Promise<Response> } };
  new Function("require", "module", "exports", code)(
    () => new Proxy({}, { get: (_target, key) => typeof key === "string" ? shared[key] : undefined }),
    module, module.exports,
  );
  return { GET: module.exports.GET, calls };
}

function captureErrors(t: TestContext) {
  const logger = t.mock.method(console, "error", () => {});
  return () => logger.mock.calls.map(call => call.arguments);
}

const errorCases: Array<[string, unknown]> = [
  ["internal error with credentials and nested properties", Object.assign(
    new Error("database failed: test-token and person@example.test", {
      cause: { document: "synthetic private body" },
    }), { code: "synthetic-secret-code", body: "synthetic private body" },
  )],
  ["Japanese document text in an error", new SyntaxError('Unexpected token: 非公開のテスト本文')],
  ["localized storage error", new Error("保存済み編集データが破損しています")],
  ["thrown string", "非公開のテスト本文 test-token person@example.test"],
  ["thrown object", { message: "synthetic private body", credential: "test-token" }],
  ["null rejection", null],
];

for (const stage of ["database", "site", "metadata", "snapshot"] as const) {
  for (const [name, error] of errorCases) {
    test(`document GET ${stage} failure is private and sanitized: ${name}`, async t => {
      const logs = captureErrors(t);
      const metaOnly = stage === "metadata";
      const f = fixture({ failStage: stage, error });
      const response = await f.GET(new Request(url + (metaOnly ? "&meta=1" : "")));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), null);
      assert.equal(response.headers.get("x-tsumu-error-stage"), null);
      assert.deepEqual(await response.json(), { error: "Couldn't load" });
      assert.deepEqual(logs(), [["[api/doc GET] document read failed"]]);
      const expected = ["auth", "configured", "siteId", "database"];
      if (stage !== "database") expected.push("site");
      if (stage === "metadata" || stage === "snapshot") expected.push(stage);
      assert.deepEqual(f.calls, expected);
    });
  }
}

test("document GET still translates the generic error and logs a single metadata-only failure", async t => {
  const logs = captureErrors(t);
  const f = fixture({
    failStage: "database", error: new Error("synthetic database error"),
    translate: value => value === "Couldn't load" ? "Could not load" : value,
  });
  const response = await f.GET(new Request(url + "&meta=1"));
  assert.deepEqual(await response.json(), { error: "Could not load" });
  assert.equal(response.headers.get("x-tsumu-error-stage"), null);
  assert.deepEqual(logs(), [["[api/doc GET] document read failed"]]);
});

test("document GET authorization and input errors never reach storage or error logging", async t => {
  const logs = captureErrors(t);
  for (const status of [401, 403]) {
    const denied = NextResponse.json({ error: "denied" }, { status });
    const f = fixture({ denied, failStage: "database", error: new Error("must not read") });
    assert.equal(await f.GET(new Request(url)), denied);
    assert.deepEqual(f.calls, ["auth"]);
  }
  const unavailable = fixture({ configured: false });
  const noDb = await unavailable.GET(new Request(url));
  assert.equal(noDb.status, 503);
  assert.equal(noDb.headers.get("x-tsumu-error-stage"), null);
  assert.deepEqual(unavailable.calls, ["auth", "configured"]);

  for (const path of ["https://editor.example.test/api/doc", url.replace("test-site", "invalid%20site")]) {
    const f = fixture();
    const invalid = await f.GET(new Request(path));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("x-tsumu-error-stage"), null);
    assert.deepEqual(f.calls, ["auth", "configured", "siteId"]);
  }
  assert.deepEqual(logs(), []);
});

test("document GET success, missing documents and absent sites preserve their behavior", async t => {
  const logs = captureErrors(t);
  for (const metaOnly of [false, true]) {
    const path = url + (metaOnly ? "&meta=1" : "");
    for (const document of [snapshot, null]) {
      const f = fixture({ document });
      const response = await f.GET(new Request(path));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("x-tsumu-error-stage"), null);
      assert.deepEqual(await response.json(), !document ? { exists: false } : {
        exists: true, rev: "4", savedAt: 123,
        ...(!metaOnly ? { doc: { siteName: "test document" } } : {}),
      });
      assert.deepEqual(f.calls, ["auth", "configured", "siteId", "database", "site", metaOnly ? "metadata" : "snapshot"]);
    }
    const f = fixture({ siteExists: false });
    const missing = await f.GET(new Request(path));
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Site not found" });
    assert.equal(missing.headers.get("x-tsumu-error-stage"), null);
    assert.deepEqual(f.calls, ["auth", "configured", "siteId", "database", "site"]);
  }
  assert.deepEqual(logs(), []);
});

for (const field of ["props", "entry"] as const) {
  for (const [language, corrupt] of [["English", "test-secret"], ["Japanese", "非公開のテスト本文"]]) {
    test(`document GET does not log or return ${language} JSON parse excerpts from corrupt stored ${field}`, async t => {
      const logs = captureErrors(t);
      const sqlite = new DatabaseSync(":memory:");
      t.after(() => sqlite.close());
      const storage: DocumentSqlStorage = {
        sql: { exec(sql, ...args) {
          const stmt = sqlite.prepare(sql);
          if (stmt.columns().length) return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
          stmt.run(...args);
          return { toArray: () => [] };
        } },
        transactionSync(fn) {
          sqlite.exec("BEGIN");
          try { const result = fn(); sqlite.exec("COMMIT"); return result; }
          catch (error) { sqlite.exec("ROLLBACK"); throw error; }
        },
      };
      const store = new StructuredDocumentStore(storage);
      store.replace(JSON.stringify(createInitialDoc()), null);
      if (field === "props") sqlite.prepare("UPDATE document_meta SET props=?").run(corrupt);
      else sqlite.prepare("UPDATE document_entries SET body=?").run(corrupt);
      assert.throws(() => store.snapshot(), error => {
        assert.ok(error instanceof SyntaxError);
        assert.ok(error.message.includes(corrupt), "real JSON parser includes the stored fragment");
        return true;
      });
      const f = fixture({ readSnapshot: () => store.snapshot() });
      const response = await f.GET(new Request(url));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), null);
      assert.equal(response.headers.get("x-tsumu-error-stage"), null);
      assert.deepEqual(await response.json(), { error: "Couldn't load" });
      assert.deepEqual(logs(), [["[api/doc GET] document read failed"]]);
    });
  }
}
});

describe("doc-patch", () => {
const doc = (): SiteDoc => ({
  schemaVersion: 1, siteName: "Example", pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["node-1"] } },
  nodes: { "node-1": { id: "node-1", type: "box", name: "Text", semantic: "auto", children: [],
    text: { content: "Hello", heading: 0 }, link: null, styles: {} } },
  pageOrder: ["home"], assets: {},
} as SiteDoc);

async function database(run: (db: Db, statements: { sql: string; args: unknown[] }[]) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-delta-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const real = await getDbFromBinding(nodeDatabase()!);
    await insertSite(real, "s1", { name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    const statements: { sql: string; args: unknown[] }[] = [];
    const db: Db = { ...real, execute: async (stmt) => {
      statements.push(typeof stmt === "string" ? { sql: stmt, args: [] } : stmt);
      return real.execute(stmt);
    } };
    await run(db, statements);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("one element edit sends only that element and leaves the base immutable", () => {
  const base = doc();
  for (let n = 0; n < 1000; n++) base.nodes[`extra-${n}`] = { ...base.nodes["node-1"], id: `extra-${n}`, text: { content: "x".repeat(1000), heading: 0 } };
  const next = structuredClone(base);
  next.nodes["node-1"].text!.content = "Edited";
  const patch = createDocPatch(base, next)!;
  assert.deepEqual(patch.map((op) => op.path), [["nodes", "node-1"]]);
  assert.ok(JSON.stringify(patch).length < JSON.stringify(next).length / 1000);
  assert.deepEqual(applyDocPatch(base, patch), next);
  assert.equal(base.nodes["node-1"].text!.content, "Hello");
  assert.deepEqual(createDocPatch(base, structuredClone(base)), []);
});

test("invalid, overlapping and destructive paths are rejected", () => {
  for (const patch of [
    [{ path: [], value: {} }], [{ path: ["__proto__", "polluted"], value: true }],
    [{ path: ["nodes", "a.b"], value: {} }], [{ path: ["pages"], remove: true }],
    [{ path: ["pageOrder"], value: {} }], [{ path: ["nodes"], value: [] }],
    [{ path: ["siteName"], value: "A", remove: true }],
    [{ path: ["nodes"], value: {} }, { path: ["nodes", "a"], remove: true }],
  ]) assert.equal(isDocPatch(patch), false, JSON.stringify(patch));
  const base = doc();
  const next = structuredClone(base);
  for (let n = 0; n <= MAX_PATCH_OPS; n++) next.nodes[`extra-${n}`] = base.nodes["node-1"];
  assert.equal(createDocPatch(base, next), null, "bulk edits use a full snapshot");
});

test("missing and out-of-order revisions require a snapshot instead of applying a patch", () => {
  const base = doc();
  const next = { ...base, siteName: "Updated" };
  const patch = createDocPatch(base, next)!;
  assert.equal(applyDocPatchAtRevision(base, "1", "2", patch), null);
  assert.equal(applyDocPatchAtRevision(null, "1", "1", patch), null);
  assert.deepEqual(applyDocPatchAtRevision(base, "1", "1", patch), next);
});

test("SQL patches preserve nulls, arrays, additions and removals without fetching the body", async () => {
  await database(async (db, statements) => {
    const base = doc();
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = structuredClone(base);
    next.siteName = "Updated";
    delete next.nodes["node-1"];
    next.nodes["node-2"] = { ...base.nodes["node-1"], id: "node-2", text: { content: 'quote " and 日本語', heading: 0 }, field: { kind: "input", disabled: false, maxLength: 0 } };
    next.pages.home.children = ["node-2"];
    const patch = createDocPatch(base, next)!;
    statements.length = 0;
    const result = await saveDocPatch(db, "s1", patch, "1");
    assert.equal(result.kind, "saved");
    assert.equal(statements.some((s) => /SELECT rev, saved_at, body/.test(s.sql)), false);
    assert.equal(statements.length, 2, "one conditional database-side backup plus one update");
    assert.ok(statements.every((s) => s.args.length <= 100));
    assert.equal(statements.some((s) => s.args.includes(JSON.stringify(base))), false);
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
    assert.deepEqual(applyDocPatch(base, patch), next);
    const conflict = await saveDocPatch(db, "s1", patch, "1");
    assert.equal(conflict.kind, "conflict");
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
  });
});

test("the maximum patch size fits parameter limits and applies all chunks correctly", async () => {
  await database(async (db, statements) => {
    const base = doc();
    for (let n = 0; n < MAX_PATCH_OPS; n++) base.nodes[`item-${n}`] = { ...base.nodes["node-1"], id: `item-${n}`, text: structuredClone(base.nodes["node-1"].text) };
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = structuredClone(base);
    for (let n = 0; n < MAX_PATCH_OPS; n++) {
      if (n % 3 === 0) delete next.nodes[`item-${n}`];
      else next.nodes[`item-${n}`].text!.content = `Updated ${n}`;
    }
    const patch = createDocPatch(base, next)!;
    assert.equal(patch.length, MAX_PATCH_OPS);
    statements.length = 0;
    assert.equal((await saveDocPatch(db, "s1", patch, "1")).kind, "saved");
    assert.ok(statements.every((s) => s.args.length <= 100));
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
  });
});

test("the first save of a day keeps the previous day's final content as that day's backup", async () => {
  await database(async (db) => {
    const backups = async () => (await db.execute("SELECT day, saved_at, body FROM site_backups WHERE site_id = 's1'")).rows;
    const base = doc();
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const evening = { ...base, siteName: "End of the first day" };
    assert.equal((await saveCurrentDoc(db, "s1", JSON.stringify(evening), "1")).kind, "saved");
    assert.equal((await backups()).length, 0, "the day has not ended yet");

    const yesterday = Date.now() - 86_400_000;
    await db.execute({ sql: "UPDATE docs SET saved_at = ? WHERE id = 's1'", args: [yesterday] });
    // 翌日の最初の保存で壊しても、前日の最後の内容が残る
    const broken = { ...evening, nodes: {}, pages: { home: { ...evening.pages.home, children: [] } } };
    assert.equal((await saveDocPatch(db, "s1", createDocPatch(evening, broken)!, "2")).kind, "saved");
    let rows = await backups();
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].day), new Date(yesterday).getUTCDay());
    assert.equal(Number(rows[0].saved_at), yesterday);
    assert.deepEqual(JSON.parse(String(rows[0].body)), evening);

    // 同じ日の2回目以降の保存では、書き換えない
    assert.equal((await saveCurrentDoc(db, "s1", JSON.stringify({ ...broken, siteName: "Later" }), "3")).kind, "saved");
    rows = await backups();
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(String(rows[0].body)), evening);
  });
});

test("large documents save until the storage itself rejects them as too large", async () => {
  await database(async (real) => {
    const base = doc();
    await saveCurrentDoc(real, "s1", JSON.stringify(base), null);
    // 大きさの上限は決め打ちしない。D1 の公称の 2MB も、以前の 10MB も超えて保存できる
    const large = structuredClone(base);
    large.nodes["node-1"].text!.content = "z".repeat(12 * 1024 * 1024);
    assert.equal((await saveCurrentDoc(real, "s1", JSON.stringify(large), "1")).kind, "saved");
    const edited = { ...large, siteName: "Edited" };
    assert.equal((await saveDocPatch(real, "s1", createDocPatch(large, edited)!, "2")).kind, "saved");
    // 保存先（D1）が大きすぎるとして拒否したときは、大きさのエラーとして返す
    const d1: Db = { ...real, execute: async (stmt) => {
      if (typeof stmt !== "string" && /^(UPDATE docs|WITH patched)/.test(stmt.sql)) {
        throw new Error("D1_ERROR: string or blob too big: SQLITE_TOOBIG");
      }
      return real.execute(stmt);
    } };
    await assert.rejects(saveCurrentDoc(d1, "s1", JSON.stringify(base), "3"), DocTooLargeError);
    await assert.rejects(saveDocPatch(d1, "s1", createDocPatch(edited, { ...edited, siteName: "A" })!, "3"), DocTooLargeError);
    assert.equal((await readCurrentDoc(real, "s1"))!.rev, "3");
  });
});

test("documents without any page are rejected, because the editor cannot open them", () => {
  const empty = { ...doc(), pages: {}, pageOrder: [] };
  assert.equal(validateDocBody(JSON.stringify(empty)), "不正なリクエスト");
  assert.equal(validateDocBody(JSON.stringify(doc())), null);
  assert.equal(isDocPatch([{ path: ["pageOrder"], value: [] }]), false);
  assert.equal(createDocPatch(doc(), empty), null, "falls back to a full save, which is rejected");
});


test("full snapshots reject missing page references and malformed document containers", () => {
  const original = doc();
  const invalid = [
    { ...original, pageOrder: ["missing"] },
    { ...original, pages: null },
    { ...original, nodes: [] },
    { ...original, assets: "assets" },
    { ...original, siteName: null },
    { ...original, pages: { home: { id: "home", children: "not-an-array" } } },
  ];
  for (const bad of invalid) {
    assert.equal(validateDocBody(JSON.stringify(bad)), "不正なリクエスト",
      JSON.stringify(bad));
  }
  assert.equal(validateDocBody(JSON.stringify(original)), null);
});

test("database-side patching does not persist invalid page order or missing page records", async () => {
  await database(async (db) => {
    const original = doc();
    await saveCurrentDoc(db, "s1", JSON.stringify(original), null);
    const badPatches = [
      [{ path: ["pages", "home"], remove: true }],
      [{ path: ["pageOrder"], value: ["missing"] }],
      [{ path: ["pages", "home"], value: { id: "home", children: "broken" } }],
    ] as const;
    for (const patch of badPatches) {
      await assert.rejects(
        saveDocPatch(db, "s1", patch as any, "1"),
        /不正な|invalid/i,
      );
      const current = await readCurrentDoc(db, "s1");
      assert.equal(current?.rev, "1");
      assert.deepEqual(JSON.parse(current!.body), original);
    }
    const fixed = { ...original.pages.home, name: "Renamed" };
    const ok = await saveDocPatch(db, "s1",
      [{ path: ["pages", "home"], value: fixed }], "1");
    assert.equal(ok.kind, "saved");
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body).pages.home, fixed);
  });
});

test("snapshots and atomic patches reject broken node trees without advancing the revision", async () => {
  await database(async (db) => {
    const original = doc();
    await saveCurrentDoc(db, "s1", JSON.stringify(original), null);
    for (const changed of [
      { ...original, nodes: {} },
      { ...original, nodes: { "node-1": null } },
      { ...original, nodes: { "node-1": { ...original.nodes["node-1"], children: ["node-1"] } } },
      { ...original, nodes: { ...original.nodes,
        a: { ...original.nodes["node-1"], id: "a", children: ["b"] },
        b: { ...original.nodes["node-1"], id: "b", children: ["a"] } } },
    ]) {
      assert.equal(validateDocBody(JSON.stringify(changed)), "不正なリクエスト");
      const patch = createDocPatch(original, changed as SiteDoc)!;
      await assert.rejects(saveDocPatch(db, "s1", patch, "1"), /不正な/);
      assert.equal((await readCurrentDoc(db, "s1"))?.body, JSON.stringify(original));
      assert.equal((await readCurrentDoc(db, "s1"))?.rev, "1");
    }
  });
});

test("component roots and asset definitions stay valid across snapshots and revisions", async () => {
  await database(async db => {
    const original = { ...doc(), components: { card: { id: "card", name: "Card", rootId: "node-1" } } };
    await saveCurrentDoc(db, "s1", JSON.stringify(original), null);
    for (const patch of [
      [{ path: ["assets", "bad"], value: null }],
      [{ path: ["components", "card"], value: { id: "card", name: "Card", rootId: "missing" } }],
      [{ path: ["pages", "home"], value: { ...original.pages.home, children: [] } },
       { path: ["nodes", "node-1"], remove: true }],
    ] as const) {
      assert.equal(validateDocBody(JSON.stringify(applyDocPatch(original, patch as any))), "不正なリクエスト");
      await assert.rejects(saveDocPatch(db, "s1", patch as any, "1"), /不正な/);
      assert.equal((await readCurrentDoc(db, "s1"))?.rev, "1");
    }
  });
});

test("structural edits work when an optional component map is null", async () => {
  await database(async db => {
    const empty = { ...doc(), components: null };
    assert.equal(validateDocBody(JSON.stringify(empty)), null);
    await saveCurrentDoc(db, "s1", JSON.stringify(empty), null);
    const result = await saveDocPatch(db, "s1", [
      { path: ["nodes", "extra"], value: { ...empty.nodes["node-1"], id: "extra" } },
      { path: ["pages", "home"], value: { ...empty.pages.home, children: ["node-1", "extra"] } },
    ], "1");
    assert.equal(result.kind, "saved");
  });
});


test("page roots cannot share ownership with other pages or node children", async () => {
  await database(async db => {
    const original = doc();
    await saveCurrentDoc(db, "s1", JSON.stringify(original), null);
    for (const changed of [
      { ...original, pages: { ...original.pages, other: { ...original.pages.home, id: "other", slug: "other" } }, pageOrder: ["home", "other"] },
      { ...original, nodes: { ...original.nodes, parent: { ...original.nodes["node-1"], id: "parent", children: ["node-1"] } } },
      { ...original, pages: { home: { ...original.pages.home, children: ["node-1", "node-1"] } } },
    ]) {
      assert.notEqual(validateDocBody(JSON.stringify(changed)), null);
      await assert.rejects(saveDocPatch(db, "s1", createDocPatch(original, changed as SiteDoc)!, "1"), /不正な/);
      assert.equal((await readCurrentDoc(db, "s1"))?.body, JSON.stringify(original));
      assert.equal((await readCurrentDoc(db, "s1"))?.rev, "1");
    }
  });
});
});

describe("doc-route-security", () => {
class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), {
      ...init, headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}
class DocTooLargeError extends Error {}
class InvalidDocPatchError extends Error {}

type Snapshot = { rev: string; savedAt: number; body: string };

function fixture(ownedAssets: Set<string> = new Set()) {
  let snapshot: Snapshot | null = {
    rev: "4", savedAt: 123, body: '{"siteName":"private"}',
  };
  let conflict = false;
  let writes = 0;
  const source = readFileSync(new URL("../app/api/doc/route.ts", import.meta.url), "utf8");
  const code = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  const shared: Record<string, unknown> = {
    NextResponse,
    dbUnavailable: async () => NextResponse.json({}, { status: 503 }),
    serverTr: async () => (value: string) => value,
    dbConfigured: () => true,
    getDb: async () => ({ backend: "sqlite" }),
    requireAuth: async () => null, requireSiteAccess: async () => null,
    sessionUser: async () => null,
    recordActivity: async () => {},
    notifyDocUpdated: () => {},
    siteIdOf: async () => "site",
    getSite: async () => ({ id: "site" }),
    getSiteRoomKey: async () => null,
    readSiteDocument: async () => snapshot,
    readSiteDocumentMeta: async () => snapshot && { rev: snapshot.rev, savedAt: snapshot.savedAt },
    extractAssetReferences,
    siteOwnsAssets: async (_db: unknown, _siteId: string, paths: Iterable<string>) =>
      [...paths].every((path) => ownedAssets.has(path)),
    saveSiteDocumentWithTarget: async () => {
      writes++;
      return { result: conflict ? { kind: "conflict", current: snapshot } : { kind: "saved", rev: "5", savedAt: 124 }, roomKey: null };
    },
    patchSiteDocumentWithTarget: async () => {
      writes++;
      return { result: conflict ? { kind: "conflict", current: snapshot } : { kind: "saved", rev: "5", savedAt: 124 }, roomKey: null };
    },
    validateDocValue: () => null,
    isDocPatch: (value: unknown) => Array.isArray(value),
    DocTooLargeError,
    InvalidDocPatchError,
    userMessage: () => "error",
    readJsonLimited,
    readJsonObjectLimited,
    jsonErrorStatus,
    JsonBodyTooLargeError,
    JsonContentTypeError,
  };
  const mod = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (_id: string) => new Proxy({}, {
      get: (_target, key: string | symbol) => typeof key === "string" ? shared[key] : undefined,
    }),
    mod, mod.exports,
  );
  return {
    GET: mod.exports.GET as (req: Request) => Promise<Response>,
    PUT: mod.exports.PUT as (req: Request) => Promise<Response>,
    PATCH: mod.exports.PATCH as (req: Request) => Promise<Response>,
    get writes() { return writes; },
    setConflict(on: boolean) { conflict = on; },
    setSnapshot(value: Snapshot | null) { snapshot = value; },
  };
}

const url = "https://editor.example.test/api/doc?site=site&base=1";
function request(method: "PUT" | "PATCH", body: string, headers: Record<string, string> = {}) {
  return new Request(url, {
    method, body, headers: { "Content-Type": "application/json", ...headers },
  });
}

test("document GET keeps full, metadata and missing responses private", async () => {
  const f = fixture();
  const full = await f.GET(new Request(url));
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("cache-control"), "private, no-store");
  assert.equal((await full.json()).doc.siteName, "private");

  const meta = await f.GET(new Request(url + "&meta=1"));
  assert.equal(meta.headers.get("cache-control"), "private, no-store");
  assert.equal((await meta.json()).rev, "4");

  f.setSnapshot(null);
  for (const path of [url, url + "&meta=1"]) {
    const missing = await f.GET(new Request(path));
    assert.equal(missing.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await missing.json(), { exists: false });
  }
});

test("document saves reject oversized, invalid MIME, malformed, and cross-site asset payloads before writes", async () => {
  const f = fixture(new Set(["assets/own.png"]));
  for (const method of ["PUT", "PATCH"] as const) {
    const huge = await f[method](request(method, "{}", {
      "Content-Length": String(64 * 1024 * 1024 + 1),
    }));
    assert.equal(huge.status, 413, method);
    const wrongType = await f[method](request(method, "{}", { "Content-Type": "text/plain" }));
    assert.equal(wrongType.status, 415, method);
    const broken = await f[method](request(method, "{bad"));
    assert.equal(broken.status, 400, method);
  }
  assert.equal(
    (await f.PUT(request("PUT", JSON.stringify({ assets: { a: { path: "assets/foreign.png" } } })))).status,
    400,
  );
  assert.equal(
    (await f.PATCH(request("PATCH", JSON.stringify([{ path: ["assets", "a"], value: { path: "assets/foreign.png" } }])))).status,
    400,
  );
  assert.equal(f.writes, 0);
  assert.equal(
    (await f.PUT(request("PUT", JSON.stringify({ assets: { a: { path: "assets/own.png" } } })))).status,
    200,
  );
  assert.equal(f.writes, 1);
});

test("ordinary saves work and conflicting document bodies are never cacheable", async () => {
  const f = fixture();
  const saved = await f.PUT(request("PUT", '{"siteName":"Edited"}'));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).rev, "5");
  assert.equal(f.writes, 1);

  f.setConflict(true);
  const conflict = await f.PATCH(request("PATCH", '[{"path":["siteName"],"value":"Changed"}]'));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.headers.get("cache-control"), "private, no-store");
  assert.equal((await conflict.json()).doc.siteName, "private");
  assert.equal(f.writes, 2);
});
});

describe("doc-save-acknowledgment", () => {
const patch = [{ path: ["siteName"], value: edit.siteName }];
const request = (method: "PUT" | "PATCH", base = "1") => new Request(`https://editor.example.test/api/doc?site=source&base=${base}`, {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(method === "PUT" ? edit : patch),
});
function publicPayload(value: unknown, ...keys: string[]) {
  for (const key of keys) assert.ok(!JSON.stringify(value).includes(key));
  assert.ok(!JSON.stringify(value).includes('"roomKey"'));
  assert.ok(!JSON.stringify(value).includes('"result"'));
}
for (const method of ["PUT", "PATCH"] as const) {
  test(`${method} acknowledges a committed write without a second room lookup`, async t => {
    const f = await setup(t); const key = await f.create("source"); let reads = 0;
    f.hooks.beforeExecute = async stmt => {
      if (isRoomLookup(stmt, "source")) {
        reads++;
        if (f.room(key).meta()?.rev === "2") throw new Error("Synthetic transient D1 read failure");
      }
    };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.deepEqual(saved, { ok: true, rev: "2", savedAt: f.room(key).meta()!.savedAt });
    assert.equal(JSON.parse(f.room(key).snapshot()!.body).siteName, edit.siteName);
    assert.equal(reads, 1);
    assert.equal(f.notifications[0]?.roomKey, key);
    publicPayload(saved, key); publicPayload(f.notifications[0].message, key);
    assert.deepEqual(f.logs(), []);
  });
  test(`${method} activity SQL failures remain advisory`, async t => {
    const f = await setup(t); const key = await f.create("source");
    f.hooks.beforeExecute = async stmt => { if (/INSERT INTO site_activity/.test(sqlOf(stmt))) throw new Error("Synthetic activity failure"); };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rev, "2");
    assert.equal(f.room(key).meta()?.rev, "2");
    assert.equal(f.notifications[0]?.roomKey, key);
    assert.deepEqual(f.logs(), []);
  });
  test(`${method} timestamp update failures stay advisory after the document commits`, async t => {
    const f = await setup(t); const key = await f.create("source");
    f.hooks.beforeBatch = async stmts => {
      if (stmts.some(stmt => /UPDATE site_document_rooms/.test(sqlOf(stmt)))) throw new Error("Synthetic timestamp failure");
    };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rev, "2");
    assert.equal(f.room(key).meta()?.rev, "2");
    assert.equal(f.notifications[0]?.roomKey, key);
    assert.deepEqual(f.logs(), []);
  });
  test(`${method} optional notification failure cannot turn a committed save into a failure`, async t => {
    const f = await setup(t); const key = await f.create("source");
    f.hooks.beforeNotify = () => { throw Object.assign(new Error("synthetic-token 非公開のテスト本文"), { roomKey: key }); };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rev, "2");
    assert.equal(f.room(key).meta()?.rev, "2");
    assert.deepEqual(f.logs(), [["[api/doc] document notification failed"]]);
  });
  test(`${method} never routes a committed old document to a replacement generation`, async t => {
    const f = await setup(t); const oldKey = await f.create("source"); let newKey: string | undefined;
    f.hooks.beforeExecute = async stmt => {
      if (/INSERT INTO site_activity/.test(sqlOf(stmt))) {
        f.hooks.beforeExecute = undefined;
        newKey = await f.replace("source", replacement);
      }
    };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    assert.ok(newKey); assert.notEqual(newKey, oldKey);
    assert.deepEqual(JSON.parse(f.room(newKey).snapshot()!.body), replacement);
    assert.equal(f.notifications.length, 1);
    assert.equal(f.notifications[0].roomKey, oldKey);
    assert.equal(JSON.stringify(f.notifications[0].message).includes(edit.siteName), true);
    publicPayload(await response.json(), oldKey, newKey);
    publicPayload(f.notifications[0].message, oldKey, newKey);
    assert.deepEqual(f.logs(), []);
  });
  test(`${method} genuine storage failures retain 502 with no notification`, async t => {
    const f = await setup(t); const key = await f.create("source");
    f.hooks.beforeRoomWrite = async () => { throw new Error("synthetic-token storage failure"); };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Couldn't save" });
    assert.equal(f.room(key).meta()?.rev, "1");
    assert.deepEqual(f.notifications, []);
    assert.deepEqual(f.logs(), [["[api/doc] document save failed"]]);
  });
  test(`${method} a replacement during the write returns missing and never broadcasts`, async t => {
    const f = await setup(t); const oldKey = await f.create("source"); let newKey: string | undefined;
    f.hooks.afterRoomWrite = async () => { f.hooks.afterRoomWrite = undefined; newKey = await f.replace("source", replacement); };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Site not found" });
    assert.deepEqual(f.notifications, []);
    assert.ok(newKey); assert.notEqual(oldKey, newKey);
    assert.deepEqual(JSON.parse(f.room(newKey).snapshot()!.body), replacement);
  });
  test(`${method} conflict snapshots preserve their public shape and never broadcast`, async t => {
    const f = await setup(t); const key = await f.create("source");
    const response = await f.doc[method](request(method, "2"));
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.deepEqual(payload, { conflict: true, rev: "1", savedAt: f.room(key).meta()!.savedAt, doc: original });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    publicPayload(payload, key);
    assert.deepEqual(f.notifications, []);
  });
  test(`${method} an obsolete conflict snapshot is not returned or broadcast`, async t => {
    const f = await setup(t); await f.create("source");
    f.hooks.afterRoomWrite = async () => { f.hooks.afterRoomWrite = undefined; await f.replace("source", replacement); };
    const response = await f.doc[method](request(method, "2"));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Site not found" });
    assert.deepEqual(f.notifications, []);
  });
}

test("server target envelopes name the room only for accepted writes", async t => {
  const f = await setup(t); const key = await f.create("source");
  for (const method of ["saveSiteDocumentWithTarget", "patchSiteDocumentWithTarget"]) {
    const value = method === "saveSiteDocumentWithTarget" ? JSON.stringify(edit) : patch;
    const rev = f.room(key).meta()!.rev;
    const internal = await f.services[method](f.rawDb, "source", value, rev);
    assert.deepEqual(Object.keys(internal).sort(), ["result", "roomKey"]);
    assert.equal(internal.roomKey, key);
    assert.deepEqual(internal.result, { kind: "saved", rev: String(Number(rev) + 1), savedAt: f.room(key).meta()!.savedAt });
    const conflict = await f.services[method](f.rawDb, "source", value, "1");
    assert.equal(conflict.result.kind, "conflict");
    assert.equal(conflict.roomKey, null);
  }
  await sites.deleteSite(f.rawDb, "source", key);
  const missing = await f.services.saveSiteDocumentWithTarget(f.rawDb, "source", JSON.stringify(edit), null);
  assert.deepEqual(missing, { result: { kind: "missing" }, roomKey: null });
});

for (const method of ["save", "patch"] as const) {
  test(`WebSocket ${method} success, conflict and broadcasts do not contain server-only target keys`, async t => {
    const f = await setup(t); const key = await f.create("source");
    const { CollaborationRoom } = load("../../custom-worker.ts", {
      "cloudflare:workers": { DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } },
      "./.open-next/worker.js": {}, "./document-room": { DocumentRoom: class {} },
      "./lib/db": { getDbFromBinding: async () => f.rawDb },
    });
    const socket = () => ({
      messages: [] as string[],
      deserializeAttachment: () => ({ siteId: "source", roomKey: key }),
      send(raw: string) { this.messages.push(raw); },
      close() { assert.fail("unexpected generation or auth rejection"); },
    });
    const sender = socket(); const peer = socket();
    const room = new CollaborationRoom({ getWebSockets: () => [sender, peer] }, { ALLOW_ANONYMOUS: "true", DB: {}, DOC_STORE: {
      idFromName: (key: string) => key,
      get: (key: string) => ({
        getSnapshot: async () => f.room(key).snapshot(),
        replaceDocument: async (raw: string, base: string | null) => f.room(key).replace(raw, base),
        patchDocument: async (value: any, base: string) => f.room(key).patch(value, base),
      }),
    } });
    const input = { type: method, requestId: "first", base: "1", ...(method === "save" ? { doc: edit } : { patch }) };
    await room.webSocketMessage(sender, JSON.stringify(input));
    assert.deepEqual(JSON.parse(sender.messages[0]), { type: "saved", requestId: "first", rev: "2", savedAt: f.room(key).meta()!.savedAt });
    assert.equal(peer.messages.length, 1);
    const update = JSON.parse(peer.messages[0]);
    assert.deepEqual(Object.keys(update).sort(), method === "save" ? ["doc", "rev", "savedAt", "type"] : ["base", "patch", "rev", "savedAt", "type"]);
    publicPayload(update, key);
    await room.webSocketMessage(sender, JSON.stringify({ ...input, requestId: "stale" }));
    const conflict = JSON.parse(sender.messages[1]);
    assert.deepEqual(conflict, { type: "conflict", requestId: "stale", rev: "2", savedAt: f.room(key).meta()!.savedAt, doc: edit });
    publicPayload(JSON.parse(sender.messages[0]), key); publicPayload(conflict, key);
    assert.equal(peer.messages.length, 1);
  });
}

test("a full save and a subsequent SQL patch use the same value for duplicate JSON keys", async t => {
  const f = await setup(t);
  await f.create("source", "Duplicate keys", null as unknown as typeof original);
  const node = { id: "n", type: "box", name: "Original", semantic: "auto", children: [], styles: {} };
  const page = { id: "home", slug: "", name: "Home", title: "", description: "", children: ["n"] };
  const text = '{"schemaVersion":1,"siteName":"Duplicate keys","nodes":{},"nodes":' + JSON.stringify({ n: node }) +
    ',"pages":' + JSON.stringify({ home: page }) + ',"pageOrder":["home"],"assets":{}}';
  const saved = await f.doc.PUT(new Request("https://editor.example.test/api/doc?site=source", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: text,
  }));
  assert.equal(saved.status, 200);
  const { rev } = await saved.json();
  const updated = await f.doc.PATCH(new Request(`https://editor.example.test/api/doc?site=source&base=${rev}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ path: ["nodes", "n"], value: { ...node, name: "Edited" } }]),
  }));
  assert.equal(updated.status, 200);
  const current = await (await f.doc.GET(new Request("https://editor.example.test/api/doc?site=source"))).json();
  assert.equal(current.doc.nodes.n.name, "Edited");
});
});

describe("doc-structural-sharing", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(count = 40): SiteDoc {
  const ids = Array.from({ length: count }, (_, i) => `node-${i}`);
  return {
    schemaVersion: 1,
    siteName: "Structural sharing",
    colorPalette: ["#111111", "#eeeeee"],
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ids },
      about: { id: "about", name: "About", slug: "about", title: "About", description: "", children: [] },
    },
    pageOrder: ["home", "about"],
    nodes: Object.fromEntries(ids.map((id) => [
      id, { ...makeBox(), id, name: id, styles: { base: { default: { color: "red" } } } },
    ])),
    assets: {
      logo: { id: "logo", name: "logo.png", src: "", storagePath: "assets/logo.png", type: "image", width: 10, height: 10 },
    },
    components: {},
  } as SiteDoc;
}

const state = () => useEditor.getState();
function open(doc = fixture()): SiteDoc {
  state().endGesture();
  state().replaceDoc(doc);
  return state().doc;
}

test("a structural edit keeps every untouched page, node, asset and setting by reference", () => {
  const before = open();
  state().updateDoc((d) => {
    d.nodes["node-3"].name = "Renamed";
    d.pages.about.title = "About us";
  });
  const after = state().doc;
  assert.notEqual(after, before);
  assert.equal(after.nodes["node-3"].name, "Renamed");
  assert.notEqual(after.nodes["node-3"], before.nodes["node-3"]);
  assert.notEqual(after.pages.about, before.pages.about);
  for (const id of Object.keys(before.nodes)) {
    if (id !== "node-3") assert.equal(after.nodes[id], before.nodes[id], `${id} must be shared`);
  }
  assert.equal(after.pages.home, before.pages.home);
  assert.equal(after.assets, before.assets, "an unchanged collection is shared as a whole");
  assert.equal(after.colorPalette, before.colorPalette);
  assert.equal(after.pageOrder, before.pageOrder);
  // 履歴に積まれた編集前の文書は書き換わらず、元に戻すと、同じ参照に戻る
  assert.equal(before.nodes["node-3"].name, "node-3");
  state().undo();
  assert.equal(state().doc, before);
  state().redo();
  assert.equal(state().doc, after);
});

test("a structural edit that changes nothing keeps the document, history and redo stack", () => {
  const before = open();
  state().updateNode("node-0", { name: "Undoable" });
  state().undo();
  const current = state().doc;
  const { past, future } = state();
  assert.equal(future.length, 1);
  state().updateDoc((d) => {
    d.nodes["node-1"].name = "node-1";
    d.pageOrder = [...d.pageOrder];
    // JSON に出ない undefined の項目は、保存される内容を変えない
    (d.nodes["node-2"] as unknown as Record<string, unknown>).customTag = undefined;
  });
  assert.equal(state().doc, current);
  assert.equal(state().past, past);
  assert.equal(state().future, future);
  assert.equal(current, before);
});

test("after a structural edit, the incremental save sends only what changed", () => {
  const synced = open(fixture(300));
  state().insertNodes([{ ...makeBox(), id: "added", name: "Added" }], "added", { kind: "page", id: "home" }, 0);
  const next = state().doc;
  const patch = createDocPatch(synced, next);
  assert.deepEqual(patch?.map((op) => op.path), [["pages", "home"], ["nodes", "added"]]);
  // 変わっていない要素は参照が同じなので、差分を作るときに直列化されない
  const original = JSON.stringify;
  let serialized = 0;
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    serialized++;
    return original(...args);
  }) as typeof JSON.stringify;
  try {
    createDocPatch(synced, next);
  } finally {
    JSON.stringify = original;
  }
  assert.ok(serialized <= 4, `only the changed page and the new node are compared (${serialized} serializations)`);
});

test("adding, removing and reordering entries is never mistaken for an unchanged document", () => {
  const before = fixture(4);
  const removed = structuredClone(before);
  delete removed.nodes["node-3"];
  removed.pages.home.children = removed.pages.home.children.filter((id) => id !== "node-3");
  const shared = shareUnchangedDoc(before, removed);
  assert.deepEqual(shared, removed);
  assert.equal(Object.hasOwn(shared.nodes, "node-3"), false);
  assert.equal(shared.nodes["node-0"], before.nodes["node-0"]);

  // キーの並びが変わるだけでも、保存される JSON は変わる
  const reordered = structuredClone(before);
  const first = reordered.nodes["node-0"];
  delete reordered.nodes["node-0"];
  reordered.nodes["node-0"] = first;
  const result = shareUnchangedDoc(before, reordered);
  assert.notEqual(result, before);
  assert.equal(JSON.stringify(result), JSON.stringify(reordered));
  assert.equal(sameDocContent(before, reordered), false);

  const extraRoot = { ...structuredClone(before), siteUrl: "https://example.com" };
  assert.equal(JSON.stringify(shareUnchangedDoc(before, extraRoot)), JSON.stringify(extraRoot));
  assert.equal(sameDocContent(before, extraRoot), false);
});

test("sharing never changes the saved content and never mutates either input", () => {
  // 決まった乱数の列で、要素・ページ・設定への変更を組み合わせる
  let seed = 12345;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };
  const mutations: Array<(d: SiteDoc) => void> = [
    (d) => { d.nodes[`node-${random(40)}`].name = `n${random(3)}`; },
    (d) => { d.nodes[`node-${random(40)}`].styles = { base: { default: { color: random(2) ? "red" : "blue" } } }; },
    (d) => { delete d.nodes[`node-${random(40)}`]; },
    (d) => { d.nodes[`extra-${random(5)}`] = { ...makeBox(), id: "extra", name: "Extra" }; },
    (d) => { d.pages.home.children = [...d.pages.home.children].reverse(); },
    (d) => { d.siteName = random(2) ? "Structural sharing" : "Renamed"; },
    (d) => { d.colorPalette = random(2) ? ["#111111", "#eeeeee"] : undefined; },
    (d) => { d.assets = {}; },
    (d) => { d.components = random(2) ? {} : undefined; },
    (d) => { (d as unknown as Record<string, unknown>).lang = random(2) ? "ja" : undefined; },
    (d) => { d.nodes = { ...d.nodes }; },
    () => {},
  ];
  for (let round = 0; round < 400; round++) {
    const before = fixture();
    const after = structuredClone(before);
    for (let i = random(4); i >= 0; i--) mutations[random(mutations.length)](after);
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);
    const result = shareUnchangedDoc(before, after);
    assert.equal(JSON.stringify(result), afterJson, `round ${round}: saved content`);
    assert.equal(result === before, beforeJson === afterJson, `round ${round}: no-op detection`);
    assert.equal(sameDocContent(before, after), beforeJson === afterJson, `round ${round}: comparison`);
    assert.equal(JSON.stringify(before), beforeJson, `round ${round}: before is not mutated`);
    assert.equal(JSON.stringify(after), afterJson, `round ${round}: after is not mutated`);
    // 差分の保存も同じ比較を使う。差分を適用した結果は、編集後と同じ内容になる
    const patch = createDocPatch(before, result);
    if (patch) {
      assert.equal(patch.length === 0, beforeJson === afterJson, `round ${round}: empty patch`);
      if (patch.length) {
        assert.equal(sameDocContent(applyDocPatch(before, patch), after), true, `round ${round}: patch round trip`);
      }
    }
  }
});

test("keys that collide with Object.prototype stay own entries of the shared collections", () => {
  const before = fixture(2);
  const after = structuredClone(before);
  Object.defineProperty(after.nodes, "__proto__", {
    value: { ...makeBox(), id: "__proto__", name: "Own" }, enumerable: true, writable: true, configurable: true,
  });
  const result = shareUnchangedDoc(before, after);
  assert.equal(Object.getPrototypeOf(result.nodes), Object.prototype);
  assert.equal(Object.hasOwn(result.nodes, "__proto__"), true);
  assert.equal(JSON.stringify(result), JSON.stringify(after));
  assert.equal(result.nodes["node-0"], before.nodes["node-0"]);
});

test("values that differ in memory but serialize identically count as unchanged", () => {
  const before = fixture(3);
  const settings = before as unknown as Record<string, unknown>;
  settings.dataRevalidate = null;
  (before.nodes["node-0"] as unknown as Record<string, unknown>).htmlAttrs = { a: "1" };
  const after = structuredClone(before);
  // NaN は JSON で null になり、undefined の項目は JSON に出ない
  (after as unknown as Record<string, unknown>).dataRevalidate = Number.NaN;
  (after.nodes["node-0"] as unknown as Record<string, unknown>).htmlAttrs = { a: "1", b: undefined };
  assert.equal(JSON.stringify(after), JSON.stringify(before));
  assert.equal(shareUnchangedDoc(before, after), before);
  assert.equal(sameDocContent(before, after), true);

  // 配列とオブジェクトの違いや、キーの並びの違いは、別の内容として扱う
  const reshaped = structuredClone(before);
  (reshaped.nodes["node-0"] as unknown as Record<string, unknown>).htmlAttrs = [["a", "1"]];
  assert.equal(sameDocContent(before, reshaped), false);
  const reordered = structuredClone(before);
  reordered.nodes["node-1"] = { name: "node-1", ...reordered.nodes["node-1"] };
  assert.equal(JSON.stringify(reordered) === JSON.stringify(before), false);
  assert.equal(sameDocContent(before, reordered), false);
  assert.equal(shareUnchangedDoc(before, reordered).nodes["node-1"], reordered.nodes["node-1"]);
});

test("a value nested too deeply to walk is still compared by its serialized form", () => {
  const deep = (depth: number) => {
    let value: unknown = "leaf";
    for (let i = 0; i < depth; i++) value = [value];
    return value;
  };
  const before = fixture(2);
  (before.nodes["node-0"] as unknown as Record<string, unknown>).htmlAttrs = deep(50_000);
  const same = { ...before, nodes: { ...before.nodes, "node-0": { ...before.nodes["node-0"], htmlAttrs: deep(50_000) } } } as unknown as SiteDoc;
  const changed = { ...before, nodes: { ...before.nodes, "node-0": { ...before.nodes["node-0"], htmlAttrs: deep(50_001) } } } as unknown as SiteDoc;
  assert.equal(sameDocContent(before, same), JSON.stringify(before) === JSON.stringify(same));
  assert.equal(sameDocContent(before, changed), false);
  assert.equal(shareUnchangedDoc(before, same), before);
});
});

describe("document-confirmation", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
for (const kind of ["pages", "add", "reset"] as const) {
  for (const change of ["unchanged", "edit", "replace", "undo", "unmount", "decline"] as const) {
    test(`${kind} destructive confirmation: ${change}`, async () => {
      const doc = createInitialDoc();
      const first = doc.pages[doc.pageOrder[0]];
      doc.pages.extra = { ...structuredClone(first), id: "extra", name: "Extra", slug: "extra", children: [] };
      doc.pageOrder.push("extra");
      doc.nodes.master = { ...makeBox(), id: "master" };
      doc.components = { reusable: { id: "reusable", name: "Reusable", rootId: "master" } };
      useEditor.getState().replaceDoc(doc);
      const ui = importCallbacks(kind);
      let closed = false;
      const tree = ui.render({ onClose: () => { closed = true; } });
      const button = elements(tree).find(e => e.type === "button" && (kind === "pages"
        ? e.props.className === "row-act is-danger"
        : kind === "add" ? e.props["data-tip"] === "Delete (also deletes every instance)"
        : elements(e).some(x => Array.isArray(x.props.children) && x.props.children.includes("Reset"))));
      assert.ok(button, kind);
      const pending = button.props.onClick({ stopPropagation() {} });
      assert.equal(ui.confirmations.length, 1);
      if (change === "edit" || change === "undo") useEditor.getState().updateDoc(d => { d.siteName = "New edit"; });
      if (change === "undo") useEditor.getState().undo();
      if (change === "replace") useEditor.getState().replaceDoc(structuredClone(doc));
      if (change === "unmount") ui.unmount();
      const before = useEditor.getState().doc;
      ui.confirmations[0].resolve(change !== "decline");
      await pending;
      if (change === "unchanged") {
        assert.notEqual(useEditor.getState().doc, before);
        if (kind === "reset") assert.equal(closed, true);
        useEditor.getState().undo();
        assert.deepEqual(useEditor.getState().doc, before);
      } else {
        assert.equal(useEditor.getState().doc, before);
        assert.equal(closed, false);
      }
      ui.unmount();
    });
  }
}

for (const route of ["menu", "bulk"] as const) test(`page ${route} deletion cancels after a remote edit`, async () => {
  const doc = createInitialDoc();
  const first = doc.pages[doc.pageOrder[0]];
  doc.pages.extra = { ...structuredClone(first), id: "extra", children: [] };
  doc.pageOrder.push("extra");
  useEditor.getState().replaceDoc(doc);
  const ui = importCallbacks("pages");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  try {
    const tree = ui.render();
    const row = elements(tree).find(e => typeof e.props?.onContextMenu === "function");
    if (route === "menu") {
      row.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 });
      const menu = elements(ui.render()).find(e => Array.isArray(e.props?.items) && e.props.items.some((item: any) => item.key === "del"));
      menu.props.items.find((item: any) => item.key === "del").onClick();
    } else {
      row.props.onClick({ metaKey: true });
      elements(ui.render()).find(e => e.props?.["aria-label"] === "Delete selected pages").props.onClick();
    }
    assert.equal(ui.confirmations.length, 1);
    useEditor.getState().updateDoc(d => { d.siteName = "Remote edit"; });
    const before = useEditor.getState().doc;
    ui.confirmations[0].resolve(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(useEditor.getState().doc, before);
  } finally {
    ui.unmount();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
});

describe("document-mutation-error-privacy", () => {
class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), {
      ...init, headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}
const routeCode = (route: string) => transformSync(readFileSync(
  new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8",
), { loader: "ts", format: "cjs", target: "es2022" }).code;
const docCode = routeCode("doc");
const sitesCode = routeCode("sites");
type Method = "PUT" | "PATCH";
type Handler = (req: Request) => Promise<Response>;
type Stage = "database" | "site" | "save" | "activity" | "read" | "insert";
const doc = createInitialDoc();
const patch: DocPatch = [{ path: ["siteName"], value: "Edited" }];
const snapshot: SiteSnapshot = { rev: "1", savedAt: 123, body: JSON.stringify(doc) };
const saved: SiteSaveResult = { kind: "saved", rev: "2", savedAt: 124 };
const saveMessage = "Couldn't save";
const createMessage = "Couldn't create it";
const saveLog = "[api/doc] document save failed";
const createLog = "[api/sites POST] site creation failed";
const tooLarge = "The document is too large for the storage";

function fixture(options: {
  stage?: Stage;
  error?: unknown;
  denied?: Response;
  configured?: boolean;
  siteExists?: boolean;
  result?: SiteSaveResult;
  read?: () => SiteSnapshot | null;
  save?: (raw: string, base: string | null) => SiteSaveResult;
  patch?: (value: DocPatch, base: string) => SiteSaveResult;
  translate?: (value: string) => string;
} = {}) {
  const calls: string[] = [];
  const step = (stage: Stage) => {
    calls.push(stage);
    if (options.stage === stage) throw options.error;
  };
  const roomKey = "synthetic-private-room-key";
  const injected: Record<string, unknown> = {
    NextResponse, userMessage: userMessage, readJsonLimited, readJsonObjectLimited, jsonErrorStatus, JsonBodyTooLargeError, JsonContentTypeError,
    DocTooLargeError: DocTooLargeError, InvalidDocPatchError: InvalidDocPatchError, validateDocValue: validateDocValue, isDocPatch: isDocPatch,
    IMPORT_LIMITS, validateImportedDoc, extractAssetReferences,
    siteOwnsAssets: async () => true,
    DEFAULT_BRANCH, DEFAULT_PREVIEW_BRANCH, isSiteId, normalizeSiteInput,
    serverTr: async () => options.translate ?? ((value: string) => value),
    requireAuth: async () => { calls.push("auth"); return options.denied ?? null; }, requireSiteAccess: async () => null,
    dbConfigured: () => { calls.push("configured"); return options.configured ?? true; },
    dbUnavailable: async () => NextResponse.json({}, { status: 503 }),
    siteIdOf: async (value: unknown) => isSiteId(value) ? value
      : NextResponse.json({ error: "invalid site" }, { status: 400 }),
    getDb: async () => { step("database"); return { backend: "d1" }; },
    getSite: async (_db: unknown, id: string) => {
      step("site"); return options.siteExists === false ? null : { id };
    },
    readSiteDocument: async () => { step("read"); return options.read ? options.read() : snapshot; },
    saveSiteDocument: async (_db: unknown, _id: string, raw: string, base: string | null) => {
      step("save"); return options.save ? options.save(raw, base) : options.result ?? saved;
    },
    patchSiteDocumentWithTarget: async (_db: unknown, _id: string, value: DocPatch, base: string) => {
      step("save");
      return { result: options.patch ? await options.patch(value, base) : options.result ?? saved, roomKey };
    },
    sessionUser: async () => null,
    recordActivity: async () => { step("activity"); },
    notifyDocUpdated: () => { calls.push("notify"); },
    newSiteId: () => "new-site",
    insertSite: async () => { step("insert"); },
    deleteSite: async () => { calls.push("delete"); },
    eraseSiteDocument: async () => { calls.push("erase"); },
    cleanupAbandonedDocuments: async () => { calls.push("cleanup"); },
  };
  injected.saveSiteDocumentWithTarget = async (...args: unknown[]) => ({
    result: await (injected.saveSiteDocument as (...args: unknown[]) => unknown)(...args), roomKey,
  });
  const load = (code: string) => {
    const module = { exports: {} as Record<string, Handler> };
    new Function("require", "module", "exports", code)(
      () => new Proxy({}, { get: (_target, key) => typeof key === "string" ? injected[key] : undefined }),
      module, module.exports,
    );
    return module.exports;
  };
  return { ...load(docCode), POST: load(sitesCode).POST, calls };
}
function request(method: Method, body: unknown = method === "PUT" ? doc : patch, base = "1") {
  return new Request(`https://editor.example.test/api/doc?site=test-site&base=${base}`, {
    method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
}
function copyRequest(input: unknown = { name: "Copy", copyFrom: "test-site" }) {
  return new Request("https://editor.example.test/api/sites", {
    method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" },
  });
}
function captureErrors(t: TestContext) {
  const logger = t.mock.method(console, "error", () => {});
  return () => logger.mock.calls.map(call => call.arguments);
}
async function assertSanitized(response: Response, logs: () => unknown[][], copying = false) {
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: copying ? createMessage : saveMessage });
  assert.deepEqual(logs(), [[copying ? createLog : saveLog]]);
}
const errorCases: Array<[string, unknown]> = [
  ["credentials and nested error properties", Object.assign(new Error(
    "database failed: postgres://test-user:test-password@db.example.test/private test-token",
    { cause: { document: "synthetic private body", token: "nested-test-token" } },
  ), { body: "synthetic private body", code: "synthetic-secret-code" })],
  ["Japanese private text", new SyntaxError("Unexpected token: 非公開のテスト本文")],
  ["localized storage failure", new Error("保存済み編集データが破損しています")],
  ["string", "非公開のテスト本文 test-token"],
  ["object", { message: "synthetic private body", credential: "test-token" }],
  ["null", null],
];
for (const method of ["PUT", "PATCH"] as const) {
  for (const stage of ["database", "site", "save", "activity"] as const) {
    for (const [label, error] of errorCases) {
      test(`${method} ${stage} failure redacts ${label}`, async t => {
        const logs = captureErrors(t);
        const f = fixture({ stage, error });
        await assertSanitized(await f[method](request(method)), logs);
        assert.ok(!f.calls.includes("notify"));
      });
    }
  }
}
for (const stage of ["database", "site", "read", "insert", "save"] as const) {
  for (const [label, error] of errorCases) {
    test(`site copy ${stage} failure redacts ${label}`, async t => {
      const logs = captureErrors(t);
      const f = fixture({ stage, error });
      await assertSanitized(await f.POST(copyRequest()), logs, true);
      if (["database", "site", "read"].includes(stage)) assert.ok(!f.calls.includes("insert"));
      if (stage === "save") assert.deepEqual(f.calls.slice(-3), ["delete", "erase", "cleanup"]);
    });
  }
}

function database(t: TestContext) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const storage: DocumentSqlStorage = {
    sql: { exec(sql, ...args) {
      const stmt = sqlite.prepare(sql);
      if (stmt.columns().length) return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
      stmt.run(...args);
      return { toArray: () => [] };
    } },
    transactionSync(fn) {
      sqlite.exec("BEGIN");
      try { const result = fn(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const store = new StructuredDocumentStore(storage);
  store.replace(JSON.stringify(doc), null);
  return { sqlite, store };
}
for (const method of ["PUT", "PATCH"] as const) {
  for (const boundary of ["conflict", "daily backup", ...(method === "PATCH" ? ["patch parsing"] : [])]) {
    for (const field of ["props", "node"] as const) {
      test(`${method} redacts real SQLite ${field} JSON errors in ${boundary}`, async t => {
        const logs = captureErrors(t);
        const { sqlite, store } = database(t);
        const corrupt = "非公開のテスト本文";
        const node = Object.values(doc.nodes).find(value => value.text)!;
        assert.ok(node);
        if (field === "props") sqlite.prepare("UPDATE document_meta SET props=?").run(corrupt);
        else sqlite.prepare("UPDATE document_entries SET body=? WHERE bucket='nodes' AND entry_id=?").run(corrupt, node.id);
        if (boundary === "daily backup") sqlite.prepare("UPDATE document_meta SET saved_at=0").run();
        const base = boundary === "conflict" ? "2" : "1";
        const value: DocPatch = [{ path: ["nodes", node.id], value: node }];
        const operation = () => method === "PUT" ? store.replace(JSON.stringify(doc), base) : store.patch(value, base);
        assert.throws(operation, error => {
          assert.ok(error instanceof SyntaxError);
          assert.ok(error.message.includes(corrupt), "the real parser includes synthetic stored text");
          return true;
        });
        const f = fixture({ save: (raw, rev) => store.replace(raw, rev), patch: (ops, rev) => store.patch(ops, rev) });
        const before = sqlite.prepare("SELECT * FROM document_meta").all();
        await assertSanitized(await f[method](request(method, method === "PUT" ? doc : value, base)), logs);
        assert.deepEqual(sqlite.prepare("SELECT * FROM document_meta").all(), before);
        assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM document_backup_meta").get()?.n, 0);
        assert.ok(!f.calls.includes("activity"));
      });
    }
  }
}
for (const field of ["props", "node"] as const) {
  test(`copy redacts real SQLite ${field} JSON errors before creating a site`, async t => {
    const logs = captureErrors(t);
    const { sqlite, store } = database(t);
    const corrupt = "非公開のテスト本文";
    if (field === "props") sqlite.prepare("UPDATE document_meta SET props=?").run(corrupt);
    else sqlite.prepare("UPDATE document_entries SET body=? WHERE bucket='nodes'").run(corrupt);
    assert.throws(() => store.snapshot(), error => error instanceof SyntaxError && error.message.includes(corrupt));
    const f = fixture({ read: () => store.snapshot() });
    await assertSanitized(await f.POST(copyRequest()), logs, true);
    assert.deepEqual(f.calls, ["auth", "configured", "database", "site", "read"]);
  });
}

test("mutation failures still translate only the fixed public fallback", async t => {
  const logs = captureErrors(t);
  const translated = new Map([[saveMessage, "Could not save"], [createMessage, "Could not create"]]);
  const f = fixture({ stage: "database", error: new Error("非公開のテスト本文"), translate: value => translated.get(value) ?? value });
  for (const method of ["PUT", "PATCH"] as const) {
    assert.deepEqual(await (await f[method](request(method))).json(), { error: "Could not save" });
  }
  assert.deepEqual(await (await f.POST(copyRequest())).json(), { error: "Could not create" });
  assert.deepEqual(logs(), [[saveLog], [saveLog], [createLog]]);
});

test("safe document validation and capacity failures retain their status and public messages", async t => {
  const logs = captureErrors(t);
  for (const method of ["PUT", "PATCH"] as const) {
    for (const error of [new InvalidDocPatchError(), new Error("Invalid request"), new Error("JSONが壊れています")]) {
      const response = await fixture({ stage: "save", error })[method](request(method));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Invalid request" });
    }
    for (const error of [new DocTooLargeError(), new Error("SQLITE_TOOBIG synthetic-private-details"), new Error("編集データの1項目が大きすぎます")]) {
      const response = await fixture({ stage: "save", error })[method](request(method));
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { error: tooLarge });
    }
  }
  const capacity = await fixture({ stage: "save", error: new Error("SQLITE_TOOBIG test-token") }).POST(copyRequest());
  assert.equal(capacity.status, 413);
  assert.deepEqual(await capacity.json(), { error: tooLarge });
  const imported = { name: doc.siteName, importId: "0123456789", initialDoc: doc };
  const collision = await fixture({ siteExists: false, stage: "insert", error: new Error("UNIQUE constraint failed: sites.id") }).POST(copyRequest(imported));
  assert.equal(collision.status, 409);
  assert.deepEqual(await collision.json(), { error: "Could not create the site." });
  assert.deepEqual(logs(), []);
});

test("auth, missing storage, invalid input, and absent sites retain early returns", async t => {
  const logs = captureErrors(t);
  for (const method of ["PUT", "PATCH", "POST"] as const) {
    const req = () => method === "POST" ? copyRequest() : request(method);
    for (const status of [401, 403]) {
      const denied = NextResponse.json({ error: "denied" }, { status });
      const f = fixture({ denied, stage: "database", error: new Error("must not read") });
      assert.equal(await f[method](req()), denied);
      assert.deepEqual(f.calls, ["auth"]);
    }
    const unavailable = fixture({ configured: false });
    assert.equal((await unavailable[method](req())).status, 503);
    assert.deepEqual(unavailable.calls, ["auth", "configured"]);
    const invalid = fixture();
    assert.equal((await invalid[method](method === "POST" ? copyRequest({ name: "" }) : request(method, {}))).status, 400);
    assert.ok(!invalid.calls.includes("database"));
    const absent = fixture({ siteExists: false });
    assert.equal((await absent[method](req())).status, 404);
    assert.ok(!absent.calls.includes("save"));
    assert.ok(!absent.calls.includes("insert"));
  }
  for (const [name, value, status] of [
    ["Content-Type", "text/plain", 415],
    ["Content-Length", "invalid", 400],
    ["Content-Length", String(IMPORT_LIMITS.docBytes + 1025), 413],
  ] as const) {
    const create = fixture();
    const req = copyRequest();
    req.headers.set(name, value);
    assert.equal((await create.POST(req)).status, status);
    assert.deepEqual(create.calls, ["auth", "configured"]);
  }
  const badImport = fixture();
  const imported = await badImport.POST(copyRequest({ name: "Import", importId: "0123456789", initialDoc: {} }));
  assert.equal(imported.status, 400);
  assert.deepEqual(await imported.json(), { error: "Invalid page, element or asset data." });
  assert.ok(!badImport.calls.includes("database"));
  assert.deepEqual(logs(), []);
});

test("successful and conflicting document mutations still return the authorized document", async t => {
  const logs = captureErrors(t);
  for (const method of ["PUT", "PATCH"] as const) {
    const ok = fixture();
    const response = await ok[method](request(method));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, rev: "2", savedAt: 124 });
    assert.ok(ok.calls.includes("notify"));
    const conflict = fixture({ result: { kind: "conflict", current: snapshot } });
    const rejected = await conflict[method](request(method));
    assert.equal(rejected.status, 409);
    assert.equal(rejected.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await rejected.json(), { conflict: true, rev: "1", savedAt: 123, doc });
    assert.ok(!conflict.calls.includes("activity"));
    const missing = await fixture({ result: { kind: "missing" } })[method](request(method));
    assert.equal(missing.status, 404);
  }
  const copied = fixture();
  const response = await copied.POST(copyRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { site: { id: "new-site" } });
  assert.ok(copied.calls.includes("save"));
  assert.ok(!copied.calls.includes("delete"));
  const blank = fixture({ read: () => null });
  assert.equal((await blank.POST(copyRequest())).status, 200);
  assert.ok(!blank.calls.includes("save"));
  assert.deepEqual(logs(), []);
});
});

describe("document-schema", () => {
test("new sites start with only home and 404 without orphaned demo content", () => {
  const doc = createInitialDoc();
  assert.equal(doc.pageOrder.length, 2);
  const [homeId, notFoundId] = doc.pageOrder;
  assert.deepEqual(Object.keys(doc.pages), [homeId, notFoundId]);
  assert.equal(doc.pages[homeId].slug, "");
  assert.equal(doc.pages[notFoundId].slug, "404");
  assert.ok(doc.pages[homeId].children.length > 0);
  assert.ok(doc.pages[notFoundId].children.length > 0);
  assert.ok(Object.values(doc.nodes).some(node =>
    node.link?.kind === "page" && node.link.pageId === homeId
  ));

  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const childId of doc.nodes[id]?.children ?? []) visit(childId);
  };
  for (const pageId of doc.pageOrder) {
    for (const nodeId of doc.pages[pageId].children) visit(nodeId);
  }
  assert.deepEqual([...reachable].sort(), Object.keys(doc.nodes).sort());
  assert.equal(validSiteDoc(doc), true);
});

test("the persisted document requires its one canonical schema version", () => {
  const doc = createInitialDoc();
  assert.equal(doc.schemaVersion, 1);
  assert.equal(validSiteDoc(doc), true);
  const invalid: Record<string, unknown> = structuredClone(doc) as unknown as Record<string, unknown>;
  delete invalid.schemaVersion;
  assert.equal(validSiteDoc(invalid), false);
  invalid.schemaVersion = 2;
  assert.equal(validSiteDoc(invalid), false);
  assert.equal(isDocPatch([{ path: ["schemaVersion"], value: 2 }]), false);
});

test("malformed scripts cannot survive a round trip through document storage", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{ id: "s", trigger: "load",    steps: [{ id: "a", kind: "set-var", into: "value", value: "1" }] }];
  assert.equal(validSiteDoc(doc), true);
  (page.pageScripts[0].steps[0] as unknown as Record<string, unknown>).kind = "unknown";
  assert.equal(validSiteDoc(doc), false);
});

test("document IDs and SQL patch paths use the same unambiguous grammar", () => {
  assert.equal(docPatchSqlPath(["nodes", "node-a_b"]), '$."nodes"."node-a_b"');
  assert.equal(isDocPatch([{ path: ["nodes", "node-a_b"], value: {} }]), true);
  assert.equal(isDocPatch([{ path: ["nodes", "a.b"], value: {} }]), false);
  assert.throws(() => docPatchSqlPath(["nodes", "a.b"]));
});

test("runtime validation rejects malformed optional node, page, asset and site fields", () => {
  const fail = (mutate: (doc: Record<string, unknown>) => void) => {
    const doc = structuredClone(createInitialDoc()) as unknown as Record<string, unknown>;
    mutate(doc);
    assert.equal(validSiteDoc(doc), false);
  };
  const node = (doc: Record<string, unknown>) =>
    Object.values(doc.nodes as Record<string, Record<string, unknown>>)[0]!;
  const page = (doc: Record<string, unknown>) =>
    Object.values(doc.pages as Record<string, Record<string, unknown>>)[0]!;

  fail(doc => { node(doc).embed = { kind: "youtube", src: 42 }; });
  fail(doc => { node(doc).list = { from: "items", limit: "3" }; });
  fail(doc => { node(doc).field = { kind: "input", disabled: "false" }; });
  fail(doc => { node(doc).motions = [{ id: "m", trigger: "load", duration: "1", delay: 0, easing: "linear" }]; });
  fail(doc => { node(doc).htmlAttrs = { title: 123 }; });
  fail(doc => { node(doc).hiddenOn = ["sm", 123]; });
  fail(doc => { node(doc).link = { kind: "url", url: "/", newTab: "true" }; });
  fail(doc => { page(doc).rawHtml = 123; });
  fail(doc => { page(doc).noindex = "false"; });
  fail(doc => { doc.baseWidth = "1280"; });
  fail(doc => { doc.dataRevalidate = -1; });
  fail(doc => { doc.pwa = { enabled: true, display: "unrecognized" }; });
  fail(doc => { doc.customFonts = [{ family: "Example", weights: [400] }]; });
  fail(doc => { doc.adobeFonts = [{ family: "Example", kitId: "bad.js", loading: "dynamic" }]; });
  fail(doc => { doc.adobeFonts = [{ family: "Example", kitId: "abc1234", loading: "unexpected" }]; });
  fail(doc => { doc.adobeFonts = [{ family: "Example", kitId: "abc1234", loading: "css", extra: true }]; });
  fail(doc => { doc.adobeFonts = [
    { family: "One", kitId: "abc1234", loading: "css" },
    { family: "Two", kitId: "abc1234", loading: "dynamic" },
  ]; });
  fail(doc => { doc.assets = { a: { id: "a", name: "test.svg", width: "100", height: 100 } }; });
  fail(doc => { doc.assets = { a: { id: "a", name: "test.svg", width: 100 } }; });
  fail(doc => { doc.assets = { a: { id: "a", name: "test.svg", width: 100, height: 100, bytes: "10" } }; });
  fail(doc => {
    const n = Object.values(doc.nodes)[0] as Record<string, unknown>;
    n.scripts = [{ id: "s1", trigger: "click", steps: [{ id: "st1", kind: "dialog", mode: "unknown", message: "Hi" }] }];
  });
});

test("valid optional shapes survive the same runtime validators", () => {
  const doc = createInitialDoc();
  doc.baseWidth = 1280;
  doc.dataRevalidate = 0;
  doc.customFonts = [{ family: "Example", weights: ["400", "700"] }];
  doc.adobeFonts = [
    { family: "acumin-pro", kitId: "abc1234", loading: "css" },
    { family: "source-han-sans-japanese", kitId: "xyz5678", loading: "dynamic" },
  ];
  doc.pwa = { enabled: true, display: "standalone", icon: { url: "/icon.png" } };
  const node = Object.values(doc.nodes)[0]!;
  node.motions = [{ id: "fade", trigger: "load", duration: 0.5, delay: 0, easing: "linear" }];
  node.htmlAttrs = { title: "example" };
  node.list = { from: "items", limit: 10 };
  node.scripts = [{
    id: "s1",
    trigger: "click",
    steps: [
      { id: "d1", kind: "dialog", mode: "alert", message: "Saved" },
      { id: "d2", kind: "dialog", mode: "confirm", message: "Proceed?", into: "confirmed" },
      { id: "d3", kind: "dialog", mode: "prompt", message: "Name?", into: "userName", defaultValue: "Guest" },
    ],
  }];
  assert.equal(validSiteDoc(doc), true);
});

test("patches cannot add unknown root fields or modify schemaVersion", () => {
  assert.equal(isDocPatch([{ path: ["arbitrary"], value: true }]), false);
  assert.equal(isDocPatch([{ path: ["schemaVersion"], value: 1 }]), false);
  assert.equal(isDocPatch([{ path: ["siteName"], value: "Site" }]), true);
  assert.equal(isDocPatch([{ path: ["nodes", "node_1"], value: {} }]), true);
});
});

describe("document-security-fuzz", () => {
// ランダムなケースはすべて決定的で、再現のためのシードを報告する。
// このファイルは自己完結させる。ルートの npm test のコマンドが、tests/*.test.mts を拾う。
const SEED = 0x4a202611;
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}
function choose<T>(next: () => number, values: readonly T[]): T {
  return values[Math.floor(next() * values.length)];
}
const utf8 = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test("navigation URL guard and exported browser runtime agree on mutated inputs", () => {
  const browserGuard = runInNewContext(NAVIGATION_RUNTIME + "\nsafeNavigationUrl") as (url: string) => string;
  const attacks = [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>", "file:///etc/passwd",
    "//attacker.invalid/x", "/\\attacker.invalid/x",
    "https:\\attacker.invalid/x", "https://safe.invalid/\r\nalert(1)",
    "javas\ncript:alert(1)", "https://user:pass@host.invalid/x",
  ];
  for (const url of attacks.slice(0, 9)) {
    assert.equal(safeNavigationUrl(url), "#", "unexpectedly allowed: " + JSON.stringify(url));
  }
  const next = random(SEED);
  const prefixes = [
    "", "/", "./", "../", "#", "?", "https://example.invalid/", "http://example.invalid/",
    "mailto:", "tel:", "javascript:", "data:", "//", "\\", "https:\\",
  ];
  const tails = [
    "ok", "x?next=1", "a b", "\u2028", "%2F", "<script>", "\u0000", "\n",
    "\r", "\t", "\\", "#fragment", "?q=x", "\u007f", "https://other.invalid",
  ];
  for (let i = 0; i < 600; i++) {
    const url = choose(next, prefixes) + choose(next, tails) + (next() < 0.2 ? choose(next, tails) : "");
    assert.equal(browserGuard(url), safeNavigationUrl(url), "seed=" + SEED + " case=" + i + " input=" + JSON.stringify(url));
    const resource = safeResourceUrl(url);
    assert.equal(typeof resource, "string");
    if (safeNavigationUrl(url) === "#" && !/^(?:blob:|data:(?:image|video|audio)\/[\w.+-]+;base64,)/i.test(url.trim())) {
      assert.equal(resource, "#", "unsafe resource URL: " + JSON.stringify(url));
    }
  }
});

test("generated JS literals retain untrusted JSON without creating HTML script terminators", () => {
  const next = random(SEED ^ 0x202);
  const parts = [
    "</script>", "<script>", "<style>", "&", "\u2028", "\u2029", "'", '"',
    "\\", "${process.env.SECRET}", "<img src=x onerror=alert(1)>",
    "\u0000", "日本語", "\n", "🧪", "</ScRiPt>",
  ];
  for (let i = 0; i < 350; i++) {
    const value = Array.from({ length: 1 + Math.floor(next() * 8) }, () => choose(next, parts)).join("");
    const literal = codeLiteral({ value, items: [value, false, 0, null] });
    assert.doesNotMatch(literal, /<\/script/i, "seed=" + SEED + " case=" + i);
    assert.doesNotMatch(literal, /[\u2028\u2029]/, "nonportable source separator");
    assert.deepEqual(
      JSON.parse(JSON.stringify(runInNewContext("(" + literal + ")"))),
      { value, items: [value, false, 0, null] },
      "seed=" + SEED + " case=" + i,
    );
  }
});

test("import, patch, reload and concurrent non-conflicting merge preserve meaning", async () => {
  const next = random(SEED ^ 0x303);
  const original = JSON.parse(JSON.stringify(createInitialDoc())) as SiteDoc;
  const initial = (await parseSiteImport(utf8(original), "doc")).doc;
  for (let i = 0; i < 40; i++) {
    const base = structuredClone(initial);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.siteName = "Local " + i + choose(next, ["<&>", "日本語", "</script>", "\u0000", "Ω"]);
    remote.description = "Remote " + i + choose(next, ["<svg>", "newline\n", "quotes \"'", ""]);
    const patch = createDocPatch(base, local);
    assert.ok(patch && patch.length > 0 && isDocPatch(patch), "seed=" + SEED + " case=" + i);
    const applied = applyDocPatch(base, patch);
    assert.deepEqual(applied, local, "patch case=" + i);
    assert.notEqual(applied, base);
    assert.deepEqual(base, initial, "base mutated, case=" + i);
    assert.equal(applyDocPatchAtRevision(base, "old", "new", patch), null);
    const combined = mergeDocs(base, local, remote);
    assert.equal(combined.siteName, local.siteName, "local edit lost, case=" + i);
    assert.equal(combined.description, remote.description, "remote edit lost, case=" + i);
    const reloaded = (await parseSiteImport(utf8(combined), "doc")).doc;
    assert.deepEqual(reloaded, JSON.parse(JSON.stringify(combined)), "round-trip case=" + i);
    assert.doesNotThrow(() => validateImportedDoc(reloaded));
  }
});

test("mutated SiteDocs reject prototype keys, dangling pages and cyclic node references", async () => {
  const source = JSON.parse(JSON.stringify(createInitialDoc())) as SiteDoc;
  const page = source.pages[source.pageOrder[0]];
  const root = page.children[0];
  assert.ok(root, "fixture should contain a root node");
  const mutations: ((value: SiteDoc) => void)[] = [
    (value) => { value.pageOrder.push("unknown-page"); },
    (value) => { value.nodes[root].children.push(root); },
    (value) => { value.nodes[root].children.push("deleted-node"); },
    (value) => { value.nodes[root].children.push(root, root); },
    (value) => { Object.defineProperty(value, "__proto__", {
      value: { polluted: true }, enumerable: true, configurable: true,
    }); },
    (value) => { Object.defineProperty(value.assets, "constructor", {
      value: {}, enumerable: true, configurable: true,
    }); },
  ];
  for (let i = 0; i < mutations.length; i++) {
    const doc = structuredClone(source);
    mutations[i](doc);
    await assert.rejects(
      parseSiteImport(utf8(doc), "doc"),
      /(?:page|element|property|node|folder)/i,
      "seed=" + SEED + " mutation=" + i,
    );
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  }
});

test("script expression comparisons are symmetric and bounded for generated JSON values", () => {
  const next = random(SEED ^ 0x505);
  const primitives: unknown[] = [null, false, true, 0, 1, -1, 1.5, "", "0", "true", "false", "日本語"];
  const value = (depth: number): unknown => {
    if (!depth || next() < 0.7) return choose(next, primitives);
    if (next() < 0.5) return [value(depth - 1), value(depth - 1)];
    return { left: value(depth - 1), right: value(depth - 1) };
  };
  for (let i = 0; i < 500; i++) {
    const a = value(3), b = value(3);
    assert.equal(matchesValueCondition(a, "eq", b), matchesValueCondition(b, "eq", a),
      "seed=" + SEED + " case=" + i);
    assert.equal(withinScriptValueLimit(a), true, "generated value rejected, case=" + i);
    assert.equal(withinScriptValueLimit(b), true, "generated value rejected, case=" + i);
  }
  assert.equal(matchesValueCondition(Number.NaN, "gt", 1), false);
  assert.equal(matchesValueCondition(Number.POSITIVE_INFINITY, "lte", "Infinity"), false);
  const cyclic: { child?: unknown } = {};
  cyclic.child = cyclic;
  assert.equal(withinScriptValueLimit(cyclic), false);
  let oversized: unknown = "leaf";
  for (let i = 0; i < 70; i++) oversized = { next: oversized };
  assert.equal(withinScriptValueLimit(oversized), false);
});

test("variable writes cannot mutate inherited prototypes or their input", () => {
  const before = ({} as Record<string, unknown>).polluted;
  const next = random(SEED ^ 0x606);
  const names = [
    "state.value", "state.__proto__.polluted", "__proto__.polluted",
    "constructor.prototype.polluted", "array.0.value", "array.1.name", "state.a.b",
  ];
  for (let i = 0; i < 200; i++) {
    const vars: Record<string, unknown> = { state: { original: true }, array: [{ original: true }] };
    const snapshot = structuredClone(vars);
    const name = choose(next, names);
    const result = setVarPath(vars, name, i);
    assert.notEqual(result, undefined, "seed=" + SEED + " case=" + i);
    assert.deepEqual(snapshot, { state: { original: true }, array: [{ original: true }] });
    assert.equal(({} as Record<string, unknown>).polluted, before);
    assert.equal(Object.getPrototypeOf(vars), Object.prototype);
  }
});
});

describe("document-storage-parity", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function durableObjectFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const storage: DocumentSqlStorage = {
    sql: {
      exec(sql, ...args) {
        const statement = sqlite.prepare(sql);
        if (statement.columns().length) {
          return { toArray: () => statement.all(...args) as Record<string, unknown>[] };
        }
        statement.run(...args);
        return { toArray: () => [] };
      },
    },
    transactionSync(callback) {
      sqlite.exec("BEGIN");
      try {
        const result = callback();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { store: new StructuredDocumentStore(storage), sqlite };
}

test("SQLite and Durable Objects preserve identical revisions and documents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-storage-parity-"));
  const old = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  const { store, sqlite } = durableObjectFixture();
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "parity", {
      name: "Parity", repo: null, branch: "main", previewBranch: "preview",
      siteUrl: null, previewUrl: null,
    });
    const original = createInitialDoc();
    const body = JSON.stringify(original);
    assert.equal((await saveCurrentDoc(db, "parity", body, null)).kind, "saved");
    assert.equal(store.replace(body, null).kind, "saved");

    const changed = structuredClone(original);
    changed.siteName = "Renamed";
    const node = Object.values(changed.nodes).find(value => value.text)!;
    node.text!.content += " update";
    const patch = createDocPatch(original, changed)!;
    assert.ok(patch.length);
    assert.equal((await saveDocPatch(db, "parity", patch, "1")).kind, "saved");
    assert.equal(store.patch(patch, "1").kind, "saved");

    const local = await readCurrentDoc(db, "parity");
    const remote = store.snapshot();
    assert.equal(local?.rev, "2");
    assert.equal(remote?.rev, "2");
    assert.deepEqual(JSON.parse(local!.body), changed);
    assert.deepEqual(JSON.parse(remote!.body), changed);

    const staleNode = await saveDocPatch(db, "parity", patch, "1");
    const staleDO = store.patch(patch, "1");
    assert.equal(staleNode.kind, "conflict");
    assert.equal(staleDO.kind, "conflict");

    const invalid = [{ path: ["baseWidth"], value: "wide" }];
    await assert.rejects(saveDocPatch(db, "parity", invalid, "2"), /不正な/);
    assert.throws(() => store.patch(invalid, "2"), /不正な/);
    assert.equal((await readCurrentDoc(db, "parity"))?.rev, "2");
    assert.equal(store.meta()?.rev, "2");
  } finally {
    sqlite.close();
    if (old === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconnecting during a pending gesture preserves Undo/Redo through conflict retries on both backends", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-history-parity-"));
  const old = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  const { store, sqlite } = durableObjectFixture();
  const editor = () => useEditor.getState();
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "history", {
      name: "History", repo: null, branch: "main", previewBranch: "preview",
      siteUrl: null, previewUrl: null,
    });
    const original = createInitialDoc();
    original.components ??= {};
    original.nodes.deleted = { ...makeBox(), id: "deleted" };
    original.pages[original.pageOrder[0]].children.push("deleted");
    assert.equal((await saveCurrentDoc(db, "history", JSON.stringify(original), null)).kind, "saved");
    assert.equal(store.replace(JSON.stringify(original), null).kind, "saved");
    const persist = async (before: SiteDoc, after: SiteDoc, base: string) => {
      const patch = createDocPatch(before, after);
      assert.ok(patch?.length);
      const nodeResult = await saveDocPatch(db, "history", patch, base);
      const doResult = store.patch(patch, base);
      assert.equal(nodeResult.kind, "saved");
      assert.equal(doResult.kind, "saved");
      const rev = String(Number(base) + 1);
      if (nodeResult.kind === "saved" && doResult.kind === "saved") {
        assert.equal(nodeResult.rev, rev);
        assert.equal(doResult.rev, rev);
      }
      for (const snapshot of [await readCurrentDoc(db, "history"), store.snapshot()]) {
        assert.equal(snapshot?.rev, rev);
        assert.deepEqual(JSON.parse(snapshot!.body), after);
        assert.equal(JSON.parse(snapshot!.body).schemaVersion, 1);
      }
    };

    editor().endGesture();
    editor().replaceDoc(original);
    const finish = editor().beginGesture();
    const remote = structuredClone(original);
    remote.siteName = "Collaborator's site name";
    delete remote.nodes.deleted;
    remote.pages[remote.pageOrder[0]].children.pop();
    await persist(original, remote, "1");

    // 版 1 のままで接続し直したクライアントは、版 2 を受け取る。どちらの保存先でも、
    // その古い書き込みが中途半端に適用されることはない。
    const stale = createDocPatch(original, { ...original, siteName: "Stale write" })!;
    const conflicts = [await saveDocPatch(db, "history", stale, "1"), store.patch(stale, "1")];
    for (const conflict of conflicts) {
      assert.equal(conflict.kind, "conflict");
      if (conflict.kind === "conflict") {
        assert.equal(conflict.current.rev, "2");
        assert.deepEqual(JSON.parse(conflict.current.body), remote);
      }
    }
    assert.equal((await readCurrentDoc(db, "history"))?.rev, "2");
    assert.equal(store.meta()?.rev, "2");
    editor().applyRemoteDoc(JSON.parse(store.snapshot()!.body));
    const node = Object.values(remote.nodes).find(value => value.text)!;
    editor().updateNode(node.id, { name: "First gesture update" });
    editor().updateNode(node.id, { name: "Final gesture update" });
    finish();
    const changed = structuredClone(editor().doc);
    await persist(remote, changed, "2");
    editor().undo();
    assert.deepEqual(editor().doc, remote);
    await persist(changed, editor().doc, "3");
    editor().redo();
    assert.deepEqual(editor().doc, changed);
    await persist(remote, editor().doc, "4");
  } finally {
    editor().endGesture();
    sqlite.close();
    if (old === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveDocPatch rejects removing a page referenced by pageFolders.beforePageId without corrupting SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-folder-anchor-"));
  const old = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  const { store, sqlite } = durableObjectFixture();
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "anchor", { name: "Anchor", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    const doc = createInitialDoc();
    doc.pages.second = { id: "second", name: "Second", slug: "second", title: "Second", description: "", children: [] };
    doc.pageOrder.push("second");
    doc.pageFolders = [{ id: "folder_1", name: "Docs", beforePageId: "second" }];
    await saveCurrentDoc(db, "anchor", JSON.stringify(doc), null);
    store.replace(JSON.stringify(doc), null);

    const invalidPatch = [
      { path: ["pages", "second"], remove: true as const },
      { path: ["pageOrder"], value: [doc.pageOrder[0]!] },
    ];
    await assert.rejects(() => saveDocPatch(db, "anchor", invalidPatch, "1"));
    assert.throws(() => store.patch(invalidPatch, "1"));

    const saved = await readCurrentDoc(db, "anchor");
    assert.equal(saved?.rev, "1");
    assert.deepEqual(JSON.parse(saved!.body), doc);
  } finally {
    sqlite.close();
    if (old === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  }
});
});

describe("editor", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Test",
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["a", "b"] } },
    pageOrder: ["p"],
    nodes: Object.fromEntries(["a", "b"].map((id) => [id, { ...makeBox(), id }])),
    assets: {},
  };
}

test("concurrent additions to the same page both remain visible", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.nodes.l = { ...makeBox(), id: "l" };
  remote.nodes.r = { ...makeBox(), id: "r" };
  local.pages.p.children.splice(1, 0, "l");
  remote.pages.p.children.splice(1, 0, "r");
  const originals = structuredClone([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(new Set(merged.pages.p.children), new Set(["a", "b", "l", "r"]));
  assert.equal(merged.pages.p.children[0], "a");
  assert.equal(merged.pages.p.children.at(-1), "b");
  assert.deepEqual([base, local, remote], originals);
});

test("editing a container does not discard a remote child insertion", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.nodes.a.name = "Renamed";
  remote.nodes.r = { ...makeBox(), id: "r" };
  remote.nodes.a.children.push("r");
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.nodes.a.name, "Renamed");
  assert.deepEqual(merged.nodes.a.children, ["r"]);
});

test("conflicting moves give each node only one parent", () => {
  const base = fixture();
  base.nodes.c = { ...makeBox(), id: "c" };
  base.pages.p.children.push("c");
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.pages.p.children = ["a", "b"];
  remote.pages.p.children = ["a", "b"];
  local.nodes.a.children = ["c"];
  remote.nodes.b.children = ["c"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.a.children, ["c"]);
  assert.deepEqual(merged.nodes.b.children, []);
});

test("opposing concurrent moves cannot create a cycle", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.pages.p.children = ["b"];
  local.nodes.b.children = ["a"];
  remote.pages.p.children = ["a"];
  remote.nodes.a.children = ["b"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.pages.p.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["a"]);
  assert.deepEqual(merged.nodes.a.children, []);
});

test("remote deletion is preserved while an unrelated node is edited", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.nodes.b.name = "Changed";
  delete remote.nodes.a;
  remote.pages.p.children = ["b"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.pages.p.children, ["b"]);
  assert.equal(merged.nodes.b.name, "Changed");
});

test("undo exits a component that no longer exists and clears text ranges", () => {
  useEditor.getState().replaceDoc(fixture());
  useEditor.getState().createComponent("a");
  const id = Object.keys(useEditor.getState().doc.components!)[0];
  useEditor.getState().setEditingComponent(id);
  useEditor.getState().setTextSel({ nodeId: "a", start: 0, end: 1, text: "a" });
  useEditor.getState().undo();
  assert.equal(useEditor.getState().editingComponentId, null);
  assert.equal(useEditor.getState().textSel, null);
});

test("redo exits a component removed by the restored history", () => {
  useEditor.getState().replaceDoc(fixture());
  useEditor.getState().createComponent("a");
  const id = Object.keys(useEditor.getState().doc.components!)[0];
  useEditor.getState().deleteComponent(id);
  useEditor.getState().undo();
  useEditor.getState().setEditingComponent(id);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().editingComponentId, null);
});

test("blocked browser storage falls back without crashing", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { get localStorage() { throw new Error("Storage blocked"); } },
  });
  try {
    assert.equal(readLocalStorage("tsumu-panel-l-w"), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("merging an unchanged side preserves nested component structure and ordering", () => {
  const base = fixture();
  const remote = structuredClone(base);
  remote.pages.p.children = ["b"];
  remote.nodes.b.children = ["a"];
  remote.nodes.root = { ...makeBox(), id: "root", children: ["child"] };
  remote.nodes.child = { ...makeBox(), id: "child" };
  remote.components = { c: { id: "c", name: "Component", rootId: "root" } };
  assert.deepEqual(mergeDocs(base, base, remote), remote);
});

test("undo after receiving a remote insertion removes only the local insertion", () => {
  const base = fixture();
  useEditor.getState().replaceDoc(base);
  useEditor.getState().insertNodes([{ ...makeBox(), id: "local" }], "local", { kind: "page", id: "p" });
  const remote = structuredClone(base);
  remote.nodes.remote = { ...makeBox(), id: "remote" };
  remote.pages.p.children.push("remote");
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.pages.p.children, ["a", "b", "remote"]);
  assert.equal(useEditor.getState().doc.nodes.local, undefined);
  useEditor.getState().redo();
  assert.deepEqual(new Set(useEditor.getState().doc.pages.p.children), new Set(["a", "b", "local", "remote"]));
});

test("concurrent edits to different properties of the same element both remain", () => {
  const base = fixture();
  base.nodes.a.text = { content: "Hello", heading: 0 };
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.nodes.a.text!.content = "Hi";
  local.nodes.a.styles.base!.default!.color = "red";
  remote.nodes.a.styles.base!.default!.padding = "8px";
  remote.nodes.a.styles.sm = { default: { fontSize: "12px" } };
  remote.nodes.a.name = "Title";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.nodes.a.text?.content, "Hi");
  assert.equal(merged.nodes.a.name, "Title");
  assert.equal(merged.nodes.a.styles.base?.default?.color, "red");
  assert.equal(merged.nodes.a.styles.base?.default?.padding, "8px");
  assert.deepEqual(merged.nodes.a.styles.sm, { default: { fontSize: "12px" } });
  // 同じ項目を両方が変えたときは、保存しようとしている自分を優先する
  remote.nodes.a.styles.base!.default!.color = "blue";
  assert.equal(mergeDocs(base, local, remote).nodes.a.styles.base?.default?.color, "red");
  // 相手が消した項目は消える
  const r2 = structuredClone(base);
  delete r2.nodes.a.styles.base!.default!.gap;
  assert.equal(mergeDocs(base, local, r2).nodes.a.styles.base?.default?.gap, undefined);
});

test("deleting the remaining pages on both sides keeps the local page and its elements", () => {
  const base = fixture();
  base.pages.q = { id: "q", name: "About", slug: "about", title: "About", description: "", children: ["c"] };
  base.nodes.c = { ...makeBox(), id: "c", children: ["d"] };
  base.nodes.d = { ...makeBox(), id: "d" };
  base.pageOrder = ["p", "q"];
  // 自分は p を、相手は q を消した（どちらも1ページは残している）
  const local = structuredClone(base);
  delete local.pages.p;
  delete local.nodes.a;
  delete local.nodes.b;
  local.pageOrder = ["q"];
  local.nodes.d.name = "Edited";
  const remote = structuredClone(base);
  delete remote.pages.q;
  delete remote.nodes.c;
  delete remote.nodes.d;
  remote.pageOrder = ["p"];
  const originals = structuredClone([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.pageOrder, ["q"]);
  assert.equal(merged.pages.p, undefined);
  assert.deepEqual(merged.pages.q.children, ["c"]);
  assert.deepEqual(merged.nodes.c.children, ["d"]);
  assert.equal(merged.nodes.d.name, "Edited");
  assert.equal(merged.nodes.a, undefined);
  assert.deepEqual([base, local, remote], originals, "inputs are not modified");
});

test("site settings changed on both sides keep each side's fields", () => {
  const base = fixture();
  base.pwa = { enabled: true, name: "App" };
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.pwa!.themeColor = "#111111";
  remote.pwa!.shortName = "A";
  assert.deepEqual(mergeDocs(base, local, remote).pwa, { enabled: true, name: "App", themeColor: "#111111", shortName: "A" });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("editor storage keys use the tsumu-* namespace with zero legacy unprefixed keys", () => {
  const legacyKeys = ["panel-l-w", "panel-r-w", "panel-l-closed", "panel-r-closed", "recent-colors-v1"];
  for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
    if (file.endsWith("storage-keys.ts")) continue;
    const text = readFileSync(file, "utf8");
    for (const key of legacyKeys) {
      assert.equal(
        text.includes(`localStorage.getItem("${key}")`) ||
          text.includes(`localStorage.setItem("${key}"`) ||
          text.includes(`readLocalStorage("${key}")`) ||
          text.includes(`writeLocalStorage("${key}"`),
        false,
        `Unexpected unprefixed storage key "${key}" in ${file}`,
      );
    }
  }
});

test("heavy editor modules stay out of eager initial editor imports", async () => {
  for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /^\s*import\s+(?!type\b).*from\s+["'](?:\.\.?\/)*(?:lib\/)?zip["']/m,
      `Static runtime ZIP import found in ${file}`,
    );
  }
  for (const panel of ["components/PagePanel.tsx", "components/SettingsPanel.tsx"]) {
    const text = readFileSync(panel, "utf8");
    assert.doesNotMatch(text, /from\s+["']\.\/ScriptEditor["']/);
    assert.match(text, /from\s+["']\.\/ScriptSummary["']/);
  }
  assert.doesNotMatch(
    readFileSync("components/PagePanel.tsx", "utf8"),
    /^\s*import\s+(?!type\b).*from\s+["']\.\.\/lib\/html-(?:file-import|to-site)["']/m,
  );
  for (const file of ["components/RightPanel.tsx", "components/Canvas.tsx"]) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /^\s*import\s+(?!type\b).*from\s+["']\.\/Comments["']/m,
    );
  }
  assert.doesNotMatch(
    readFileSync("components/style-panel/FontPicker.tsx", "utf8"),
    /^\s*import\s+(?!type\b).*from\s+["']\.\.\/\.\.\/lib\/google-font-catalog["']/m,
  );

  const bundle = await esbuildBuild({
    entryPoints: ["components/Home.tsx", "components/Editor.tsx"],
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    write: false,
    outdir: "/tmp/tsumu-bundle-check",
    metafile: true,
    external: ["react", "react-dom", "react/*", "next/*", "next-auth/*", "lucide-react"],
  });
  const staticInputsFor = (entry: string): Set<string> => {
    const outputs = bundle.metafile.outputs;
    const entryOut = Object.entries(outputs).find(([, info]) => info.entryPoint === entry)?.[0];
    assert.ok(entryOut, `Missing output for ${entry}`);
    const seen = new Set<string>();
    const inputs = new Set<string>();
    const queue = [entryOut];
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current) || !outputs[current]) continue;
      seen.add(current);
      for (const inp of Object.keys(outputs[current].inputs)) inputs.add(inp);
      for (const imp of outputs[current].imports) {
        if (!imp.external && imp.kind !== "dynamic-import") queue.push(imp.path);
      }
    }
    return inputs;
  };

  const homeStatic = [...staticInputsFor("components/Home.tsx")];
  for (const forbidden of [
    "lib/db.ts",
    "lib/sites.ts",
    "lib/site-access.ts",
    "node_modules/parse5/",
    "node_modules/acorn/",
    "components/AllowedAccounts.tsx",
    "components/SiteMembers.tsx",
  ]) {
    assert.equal(
      homeStatic.some((p) => p.includes(forbidden)),
      false,
      `Home.tsx static bundle unexpectedly pulled in ${forbidden}`,
    );
  }

  const editorStatic = [...staticInputsFor("components/Editor.tsx")];
  for (const forbidden of [
    "lib/db.ts",
    "lib/sites.ts",
    "lib/site-access.ts",
    "node_modules/acorn/",
    "components/AiChat.tsx",
    "components/StaticPublishModal.tsx",
    "components/NetlifyPublishModal.tsx",
  ]) {
    assert.equal(
      editorStatic.some((p) => p.includes(forbidden)),
      false,
      `Editor.tsx static bundle unexpectedly pulled in ${forbidden}`,
    );
  }
});
});

describe("editor-fast-node-updates", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(size = 128): SiteDoc {
  const ids = Array.from({ length: size }, (_, i) => `node-${i}`);
  return {
    siteName: "Fast editor updates",
    pageOrder: ["p"],
    pages: {
      p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ids },
    },
    nodes: Object.fromEntries(ids.map((id) => [id, { ...makeBox(), id, name: id }])),
    assets: {},
  };
}

function open() {
  useEditor.getState().endGesture();
  useEditor.getState().replaceDoc(fixture());
}

test("editing one node retains unchanged document branches and undo snapshots", () => {
  open();
  const before = useEditor.getState().doc;
  useEditor.getState().updateNode("node-0", { name: "Updated" });
  const after = useEditor.getState().doc;

  assert.notStrictEqual(after, before);
  assert.notStrictEqual(after.nodes, before.nodes);
  assert.notStrictEqual(after.nodes["node-0"], before.nodes["node-0"]);
  assert.strictEqual(after.nodes["node-1"], before.nodes["node-1"]);
  assert.strictEqual(after.pages, before.pages);
  assert.strictEqual(after.assets, before.assets);
  assert.equal(before.nodes["node-0"].name, "node-0");
  assert.equal(after.nodes["node-0"].name, "Updated");

  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "node-0");
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "Updated");
});

test("no-op node changes retain the existing document and history", () => {
  open();
  const before = useEditor.getState().doc;
  const history = useEditor.getState().past;
  useEditor.getState().updateNode("node-0", { name: "node-0" });
  useEditor.getState().updateNode("missing", { name: "New" });
  assert.strictEqual(useEditor.getState().doc, before);
  assert.strictEqual(useEditor.getState().past, history);
});

test("multi-selection edits only clone changed nodes without mutating siblings", () => {
  open();
  useEditor.getState().selectMany(["node-0", "node-1"], "node-1");
  const before = useEditor.getState().doc;
  useEditor.getState().updateTargets("node-0", (node) => {
    node.name = `Renamed ${node.name}`;
  });
  const after = useEditor.getState().doc;
  assert.equal(after.nodes["node-0"].name, "Renamed node-0");
  assert.equal(after.nodes["node-1"].name, "Renamed node-1");
  assert.strictEqual(after.nodes["node-2"], before.nodes["node-2"]);
  assert.equal(before.nodes["node-0"].name, "node-0");
  assert.equal(before.nodes["node-1"].name, "node-1");
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "node-0");
  assert.equal(useEditor.getState().doc.nodes["node-1"].name, "node-1");
});

test("transient style edits preserve one gesture-level undo checkpoint", () => {
  open();
  useEditor.getState().select("node-0");
  const before = useEditor.getState().doc;
  const finish = useEditor.getState().beginGesture();
  useEditor.getState().setStyleProps("node-0", { color: "#ff0000" }, { transient: true });
  const middle = useEditor.getState().doc;
  useEditor.getState().setStyleProps("node-0", { color: "#00ff00" }, { transient: true });
  finish();
  const after = useEditor.getState().doc;

  assert.strictEqual(middle.nodes["node-2"], before.nodes["node-2"]);
  assert.strictEqual(after.nodes["node-2"], before.nodes["node-2"]);
  assert.equal(before.nodes["node-0"].styles.base?.default?.color, undefined);
  assert.equal(after.nodes["node-0"].styles.base?.default?.color, "#00ff00");
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].styles.base?.default?.color, undefined);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].styles.base?.default?.color, "#00ff00");
});

test("script edits preserve undo/redo and do not create history for an unchanged workspace", () => {
  open();
  const nodeIds = ["node-0", "node-1"];
  const before = useEditor.getState().doc;
  const views = [{
    id: "script", nodeId: "node-0", trigger: "click" as const,
    steps: [{ id: "step", kind: "wait" as const, seconds: 1 }],
  }];
  useEditor.getState().updatePageScripts("p", nodeIds, views);
  const first = useEditor.getState().doc;
  assert.notStrictEqual(first, before);
  assert.strictEqual(first.nodes["node-1"], before.nodes["node-1"]);
  assert.strictEqual(first.assets, before.assets);
  assert.strictEqual(first.pages, before.pages);
  const history = useEditor.getState().past;
  const unchanged = pageScriptsOf(first, nodeIds, "p");
  useEditor.getState().updatePageScripts("p", nodeIds, unchanged);
  assert.strictEqual(useEditor.getState().doc, first);
  assert.strictEqual(useEditor.getState().past, history);

  const updated = unchanged.map((s) => s.id === "script"
    ? { ...s, steps: [{ ...s.steps[0], seconds: 2 }] } : s);
  useEditor.getState().updatePageScripts("p", nodeIds, updated);
  assert.equal(useEditor.getState().doc.nodes["node-0"].scripts?.[0].steps[0].kind, "wait");
  useEditor.getState().undo();
  assert.equal((useEditor.getState().doc.nodes["node-0"].scripts?.[0].steps[0] as { seconds: number }).seconds, 1);
  useEditor.getState().undo();
  assert.strictEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].scripts?.[0].id, "script");
  useEditor.getState().redo();
  assert.equal((useEditor.getState().doc.nodes["node-0"].scripts?.[0].steps[0] as { seconds: number }).seconds, 2);
});

for (const mode of ["gesture", "checkpoint"] as const) {
  test(`${mode} document no-ops preserve references, redo and the pending checkpoint`, () => {
    open();
    useEditor.getState().updateNode("node-0", { name: "Redo me" });
    useEditor.getState().undo();
    const finish = mode === "gesture" ? useEditor.getState().beginGesture() : () => {};
    if (mode === "checkpoint") useEditor.getState().checkpoint();
    const before = useEditor.getState();
    let notifications = 0;
    const unsubscribe = useEditor.subscribe(() => { notifications++; });
    try {
      for (let i = 0; i < 100; i++) {
        useEditor.getState().updateDoc(d => { d.siteName = before.doc.siteName; },
          mode === "checkpoint" ? { history: false } : undefined);
      }
    } finally { unsubscribe(); }
    assert.equal(notifications, 0, "unchanged pointer events must not notify subscribers");
    assert.strictEqual(useEditor.getState(), before);

    for (const name of ["First", "Last"]) {
      useEditor.getState().updateDoc(d => { d.siteName = name; },
        mode === "checkpoint" ? { history: false } : undefined);
    }
    finish();
    const after = useEditor.getState().doc;
    assert.equal(useEditor.getState().past.length, 1);
    assert.equal(useEditor.getState().future.length, 0);
    useEditor.getState().undo();
    assert.strictEqual(useEditor.getState().doc, before.doc);
    useEditor.getState().redo();
    assert.strictEqual(useEditor.getState().doc, after);
  });
}

const edits = {
  node: () => useEditor.getState().updateNode("node-0", { name: "Changed" }),
  document: () => useEditor.getState().updateDoc(d => { d.siteName = "Changed"; }),
  scripts: () => useEditor.getState().updatePageScripts("p", ["node-0"], [{
    id: "script", nodeId: "node-0", trigger: "click",    steps: [{ id: "step", kind: "wait", seconds: 1 }],
  }]),
};

for (const [kind, edit] of Object.entries(edits)) {
  for (const gesture of [false, true]) {
    test(`${kind} edits publish document and history together${gesture ? " during a gesture" : ""}`, () => {
      open();
      useEditor.getState().updateNode("node-1", { name: "Redo me" });
      useEditor.getState().undo();
      const finish = gesture ? useEditor.getState().beginGesture() : () => {};
      const before = useEditor.getState();
      const observed: ReturnType<typeof useEditor.getState>[] = [];
      const unsubscribe = useEditor.subscribe(s => { observed.push(s); });
      try { edit(); } finally { unsubscribe(); }
      const after = useEditor.getState().doc;
      finish();
      assert.equal(observed.length, 1, "one edit must publish one complete state");
      assert.notStrictEqual(observed[0].doc, before.doc);
      assert.deepEqual(observed[0].past, [before.doc]);
      assert.deepEqual(observed[0].future, []);
      useEditor.getState().undo();
      assert.strictEqual(useEditor.getState().doc, before.doc);
      useEditor.getState().redo();
      assert.strictEqual(useEditor.getState().doc, after);
    });
  }

  test(`${kind} commits retain subscriber edits and their separate undo steps`, () => {
    open();
    const before = useEditor.getState().doc;
    let handled = false;
    let firstEdit: SiteDoc | undefined;
    const unsubscribe = useEditor.subscribe((s, previous) => {
      if (handled || s.past === previous.past) return;
      handled = true;
      firstEdit = s.doc;
      s.updateNode("node-1", { name: "Subscriber edit" });
    });
    try { edit(); } finally { unsubscribe(); }
    const after = useEditor.getState().doc;
    assert.equal(after.nodes["node-1"].name, "Subscriber edit");
    assert.notDeepEqual(firstEdit, before);
    assert.equal(useEditor.getState().past.length, 2);
    useEditor.getState().undo();
    assert.strictEqual(useEditor.getState().doc, firstEdit);
    useEditor.getState().undo();
    assert.strictEqual(useEditor.getState().doc, before);
    useEditor.getState().redo();
    assert.strictEqual(useEditor.getState().doc, firstEdit);
    useEditor.getState().redo();
    assert.strictEqual(useEditor.getState().doc, after);
  });
}

for (const action of ["restoreDoc", "resetDoc"] as const) {
  test(`${action} publishes its document, session and undo history together`, () => {
    open();
    const before = useEditor.getState();
    const observed: ReturnType<typeof useEditor.getState>[] = [];
    const unsubscribe = useEditor.subscribe(s => { observed.push(s); });
    try {
      if (action === "restoreDoc") {
        useEditor.getState().restoreDoc({ ...before.doc, siteName: "Restored" });
      } else {
        useEditor.getState().resetDoc();
      }
    } finally { unsubscribe(); }
    assert.equal(observed.length, 1);
    const after = observed[0];
    assert.notStrictEqual(after.doc, before.doc);
    assert.equal(after.documentSession, before.documentSession + 1);
    assert.equal(after.historyRevision, before.historyRevision + 1);
    assert.deepEqual(after.past, [before.doc]);
    assert.deepEqual(after.future, []);
    useEditor.getState().undo();
    assert.strictEqual(useEditor.getState().doc, before.doc);
    useEditor.getState().redo();
    assert.strictEqual(useEditor.getState().doc, after.doc);
  });
}
});

describe("editor-history-integrity", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const SEED = 0x4a202611;
function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}
function fixture(): SiteDoc {
  return {
    siteName: "Editor history fixture",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", name: "Home", slug: "", title: "Home",
        description: "", children: ["original"],
      },
    },
    nodes: {
      original: {
        ...makeBox(), id: "original", name: "Original",
        attrId: "original-element",
      },
    },
    assets: {},
  };
}
function assertTree(doc: SiteDoc, caseIndex: number): void {
  const page = doc.pages.home;
  assert.equal(validNodeForest(doc.pages, doc.nodes, doc.components), true,
    "invalid node forest: seed=" + SEED + " case=" + caseIndex);
  assert.equal(new Set(page.children).size, page.children.length,
    "duplicate child ID: seed=" + SEED + " case=" + caseIndex);
  const ids = Object.keys(doc.nodes);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of page.children) {
    assert.ok(Object.hasOwn(doc.nodes, id), "dangling child: " + id);
    assert.equal(doc.nodes[id].id, id);
  }
}

test("duplicated nodes keep unique IDs through undo, redo and deletion", () => {
  const next = random(SEED ^ 0x1717);
  const state = () => useEditor.getState();
  for (let caseIndex = 0; caseIndex < 32; caseIndex++) {
    state().replaceDoc(fixture());
    const original = structuredClone(state().doc);
    const steps = 1 + next() % 9;
    for (let step = 0; step < steps; step++) {
      const existing = state().doc.pages.home.children;
      const id = existing[next() % existing.length];
      const beforeCount = Object.keys(state().doc.nodes).length;
      state().duplicateNode(id);
      assert.equal(Object.keys(state().doc.nodes).length, beforeCount + 1,
        "duplicate did not add exactly one node: case=" + caseIndex + " step=" + step);
      assertTree(state().doc, caseIndex);
    }
    const duplicated = structuredClone(state().doc);
    for (let step = 0; step < steps; step++) {
      state().undo();
      assertTree(state().doc, caseIndex);
    }
    assert.deepEqual(state().doc, original, "undo lost the original: case=" + caseIndex);
    for (let step = 0; step < steps; step++) {
      state().redo();
      assertTree(state().doc, caseIndex);
    }
    assert.deepEqual(state().doc, duplicated, "redo lost a duplicate: case=" + caseIndex);

    const children = state().doc.pages.home.children;
    const removedId = children[1 + next() % (children.length - 1)];
    state().deleteNode(removedId);
    const afterDelete = structuredClone(state().doc);
    assert.equal(Object.hasOwn(afterDelete.nodes, removedId), false,
      "deleted node remained in map: case=" + caseIndex);
    assert.equal(afterDelete.pages.home.children.includes(removedId), false,
      "deleted node remained in page: case=" + caseIndex);
    assertTree(afterDelete, caseIndex);

    state().undo();
    assert.deepEqual(state().doc, duplicated, "undo did not restore removed node");
    state().redo();
    assert.deepEqual(state().doc, afterDelete, "redo resurrected removed node");
    assertTree(state().doc, caseIndex);
  }
});

test("duplicating a selection of pages commits one undoable change", () => {
  const state = useEditor.getState;
  const doc = fixture();
  doc.pages.about = { ...doc.pages.home, id: "about", slug: "about", name: "About", children: ["about-root"] };
  doc.pages.contact = { ...doc.pages.home, id: "contact", slug: "contact", name: "Contact", children: [] };
  doc.nodes.original.link = { kind: "page", pageId: "about" };
  doc.pages.about.pageScripts = [{ id: "load", trigger: "load", steps: [
    { id: "repeat", kind: "repeat", times: 1, then: [{ id: "back", kind: "open-page", pageId: "home" }] },
  ] }];
  doc.nodes["about-root"] = { ...makeBox(), id: "about-root", children: ["about-child"] };
  doc.nodes["about-child"] = { ...makeBox(), id: "about-child", scripts: [{ id: "navigation", trigger: "click", steps: [
    { id: "self", kind: "open-page", pageId: "about" }, { id: "external", kind: "open-page", pageId: "contact" },
  ] }] };
  doc.pageOrder.push("about", "contact");
  state().replaceDoc(doc);
  const notifications: SiteDoc[] = [];
  const stop = useEditor.subscribe((s, previous) => {
    if (s.doc !== previous.doc) notifications.push(s.doc);
  });
  try {
    state().duplicatePages(["about", "missing", "home", "about"]);
  } finally {
    stop();
  }
  const after = state().doc;
  const [home, homeCopy, about, aboutCopy] = after.pageOrder;
  assert.deepEqual(after.pageOrder.map(id => after.pages[id].slug), ["", "copy", "about", "about-copy", "contact"]);
  assert.equal(after.pages[home], doc.pages.home);
  assert.equal(after.pages[about], doc.pages.about);
  assert.notEqual(after.pages[homeCopy].children[0], "original");
  const root = after.pages[aboutCopy].children[0];
  assert.notEqual(root, "about-root");
  assert.notEqual(after.nodes[root].children[0], "about-child");
  assert.equal(after.nodes[after.pages[homeCopy].children[0]].link?.pageId, aboutCopy);
  assert.equal(after.nodes.original.link?.pageId, about);
  const loop = after.pages[aboutCopy].pageScripts![0].steps[0];
  assert.ok(loop.kind === "repeat" && loop.then[0].kind === "open-page");
  assert.equal(loop.then[0].pageId, homeCopy);
  const steps = after.nodes[after.nodes[root].children[0]].scripts![0].steps;
  assert.deepEqual(steps.map(step => step.kind === "open-page" && step.pageId), [aboutCopy, "contact"]);
  assert.equal(state().activePageId, aboutCopy);
  assert.deepEqual(notifications, [after]);
  assert.deepEqual(state().past, [doc]);
  state().undo();
  assert.equal(state().doc, doc);
  const undone = state();
  state().duplicatePages(["missing"]);
  assert.equal(state(), undone);
  state().redo();
  assert.equal(state().doc, after);
});
});

describe("editor-page-history", () => {
function fixture(href = "https://example.test/sites/site?other=keep#anchor") {
  const stack = [href];
  let cursor = 0;
  let urlReads = 0;
  let page = "first";
  let pages = ["first", "second", "third"];
  const listeners = new Set<() => void>();
  const setPage = (id: string) => {
    const prev = state();
    page = id;
    for (const fn of callbacks) fn(state(), prev);
  };
  const state = () => ({
    activePageId: page,
    doc: { pages: Object.fromEntries(pages.map(id => [id, {}])), pageOrder: pages },
    setActivePage: setPage,
  });
  const callbacks = new Set<(current: ReturnType<typeof state>, previous: ReturnType<typeof state>) => void>();
  const location = {
    get href() { urlReads++; return stack[cursor]; },
    get pathname() { return new URL(stack[cursor]).pathname; },
  };
  const browser = {
    location,
    history: {
      state: { __NA: true },
      pushState(_data: unknown, _unused: string, url: string | URL | null) {
        stack.splice(cursor + 1);
        stack.push(new URL(String(url), location.href).href);
        cursor++;
      },
      replaceState(_data: unknown, _unused: string, url: string | URL | null) {
        stack[cursor] = new URL(String(url), location.href).href;
      },
    },
    addEventListener(_event: string, fn: () => void) { listeners.add(fn); },
    removeEventListener(_event: string, fn: () => void) { listeners.delete(fn); },
  };
  const store = {
    getState: state,
    subscribe(fn: (current: ReturnType<typeof state>, previous: ReturnType<typeof state>) => void) {
      callbacks.add(fn);
      return () => { callbacks.delete(fn); };
    },
  };
  const back = () => { cursor--; for (const listener of listeners) listener(); };
  const forward = () => { cursor++; for (const listener of listeners) listener(); };
  return {
    browser, store, setPage, back, forward, get page() { return page; },
    get url() { return new URL(location.href); },
    get historyLength() { return stack.length; },
    get urlReads() { return urlReads; },
    deletePage(id: string) {
      const prev = state();
      pages = pages.filter(value => value !== id);
      for (const fn of callbacks) fn(state(), prev);
      if (page === id) setPage(pages[0]);
    },
  };
}

test("page changes preserve unrelated query parameters and create browser history", () => {
  const f = fixture();
  const dispose = connectEditorPageHistory(f.store, f.browser as unknown as Window);
  assert.equal(f.url.searchParams.get("page"), "first");
  assert.equal(f.historyLength, 1);
  f.setPage("second");
  f.setPage("third");
  assert.equal(f.url.searchParams.get("page"), "third");
  assert.equal(f.url.searchParams.get("other"), "keep");
  assert.equal(f.url.hash, "#anchor");
  assert.equal(f.historyLength, 3);
  f.back();
  assert.equal(f.page, "second");
  assert.equal(f.historyLength, 3);
  f.back();
  assert.equal(f.page, "first");
  f.forward();
  assert.equal(f.page, "second");
  const reads = f.urlReads;
  f.setPage("second");
  assert.equal(f.historyLength, 3);
  assert.equal(f.urlReads, reads);
  dispose();
  f.setPage("third");
  assert.equal(f.url.searchParams.get("page"), "second");
});

test("direct page links override locally remembered page without pushing history", () => {
  const f = fixture("https://example.test/sites/site?other=keep&page=third");
  const dispose = connectEditorPageHistory(f.store, f.browser as unknown as Window);
  assert.equal(f.page, "third");
  assert.equal(f.historyLength, 1);
  dispose();
});

test("invalid page links fall back to the current page and are replaced", () => {
  const f = fixture("https://example.test/sites/site?page=deleted&other=keep");
  const dispose = connectEditorPageHistory(f.store, f.browser as unknown as Window);
  assert.equal(f.page, "first");
  assert.equal(f.url.searchParams.get("page"), "first");
  f.setPage("second");
  f.deletePage("second");
  assert.equal(f.page, "first");
  assert.equal(f.url.searchParams.get("page"), "first");
  // Returning to a historical link for a deleted page does not select an invalid page.
  f.back();
  assert.equal(f.page, "first");
  assert.equal(f.url.searchParams.get("page"), "first");
  dispose();
});

test("history is not installed for unrelated routes", () => {
  const f = fixture("https://example.test/");
  const dispose = connectEditorPageHistory(f.store, f.browser as unknown as Window);
  f.setPage("second");
  assert.equal(f.historyLength, 1);
  assert.equal(f.url.searchParams.has("page"), false);
  dispose();
});
});

describe("editor-tree-depth", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
function fixture(depth: number): SiteDoc {
  const nodes: SiteDoc["nodes"] = { host: { ...makeBox(), id: "host" } };
  for (let i = 1; i <= depth; i++) nodes[`n${i}`] = {
    ...makeBox(), id: `n${i}`, children: i < depth ? [`n${i + 1}`] : [],
  };
  return {
    schemaVersion: 1, siteName: "Depth", assets: {}, nodes, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Page", slug: "", title: "", description: "", children: ["host", "n1"] } },
  };
}
const snapshot = () => structuredClone({
  doc: state().doc, past: state().past, future: state().future,
  selection: state().selection, selectedIds: state().selectedIds,
  editingText: state().editingText, textSel: state().textSel,
});
const cases: { name: string; setup?: (doc: SiteDoc, depth: number) => void; select?: (depth: number) => string; run: (depth: number) => unknown }[] = [
  { name: "moving", run: () => state().moveNode("n1", { kind: "node", id: "host" }, 0) },
  { name: "inserting", run: depth => {
    const node = { ...makeBox(), id: "extra" };
    state().insertNodes([node], node.id, { kind: "node", id: `n${depth}` });
  } },
  { name: "inserting a component instance", setup: doc => {
    doc.nodes.master = { ...makeBox(), id: "master" };
    doc.components = { c: { id: "c", name: "Component", rootId: "master" } };
  }, select: depth => `n${depth}`, run: () => state().insertInstance("c") },
  { name: "wrapping in a list", run: () => state().createList("n1") },
  { name: "detaching a component", setup: doc => {
    doc.pages.p.children = ["host"];
    doc.nodes.host.children = ["instance"];
    doc.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "c" };
    doc.components = { c: { id: "c", name: "Component", rootId: "n1" } };
  }, run: () => state().detachInstance("instance") },
  { name: "splitting text", setup: (doc, depth) => {
    doc.nodes[`n${depth}`] = { ...makeText("abc"), id: `n${depth}` };
  }, run: depth => state().splitTextSpan(`n${depth}`, 1, 2, "b", { color: "red" }) },
];

for (const action of cases) for (const allowed of [false, true]) {
  test(`${action.name}: ${allowed ? "permits exactly" : "rejects exceeding"} MAX_NODE_DEPTH without losing history`, () => {
    const depth = MAX_NODE_DEPTH - (allowed ? 1 : 0);
    const doc = fixture(depth);
    action.setup?.(doc, depth);
    assert.equal(validateDocValue(doc), null);
    state().endGesture();
    state().replaceDoc(doc);
    state().setActivePage("p");
    state().select("host");
    state().updateNode("host", { name: "Temporary" });
    state().undo();
    if (action.select) state().select(action.select(depth));
    const before = snapshot();
    action.run(depth);
    if (!allowed) {
      assert.deepEqual(snapshot(), before, "rejected operations cannot change doc, undo/redo, or selection");
    } else {
      assert.notDeepEqual(state().doc, before.doc);
      assert.equal(validateDocValue(state().doc), null);
      const after = structuredClone(state().doc);
      state().undo();
      assert.deepEqual(state().doc, before.doc);
      state().redo();
      assert.deepEqual(state().doc, after);
    }
  });
}

test("subtree height handles multiple roots, detached trees, missing children and cycles iteratively", () => {
  assert.equal(maxSubtreeDepth({}, []), 0);
  const nodes = { a: { children: ["b"] }, b: { children: ["c"] }, c: { children: [] }, d: { children: [] } };
  assert.equal(maxSubtreeDepth(nodes, ["d", "a"]), 3);
  assert.equal(maxSubtreeDepth(nodes, ["b"]), 2);
  assert.equal(maxSubtreeDepth(nodes, ["missing"]), Infinity);
  assert.equal(maxSubtreeDepth({ a: { children: ["missing"] } }, ["a"]), Infinity);
  assert.equal(maxSubtreeDepth({ a: { children: ["b"] }, b: { children: ["a"] } }, ["a"]), Infinity);
  assert.equal(maxSubtreeDepth(fixture(1000).nodes, ["n1"]), 1000);
});
});

describe("features", () => {
test("transform keeps unknown functions and round-trips its parts", () => {
  const t = parseTransform("translateY(-4px) rotate(0.5turn) scale(1.1, 0.9) skewX(10deg) perspective(400px)");
  assert.equal(t.x, "0px");
  assert.equal(t.y, "-4px");
  assert.equal(t.rotate, 180);
  assert.equal(t.scaleX, 1.1);
  assert.equal(t.scaleY, 0.9);
  assert.equal(t.skewX, 10);
  assert.equal(t.rest, "perspective(400px)");
  const again = parseTransform(serializeTransform({ ...t, rotate: 0 })!);
  assert.equal(again.rotate, 0);
  assert.equal(again.y, "-4px");
  assert.equal(again.rest, "perspective(400px)");
  assert.equal(serializeTransform(parseTransform("none")), null);
  assert.equal(serializeTransform({ ...parseTransform(""), x: "-50%" }), "translate(-50%, 0px)");
});

test("pseudo-element style props are split out of the map", () => {
  const map: Record<string, string> = { color: "red", placeholderColor: "#999", fileButtonBackground: "#000" };
  const parts = extractPartStyles(map);
  assert.deepEqual(map, { color: "red" });
  assert.equal(parts.length, 2);
  assert.match(parts[0].selector(".a"), /::placeholder/);
  assert.equal(parts[0].map.color, "#999");
  assert.match(parts[1].selector(".a"), /::file-selector-button/);
  assert.equal(parts[1].map.backgroundColor, "#000");
});

test("JSON body variables are escaped inside strings and raw outside", () => {
  const out = interpolateJson('{"q": "{q}", "n": {n}, "list": {arr}, "none": {x}}', { q: 'a "b"', n: 3, arr: [1, "2"] });
  assert.deepEqual(JSON.parse(out), { q: 'a "b"', n: 3, list: [1, "2"], none: null });
  assert.equal(bodyJsonError('{"a": {n}}'), false);
  assert.equal(bodyJsonError('{"a": '), true);
});

test("JSON body escaped braces remain valid with JSON-encoded backslashes", () => {
  const template = String.raw`{"one":"\{name}","encoded":"\\{name}","double":"\\\\{name}","ordinary":"{name}"}`;
  const vars = { name: "Ada" };
  const body = interpolateJson(template, vars);
  assert.deepEqual(JSON.parse(body), {
    one: "{name}",
    encoded: "{name}",
    double: "\\{name}",
    ordinary: "Ada",
  });
  assert.equal(bodyJsonError(template), false);
  const request = fetchRequestOf({ method: "POST", body: template }, vars);
  assert.deepEqual(JSON.parse(request?.body ?? ""), JSON.parse(body));
});

test("fetch request options add a JSON content type only when sending a body", () => {
  assert.equal(fetchRequestOf({}, {}), undefined);
  const r = fetchRequestOf(
    { method: "POST", headers: [{ name: "X-Key", value: "{k}" }], body: '{"q": "{q}"}' },
    { k: "secret", q: "hi" }
  );
  assert.deepEqual(r, {
    method: "POST",
    headers: { "X-Key": "secret", "Content-Type": "application/json" },
    body: '{"q": "hi"}',
  });
  // GET では本文を送らない
  assert.equal(fetchRequestOf({ method: "GET", body: "{}" }, {}), undefined);
});

test("field initial values follow the published browser values", () => {
  assert.equal(fieldInitialValue({ kind: "checkbox", checked: true }), "true");
  assert.equal(fieldInitialValue({ kind: "checkbox" }), "false");
  assert.equal(fieldInitialValue({ kind: "select", options: ["A", "B"].map((value) => ({label:value,value})) }), "A");
  assert.equal(fieldInitialValue({ kind: "input", defaultValue: "Hi {name}" }, { name: "Ann" }), "Hi Ann");
  const defaultRadio = makeField("radio");
  assert.equal(defaultRadio.field?.group, "radio");
  assert.equal(defaultRadio.attrId, "radio-1");
  // ラジオボタンのグループ名が空でも、ID 属性を代わりに使わない
  const ungroupedRadio: DocNode = { ...makeBox(), id: "ur", type: "field", attrId: "radio-1", field: { kind: "radio", label: "S", checked: true } };
  assert.equal(fieldVarName(ungroupedRadio), "");
  assert.deepEqual(fieldDefaults([ungroupedRadio]), {});
  // グループ名を付けたラジオボタン: {グループ名} は選んだ値、{ID} はそのボタンを選んでいるか
  const item = (id: string, label: string, checked?: boolean): DocNode => ({ ...makeBox(), id, type: "field", attrId: id, field: { kind: "radio", label, group: "size", checked, disabled: id === "s" } });
  const group = [item("s", "S"), item("m", "M", true), item("l", "L")];
  const values = fieldDefaults(group);
  assert.deepEqual(values, { size: "M" });
  assert.equal(fieldStateValues(group, values).m, "true");
  assert.equal(fieldStateValues(group, values).s, "false");
  assert.equal(fieldStateValues(group, values)["s.disabled"], "true");
  assert.equal(fieldStateValues(group, values)["size.index"], "2");
  assert.deepEqual(fieldValuePatch(group, "s", "true", values), { size: "S" });
  assert.deepEqual(fieldValuePatch(group, "m", "false", values), { size: "" });
  const box: DocNode = { ...makeBox(), id: "a", type: "field", attrId: "agree", field: { kind: "checkbox" } };
  assert.deepEqual(fieldValuePatch([box], "agree", "on", {}), { agree: "true" });
});

function docWith(nodes: DocNode[], pageScripts?: SiteDoc["pages"][string]["pageScripts"]): SiteDoc {
  return {
    siteName: "T",
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: nodes.map((n) => n.id), pageScripts } },
    pageOrder: ["p"],
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    assets: {},
  };
}

test("variables made inside an if block are suggested in text", () => {
  const box: DocNode = {
    ...makeBox(),
    id: "cb",
    type: "field",
    attrId: "agree",
    field: { kind: "checkbox", label: "OK" },
    scripts: [
      {
        id: "s",
        trigger: "change",
        steps: [
          {
            id: "if",
            kind: "if",
            cond: { subject: "value", target: "@self", op: "eq", value: "on" },
            then: [{ id: "sv", kind: "set-var", value: "hoge", into: "hensuu" }],
          },
        ],
      },
    ],
  };
  const text: DocNode = { ...makeBox(), id: "t", text: { content: "", heading: 0 } };
  assert.ok(varNamesAt(docWith([box, text]), "p", "t").includes("hensuu"));
});

test("publish checks validate targets in every AND/OR if clause", () => {
  const button: DocNode = {
    ...makeBox(), id: "trigger", attrId: "trigger",
    scripts: [{
      id: "on-click", trigger: "click", steps: [{
        id: "if-joined", kind: "if",
        cond: { subject: "var", target: "", left: "{flag}", op: "eq", value: "ready" },
        conditions: [
          { subject: "visible", target: "missing-target", and: true },
          { subject: "value", target: "trigger", op: "eq", value: "yes", and: false },
        ],
        then: [{ id: "yes", kind: "set-var", into: "result", value: "yes" }],
      }],
    }],
  };
  const issues = runChecks(docWith([button])).filter((issue) => issue.help === "act-script");
  assert.ok(issues.some((issue) => issue.message.includes("missing-target")),
    "missing targets in additional clauses must be detected");
  assert.ok(!issues.some((issue) => issue.message.includes('「trigger」がこのページに見つかりません')),
    "existing targets must not be reported as missing");
});

test("published fields interpolate variables and keep a live template for field values", () => {
  const name: DocNode = { ...makeBox(), id: "n", type: "field", attrId: "name", field: { kind: "input", placeholder: "Your name" } };
  const hello: DocNode = { ...makeBox(), id: "h", type: "field", attrId: "greet", field: { kind: "input", defaultValue: "Hi {name}", min: "1", required: true } };
  const sel: DocNode = { ...makeBox(), id: "s", type: "field", attrId: "plan", field: { kind: "select", defaultValue: "{name}", options: ["{name}", "Guest"].map((value) => ({label:value,value})) } };
  const cb: DocNode = { ...makeBox(), id: "c", type: "field", attrId: "ok", field: { kind: "checkbox", label: "For {name}" } };
  const doc = docWith([name, hello, sel, cb]);
  assert.equal(usesLiveFields(doc), true);
  const { files } = generateProject(doc);
  const page = Object.entries(files).find(([p]) => p.endsWith("page.tsx"))![1];
  assert.match(page, /defaultValue=\{interpolate\("Hi \{name\}", vars\)\}/);
  assert.match(page, /data-live-value=/);
  assert.match(page, /<option[^>]* data-live=/);
  assert.match(page, /<span data-live=[^>]*>\{interpolate\("For \{name\}", vars\)\}<\/span>/);
  assert.match(page, / required/);
  // 文字の入力欄には min を付けない
  assert.doesNotMatch(page, /min=/);
  assert.ok(files["public/scripts.js"], "the runtime is published so the text follows the field");
});

test("comments: only the author can edit or delete, and resolving records who", () => {
  const ann = { email: "ann@example.com", name: "Ann", image: null };
  const bob = { email: "bob@example.com", name: "Bob", image: null };
  const create = parseCommentAction({ action: "create", id: "t1", pageId: "p", nodeId: "n1", x: 0.5, y: 2, bp: "base", body: " hi " });
  assert.ok(create && create.action === "create" && create.y === 1 && create.body === "hi");
  let threads: CommentThread[] = applyCommentAction([], create!, ann, 1);
  threads = applyCommentAction(threads, { action: "reply", threadId: "t1", id: "m2", body: "yo" }, bob, 2);
  assert.equal(threads[0].messages.length, 2);
  // Bob は、Ann のコメントを消せない
  assert.equal(applyCommentAction(threads, { action: "delete-thread", threadId: "t1" }, bob)[0]?.id, "t1");
  assert.equal(applyCommentAction(threads, { action: "edit", messageId: "t1-0", body: "x" }, bob)[0].messages[0].body, "hi");
  threads = applyCommentAction(threads, { action: "resolve", threadId: "t1", resolved: true }, bob, 3);
  assert.equal(threads[0].resolvedBy?.email, "bob@example.com");
  assert.equal(applyCommentAction(threads, { action: "delete-thread", threadId: "t1" }, ann).length, 0);
  assert.equal(parseCommentAction({ action: "create", id: "bad id!", pageId: "p", nodeId: null, x: 0, y: 0, body: "a" }), null);
});

test("cloned ID suffixes fill gaps and reserve radio group names", () => {
  const doc = docWith(["card", "card-2", "card-4"].map((attrId) => ({ ...makeBox(), id: attrId, attrId })));
  doc.nodes.radio = { ...makeField("radio"), id: "radio", field: { kind: "radio", group: "card-5" } };
  doc.pages.p.children.push("radio");
  const clones = ["card", "card-2", "card-4", "card-9", "menu-9"].map((attrId) => ({
    ...makeBox(), id: attrId, attrId,
  }));
  clones.push({ ...makeField("radio"), id: "copy-radio", field: { kind: "radio", group: "card-6" } });
  refreshClonedIds(doc, "p", clones);
  assert.deepEqual(clones.slice(0, 5).map((node) => node.attrId), ["card-3", "card-7", "card-8", "card-9", "menu-9"]);
  const nextCopy = [{ ...makeBox(), id: "next", attrId: "card-2" }];
  refreshClonedIds(doc, "p", nextCopy);
  assert.equal(nextCopy[0].attrId, "card-3");
});

test("buttons, switches and radio groups are exported as working HTML", () => {
  const btn: DocNode = { ...makeBox(), id: "b", semantic: "button", text: { content: "Go", heading: 0 } };
  const form: DocNode = { ...makeBox(), id: "f", semantic: "form", children: ["b"] };
  const outside: DocNode = { ...makeBox(), id: "b2", semantic: "button", text: { content: "Menu", heading: 0 } };
  const sw = makeSwitch();
  const r1: DocNode = { ...makeBox(), id: "r1", type: "field", attrId: "small", field: { kind: "radio", label: "S", group: "size", disabled: true } };
  const doc = docWith([form, outside, sw.root, r1]);
  for (const n of sw.nodes) doc.nodes[n.id] = n;
  doc.nodes.b = btn;
  const { files } = generateProject(doc);
  const page = Object.entries(files).find(([p]) => p.endsWith("page.tsx"))![1];
  // フォームの中のボタンは送信のボタン、外は普通のボタン
  assert.match(page, /<button[^>]*type="submit"/);
  assert.match(page, /<button[^>]*type="button"/);
  // スイッチは、非表示のチェックボックスと、オン・オフのボックスと、スクリプトで構成される
  assert.match(page, /id="toggle"[^>]*>[\s\S]*?<input type="checkbox" name="toggle" value="true"/);
  assert.match(page, /id="switch-off"/);
  assert.match(page, /id="switch-on"[^>]*data-toggle-show="flex"/);
  assert.match(page, /data-scripts=/);
  assert.match(page, /type="radio" name="size" value="S"[^/]* disabled/);
  // 2つ目のスイッチを追加したときは、チェックボックスとオン・オフの ID、スクリプトの参照が、まとめて付け替わる
  const sw2 = makeSwitch();
  refreshClonedIds(doc, "p", sw2.nodes);
  assert.ok(sw2.nodes.some((n) => n.attrId === "toggle-2"));
  assert.ok(sw2.nodes.some((n) => n.attrId === "switch-off-2"));
  assert.ok(sw2.nodes.some((n) => n.attrId === "switch-on-2"));
  assert.match(JSON.stringify(sw2.root.scripts), /toggle-2/);
  assert.match(JSON.stringify(sw2.root.scripts), /switch-off-2/);
  assert.match(JSON.stringify(sw2.root.scripts), /switch-on-2/);
  // SearchForm は data-* 属性を受け取れ、クエリが無いときは defaultChecked を保つ
  const searchForm = files["components/SearchForm.tsx"];
  assert.match(searchForm, /ComponentPropsWithoutRef<"form">/);
  assert.match(searchForm, /input\.defaultChecked/);
});

test("pageReadsQuery detects POST body variables and preserves explicit list transforms", () => {
  const itemText: DocNode = { ...makeBox(), id: "it", text: { content: "{badge}", heading: 0 } };
  const list: DocNode = { ...makeBox(), id: "l", type: "list", list: { from: "items" }, children: ["it"] };
  const isrDoc = docWith([list], [
    {
      id: "ps",
      trigger: "load",
      steps: [
        { id: "f1", kind: "fetch", url: "https://api.example.com/items", as: "items", preview: { sample: [{ id: 1 }] } },
        { id: "af", kind: "transform", source: "items", into: "count", transform: { kind: "length" } },
      ],
    },
  ]);
  isrDoc.nodes.it = itemText;
  const isrPage = generateProject(isrDoc).files["app/page.tsx"];
  assert.match(isrPage, /__evalValueRecipe/);

  const postDoc = docWith([ { ...makeBox(), id: "t", text: { content: "{res.ok}", heading: 0 } } ], [
    {
      id: "ps2",
      trigger: "load",
      steps: [
        { id: "f2", kind: "fetch", url: "https://api.example.com/search", method: "POST", body: '{"q": "{q}"}', as: "res" },
      ],
    },
  ]);
  const postPage = generateProject(postDoc).files["app/page.tsx"];
  assert.match(postPage, /export const dynamic = "force-dynamic";/);
  assert.match(postPage, /await searchParams/);
});

test("slug page generateMetadata preserves description, noindex and openGraph", () => {
  const h1: DocNode = { ...makeBox(), id: "h", text: { content: "{post.title}", heading: 1 } };
  const doc: SiteDoc = {
    siteName: "Blog",
    pages: {
      p: {
        id: "p",
        name: "Post",
        slug: "posts/[slug]",
        title: "Fallback",
        description: "Article page",
        noindex: true,
        ogImage: { kind: "url", url: "https://example.com/og.png" },
        children: ["h"],
        pageScripts: [
          {
            id: "s",
            trigger: "load",
            steps: [
              { id: "f", kind: "fetch", url: "https://api.example.com/posts", as: "posts", preview: { sample: [{ slug: "a", title: "Hello" }] } },
              { id: "post-init", kind: "set-var", into: "post", value: "null" },
              { id: "select-post", kind: "for-each", array: "posts", then: [
                { id: "match", kind: "if", cond: { subject: "var", target: "",
                  left: "{ループ.値.slug}", op: "eq", value: "{slug}" }, then: [
                  { id: "choose", kind: "set-var", into: "post", value: "{ループ.値}" },
                  { id: "break", kind: "break-loop" },
                ] },
              ] },
            ],
          },
        ],
      },
    },
    pageOrder: ["p"],
    nodes: { h: h1 },
    assets: {},
  };
  const page = generateProject(doc).files["app/posts/[slug]/page.tsx"];
  assert.match(page, /export async function generateMetadata/);
  assert.match(page, /description: "Article page"/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /openGraph:/);
  assert.match(page, /twitter: \{ card: "summary_large_image" \}/);
});

test("obfuscateVarNames renames variable tokens and cloning renames grouped radio item IDs", () => {
  const itemText: DocNode = { ...makeBox(), id: "it", text: { content: "{label}", heading: 0 } };
  const list: DocNode = { ...makeBox(), id: "l", type: "list", list: { from: "items" }, children: ["it"] };
  const doc = docWith([list], [
    {
      id: "ps",
      trigger: "load",
      steps: [
        { id: "f1", kind: "fetch", url: "https://api.example.com/items", as: "items" },
        { id: "af", kind: "transform", source: "items", into: "count", transform: { kind: "length" } },
        { id: "sv", kind: "set-var", value: "y", into: "label" },
      ],
    },
  ]);
  doc.nodes.it = itemText;
  const obf = obfuscateVarNames(doc);
  assert.match(obf.nodes.it.text?.content ?? "", /^\{_\d+\}$/);

  // ラジオボタンは既定で group="radio"、attrId="radio-1" を持ち、追加・複製のときに、個別の ID（radio-2, radio-3）が自動で振られる
  const r1 = makeField("radio");
  const rDoc = docWith([r1]);
  const r2 = makeField("radio");
  refreshClonedIds(rDoc, "p", [r2]);
  assert.equal(r1.attrId, "radio-1");
  assert.equal(r2.attrId, "radio-2");
  assert.equal(r2.field?.group, "radio");

  // コンポーネントの中の h1 と入力欄も、点検と変数の候補で認識される
  const compH1: DocNode = { ...makeBox(), id: "ch1", type: "field", attrId: "comp-input", field: { kind: "input" } };
  const compRoot: DocNode = { ...makeBox(), id: "cr", text: { content: "Heading", heading: 1 }, children: ["ch1"] };
  const inst: DocNode = { ...makeBox(), id: "inst", type: "instance", componentId: "c1" };
  const cDoc: SiteDoc = {
    siteName: "Real Site",
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "Desc", children: ["inst"] } },
    pageOrder: ["p"],
    nodes: { cr: compRoot, ch1: compH1, inst },
    components: { c1: { id: "c1", name: "Hero", rootId: "cr" } },
    assets: {},
  };
  assert.ok(varNamesAt(cDoc, "p", "inst").includes("comp-input"));
  assert.ok(!runChecks(cDoc).some((w) => w.help === "seo-h1"));
  assert.equal(interpolateUrl("{img}", { img: "data:image/png;base64,AAAA" }), "data:image/png;base64,AAAA");
});

test("shadowed SVG images are drawn at 2x and positioned siblings stay on top of them", () => {
  // 前にある位置指定の要素（重ねた文字）と、後ろの位置指定の要素
  const before: DocNode = { ...makeBox(), id: "a", styles: { base: { default: { position: "absolute", top: "0" } } } };
  const after: DocNode = { ...makeBox(), id: "z", styles: { base: { default: { position: "sticky", top: "0", zIndex: "0" } } } };
  const own: DocNode = { ...makeBox(), id: "o", styles: { base: { default: { position: "absolute", zIndex: "5" } } } };
  const img: DocNode = { ...makeImage(), id: "i" };
  // 実寸が 0 の画像には、アセットの実寸を使う
  img.image = { ...img.image!, assetId: "s", src: "", width: 0, height: 0 };
  const doc = docWith([before, img, after, own]);
  doc.assets.s = { id: "s", name: "s.svg", path: "assets/s.svg", mimeType: "image/svg+xml", width: 120, height: 40, svgFilter: true };
  const { files } = generateProject(doc);
  const page = Object.entries(files).find(([p]) => p.endsWith("page.tsx"))![1];
  assert.match(page, /className="crisp-svg [^"]*"/);
  assert.match(page, /\["--crisp-svg-width"\]: "120px"/);
  assert.match(page, /\["--crisp-svg-ratio"\]: "120 \/ 40"/);
  assert.match(page, /\} as import\("react"\)\.CSSProperties\}/);
  // 画像は絶対配置なので、実寸の透明な svg で枠の中身の大きさを決める
  assert.match(page, /<svg aria-hidden="true" width=\{120\} height=\{40\} viewBox="0 0 120 40" \/>/);
  assert.match(page, /width=\{240\}\s+height=\{80\}/);
  assert.match(files["app/globals.css"], /transform: scale\(0\.5\)/);
  assert.match(files["app/globals.css"], /aspect-ratio: var\(--crisp-svg-ratio\)/);
  assert.match(files["app/globals.css"], /\.crisp-svg > img \{[\s\S]*?position: absolute;/);
  assert.match(files["app/globals.css"], /\.crisp-svg > svg \{[\s\S]*?display: block;[\s\S]*?width: 100%;/);
  // HTML 書き出しにも同じレイアウトを適用する。
  const html = generateStandaloneHtml(doc, generateProject(doc)).files["index.html"];
  assert.match(html, /class="crisp-svg [^"]*"/);
  assert.match(html, /style="--crisp-svg-width:120px;--crisp-svg-ratio:120\/40"/);
  assert.match(html, /<svg aria-hidden="true" width="120" height="40" viewBox="0 0 120 40"><\/svg><img/);
  // 前後の位置指定の要素は z-index: 1 になり、自分の z-index を持つ要素はそのまま
  assert.equal((files["styles/site.css"].match(/z-index: 1;/g) ?? []).length, 2);
  assert.match(files["styles/site.css"], /z-index: 5;/);
  // 元の編集データは書き換えない
  assert.equal(doc.nodes.a.styles.base?.default?.zIndex, undefined);

  // チェックを外したら、通常の画像になる
  img.image.crispShadow = false;
  const plain = Object.entries(generateProject(doc).files).find(([p]) => p.endsWith("page.tsx"))![1];
  assert.doesNotMatch(plain, /crisp-svg/);
});

test("embedded images use asset IDs without duplicated node data URLs", () => {
  const data = `data:image/png;base64,${"A".repeat(4000)}`;
  const a: DocNode = { ...makeImage(), id: "a" };
  const b: DocNode = { ...makeImage(), id: "b" };
  a.image = { ...a.image!, assetId: "s", src: "" };
  b.image = { ...b.image!, assetId: "s", src: "" };
  const bg: DocNode = { ...makeBox(), id: "bg", styles: { base: { default: { backgroundImage: `url(${data})` } } } };
  const doc = docWith([a, b, bg]);
  doc.assets.s = { id: "s", name: "s.png", mimeType: "image/png", width: 10, height: 10, dataUrl: data };

  // 要素には複製しない（表示は assetId から引く）。サーバーに置いたアセットには、パスを持たせる
  assert.equal(nodeAssetSrc(doc.assets.s), "");
  assert.equal(nodeAssetSrc({ ...doc.assets.s, dataUrl: undefined, path: "assets/s.png" }), "/api/assets/file?path=assets%2Fs.png");
  assert.equal(doc.nodes.a.image!.src, "");
  assert.equal(doc.nodes.b.image!.src, "");
  assert.equal(mediaSrc(doc, doc.nodes.a.image!), data, "the canvas still shows the image");
  // 書き出すサイトは変わらない
  const page = Object.entries(generateProject(doc).files).find(([p]) => p.endsWith("page.tsx"))![1];
  assert.match(page, /src="\/assets\/[^"]+\.png"/);

  // サーバーに移すと、要素の src と、背景画像のスタイルも差し替わる
  replaceEmbeddedAsset(doc, "s", "assets/s.png");
  const src = "/api/assets/file?path=assets%2Fs.png";
  assert.equal(doc.assets.s.dataUrl, undefined);
  assert.equal(doc.nodes.a.image!.src, src);
  assert.equal(doc.nodes.b.image!.src, src);
  assert.equal(doc.nodes.bg.styles.base!.default!.backgroundImage, `url(${src})`);
  assert.equal(JSON.stringify(doc).includes("base64"), false);
});

test("embedded asset migration includes page backgrounds created by the background panel", () => {
  const data = "data:image/png;base64,AAAA";
  const doc = docWith([]);
  doc.assets.s = { id: "s", name: "s.png", width: 10, height: 10, dataUrl: data };
  doc.pages.p.bodyStyles = {
    base: {
      default: { backgroundImage: `url("${data}")`, color: "red" },
      hover: { backgroundImage: `url("${data}")` },
    },
    md: { focus: { backgroundImage: `url("${data}")` } },
  };
  doc.pages.other = {
    ...doc.pages.p, id: "other", slug: "other",
    bodyStyles: { base: { default: { backgroundImage: `url("${data}")` } } },
  };
  doc.pages.plain = { ...doc.pages.p, id: "plain", slug: "plain", bodyStyles: undefined };
  replaceEmbeddedAsset(doc, "s", "assets/s.png");
  const expected = 'url("/api/assets/file?path=assets%2Fs.png")';
  assert.equal(doc.pages.p.bodyStyles.base.default!.backgroundImage, expected);
  assert.equal(doc.pages.p.bodyStyles.base.hover!.backgroundImage, expected);
  assert.equal(doc.pages.p.bodyStyles.md.focus!.backgroundImage, expected);
  assert.equal(doc.pages.other.bodyStyles!.base.default!.backgroundImage, expected);
  assert.equal(doc.pages.p.bodyStyles.base.default!.color, "red");
  assert.equal(doc.pages.plain.bodyStyles, undefined);
  const generated = Object.values(generateProject(doc).files).join("\n");
  assert.ok(!generated.includes(data), "the generated page no longer embeds the background");
  assert.match(generated, /url\([^)]*\/assets\//);
});

test("page background migration preserves prefix collisions and non-panel CSS or authored code", () => {
  const data = "data:image/png;base64,AAAA";
  const values = [
    `url("${data}BBBB")`,
    `url("${data}#icon")`,
    `url(${data})`,
    `url('${data}')`,
    `url( "${data}" )`,
    `url("${data}"), url("${data}")`,
    `linear-gradient(red, blue), url("${data}")`,
    `image-set("${data}" 1x)`,
  ];
  for (const value of values) {
    const doc = docWith([]);
    doc.assets.s = { id: "s", name: "s.png", width: 10, height: 10, dataUrl: data };
    doc.assets.other = { ...doc.assets.s, id: "other" };
    doc.pages.p.bodyStyles = { base: { default: {
      backgroundImage: value,
      content: `"${data}"`,
      "--asset-url": data,
    } } };
    doc.pages.p.rawHtml = `<img src="${data}">`;
    doc.pages.p.customTopHtml = data;
    doc.customHeadHtml = data;
    const before = structuredClone(doc);
    replaceEmbeddedAsset(doc, "s", "assets/s.png");
    assert.deepEqual(doc.pages, before.pages, value);
    assert.equal(doc.customHeadHtml, before.customHeadHtml);
    assert.deepEqual(doc.assets.other, before.assets.other);
  }
});

test("editing rotation preserves percentage scales from existing CSS", () => {
  for (const [source, x, y] of [
    ["scale(50%)", 0.5, 0.5],
    ["scale(50%, 125%)", 0.5, 1.25],
    ["scaleX(50%) scaleY(125%)", 0.5, 1.25],
    ["scale(5e1%, +1.25)", 0.5, 1.25],
    ["scale(-50%, 0%)", -0.5, 0],
  ] as const) {
    const parts = parseTransform(source);
    assert.equal(parts.scaleX, x);
    assert.equal(parts.scaleY, y);
    const edited = parseTransform(serializeTransform({ ...parts, rotate: 30 })!);
    assert.equal(edited.rotate, 30);
    assert.equal(edited.scaleX, x);
    assert.equal(edited.scaleY, y);
  }
});

test("unsupported scale values are retained instead of reading a numeric prefix", () => {
  for (const source of ["scale(2px)", "scaleX(2foo)", "scaleY(1e309)", "scale(1, 2, 3)", "scaleX(1, 2)"]) {
    const parts = parseTransform(source);
    assert.equal(parts.scaleX, 1);
    assert.equal(parts.scaleY, 1);
    assert.equal(parts.rest, source);
    assert.equal(serializeTransform(parts), source);
  }
});

test("editing blur preserves number-form filter strengths", () => {
  const parsed = parseFilter("brightness(0.5) contrast(1.2) saturate(0) grayscale(.25) sepia(1)");
  assert.deepEqual(parsed, { blur: 0, brightness: 50, contrast: 120, saturate: 0, grayscale: 25, sepia: 100, hueRotate: 0 });
  const edited = serializeFilter({ ...parsed, blur: 4 });
  assert.equal(edited, "blur(4px) brightness(50%) contrast(120%) saturate(0%) grayscale(25%) sepia(100%)");
  assert.deepEqual(parseFilter(edited!), { ...parsed, blur: 4 });
});

test("number and percentage filter inputs have equivalent editable values", () => {
  assert.deepEqual(
    parseFilter("brightness( +5e-1 ) contrast(1.2e2%) saturate( 0% ) grayscale(25%) sepia(1e0)"),
    parseFilter("brightness(50%) contrast(120%) saturate(0) grayscale(.25) sepia(100%)")
  );
  assert.equal(parseFilter("brightness(1e309)").brightness, 100);
  assert.equal(parseFilter("contrast(2px)").contrast, 100);
});
});

describe("gesture-history-boundary", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
function open() {
  state().endGesture();
  const doc: SiteDoc = {
    siteName: "Gesture history", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["a"] } },
    nodes: { a: { ...makeBox(), id: "a", name: "Original" } },
  };
  state().replaceDoc(doc);
}

for (const action of ["undo", "redo"] as const) {
  test(`${action} ends the previous gesture and subsequent changes remain undoable`, () => {
    open();
    const finish = state().beginGesture();
    state().updateNode("a", { name: "First" });
    if (action === "redo") {
      finish();
      state().undo();
      state().beginGesture();
    }
    state()[action]();
    const boundary = state().doc.nodes.a.name;
    assert.equal(state().gestureActive, false);
    state().updateNode("a", { name: "Second" });
    finish();
    assert.equal(state().future.length, 0, "a new edit must discard stale redo history");
    state().undo();
    assert.equal(state().doc.nodes.a.name, boundary);
    state().redo();
    assert.equal(state().doc.nodes.a.name, "Second");
  });

  test(`${action} invalidates old release callbacks without ending a newer gesture`, () => {
    open();
    state().updateNode("a", { name: "First" });
    if (action === "redo") state().undo();
    const oldFinish = state().beginGesture();
    const overlappingFinish = state().beginGesture();
    state()[action]();
    const boundary = state().doc.nodes.a.name;
    const newFinish = state().beginGesture();
    state().updateNode("a", { name: "Second" });
    oldFinish();
    overlappingFinish();
    assert.equal(state().gestureActive, true);
    state().updateNode("a", { name: "Third" });
    newFinish();
    assert.equal(state().gestureActive, false);
    state().undo();
    assert.equal(state().doc.nodes.a.name, boundary, "the new gesture is one undo step");
    state().redo();
    assert.equal(state().doc.nodes.a.name, "Third");
  });

  test(`${action} with no history still ends the gesture before the next edit`, () => {
    open();
    const finish = state().beginGesture();
    state()[action]();
    assert.equal(state().gestureActive, false);
    state().updateNode("a", { name: "Changed" });
    finish();
    state().undo();
    assert.equal(state().doc.nodes.a.name, "Original");
  });
}

for (const action of ["replaceDoc", "restoreDoc", "resetDoc"] as const) {
  const transition = () => {
    if (action === "resetDoc") state().resetDoc();
    else state()[action]({ ...state().doc, siteName: "Replacement" });
  };

  test(`${action} ends interrupted gestures so the next ordinary edit is undoable`, () => {
    open();
    const finish = state().beginGesture();
    state().updateDoc(doc => { doc.siteName = "Dragging"; });
    transition();
    const boundary = state().doc;
    assert.equal(state().gestureActive, false);
    state().updateDoc(doc => { doc.siteName = "After replacement"; });
    finish();
    state().undo();
    assert.deepEqual(state().doc, boundary);
    state().redo();
    assert.equal(state().doc.siteName, "After replacement");
  });

  test(`${action} discards old gesture owners before starting a new gesture`, () => {
    open();
    const oldFinish = state().beginGesture();
    const overlappingFinish = state().beginGesture();
    transition();
    const boundary = state().doc;
    const newFinish = state().beginGesture();
    state().updateDoc(doc => { doc.siteName = "First new change"; });
    oldFinish();
    overlappingFinish();
    assert.equal(state().gestureActive, true);
    state().updateDoc(doc => { doc.siteName = "Second new change"; });
    newFinish();
    assert.equal(state().gestureActive, false);
    state().undo();
    assert.deepEqual(state().doc, boundary, "the new gesture has its own checkpoint");
    state().redo();
    assert.equal(state().doc.siteName, "Second new change");
  });
}
});

describe("history-conflicts", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "History", pageOrder: ["p"], assets: {}, components: {},
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["a"] } },
    nodes: { a: { ...makeBox(), id: "a", name: "Original", styles: { base: { default: { color: "red" } } } } },
  };
}
const state = () => useEditor.getState();

test("undo preserves remote edits that superseded the same local property", () => {
  state().replaceDoc(fixture());
  state().updateNode("a", { name: "Local" });
  state().setStyleProps("a", { color: "blue" });
  const remote = structuredClone(state().doc);
  remote.nodes.a.name = "Remote";
  state().applyRemoteDoc(remote);
  state().undo();
  assert.equal(state().doc.nodes.a.name, "Remote");
  assert.equal(state().doc.nodes.a.styles.base?.default?.color, "red");
  state().undo();
  assert.equal(state().doc.nodes.a.name, "Remote");
  state().redo();
  assert.equal(state().doc.nodes.a.name, "Remote");
  assert.equal(state().doc.nodes.a.styles.base?.default?.color, "blue");
});

test("redo does not overwrite a remote edit made after undo", () => {
  state().replaceDoc(fixture());
  state().updateNode("a", { name: "Local" });
  state().undo();
  const remote = structuredClone(state().doc);
  remote.nodes.a.name = "Remote";
  state().applyRemoteDoc(remote);
  state().redo();
  assert.equal(state().doc.nodes.a.name, "Remote");
});

test("undo does not resurrect a property removed by another editor", () => {
  state().replaceDoc(fixture());
  state().setStyleProps("a", { color: "blue" });
  const remote = structuredClone(state().doc);
  delete remote.nodes.a.styles.base!.default!.color;
  state().applyRemoteDoc(remote);
  state().undo();
  assert.equal(state().doc.nodes.a.styles.base?.default?.color, undefined);
});

test("undo does not revert another editor's subsequent move", () => {
  const doc = fixture();
  for (const id of ["first", "second"]) doc.nodes[id] = { ...makeBox(), id };
  doc.pages.p.children.push("first", "second");
  state().replaceDoc(doc);
  state().moveNode("a", { kind: "node", id: "first" }, 0);
  const remote = structuredClone(state().doc);
  remote.nodes.first.children = [];
  remote.nodes.second.children = ["a"];
  state().applyRemoteDoc(remote);
  state().undo();
  assert.deepEqual(state().doc.nodes.second.children, ["a"]);
  assert.deepEqual(state().doc.nodes.first.children, []);
  assert.ok(!state().doc.pages.p.children.includes("a"));
});

test("undo does not resurrect nodes removed after a local edit", () => {
  state().replaceDoc(fixture());
  state().updateNode("a", { name: "Local" });
  const remote = structuredClone(state().doc);
  delete remote.nodes.a;
  remote.pages.p.children = [];
  state().applyRemoteDoc(remote);
  state().undo();
  assert.equal(state().doc.nodes.a, undefined);
  assert.deepEqual(state().doc.pages.p.children, []);
});

for (const path of ["node gesture", "document gesture", "transient checkpoint"] as const) {
  test(`remote updates before the first ${path} change preserve one Undo step and invalidate Redo`, () => {
    state().endGesture();
    const doc = fixture();
    doc.nodes.deleted = { ...makeBox(), id: "deleted" };
    doc.pages.p.children.push("deleted");
    state().replaceDoc(doc);
    state().updatePage("p", { description: "Abandoned edit" });
    state().undo();
    assert.equal(state().future.length, 1);

    let finish = () => {};
    if (path === "transient checkpoint") state().checkpoint();
    else finish = state().beginGesture();
    const remote = structuredClone(state().doc);
    remote.nodes.a.name = "Collaborator rename";
    delete remote.nodes.deleted;
    remote.pages.p.children = ["a"];
    state().applyRemoteDoc(remote);
    // 接続し直した後のスナップショットを含め、同期を何度くり返しても、
    // 時点を使い切ったり、空の履歴の項目を作ったりしてはならない。
    const latest = structuredClone(remote);
    latest.siteName = "Remote site name";
    state().applyRemoteDoc(latest);
    assert.equal(state().past.length, 0);
    assert.equal(state().future.length, 1);

    for (const color of ["blue", "green"]) {
      if (path === "document gesture") {
        state().updateDoc(d => { d.nodes.a.styles.base!.default!.color = color; });
      } else {
        state().setStyleProps("a", { color }, { transient: path === "transient checkpoint" });
      }
    }
    finish();
    assert.equal(state().past.length, 1);
    assert.equal(state().future.length, 0, "new local changes discard the abandoned redo branch");
    const changed = structuredClone(state().doc);
    state().undo();
    assert.deepEqual(state().doc, latest, "undo retains remote properties and node deletion");
    state().redo();
    assert.deepEqual(state().doc, changed);
    assert.equal(state().doc.schemaVersion, 1);
    assert.deepEqual(remote.nodes.a.styles, doc.nodes.a.styles, "rebasing does not mutate input snapshots");
  });
}

test("a remote deletion followed by a no-op gesture preserves the rebased redo branch", () => {
  state().endGesture();
  state().replaceDoc(fixture());
  state().updatePage("p", { description: "Redo me" });
  state().undo();
  const finish = state().beginGesture();
  const remote = structuredClone(state().doc);
  delete remote.nodes.a;
  remote.pages.p.children = [];
  state().applyRemoteDoc(remote);
  state().updateNode("a", { name: "Late edit to deleted node" });
  finish();
  assert.equal(state().past.length, 0);
  assert.equal(state().future.length, 1);
  state().redo();
  assert.deepEqual(state().doc, { ...remote, pages: { p: { ...remote.pages.p, description: "Redo me" } } });
});
});

describe("history-restore-safety", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const source = readFileSync(new URL("../components/PublishModal.tsx", import.meta.url), "utf8");
const restoreCode = transformSync(source.slice(source.indexOf("async function restoreFrom("), source.indexOf("function PublishHistory(")), { loader: "tsx" }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(validate: typeof validateImportedDoc = validateImportedDoc) {
  const doc = { schemaVersion: 1, siteName: "Original", assets: {}, nodes: {}, pages: { p: { id: "p", name: "Home", title: "", description: "", slug: "", children: [] } }, pageOrder: ["p"] };
  useEditor.getState().replaceDoc(doc);
  const revision = useEditor.getState().historyRevision;
  const restored = { ...doc, siteName: "Backup" };
  const response = deferred<Response>();
  const confirm = deferred<boolean>();
  let mounted = true, confirmations = 0;
  const run = new Function("fetch", "showConfirm", "useEditor", "tr", "readRestoreJson", "IMPORT_LIMITS", "validateImportedDoc", "sanitizeImportedInlineIcons", `${restoreCode}; return restoreFrom;`)(
    () => response.promise, () => { confirmations++; return confirm.promise; }, useEditor, (s: string) => s,
    readRestoreJson, IMPORT_LIMITS, validate, sanitizeImportedInlineIcons,
  ) as (url: string, label: string, current: () => boolean) => Promise<boolean>;
  return { restored, response, confirm, cancel: () => { mounted = false; }, get confirmations() { return confirmations; },
    run: () => run("https://example.test/backup", "yesterday", () => mounted && useEditor.getState().historyRevision === revision) };
}

test("history restore is cancelled before confirmation when its panel or history changes while fetching", async () => {
  for (const stop of ["unmount", "replace"] as const) {
    const f = fixture(); const result = f.run();
    if (stop === "unmount") f.cancel();
    else useEditor.getState().replaceDoc({ ...useEditor.getState().doc, siteName: "Another document" });
    const before = useEditor.getState().doc;
    f.response.resolve(Response.json(f.restored));
    await tick();
    assert.equal(f.confirmations, 0);
    assert.equal(await result, false);
    assert.equal(useEditor.getState().doc, before);
  }
});
test("history restore cannot overwrite a replaced document or closed target after confirmation", async () => {
  for (const stop of ["unmount", "replace"] as const) {
    const f = fixture(); const result = f.run(); f.response.resolve(Response.json(f.restored)); await tick();
    assert.equal(f.confirmations, 1);
    if (stop === "unmount") f.cancel();
    else useEditor.getState().replaceDoc({ ...useEditor.getState().doc, siteName: "Another document" });
    const before = useEditor.getState().doc; f.confirm.resolve(true);
    assert.equal(await result, false); assert.equal(useEditor.getState().doc, before);
  }
});
test("an active history restore remains one undoable operation and preserves ordinary edits for undo", async () => {
  const f = fixture(); const result = f.run(); f.response.resolve(Response.json(f.restored)); await tick();
  useEditor.getState().updatePage("p", { name: "Edited while reviewing" });
  f.confirm.resolve(true); assert.equal(await result, true);
  assert.equal(useEditor.getState().doc.siteName, "Backup");
  useEditor.getState().undo(); assert.equal(useEditor.getState().doc.pages.p.name, "Edited while reviewing");
});
test("cancelled requests suppress stale server errors", async () => {
  const f = fixture(); const result = f.run(); f.cancel();
  f.response.resolve(Response.json({ error: "obsolete failure" }, { status: 500 }));
  assert.equal(await result, false); assert.equal(f.confirmations, 0);
});

test("obsolete restore completions cannot clear the newer request's busy state, including the same revision", async () => {
  for (const kind of ["publish", "backup"] as const) {
    const start = source.indexOf(kind === "publish" ? "  const restore = async (c: PublishCommit)" : "  const restore = async (b: Backup)");
    const callback = transformSync(source.slice(start, source.indexOf("\n  return (", start)), { loader: "tsx" }).code;
    const first = deferred<boolean>(), second = deferred<boolean>();
    let count = 0, busy: unknown, generation = 0;
    const busyRequest = { current: 0 };
    const injected = {
      pendingRestore: { begin() { const own = ++generation; return { current: () => generation === own, finish() {} }; } },
      busyRequest, setBusy: (value: unknown) => { busy = value; },
      restoreFrom: () => ++count === 1 ? first.promise : second.promise,
      historyUrl: () => "history", siteApi: () => "backup", formatDate: () => "date",
      conf: {}, target: "production", onDone() {}, showAlert() {}, userMessage: String, tr: String,
    };
    const restore = new Function(...Object.keys(injected), `${callback}; return restore;`)(...Object.values(injected));
    const item = { sha: "same-revision", date: "date", day: 2, savedAt: 123 };
    const older = restore(item), newer = restore(item);
    const active = busy;
    first.resolve(false); await older;
    assert.equal(busy, active, `${kind}: an older completion must not unlock newer work`);
    // 文書を復元すると、finally が動く前に historyRevision が変わる。
    generation++;
    second.resolve(true); await newer;
    assert.equal(busy, null, `${kind}: successful restore still clears its own busy state`);
  }
});

test("untrusted GitHub history inline SVG is sanitized before it enters the editor", async () => {
  const doc = createInitialDoc();
  const icon = makeIcon();
  const page = doc.pages[doc.pageOrder[0]];
  doc.nodes[icon.id] = icon;
  page.children.push(icon.id);
  icon.icon!.svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
    '<script>alert(2)</script><style>body{display:none}</style><circle cx="3" cy="3" r="2"/></svg>';
  const f = fixture();
  const task = f.run();
  f.response.resolve(Response.json(doc));
  await tick();
  assert.equal(f.confirmations, 1);
  f.confirm.resolve(true);
  assert.equal(await task, true);
  const savedSvg = useEditor.getState().doc.nodes[icon.id].icon!.svg;
  assert.match(savedSvg, /<svg/);
  assert.match(savedSvg, /<circle/);
  assert.doesNotMatch(savedSvg, /onload|<script|<style|alert/i);
});
});

describe("locked-node-operations", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
function open() {
  state().endGesture();
  const doc: SiteDoc = {
    siteName: "Locked nodes", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: ["a", "locked", "c"] } },
    nodes: Object.fromEntries(["a", "locked", "c"].map(id => [id, { ...makeBox(), id, name: id, locked: id === "locked" }])),
  };
  state().replaceDoc(doc);
  state().setActivePage("p");
  state().selectMany(["a", "locked"], "a");
  return structuredClone(doc);
}

test("cut copies only the unlocked selected nodes that will be deleted", () => {
  const before = open();
  state().copyNode("a", { unlockedOnly: true });
  state().deleteNodes(state().selectedIds);
  assert.deepEqual(state().clipboard!.rootIds, ["a"]);
  assert.deepEqual(state().doc.pages.p.children, ["locked", "c"]);
  state().undo();
  assert.deepEqual(state().doc, before);
  state().redo();
  state().select(null);
  state().pasteClipboard();
  assert.deepEqual(state().doc.pages.p.children.map(id => state().doc.nodes[id].name), ["locked", "c", "a"]);
});

test("ordinary copy still includes locked selected nodes", () => {
  open();
  state().copyNode("a");
  assert.deepEqual(state().clipboard!.rootIds, ["a", "locked"]);
});

test("an all-locked cut does not overwrite the previous clipboard", () => {
  open();
  state().select("a");
  state().copyNode("a");
  const clipboard = state().clipboard;
  state().select("locked");
  state().copyNode("locked", { unlockedOnly: true });
  assert.equal(state().clipboard, clipboard);
});

test("locked nodes cannot be reordered directly and do not create undo entries", () => {
  const before = open();
  state().moveNode("locked", { kind: "page", id: "p" }, 0);
  assert.deepEqual(state().doc, before);
  assert.equal(state().past.length, 0);
});

test("a mixed move moves only unlocked roots and undo restores the original order", () => {
  const before = open();
  state().moveNodes(["a", "locked"], { kind: "page", id: "p" }, 3);
  assert.deepEqual(state().doc.pages.p.children, ["locked", "c", "a"]);
  assert.equal(state().doc.nodes.locked.locked, true);
  state().undo();
  assert.deepEqual(state().doc, before);
});

test("cut keeps descendants of an unlocked root, matching subtree deletion semantics", () => {
  open();
  state().moveNode("c", { kind: "node", id: "a" }, 0);
  state().updateNode("c", { locked: true });
  state().select("a");
  state().copyNode("a", { unlockedOnly: true });
  assert.deepEqual(state().clipboard!.rootIds, ["a"]);
  assert.deepEqual(state().clipboard!.nodes.map(node => node.id), ["a", "c"]);
  state().deleteNodes(["a"]);
  assert.equal(state().doc.nodes.c, undefined);
});

test("AI operations refuse moving locked nodes, enforce MAX_NODE_DEPTH, clear assetSuffix on set_image, and deduplicate set_hidden breakpoints", async () => {
  const { applyAiOps } = await import("../lib/aiOps");
  const { MAX_NODE_DEPTH } = await import("../lib/doc-tree");
  const { makeImage } = await import("../lib/presets");
  const doc = open();
  doc.nodes.img = { ...makeImage(), id: "img", image: { src: "/old.png", alt: "Old", width: 10, height: 10, assetId: "asset_1", assetSuffix: "?v=1" } };
  doc.pages.p.children.push("img");

  const moveLocked = applyAiOps(doc, [{ op: "move", id: "locked", parent: null, index: 0 }], { pageId: "p" });
  assert.equal(moveLocked.applied.length, 0);
  assert.match(moveLocked.errors[0] ?? "", /locked/);
  assert.deepEqual(doc.pages.p.children, ["a", "locked", "c", "img"]);

  const imgEdit = applyAiOps(doc, [
    { op: "set_image", id: "img", src: "https://example.com/new.png", alt: "New" },
    { op: "set_hidden", id: "a", breakpoints: ["sm", "sm", "lg"] },
  ], { pageId: "p" });
  assert.equal(imgEdit.errors.length, 0);
  assert.equal(doc.nodes.img.image?.assetId, undefined);
  assert.equal(doc.nodes.img.image?.assetSuffix, undefined);
  assert.equal(doc.nodes.img.image?.alt, "New");
  assert.deepEqual(doc.nodes.a.hiddenOn, ["sm", "lg"]);

  let parent = "a";
  for (let i = 1; i < MAX_NODE_DEPTH; i++) {
    const id = `d_${i}`;
    doc.nodes[id] = { ...makeBox(), id, children: [] };
    doc.nodes[parent].children.push(id);
    parent = id;
  }
  const tooDeep = applyAiOps(doc, [{ op: "insert", parent, node: { type: "box", name: "Leaf" } }], { pageId: "p" });
  assert.equal(tooDeep.applied.length, 0);
  assert.match(tooDeep.errors[0] ?? "", /maximum nesting depth/);
});
});

describe("regressions", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const require = createRequire(import.meta.url);

function fixture(nodes: DocNode[]): SiteDoc {
  return {
    siteName: "Export test",
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: nodes.map((n) => n.id) } },
    pageOrder: ["p"], nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), assets: {},
  };
}

// 構文エラーがあれば、transformSync が例外を投げる。
const transpileTsx = (source: string, sourcefile: string) =>
  transformSync(source, { sourcefile, loader: "tsx", jsx: "automatic", format: "cjs", target: "es2020" }).code;

function evaluate(source: string) {
  const code = transpileTsx(source, "fixture.tsx");
  const mod = { exports: {} as { default: () => any } };
  new Function("require", "module", "exports", code)(require, mod, mod.exports);
  return mod.exports.default();
}

test("exported JSX preserves quotes, backslashes, newlines and literal HTML entities", () => {
  for (const value of ['Say "hello"', "C:\\new\\test", "line 1\r\nline 2\tend", "&copy; &amp; &#34;", "<hello> 日本語"]) {
    const doc = fixture([
      { ...makeBox(), id: "field", type: "field", field: { kind: "input", placeholder: value, defaultValue: value } },
      { ...makeBox(), id: "image", type: "image", image: { src: "/image.png", alt: value, width: 10, height: 10 } },
      { ...makeBox(), id: "link", link: { kind: "url", url: `https://example.com/?q=${value}` } },
    ]);
    const tree = evaluate(generateProject(doc).files["app/page.tsx"]);
    const [, field, image, link] = tree.props.children;
    assert.equal(field.props.placeholder, value);
    assert.equal(field.props.defaultValue, value);
    assert.equal(image.props.alt, value);
    assert.equal(link.props.href, `https://example.com/?q=${value}`);
  }
});

test("custom head attributes preserve HTML entities and embedded quotes", () => {
  const jsx = headHtmlToJsx(`<meta name="description" content='Say "hello" &amp; goodbye'>`, "");
  const tree = evaluate(`export default function Head() { return (${jsx}); }`);
  assert.equal(tree.props.content, 'Say "hello" & goodbye');
});

test("custom head duplicate attributes keep the first HTML value, ignoring case", () => {
  const jsx = headHtmlToJsx(`<meta NAME="description" name="robots" content='First &amp; value' CONTENT="Second" data-id="one" DATA-ID="two" scheme="first" SCHEME="second"><script SRC="/first.js" src="/second.js" async="false" ASYNC="true"></script><link REL="stylesheet" rel="preload" disabled DISABLED="false"><meta CHARSET="utf-8" charset="shift_jis">`, "");
  const [meta, script, link, charset] = evaluate(`export default function Head() { return (<>${jsx}</>); }`).props.children;
  assert.deepEqual(meta.props, { name: "description", content: "First & value", "data-id": "one", scheme: "first" });
  assert.deepEqual(script.props, { src: "/first.js", async: true });
  assert.deepEqual(link.props, { rel: "stylesheet", disabled: true });
  assert.deepEqual(charset.props, { charSet: "utf-8" });
  assert.equal((jsx.match(/\basync\b/g) ?? []).length, 1);
  assert.equal((jsx.match(/\bdisabled\b/g) ?? []).length, 1);
});

test("custom head duplicate tracking is per element and preserves empty first values", () => {
  const jsx = headHtmlToJsx(`<meta name NAME="ignored" content="" CONTENT="ignored"><meta name="second" content="other"><meta name=third NAME=fourth content='last'>`, "");
  const children = evaluate(`export default function Head() { return (<>${jsx}</>); }`).props.children;
  assert.deepEqual(children.map((child: any) => child.props), [
    { name: "", content: "" },
    { name: "second", content: "other" },
    { name: "third", content: "last" },
  ]);
});

test("custom head HTML boolean attributes use presence rather than string values", () => {
  for (const value of ["", "true", "false", "async", "0"]) {
    const jsx = headHtmlToJsx(`<script ASYNC="${value}" defer='${value}' nomodule=${value || 'nomodule'} src="/tag.js"></script><link disabled="${value}" rel="stylesheet" href="/theme.css"><meta itemscope="${value}" name="scope">`, "");
    const [script, link, meta] = evaluate(`export default function Head() { return (<>${jsx}</>); }`).props.children;
    assert.equal(script.props.async, true);
    assert.equal(script.props.defer, true);
    assert.equal(script.props.noModule, true);
    assert.equal(link.props.disabled, true);
    assert.equal(meta.props.itemScope, true);
  }
});

test("custom head tag boundaries respect both quote styles and preserve following tags", () => {
  const jsx = headHtmlToJsx(`<meta name="description" content="Revenue > cost"><link title='A > B < C' href="/x?a=1&amp;b=2"><base href="/" target="_blank"><title data-label="x > y">A &amp; B</title>`, "");
  const [meta, link, base, title] = evaluate(`export default function Head() { return (<>${jsx}</>); }`).props.children;
  assert.deepEqual(meta.props, { name: "description", content: "Revenue > cost" });
  assert.deepEqual(link.props, { title: "A > B < C", href: "/x?a=1&b=2" });
  assert.deepEqual(base.props, { href: "/", target: "_blank" });
  assert.equal(title.props["data-label"], "x > y");
  assert.equal(title.props.dangerouslySetInnerHTML.__html, "A &amp; B");
});

test("custom head raw contents and comments remain separate from quoted opening tags", () => {
  const scriptBody = 'if (3 > 2) { window.value = "<meta name=wrong>"; }';
  const styleBody = '.a > .b::before { content: "<tag>"; }';
  const noScriptBody = '<link rel="stylesheet" href="/fallback.css">';
  const jsx = headHtmlToJsx(`<!-- <meta name="commented"> --><script data-label="a > b">${scriptBody}</script><style title='c > d'>${styleBody}</style><noscript data-label="e > f">${noScriptBody}</noscript>`, "  ");
  const [script, style, noScript] = evaluate(`export default function Head() { return (<>${jsx}</>); }`).props.children;
  assert.equal(script.props.dangerouslySetInnerHTML.__html, scriptBody);
  assert.equal(style.props.dangerouslySetInnerHTML.__html, styleBody);
  assert.equal(noScript.props.dangerouslySetInnerHTML.__html, noScriptBody);
  assert.doesNotMatch(jsx, /commented/);
});

test("custom head empty string attributes stay strings and data or aria values are not booleans", () => {
  const jsx = headHtmlToJsx(`<meta name content data-flag="false" aria-hidden="true"><script src defer data-async="false"></script>`, "");
  const [meta, script] = evaluate(`export default function Head() { return (<>${jsx}</>); }`).props.children;
  assert.deepEqual(meta.props, { name: "", content: "", "data-flag": "false", "aria-hidden": "true" });
  assert.equal(script.props.src, "");
  assert.equal(script.props.defer, true);
  assert.equal(script.props["data-async"], "false");
});

test("custom head attributes unknown to React's types do not break the typecheck", () => {
  const jsx = headHtmlToJsx(`<script language="javascript" src="/x.js?a=1&amp;b=2" style="color:red" data-id="7"></script><meta name="a" content="b" scheme="&#x41;&amp;">`, "");
  assert.doesNotMatch(jsx, / language=| scheme=|style/);
  const tree = evaluate(`export default function Head() { return (<>${jsx}</>); }`);
  const [script, meta] = tree.props.children;
  assert.deepEqual(script.props, { language: "javascript", src: "/x.js?a=1&b=2", "data-id": "7" });
  assert.equal(meta.props.scheme, "A&");
});

test("generated components avoid framework names and the exported project typechecks", () => {
  const names = ["Page", "Image", "Link", "Fragment", "SmartLink", "SearchForm", "SiteLoadingScreen", "PageHtml", "Metadata", "Vars", "Item", "Image2", "Object", "Array", "Promise", "Record", "JSON", "Error", "Number", "String", "Boolean", "Proxy", "RequestInit"];
  const doc = fixture([]);
  doc.components = {};
  for (const [i, name] of names.entries()) {
    const rootId = `root${i}`;
    const id = `component${i}`;
    doc.components[id] = { id, name, rootId };
    doc.nodes[rootId] = { ...makeBox(), id: rootId, children: [`image${i}`, `link${i}`, `dynamic${i}`] };
    doc.nodes[`image${i}`] = { ...makeBox(), id: `image${i}`, type: "image", image: { src: "/test.png", alt: "Test", width: 10, height: 10 } };
    doc.nodes[`link${i}`] = { ...makeBox(), id: `link${i}`, link: { kind: "url", url: "/" } };
    doc.nodes[`dynamic${i}`] = { ...makeBox(), id: `dynamic${i}`, link: { kind: "url", url: "{target}" } };
    const instance = `instance${i}`;
    doc.nodes[instance] = { ...makeBox(), id: instance, type: "instance", componentId: id };
    doc.pages.p.children.push(instance);
  }
  doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "items" } };
  doc.pages.p.children.push("list");
  doc.pages.p.pageScripts = [{
    id: "load", trigger: "load", steps: [
      { id: "fetch", kind: "fetch", url: "https://example.com/?q={q}", as: "items" },
      { id: "dyn", kind: "fetch", url: "{api}/items", as: "more" },
      { id: "titles-init", kind: "set-var", value: "[]", into: "titles" },
      { id: "map", kind: "for-each", array: "items", then: [
        { id: "write-title", kind: "set-list-item", list: "titles", key: "", value: "{ループ.値.title}" },
      ] },
      { id: "join", kind: "transform", source: "titles", into: "titles", transform: { kind: "join", separator: "," } },
      { id: "split", kind: "transform", source: "titles", into: "parts", transform: { kind: "split", separator: "," } },
    ],
  }];
  // 計測のタグなどのスクリプトを含む、ページ専用のコード（ページ遷移で開いたときにも動かす）
  doc.pages.p.customEndHtml = `<script src="/tag.js"></script><script>window.tagged = true;</script>`;
  doc.pages.p.customTopHtml = `<script type="application/ld+json">{"@type":"Thing"}</script>`;
  doc.customHeadHtml = `<script language="javascript" async="" ASYNC="false" defer="defer" nomodule="false" src="/x.js" SRC="/ignored.js" data-label="a > b"></script><meta name="a" NAME="ignored" content="Revenue > cost" scheme="c" style="x"><link disabled="" DISABLED="false" rel="stylesheet" href="/style.css"><meta itemscope="" name content>`;
  const { files } = generateProject(doc);
  assert.match(files["app/page.tsx"], /<PageHtml html=\{"\\u003cscript src=/);
  // 取得先のホストが {変数} で決まるときも、接続するときに宛先を確かめる fetchPublic で取得する
  assert.match(files["app/page.tsx"], /fetchJson\(interpolateUrl\("\{[^"]*\}\/items", vars\)\)/);
  assert.match(files["app/page.tsx"], /import \{ fetchPublic, readTextLimited \} from "@\/lib\/safe-fetch";/);
  assert.ok(files["lib/safe-fetch.ts"]);
  assert.match(files["app/page.tsx"], /fetchJson\(interpolateUrl\("https:\/\/example\.com\/\?q=\{q\}", vars\)\)/);
  assert.match(files["app/page.tsx"], /dangerouslySetInnerHTML=\{\{ __html: "\\u003cscript type=/);
  assert.match(files["components/PageHtml2.tsx"], /export default function PageHtml2\(/);
  const dir = mkdtempSync(join(tmpdir(), "tsumu-export-test-"));
  try {
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    // 書き出すサイトも、本体と同じ TypeScript 7 で型を検査する。
    execFileSync(resolve("node_modules/.bin/tsc"), [
      "--project", join(dir, "tsconfig.json"), "--noEmit", "--incremental", "false",
    ], { cwd: dir, stdio: "pipe" });
    assert.match(files["components/SmartLink.tsx"], /export default function SmartLink\(/);
    assert.match(files["components/SmartLink2.tsx"], /export default function SmartLink2\(/,
      "the user component must not be overwritten by the link helper");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** ページの直下に roots を置き、他のノードも doc に入れる */
function site(roots: DocNode[], others: DocNode[] = []): SiteDoc {
  const doc = fixture(roots);
  for (const n of others) doc.nodes[n.id] = n;
  return doc;
}

const load = (steps: object[]) => [{ id: "load", trigger: "load" as const, steps: steps as never }];
const click = (steps: object[]) => [{ id: "click", trigger: "click" as const, steps: steps as never }];

test("a link inside a link becomes a click script instead of a nested <a>", () => {
  const inner: DocNode = { ...makeBox(), id: "inner", text: { content: "Inner", heading: 0 }, link: { kind: "url", url: "https://example.com/?a=1&b=2", newTab: true } };
  const outer: DocNode = { ...makeBox(), id: "outer", link: { kind: "url", url: "/about" }, children: ["inner"] };
  const doc = site([outer], [inner]);
  const { files } = generateProject(doc);
  const tree = evaluate(files["app/page.tsx"]);
  const link = tree.props.children[1];
  const child = link.props.children;
  assert.equal(child.type, "p");
  assert.deepEqual(JSON.parse(child.props["data-scripts"]), [
    { trigger: "click", steps: [{ kind: "open-url", url: "https://example.com/?a=1&b=2", newTab: true }] },
  ]);
  assert.match(files["public/scripts.js"], /window\.open/);
  // 編集中のデータはそのまま
  assert.deepEqual(doc.nodes.inner.link, { kind: "url", url: "https://example.com/?a=1&b=2", newTab: true });
});

test("a link inside a component used in a link is converted, and nested forms become divs", () => {
  const compLink: DocNode = { ...makeBox(), id: "compLink", text: { content: "About", heading: 0 }, link: { kind: "page", pageId: "p" } };
  const wrap: DocNode = { ...makeBox(), id: "wrap", link: { kind: "url", url: "https://example.org/" }, children: ["inst"] };
  const inst: DocNode = { ...makeBox(), id: "inst", type: "instance", componentId: "c" };
  const inner: DocNode = { ...makeBox(), id: "innerForm", semantic: "form" };
  const outer: DocNode = { ...makeBox(), id: "outerForm", semantic: "form", children: ["innerForm"] };
  const doc = site([wrap, outer], [compLink, inst, inner]);
  doc.components = { c: { id: "c", name: "Nav", rootId: "compLink" } };
  const { files } = generateProject(doc);
  assert.doesNotMatch(files["components/Nav.tsx"], /<Link|<a /);
  assert.ok(files["components/Nav.tsx"].includes(String.raw`\"kind\":\"open-page\",\"href\":\"/\"`));
  assert.equal(files["app/page.tsx"].match(/<SearchForm/g)?.length, 1);
});

test("a component whose root renders nothing returns null", () => {
  const media: DocNode = { ...makeBox(), id: "media", type: "media", media: { kind: "video", src: "" } };
  const inst: DocNode = { ...makeBox(), id: "inst", type: "instance", componentId: "c" };
  const doc = site([inst], [media]);
  doc.components = { c: { id: "c", name: "Empty", rootId: "media" } };
  const source = generateProject(doc).files["components/Empty.tsx"];
  assert.doesNotThrow(() => transpileTsx(source, "Empty.tsx"));
  assert.match(source, /return \(\s*null\s*\);/);
});

test("scripts in a browser-rendered list template keep the item's {names}", () => {
  const button: DocNode = { ...makeBox(), id: "pick", semantic: "button", text: { content: "Pick", heading: 0 }, scripts: click([{ id: "s", kind: "set-value", target: "kw", value: "{値}" }]) };
  const list: DocNode = { ...makeBox(), id: "list", type: "list", list: { from: "tags" }, children: ["pick"] };
  const make: DocNode = { ...makeBox(), id: "make", scripts: click([
    { id: "sp-source", kind: "set-var", value: "a,b", into: "tags" },
    { id: "sp", kind: "transform", source: "tags", into: "tags", transform: { kind: "split", separator: "," } },
  ]) };
  const page = generateProject(site([make, list], [button])).files["app/page.tsx"];
  assert.match(page, /data-client-list/);
  // 項目がまだ無い段階では空文字にせず、実行時に読む参照の名前を残す。
  assert.match(page, /"value":\{ scriptParts: \["", \{ name: "値"/);
});

test("[slug] pages answer 404 when the API has no item, and metadata reads the same query", () => {
  const title: DocNode = { ...makeBox(), id: "t", text: { content: "{item.title}", heading: 1 } };
  const doc = site([title]);
  doc.pages.p.slug = "items/[slug]";
  doc.pages.p.pageScripts = load([
    { id: "f", kind: "fetch", url: "https://api.example.com/items/{slug}", as: "raw", preview: { sample: { title: "A" } } },
    { id: "v", kind: "set-var", value: "{raw}", into: "item" },
  ]);
  const isr = generateProject(doc).files["app/items/[slug]/page.tsx"];
  assert.match(isr, /export const revalidate = 60/);
  assert.match(isr, /if \(res\.status === 404 \|\| res\.status === 410\) return null;/);

  // URL のクエリも使う取得: メタデータも、クエリを入れてから同じ URL を取得する
  (doc.pages.p.pageScripts[0].steps[0] as { url: string }).url = "https://api.example.com/items/{slug}?lang={lang}";
  const dynamic = generateProject(doc).files["app/items/[slug]/page.tsx"];
  const meta = dynamic.slice(dynamic.indexOf("export async function generateMetadata"), dynamic.indexOf("export default"));
  assert.match(meta, /searchParams/);
  // URL の [slug] は、?slug= より優先する
  assert.ok(meta.indexOf("vars[k] = v") < meta.indexOf("vars.slug = slug"));
});

test("a search form inside a component makes the page read the query on every request", () => {
  const input: DocNode = { ...makeBox(), id: "q", type: "field", attrId: "q", field: { kind: "input", inputType: "search" } };
  const label: DocNode = { ...makeBox(), id: "label", text: { content: "{q}を検索", heading: 0 } };
  const form: DocNode = { ...makeBox(), id: "form", semantic: "form", children: ["q", "label"] };
  const inst: DocNode = { ...makeBox(), id: "inst", type: "instance", componentId: "c" };
  const doc = site([inst], [input, label, form]);
  doc.components = { c: { id: "c", name: "Search", rootId: "form" } };
  doc.pages.p.pageScripts = load([{ id: "f", kind: "fetch", url: "https://api.example.com/search?q={q}", as: "res" }]);
  const { files } = generateProject(doc);
  assert.match(files["app/page.tsx"], /export const dynamic = "force-dynamic"/);
  assert.match(files["app/page.tsx"], /await searchParams/);
  // コンポーネントの中でも、入力欄の値を使う文字は、入力に合わせて書き直す
  assert.match(files["components/Search.tsx"], /data-live=\{interpolate\("\{q\}を検索", \{ \.\.\.\{\}, \.\.\.\{"q":"\{q\}"/);
});

test("elements shown by page scripts keep their display, custom CSS keeps semicolons in values", () => {
  const banner: DocNode = {
    ...makeBox(), id: "banner", attrId: "banner",
    styles: { base: { default: { display: "none", flexDirection: "row" } } },
    customCss: `background-image: url(data:image/png;base64,iVBORw0KGgo=); content: "a;b $1 $&"`,
  };
  const doc = site([banner]);
  doc.pages.p.pageScripts = load([{ id: "w", kind: "wait", seconds: 1 }, { id: "s", kind: "show", target: "banner" }]);
  const { files } = generateProject(doc);
  assert.match(files["app/page.tsx"], /id="banner" data-toggle-show="flex"/);
  assert.match(files["styles/site.css"], /  background-image: url\(data:image\/png;base64,iVBORw0KGgo=\);\n  content: "a;b \$1 \$&";\n/);
});

test("page URLs starting with an underscore are routed instead of becoming private folders", () => {
  const doc = site([]);
  doc.pages.u = { id: "u", name: "Drafts", slug: "_drafts/notes", title: "Drafts", description: "", children: [] };
  doc.pageOrder.push("u");
  assert.ok(generateProject(doc).files["app/%5Fdrafts/notes/page.tsx"]);
});

test("the site language is used for <html lang>, the manifest and the default 404 page", () => {
  const doc = site([]);
  doc.pwa = { enabled: true };
  assert.match(generateProject(doc).files["app/layout.tsx"], /<html lang="ja">/);
  doc.lang = "zh-Hant";
  const { files } = generateProject(doc);
  assert.match(files["app/layout.tsx"], /<html lang="zh-Hant">/);
  assert.match(files["app/manifest.ts"], /"lang": "zh-Hant"/);
  assert.match(files["app/not-found.tsx"], /Page not found\./);
  // 言語コードでない値は使わない（属性を壊さない）
  doc.lang = `"><script>alert(1)</script>`;
  assert.match(generateProject(doc).files["app/layout.tsx"], /<html lang="ja">/);
});

test("a page in another language wraps its content in a lang element", () => {
  const title: DocNode = { ...makeBox(), id: "t", text: { content: "Hello", heading: 1 } };
  const doc = site([title]);
  doc.lang = "ja";
  assert.doesNotMatch(generateProject(doc).files["app/page.tsx"], /lang=/);
  doc.pages.p.lang = "en";
  const tree = evaluate(generateProject(doc).files["app/page.tsx"]);
  const wrapper = tree.props.children;
  assert.equal(wrapper.props.lang, "en");
  assert.deepEqual(wrapper.props.style, { display: "contents" });
  assert.equal(wrapper.props.children[1].props.children, "Hello");
  // サイトと同じ言語なら、包まない
  doc.lang = "en";
  assert.doesNotMatch(generateProject(doc).files["app/page.tsx"], /lang=/);
});

test("moving to a deleted destination preserves the nodes and their original parent", () => {
  for (const kind of ["node", "page"] as const) {
    useEditor.getState().replaceDoc(fixture(["a", "b"].map((id) => ({ ...makeBox(), id }))));
    const before = structuredClone(useEditor.getState().doc);
    useEditor.getState().moveNodes(["a", "b"], { kind, id: "deleted" }, 0);
    assert.deepEqual(useEditor.getState().doc, before);
  }
});

test("moving repeated selections inserts each node only once and can be undone", () => {
  useEditor.getState().replaceDoc(fixture(["a", "b"].map((id) => ({ ...makeBox(), id }))));
  useEditor.getState().moveNodes(["a", "a"], { kind: "node", id: "b" }, 0);
  assert.deepEqual(useEditor.getState().doc.pages.p.children, ["b"]);
  assert.deepEqual(useEditor.getState().doc.nodes.b.children, ["a"]);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.pages.p.children, ["a", "b"]);
});

test("a component master cannot be moved into a page", () => {
  useEditor.getState().replaceDoc(fixture(["a", "b"].map((id) => ({ ...makeBox(), id }))));
  useEditor.getState().createComponent("a");
  const before = structuredClone(useEditor.getState().doc);
  const rootId = Object.values(before.components!)[0].rootId;
  useEditor.getState().moveNodes([rootId], { kind: "page", id: "p" }, 0);
  assert.deepEqual(useEditor.getState().doc, before);
});

test("a corrupted tree with a cycle still generates instead of overflowing the stack", () => {
  const a: DocNode = { ...makeBox(), id: "a", children: ["b"] };
  const b: DocNode = { ...makeBox(), id: "b", text: { content: "B", heading: 0 }, children: ["a"] };
  const list: DocNode = { ...makeBox(), id: "l", type: "list", list: { from: "items" }, children: ["l"] };
  const doc = site([a, list], [b]);
  const page = generateProject(doc).files["app/page.tsx"];
  assert.match(page, /\{"B"\}/);
});

test("generated ids differ even when created in the same millisecond on different clients", async () => {
  const ids = new Set(Array.from({ length: 2000 }, () => makeBox().id));
  assert.equal(ids.size, 2000);
  assert.match(makeBox().id, /^node_[a-z0-9]+$/);
});

test("duplicated elements keep their own custom keyframes", () => {
  const motion = (css: string) => [{ id: "motion_1", trigger: "load" as const, keyframes: "custom", customKeyframes: css, duration: 1, delay: 0, easing: "ease" }];
  const a: DocNode = { ...makeBox(), id: "a", motions: motion("from { opacity: 0 }") };
  const b: DocNode = { ...makeBox(), id: "b", motions: motion("from { transform: scale(0) }") };
  const css = generateProject(site([a, b])).files["styles/site.css"];
  assert.match(css, /@keyframes anim-a-motion_1 \{\n  from \{ opacity: 0 \}/);
  assert.match(css, /@keyframes anim-b-motion_1 \{\n  from \{ transform: scale\(0\) \}/);
});

test("device ranges for hiding leave no gap at fractional screen widths", () => {
  const box: DocNode = { ...makeBox(), id: "x", hiddenOn: ["base"] };
  const css = generateProject(site([box])).files["styles/site.css"];
  // 「パソコンでは非表示」は、すぐ下の画面の max-width をわずかに超えたところから効く
  const m = /@media \(min-width: ([\d.]+)px\) \{\n  \.[\w-]+ \{\n    display: none;/.exec(css);
  assert.ok(m, css);
  assert.ok(!Number.isInteger(Number(m[1])) && Number(m[1]) % 1 < 0.1, m[1]);
});

test("a fetch URL that cannot be parsed does not stop the export and sends no credentials", () => {
  const doc = fixture([]);
  doc.pages.p.pageScripts = load([
    { id: "fetch", kind: "fetch", url: "https://exa mple.com/items", as: "items", headers: [{ name: "Authorization", value: "Bearer x" }] },
  ]) as never;
  const { files } = generateProject(doc);
  // 取得元のオリジンが決まらないため、認証情報付きの取得は safeRequestOrigin が止める
  assert.match(files["app/page.tsx"], /fetchJson\(interpolateUrl\("https:\/\/exa mple\.com\/items", vars\), JSON\.stringify\(\{ headers: \{ "Authorization": "Bearer x" \} \}\), undefined\)/);
});

test("the script runtime parses as JavaScript (preview and export run it with new Function)", async () => {
  const { SCRIPT_RUNTIME } = await import("../lib/script-runtime");
  // テンプレート文字列の中の正規表現は、\\/ と書かないと / で終わり、プレビューのキャンバスごと落ちる
  assert.doesNotThrow(() => new Function(`return (${SCRIPT_RUNTIME})`));
});

test("Next.js live URL and image bindings emit data-live attributes and avoid stale SmartLink props", () => {
  const qField: DocNode = { ...makeBox(), id: "q", attrId: "q", type: "field", field: { kind: "input", inputType: "text" } };
  const liveImg: DocNode = { ...makeBox(), id: "img", type: "image", image: { src: "https://cdn.example.com/{q}.png", alt: "Preview", width: 80, height: 80 } };
  const liveLink: DocNode = { ...makeBox(), id: "lnk", text: { content: "Open", heading: 0 }, link: { kind: "url", url: "https://example.com/search?q={q}" } };
  const doc = site([qField, liveImg, liveLink]);
  const { files } = generateProject(doc);
  assert.match(files["app/page.tsx"], /data-live-src=\{interpolate\("https:\/\/cdn\.example\.com\/\{q\}\.png"/);
  assert.match(files["app/page.tsx"], /<a [^>]*data-live-href=\{interpolate\("https:\/\/example\.com\/search\?q=\{q\}"/);
  assert.doesNotMatch(files["app/page.tsx"], /<SmartLink[^>]*data-live-href/);
});
});

describe("store-destructive-lifecycle", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture() {
  const d = createInitialDoc();
  d.nodes.master = { ...makeText("selected words"), id: "master" };
  d.components = { reusable: { id: "reusable", name: "Reusable", rootId: "master" } };
  useEditor.getState().replaceDoc(d);
  return d;
}

for (const change of ["unchanged", "remote", "replace", "undo", "decline"] as const) {
  test(`master-root Delete confirmation handles ${change}`, async () => {
    const original = fixture();
    useEditor.getState().deleteNodes(["master"]);
    const dialog = useDialogs.getState().queue.at(-1)!;
    assert.equal(dialog.kind, "confirm");
    if (change === "remote") useEditor.getState().applyRemoteDoc({ ...original, siteName: "Remote changes" });
    if (change === "replace") useEditor.getState().replaceDoc(structuredClone(original));
    if (change === "undo") {
      useEditor.getState().updateDoc(d => { d.siteName = "changed"; });
      useEditor.getState().undo();
      assert.equal(useEditor.getState().doc, original);
    }
    const before = useEditor.getState().doc;
    if (dialog.kind === "confirm") dialog.resolve(change !== "decline");
    closeDialog(dialog.id);
    await new Promise(resolve => setImmediate(resolve));
    if (change === "unchanged") {
      assert.equal(useEditor.getState().doc.components!.reusable, undefined);
      useEditor.getState().undo();
      assert.deepEqual(useEditor.getState().doc, original);
    } else assert.equal(useEditor.getState().doc, before);
  });
}

test("document replacement keeps valid node selection but discards old text ranges", () => {
  const doc = fixture();
  useEditor.getState().select("master");
  useEditor.getState().setTextSel({ nodeId: "master", start: 0, end: 8, text: "selected" });
  useEditor.getState().replaceDoc(structuredClone(doc));
  assert.equal(useEditor.getState().selection, "master");
  assert.equal(useEditor.getState().textSel, null);
  assert.deepEqual(useEditor.getState().doc, doc);
});

test("duplicatePages assigns fresh script and step IDs, and deletePages clears loadingScreen and open-page steps", () => {
  const d = createInitialDoc();
  const homeId = d.pageOrder[0];
  d.pages.about = {
    id: "about", name: "About", slug: "about", title: "About", description: "", children: [],
    pageScripts: [{ id: "ps_1", trigger: "load", steps: [{ id: "st_1", kind: "wait", seconds: 1 }] }],
  };
  d.pageOrder.push("about");
  const btnId = d.pages[homeId].children[0];
  d.nodes[btnId].scripts = [
    {
      id: "ns_only_about", trigger: "click",
      steps: [{
        id: "if_1", kind: "if",
        cond: { subject: "var", target: "", left: "1", op: "eq", value: "1" },
        then: [{ id: "op_1", kind: "open-page", pageId: "about" }],
      }],
    },
    {
      id: "ns_mixed", trigger: "hover",
      steps: [
        { id: "op_2", kind: "open-page", pageId: "about" },
        { id: "w_2", kind: "wait", seconds: 0.5 },
      ],
    },
  ];
  d.loadingScreen = { enabled: true, pageId: "about", minDuration: 0.4, fadeDuration: 0.3, frequency: "session" };
  useEditor.getState().replaceDoc(d);

  useEditor.getState().duplicatePages([homeId, "about"]);
  const afterDup = useEditor.getState().doc;
  const copiedAboutId = afterDup.pageOrder.find((id) => id !== homeId && id !== "about" && afterDup.pages[id].slug.startsWith("about"))!;
  const copiedHomeId = afterDup.pageOrder.find((id) => id !== homeId && id !== "about" && id !== copiedAboutId)!;
  assert.notEqual(afterDup.pages[copiedAboutId].pageScripts![0].id, "ps_1");
  assert.notEqual(afterDup.pages[copiedAboutId].pageScripts![0].steps[0].id, "st_1");
  const copiedBtn = afterDup.nodes[afterDup.pages[copiedHomeId].children[0]];
  assert.notEqual(copiedBtn.scripts![0].id, "ns_only_about");
  assert.notEqual(copiedBtn.scripts![0].steps[0].id, "if_1");

  useEditor.getState().deletePages(["about"]);
  const afterDel = useEditor.getState().doc;
  assert.equal(afterDel.loadingScreen?.enabled, false);
  assert.equal(afterDel.loadingScreen?.pageId, undefined);
  const homeBtnScripts = afterDel.nodes[btnId].scripts!;
  assert.equal(homeBtnScripts.length, 1);
  assert.equal(homeBtnScripts[0].id, "ns_mixed");
  assert.deepEqual(homeBtnScripts[0].steps.map((s) => s.kind), ["wait"]);
});
});

describe("structured-document-store", () => {
function database() {
  const sqlite = new DatabaseSync(":memory:");
  const queries: string[] = [];
  const storage: DocumentSqlStorage = {
    sql: {
      exec(sql, ...args) {
        queries.push(sql);
        const stmt = sqlite.prepare(sql);
        if (stmt.columns().length) {
          return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
        }
        stmt.run(...args);
        return { toArray: () => [] };
      },
    },
    transactionSync(fn) {
      sqlite.exec("BEGIN");
      try {
        const result = fn();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { store: new StructuredDocumentStore(storage), sqlite, queries };
}

test("initial snapshot is stored in separate site, page, node and asset rows", () => {
  const { store, sqlite } = database();
  const doc = createInitialDoc();
  assert.equal(validSiteDoc(doc), true);
  assert.equal(store.replace(JSON.stringify(doc), null).kind, "saved");
  const persisted = store.snapshot()!;
  assert.equal(persisted.rev, "1");
  assert.deepEqual(JSON.parse(persisted.body), doc);
  const count = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM document_entries WHERE bucket='nodes'").get()!.n);
  assert.equal(count, Object.keys(doc.nodes).length);
  const meta = sqlite.prepare("SELECT props FROM document_meta WHERE id=1").get()!;
  assert.equal(Object.hasOwn(JSON.parse(String(meta.props)), "nodes"), false);
  sqlite.close();
});

test("one-character edits touch one element row and rev, not 7,000 rows", () => {
  const { store, sqlite, queries } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const next = structuredClone(initial);
  const node = Object.values(next.nodes).find(n => n.text && typeof n.text.content === "string")!;
  assert.ok(node);
  node.text!.content += "x";
  const patch = createDocPatch(initial, next)!;
  assert.equal(patch.length, 1);
  queries.length = 0;
  assert.equal(store.patch(patch, "1").kind, "saved");
  assert.ok(queries.some(sql => sql.startsWith("UPDATE document_entries SET body")));
  assert.ok(!queries.some(sql => /^UPDATE document_meta .*props=/i.test(sql)));
  assert.ok(!queries.some(sql => sql.startsWith("SELECT bucket,entry_id,body FROM document_entries")));
  assert.ok(!queries.some(sql => sql === "DELETE FROM document_entries"));
  assert.equal(store.meta()?.rev, "2");
  assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
  queries.length = 0;
  assert.equal(store.patch(patch, "2").kind, "saved");
  assert.equal(entryWrites(queries).length, 0, "repeated node values only advance the revision");
  assert.equal(store.meta()?.rev, "3");
  sqlite.close();
});

test("UTF-8 row limits distinguish ASCII and multibyte content at the same string length", () => {
  const { store, sqlite } = database();
  try {
    const doc = createInitialDoc();
    doc.customHeadHtml = "a".repeat(2_400_000);
    assert.equal(store.replace(JSON.stringify(doc), null).kind, "saved");
    assert.throws(() => store.patch([
      { path: ["customHeadHtml"], value: "漢".repeat(2_400_000) },
    ], "1"), /1項目が大きすぎます/);
    assert.equal(store.meta()?.rev, "1");
  } finally { sqlite.close(); }
});

test("stale revisions conflict without applying a partial document update", () => {
  const { store, sqlite } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const changed = { ...initial, siteName: "Updated" };
  const patch = createDocPatch(initial, changed)!;
  assert.equal(store.patch(patch, "1").kind, "saved");
  const conflict = store.patch(patch, "1");
  assert.equal(conflict.kind, "conflict");
  assert.equal(store.meta()?.rev, "2");
  assert.equal(JSON.parse(store.snapshot()!.body).siteName, "Updated");
  sqlite.close();
});

test("broken node ownership fails atomically and preserves document revision", () => {
  const { store, sqlite } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const changed = structuredClone(initial);
  const page = changed.pages[changed.pageOrder[0]];
  const root = page.children[0];
  page.children.push(root);
  const patch = createDocPatch(initial, changed)!;
  assert.ok(patch);
  assert.throws(() => store.patch(patch, "1"), /不正な/);
  assert.equal(store.meta()?.rev, "1");
  assert.deepEqual(JSON.parse(store.snapshot()!.body), initial);
  sqlite.close();
});

test("an actual multi-megabyte SiteDoc can initialize and change one node without a full rewrite", () => {
  const { store, sqlite, queries } = database();
  const doc = createInitialDoc();
  const leaf = Object.values(doc.nodes).find(n => n.children.length === 0 && n.text)!;
  assert.ok(leaf);
  for (let i = 0; i < 7_000; i++) {
    const id = "test_detached_" + i;
    doc.nodes[id] = { ...structuredClone(leaf), id, text: {
      ...leaf.text!, content: "L".repeat(800) + i,
    } };
  }
  assert.equal(validSiteDoc(doc), true);
  assert.ok(Buffer.byteLength(JSON.stringify(doc), "utf8") > 5_000_000);
  assert.equal(store.replace(JSON.stringify(doc), null).kind, "saved");
  assert.equal(Object.keys(JSON.parse(store.snapshot()!.body).nodes).length, Object.keys(doc.nodes).length);
  const edited = structuredClone(doc);
  edited.nodes.test_detached_4000.text!.content += "!";
  const patch = createDocPatch(doc, edited)!;
  queries.length = 0;
  assert.equal(store.patch(patch, "1").kind, "saved");
  const writes = queries.filter(q => q.startsWith("UPDATE document_entries SET body") || q.startsWith("DELETE FROM document_entries"));
  assert.equal(writes.length, 1, "one changed node row only");
  assert.deepEqual(JSON.parse(store.snapshot()!.body).nodes.test_detached_4000, edited.nodes.test_detached_4000);
  sqlite.close();
});

test("asset references are read directly from asset rows and erase clears both tables", () => {
  const { store, sqlite } = database();
  const doc = createInitialDoc();
  doc.assets.asset1 = { id: "asset1", name: "a.png", path: "assets/a.png", mimeType: "image/png", width: 1, height: 1 };
  assert.equal(validSiteDoc(doc), true);
  store.replace(JSON.stringify(doc), null);
  assert.deepEqual(store.assetReferences(), [{ path: "assets/a.png", bytes: null }]);
  store.erase();
  assert.equal(store.snapshot(), null);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM document_entries").get()!.n), 0);
  sqlite.close();
});


test("daily backups preserve the previous day's final SiteDoc, in small SQLite chunks", () => {
  const { store, sqlite } = database();
  const original = createInitialDoc();
  // UTF-16 の1文字で、1つ目と2つ目の分割の間のサロゲートのそろい方が反転する。
  // バックアップは、どちら側の絵文字も保たなければならない。
  original.customHeadHtml = "😀".repeat(150_000) + "x" +
    "😀".repeat(150_000) + "保存データ".repeat(150_000);
  store.replace(JSON.stringify(original), null);
  const yesterday = Date.now() - 86_400_000;
  sqlite.prepare("UPDATE document_meta SET saved_at=? WHERE id=1").run(yesterday);
  const edited = { ...original, siteName: "New day" };
  const patch = createDocPatch(original, edited)!;
  assert.equal(store.patch(patch, "1").kind, "saved");
  const entries = store.listBackups();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].day, new Date(yesterday).getUTCDay());
  assert.equal(entries[0].savedAt, yesterday);
  assert.deepEqual(JSON.parse(store.readBackup(entries[0].day)!), original);
  assert.ok(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM document_backup_chunks").get()!.count) > 1,
    "Large backups are chunked into separate rows");
  assert.equal(store.patch(createDocPatch(edited, { ...edited, siteName: "Same day" })!, "2").kind, "saved");
  assert.equal(store.listBackups().length, 1, "do not overwrite the previous day's snapshot");
  sqlite.close();
});

test("deletion seals the room permanently, even if an old RPC save arrives later", () => {
  const { store, sqlite } = database();
  const doc = createInitialDoc();
  store.replace(JSON.stringify(doc), null);
  store.erase();
  assert.equal(store.snapshot(), null);
  assert.equal(store.meta(), null);
  assert.equal(store.readBackup(0), null);
  assert.deepEqual(store.listBackups(), []);
  assert.deepEqual(store.assetReferences(), []);
  assert.deepEqual(store.replace(JSON.stringify(doc), null), { kind: "missing" });
  assert.deepEqual(store.patch([{ path: ["siteName"], value: "Resurrect" }], "1"), { kind: "missing" });
  store.erase(); // 再試行しても結果は変わらない
  assert.equal(store.snapshot(), null);
  sqlite.close();
});

test("invalid optional fields cannot bypass full saves or fast node PATCH", () => {
  const { store, sqlite } = database();
  const original = createInitialDoc();
  assert.equal(store.replace(JSON.stringify(original), null).kind, "saved");

  const invalidNode = structuredClone(Object.values(original.nodes)[0]!);
  (invalidNode as unknown as Record<string, unknown>).motions = [
    { id: "animation", trigger: "load", duration: "invalid", delay: 0, easing: "linear" },
  ];
  assert.throws(() => store.patch([
    { path: ["nodes", invalidNode.id], value: invalidNode },
  ], "1"), /不正な/);
  assert.equal(store.meta()?.rev, "1");

  const invalidDoc = structuredClone(original);
  (invalidDoc as unknown as Record<string, unknown>).baseWidth = "wide";
  assert.throws(() => store.replace(JSON.stringify(invalidDoc), "1"), /不正な/);
  assert.equal(store.meta()?.rev, "1");
  assert.deepEqual(JSON.parse(store.snapshot()!.body), original);
  sqlite.close();
});

test("reopening an initialized room issues only reads so a write quota cannot block loading", () => {
  const sqlite = new DatabaseSync(":memory:");
  const queries: string[] = [];
  const storage: DocumentSqlStorage = {
    sql: {
      exec(sql, ...args) {
        queries.push(sql);
        const stmt = sqlite.prepare(sql);
        if (stmt.columns().length) {
          return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
        }
        stmt.run(...args);
        return { toArray: () => [] };
      },
    },
    transactionSync(fn) {
      return fn();
    },
  };
  const first = new StructuredDocumentStore(storage);
  assert.equal(first.replace(JSON.stringify(createInitialDoc()), null).kind, "saved");
  queries.length = 0;
  const reopened = new StructuredDocumentStore(storage);
  assert.ok(reopened.snapshot());
  assert.ok(reopened.meta());
  assert.deepEqual(queries.filter((sql) => !/^\s*SELECT\b/i.test(sql)), []);
});

const entryWrites = (queries: string[]) =>
  queries.filter(sql => /^(INSERT|UPDATE|DELETE)\b[^;]*document_entries/i.test(sql.trim()));

test("full snapshot saves write only the entry rows that changed", () => {
  const { store, sqlite, queries } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  queries.length = 0;
  assert.equal(store.replace(JSON.stringify(initial), "1").kind, "saved");
  assert.deepEqual(entryWrites(queries), []);

  const next = structuredClone(initial);
  const node = Object.values(next.nodes).find(n => n.text && typeof n.text.content === "string")!;
  node.text!.content += "x";
  queries.length = 0;
  assert.equal(store.replace(JSON.stringify(next), "2").kind, "saved");
  assert.equal(entryWrites(queries).length, 1);
  assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
  sqlite.close();
});

test("full snapshot saves delete removed entries and insert new ones", () => {
  const { store, sqlite } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const next = structuredClone(initial);
  const pageId = initial.pageOrder[1];
  const renamed = "page_renamed000001";
  next.pages[renamed] = { ...next.pages[pageId], id: renamed };
  delete next.pages[pageId];
  next.pageOrder = next.pageOrder.map(id => id === pageId ? renamed : id);
  assert.equal(validSiteDoc(next), true);
  assert.equal(store.replace(JSON.stringify(next), "1").kind, "saved");
  assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
  const rows = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM document_entries").get()!.n);
  const expected = Object.keys(next.pages).length + Object.keys(next.nodes).length
    + Object.keys(next.assets).length + Object.keys(next.components ?? {}).length;
  assert.equal(rows, expected);
  sqlite.close();
});

test("bucket-level patches rewrite only the changed rows of that bucket", () => {
  const { store, sqlite, queries } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const next = structuredClone(initial);
  const node = Object.values(next.nodes).find(n => n.text && typeof n.text.content === "string")!;
  node.text!.content += "x";
  queries.length = 0;
  assert.equal(store.patch([{ path: ["nodes"], value: next.nodes }], "1").kind, "saved");
  assert.equal(entryWrites(queries).length, 1);
  assert.ok(!queries.some(sql => /^UPDATE document_meta .*props=/i.test(sql)));
  assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
  sqlite.close();
});

test("adding and removing an empty components bucket persists its presence", () => {
  const { store, sqlite } = database();
  try {
    const doc = createInitialDoc();
    delete doc.components;
    store.replace(JSON.stringify(doc), null);
    assert.equal(store.patch([{ path: ["components"], value: {} }], "1").kind, "saved");
    assert.deepEqual(JSON.parse(store.snapshot()!.body).components, {});
    assert.equal(store.patch([{ path: ["components"], remove: true }], "2").kind, "saved");
    assert.deepEqual(JSON.parse(store.snapshot()!.body), doc);
  } finally { sqlite.close(); }
});
});
