import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";
import { createBrowserDoc, deleteBrowserDoc, readBrowserDoc, writeBrowserDoc } from "../lib/browser-doc-storage";
import {
  browserDocumentCreateScenario, browserDocumentScenario, cursorScenario,
  expectedCreate, expectedDocument, expectedTransaction,
  transactionCases, transactionScenario,
} from "./helpers/indexeddb-transactions";

for (const mode of transactionCases) {
  test(`IndexedDB fixture: ${mode} preserves transaction atomicity`, { timeout: 5_000 }, async () => {
    assert.deepEqual(await transactionScenario(fakeIndexedDB(), mode), expectedTransaction(mode));
  });
}

const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
before(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { indexedDB: fakeIndexedDB() } });
});
after(() => {
  if (previous) Object.defineProperty(globalThis, "window", previous);
  else Reflect.deleteProperty(globalThis, "window");
});

test("browser document saves reopen an unexpectedly closed connection and still reject stale revisions", async (t) => {
  const opens = t.mock.method(window.indexedDB, "open");
  await createBrowserDoc("reopen", "original");
  const db = opens.mock.calls[0].result!.result;
  t.mock.method(db, "transaction", () => { throw new DOMException("Connection closed", "InvalidStateError"); });
  db.onclose?.call(db, new Event("close"));

  assert.equal(await writeBrowserDoc("reopen", "new edit", "original"), "saved");
  assert.equal(await writeBrowserDoc("reopen", "stale edit", "original"), "conflict");
  assert.equal(await readBrowserDoc("reopen"), "new edit");
  assert.equal(opens.mock.callCount(), 2);
  await deleteBrowserDoc("reopen");
});

test("real browser document storage serializes competing creates", { timeout: 5_000 }, async () => {
  assert.deepEqual(await browserDocumentCreateScenario(), expectedCreate);
});
test("real browser document storage rejects stale saves and preserves unrelated documents", { timeout: 5_000 }, async () => {
  assert.deepEqual(await browserDocumentScenario(), expectedDocument);
});

for (const abort of [false, true]) {
  test(`IndexedDB cursor ${abort ? "aborts queued reads" : "completes without continue"}`, { timeout: 5_000 }, async () => {
    assert.deepEqual(await cursorScenario(fakeIndexedDB(), abort), {
      outcome: abort ? "abort" : "complete", seen: ["one"],
    });
  });
}
