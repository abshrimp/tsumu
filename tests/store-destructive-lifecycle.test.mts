import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { createInitialDoc, makeText } from "../lib/presets";
import { useDialogs, closeDialog } from "../lib/dialog";

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

