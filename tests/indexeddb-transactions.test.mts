import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";
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
