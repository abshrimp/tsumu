import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { elements, importCallbacks } from "./helpers/pending-import";
import { pageKindFixture } from "./helpers/page-kind-confirmation";
import type { Page } from "../lib/types";

const state = () => useEditor.getState();
function fixture(patch: Partial<Page> = {}) {
  const doc = pageKindFixture();
  Object.assign(doc.pages.p, patch);
  state().replaceDoc(doc); state().setActivePage("p");
  const ui = importCallbacks("html");
  const render = () => elements(ui.render()).find(e => e.props?.options?.some((o: any) => o.value === "html"));
  return { ui, render, change: (kind: string) => render().props.onChange(kind) as Promise<void> };
}
function snapshot() {
  const { doc, past, future } = state();
  return structuredClone({ doc, past, future });
}

for (const kind of ["html", "redirect"]) {
  for (const patch of [
    { rawHtml: "<p>Collaborator content</p>" },
    { redirectTo: "/new-target" },
    { rewriteTo: "/new-rewrite" },
  ]) test(`${kind} confirmation cannot replace newer remote ${Object.keys(patch)[0]}`, async () => {
    const f = fixture();
    try {
      const change = f.change(kind);
      assert.equal(f.ui.confirmations.length, 1);
      const remote = structuredClone(state().doc); Object.assign(remote.pages.p, patch);
      state().applyRemoteDoc(remote);
      const before = snapshot();
      // 再描画より先に確認を完了しても、現在のストアで競合を検出する。
      f.ui.confirmations[0].resolve(true); await change;
      assert.deepEqual(snapshot(), before);
    } finally { f.ui.unmount(); }
  });

  for (const interruption of ["undo", "undo-redo", "restore", "replace", "delete", "page", "page-return", "unmount", "cancel"]) {
    test(`${kind} confirmation does not survive ${interruption}`, async () => {
      const f = fixture();
      try {
        state().updatePage("p", { title: "Undo this" });
        const change = f.change(kind);
        if (interruption.startsWith("undo")) state().undo();
        if (interruption === "undo-redo") state().redo();
        if (interruption === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
        if (interruption === "replace") state().replaceDoc(structuredClone(state().doc));
        if (interruption === "delete") { const remote = structuredClone(state().doc); delete remote.pages.p; remote.pageOrder = ["q"]; state().applyRemoteDoc(remote); }
        if (interruption.startsWith("page")) state().setActivePage("q");
        if (interruption === "page-return") { f.render(); state().setActivePage("p"); f.render(); }
        if (interruption === "unmount") f.ui.unmount();
        const before = snapshot();
        f.ui.confirmations[0].resolve(interruption !== "cancel"); await change;
        assert.deepEqual(snapshot(), before);
      } finally { f.ui.unmount(); }
    });
  }

  test(`${kind} confirmation preserves unrelated remote edits and creates one undo step`, async () => {
    const f = fixture();
    try {
      const change = f.change(kind);
      const remote = structuredClone(state().doc);
      Object.assign(remote.pages.p, { name: "Renamed", title: "New SEO", description: "New description" });
      remote.nodes.a.text!.content = "Collaborator element edit";
      remote.pages.q.name = "Other page";
      state().applyRemoteDoc(remote); f.render();
      const before = structuredClone(state().doc);
      f.ui.confirmations[0].resolve(true); await change;
      const after = structuredClone(state().doc);
      assert.deepEqual(after.pages.p, { ...before.pages.p, rawHtml: kind === "html" ? "" : null, redirectTo: kind === "redirect" ? "" : undefined, rewriteTo: undefined });
      assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.pages.q, before.pages.q);
      assert.equal(state().past.length, 1);
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); assert.deepEqual(state().doc, after);
    } finally { f.ui.unmount(); }
  });
}

for (const [from, patch] of Object.entries({ normal: {}, html: { rawHtml: "<p>Approved old HTML</p>" }, redirect: { redirectTo: "/old" }, rewrite: { rewriteTo: "/old" } })) {
  for (const to of ["normal", "html", "redirect"]) {
    if ((from === "rewrite" ? "redirect" : from) === to) continue;
    test(`approved ${from} to ${to} still works`, async () => {
      const f = fixture(patch);
      try {
        const before = structuredClone(state().doc);
        const change = f.change(to);
        for (const dialog of f.ui.confirmations) dialog.resolve(true);
        await change;
        const after = structuredClone(state().doc);
        assert.equal(after.pages.p.rawHtml, to === "html" ? (patch as Partial<Page>).rawHtml || "" : null);
        assert.equal(after.pages.p.redirectTo, to === "redirect" ? "" : undefined);
        assert.equal(after.pages.p.rewriteTo, undefined);
        assert.deepEqual(after.nodes, before.nodes);
        assert.deepEqual(after.pages.p.children, before.pages.p.children);
        state().undo(); assert.deepEqual(state().doc, before);
        state().redo(); assert.deepEqual(state().doc, after);
      } finally { f.ui.unmount(); }
    });
  }
}

test("a newer kind request supersedes a pending confirmation", async () => {
  const f = fixture();
  try {
    const older = f.change("html");
    const newer = f.change("redirect");
    const before = snapshot();
    f.ui.confirmations[0].resolve(true); await older;
    assert.deepEqual(snapshot(), before);
    f.ui.confirmations[1].resolve(true); await newer;
    assert.equal(state().doc.pages.p.redirectTo, "");
    assert.equal(state().past.length, 1);
  } finally { f.ui.unmount(); }
});
