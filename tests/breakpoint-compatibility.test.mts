import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { buildCanvasCss } from "../components/canvas/css";
import { validSiteDoc } from "../lib/doc-tree";
import { generateExportProject } from "../lib/export-formats";
import { createInitialDoc, makeBox } from "../lib/presets";
import { parseSiteImport } from "../lib/site-import";
import { useEditor } from "../lib/store";
import { applyBreakpoints, normalizeBreakpoints, BP_INFO, BP_ORDER } from "../lib/style";
import { type SiteDoc } from "../lib/types";
import { elements, importCallbacks } from "./helpers/pending-import";
import { spawnSync } from "node:child_process";
import { loadDicts, translate } from "../lib/i18n";

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
