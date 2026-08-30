import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCanvasCss } from "../components/canvas/css";
import { validSiteDoc } from "../lib/doc-tree";
import { generateExportProject } from "../lib/export-formats";
import { createInitialDoc, makeBox } from "../lib/presets";
import { parseSiteImport } from "../lib/site-import";
import { useEditor } from "../lib/store";
import { applyBreakpoints, normalizeBreakpoints } from "../lib/style";
import type { SiteDoc } from "../lib/types";

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
