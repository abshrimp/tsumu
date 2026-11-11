import assert from "node:assert/strict";
import { test } from "node:test";
import { assetSrc, downloadAsset } from "../lib/assets";
import { useEditor } from "../lib/store";
import { assetConfirmationCallbacks, assetConfirmationDoc, candidate, spare } from "./helpers/asset-confirmation";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const failure = "Could not download the asset.";

function browser() {
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const blobs: Blob[] = [], saved: { href: string; download: string }[] = [], opened: unknown[][] = [], revoked: string[] = [];
  const timers: (() => void)[] = [];
  Object.assign(globalThis, {
    HTMLElement: class {},
    window: { location: { pathname: "/sites/original" }, addEventListener() {}, removeEventListener() {}, open: (...args: unknown[]) => { opened.push(args); } },
    document: { createElement: () => ({ href: "", download: "", click() { saved.push({ href: this.href, download: this.download }); } }) },
    setTimeout: (run: () => void, delay: number) => { assert.equal(delay, 1000); timers.push(run); return 1; },
  });
  URL.createObjectURL = (blob) => { blobs.push(blob as Blob); return `blob:download-${blobs.length}`; };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  return {
    blobs, saved, opened, revoked, timers,
    close() {
      for (const key of ["window", "document", "fetch", "setTimeout", "HTMLElement"]) {
        if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
        else Reflect.deleteProperty(globalThis, key);
      }
      URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    },
  };
}

for (const status of [403, 404, 500, 502]) {
  test(`HTTP ${status} never saves error bytes or falls back to navigation`, async () => {
    const b = browser();
    try {
      let read = false;
      globalThis.fetch = async () => ({ ok: false, status, blob: async () => { read = true; return new Blob(["error"]); } }) as Response;
      await assert.rejects(downloadAsset(candidate), { message: failure });
      assert.equal(read, false);
      assert.deepEqual([b.saved, b.blobs, b.opened], [[], [], []]);
    } finally { b.close(); }
  });
}

for (const embedded of [false, true]) {
  test(`${embedded ? "data URL" : "remote"} download preserves bytes and filename, with deferred cleanup`, async () => {
    const b = browser();
    try {
      const asset = embedded ? { ...candidate, path: undefined, dataUrl: "data:image/png;base64,AAEC/w==" } : candidate;
      const bytes = new Uint8Array([0, 1, 2, 255]);
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = async (src) => {
        assert.equal(src, assetSrc(asset));
        return embedded ? nativeFetch(src) : new Response(bytes, { headers: { "content-type": "image/png" } });
      };
      await downloadAsset(asset);
      assert.deepEqual(new Uint8Array(await b.blobs[0].arrayBuffer()), bytes);
      assert.equal(b.blobs[0].type, "image/png");
      assert.deepEqual(b.saved, [{ href: "blob:download-1", download: candidate.name }]);
      assert.deepEqual(b.opened, []);
      assert.deepEqual(b.revoked, []);
      b.timers.forEach((run) => run());
      assert.deepEqual(b.revoked, ["blob:download-1"]);
    } finally { b.close(); }
  });
}

test("network/CORS rejection retains source navigation fallback", async () => {
  const b = browser();
  try {
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await downloadAsset(candidate);
    assert.deepEqual(b.opened, [[assetSrc(candidate), "_blank", "noopener"]]);
    assert.deepEqual(b.saved, []);
  } finally { b.close(); }
});

test("interrupted response bodies reject without navigation or corrupted files", async () => {
  const b = browser();
  try {
    globalThis.fetch = async () => ({ ok: true, blob: async () => { throw new Error("interrupted"); } }) as Response;
    await assert.rejects(downloadAsset(candidate), /interrupted/);
    assert.deepEqual([b.saved, b.blobs, b.opened], [[], [], []]);
  } finally { b.close(); }
});

test("click failure still schedules object URL cleanup", async () => {
  const b = browser();
  try {
    globalThis.fetch = async () => new Response("bytes");
    globalThis.document.createElement = (() => ({ click() { throw new Error("click failed"); } })) as any;
    await assert.rejects(downloadAsset(candidate), /click failed/);
    b.timers.forEach((run) => run());
    assert.deepEqual(b.revoked, ["blob:download-1"]);
    assert.deepEqual(b.opened, []);
  } finally { b.close(); }
});

function panel() {
  const b = browser();
  useEditor.getState().replaceDoc(assetConfirmationDoc());
  const ui = assetConfirmationCallbacks();
  const requests: ((response: Response) => void)[] = [];
  globalThis.fetch = () => new Promise<Response>((resolve) => requests.push(resolve));
  return {
    ...b, ui, requests,
    click(id = candidate.id) {
      const card = ui.render().find((e) => e.props?.["data-asset-id"] === id);
      card.props.children.find((e: any) => e?.props?.["data-tip"] === "Download").props.onClick();
    },
    errors: () => ui.render().filter((e) => e.props?.className === "hint" && e.props.children === failure),
    close() { ui.unmount(); b.close(); },
  };
}

test("actual download handler reports failure, then clears it on a successful retry", async () => {
  const p = panel();
  try {
    p.click(); p.requests[0](new Response("missing", { status: 404 })); await tick();
    assert.equal(p.errors().length, 1); assert.equal(p.saved.length, 0);
    p.click(); assert.equal(p.errors().length, 0);
    p.requests[1](new Response("bytes")); await tick();
    assert.equal(p.errors().length, 0); assert.equal(p.saved.length, 1);
  } finally { p.close(); }
});

for (const change of ["newer-download", "newer-upload", "unmount", "replace-doc", "undo-redo", "site", "replace-asset", "remove-asset"] as const) {
  test(`pending download failure is ignored after ${change}`, async () => {
    const p = panel();
    try {
      const s = useEditor.getState;
      s().updateNode("media", { name: "Undoable" });
      p.click();
      if (change === "newer-download") { p.click(spare.id); p.requests[1](new Response("bytes")); await tick(); }
      if (change === "newer-upload") {
        p.ui.render().find((e) => e.type === "input" && e.props.type === "file").props.onChange({ target: { files: [{ type: "text/plain" }], value: "" } });
      }
      if (change === "unmount") p.ui.unmount();
      if (change === "replace-doc") s().replaceDoc(structuredClone(s().doc));
      if (change === "undo-redo") { s().undo(); s().redo(); }
      if (change === "site") window.location.pathname = "/sites/other";
      if (change === "replace-asset" || change === "remove-asset") {
        const d = structuredClone(s().doc);
        if (change === "replace-asset") d.assets[candidate.id].path = "assets/new.png";
        else delete d.assets[candidate.id];
        s().applyRemoteDoc(d);
      }
      p.requests[0](new Response("missing", { status: 404 })); await tick();
      assert.equal(p.errors().length, 0);
    } finally { p.close(); }
  });
}
