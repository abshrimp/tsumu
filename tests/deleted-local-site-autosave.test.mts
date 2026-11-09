import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Bundle the real store with its actual site-scoped key, then evaluate in a fresh tab.
const source = (await build({
  stdin: { contents: `export * from './lib/store'; export * from './lib/site'; export { createInitialDoc } from './lib/presets'; export * from './lib/local-save'; export { sendCloudDoc } from './lib/cloud-save'; export { generateProject } from './lib/generator';`, resolveDir: resolve('.'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
})).outputFiles[0].text;
const require = createRequire(resolve('package.json'));
afterEach(() => { mock.reset(); mock.timers.reset(); });
function fixture(initialRaw?: string) {
  mock.timers.enable({ apis: ["setTimeout"] });
  const values = new Map<string, string>();
  if (initialRaw !== undefined) values.set("tsumu-doc-v1:autosave-test", initialRaw);
  const writes: string[] = [];
  const storage: Storage = {
    get length() { return values.size; }, key: i => [...values.keys()][i] ?? null,
    clear() { values.clear(); }, removeItem(key) { values.delete(key); },
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push(key); values.set(key, value); },
  };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(new EventTarget(), { hidden: false, activeElement: null }) });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: class {} });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { localStorage: storage, location: { pathname: '/sites/autosave-test' } }) });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', source)(require, module, module.exports);
  const api = module.exports;
  const site = { ...api.emptyDest(), id: 'autosave-test', name: 'Original', createdAt: 1, updatedAt: 2 };
  api.saveLocalSites([site]);
  const key = api.siteKey(api.DOC_STORAGE_KEY);
  return { ...api, values, writes, storage, key,
    remove() { api.deleteLocalSite(site.id); for (const key of api.SITE_SCOPED_KEYS) storage.removeItem(api.siteKey(key)); },
    dispose() {
      for (const [name, previous] of [['window', oldWindow], ['document', oldDocument], ['HTMLElement', oldElement]] as const) {
        if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test('deleted local site rejects a stale autosave without recreating its document', () => {
  const f = fixture();
  try {
    const doc = f.useEditor.getState().doc;
    f.remove();
    const result = f.persistDoc(doc);
    assert.equal(f.values.has(f.key), false, 'a stale tab must not recreate the deleted document');
    assert.equal(result, 'deleted');
    assert.equal(f.isLocalSiteDeleted(), true);
    assert.deepEqual(f.loadLocalSites(), []);
    assert.equal(f.useEditor.getState().doc, doc);
  } finally { f.dispose(); }
});

for (const listed of [true, false]) test(`${listed ? 'normal local site' : 'server fallback absent from local list'} saves normally and skips unchanged writes`, () => {
  const f = fixture();
  try {
    if (!listed) f.values.delete('tsumu-sites-v1');
    const doc = f.useEditor.getState().doc;
    assert.equal(f.persistDoc(doc), 'saved');
    assert.deepEqual(JSON.parse(f.values.get(f.key)), doc);
    const before = [...f.values]; const writes = f.writes.length;
    assert.equal(f.persistDoc(doc), 'saved');
    assert.deepEqual([...f.values], before);
    assert.equal(f.writes.length, writes);
    if (!listed) assert.equal(f.values.has('tsumu-sites-v1'), false);
  } finally { f.dispose(); }
});

test('unchanged cached content does not bypass the deletion marker or erase a recoverable snapshot', () => {
  const f = fixture();
  try {
    const doc = f.useEditor.getState().doc;
    f.persistDoc(doc);
    // Marker committed, but Home cleanup did not finish.
    f.deleteLocalSite('autosave-test');
    const before = [...f.values]; const writes = f.writes.length;
    assert.equal(f.persistDoc(doc), 'deleted');
    assert.deepEqual([...f.values], before);
    assert.equal(f.writes.length, writes);
  } finally { f.dispose(); }
});

for (const failure of ['marker-read', 'doc-read', 'quota', 'post-write-marker-read']) test(`${failure} never reports a successful local save`, () => {
  const f = fixture();
  try {
    const doc = f.useEditor.getState().doc;
    f.persistDoc(doc);
    const cached = f.values.get(f.key);
    const read = f.storage.getItem;
    let written = false;
    const write = f.storage.setItem;
    mock.method(f.storage, 'getItem', (key: string) => {
      if ((failure === 'marker-read' || (failure === 'post-write-marker-read' && written)) && key.endsWith('site-deleted-v1:autosave-test')) throw new Error('blocked marker');
      if (failure === 'doc-read' && key === f.key) throw new Error('blocked doc');
      return read(key);
    });
    mock.method(f.storage, 'setItem', (key: string, value: string) => {
      if (key === f.key) {
        if (failure === 'quota') throw new DOMException('Full', 'QuotaExceededError');
        written = true;
      }
      write(key, value);
    });
    assert.equal(f.persistDoc({ ...doc, siteName: 'Unsaved draft' }), 'error');
    if (failure !== 'post-write-marker-read') assert.equal(f.values.get(f.key), cached);
    assert.equal(f.useEditor.getState().doc, doc);
  } finally { f.dispose(); }
});

for (const unchanged of [true, false]) test(`deletion during the ${unchanged ? 'unchanged' : 'changed'} document read stops persistence`, () => {
  const f = fixture();
  try {
    const doc = f.useEditor.getState().doc;
    f.persistDoc(doc);
    const read = f.storage.getItem;
    let pending = true;
    mock.method(f.storage, 'getItem', (key: string) => {
      const value = read(key);
      if (pending && key === f.key) { pending = false; f.remove(); }
      return value;
    });
    assert.equal(f.persistDoc(unchanged ? doc : { ...doc, siteName: 'Late edit' }), 'deleted');
    assert.equal(f.values.has(f.key), false);
  } finally { f.dispose(); }
});

test('a deletion overlapping setItem returns deleted, without claiming atomicity or destroying the remaining bytes', () => {
  const f = fixture();
  try {
    const doc = f.useEditor.getState().doc;
    const write = f.storage.setItem;
    mock.method(f.storage, 'setItem', (key: string, value: string) => {
      if (key === f.key) f.remove();
      write(key, value);
    });
    assert.equal(f.persistDoc(doc), 'deleted');
    assert.equal(f.isLocalSiteDeleted(), true);
    assert.deepEqual(f.loadLocalSites(), []);
    assert.equal(f.values.get(f.key), JSON.stringify(doc), 'the racing cache is not a recoverable listed site; do not delete its bytes');
    const writes = f.writes.length;
    assert.equal(f.persistDoc(doc), 'deleted');
    assert.equal(f.writes.length, writes);
  } finally { f.dispose(); }
});

test('stale editing, Undo, Redo, restore, copy and generated ZIP input keep the in-memory document and history', () => {
  const f = fixture();
  try {
    const original = f.useEditor.getState().doc;
    f.remove();
    f.useEditor.getState().updateDoc((doc: any) => { doc.siteName = 'Recovered draft'; });
    const edited = f.useEditor.getState().doc;
    assert.equal(f.persistDoc(edited), 'deleted');
    assert.equal(f.useEditor.getState().past.at(-1), original);
    f.useEditor.getState().undo();
    assert.equal(f.useEditor.getState().doc, original);
    assert.equal(f.persistDoc(f.useEditor.getState().doc), 'deleted');
    f.useEditor.getState().redo();
    assert.equal(f.useEditor.getState().doc, edited);
    assert.equal(f.persistDoc(edited), 'deleted');
    const restored = { ...edited, siteName: 'Restored draft' };
    f.useEditor.getState().restoreDoc(restored);
    assert.equal(f.persistDoc(restored), 'deleted');
    assert.equal(f.useEditor.getState().past.at(-1), edited);
    const node = Object.keys(restored.nodes)[0];
    f.useEditor.getState().copyNode(node);
    assert.equal(f.useEditor.getState().clipboard.nodes.some((n: any) => n.id === node), true);
    const before = JSON.stringify(f.useEditor.getState().doc);
    const output = f.generateProject(f.useEditor.getState().doc);
    assert.ok(output.files['package.json']);
    assert.ok(Object.keys(output.files).some(path => path.endsWith('page.tsx')));
    assert.equal(JSON.stringify(f.useEditor.getState().doc), before);
    assert.equal(f.values.has(f.key), false);
    assert.equal(f.isLocalSiteDeleted(), true);
  } finally { f.dispose(); }
});

for (const trigger of ['storage', 'focus', 'visibilitychange']) test(`${trigger} invalidates a previously saved result without another edit and detaches cleanly`, () => {
  const f = fixture();
  let stop = () => {};
  try {
    const doc = f.useEditor.getState().doc;
    let saved = { doc, result: f.persistDoc(doc) };
    let notifications = 0;
    stop = f.watchLocalSaveBlock((result: string) => { notifications++; saved = { doc, result }; });
    assert.equal(f.localSaveState(saved, doc), 'saved');
    f.remove();
    const emit = () => {
      if (trigger === 'storage') window.dispatchEvent(Object.assign(new Event('storage'), { key: 'tsumu-site-deleted-v1:autosave-test', storageArea: f.storage }));
      else if (trigger === 'focus') window.dispatchEvent(new Event('focus'));
      else document.dispatchEvent(new Event('visibilitychange'));
    };
    emit();
    assert.equal(f.localSaveState(saved, doc), 'deleted');
    assert.equal(f.localSaveState(saved, { ...doc, siteName: 'Another edit' }), 'deleted');
    assert.equal(f.useEditor.getState().doc, doc);
    assert.equal(notifications, 1);
    stop(); emit(); assert.equal(notifications, 1);
  } finally { stop(); f.dispose(); }
});

test('availability checks fail closed and ignore another site or session storage', () => {
  const f = fixture(); let stop = () => {};
  try {
    const reasons: string[] = [];
    stop = f.watchLocalSaveBlock((result: string) => reasons.push(result));
    const read = f.storage.getItem;
    mock.method(f.storage, 'getItem', (key: string) => {
      if (key.includes('site-deleted-v1')) throw new Error('Cannot read marker');
      return read(key);
    });
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'tsumu-site-deleted-v1:other', storageArea: f.storage }));
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'tsumu-site-deleted-v1:autosave-test', storageArea: {} }));
    assert.deepEqual(reasons, []);
    window.dispatchEvent(Object.assign(new Event('storage'), { key: null, storageArea: f.storage }));
    assert.deepEqual(reasons, ['error']);
  } finally { stop(); f.dispose(); }
});

test('only a deleted browser copy without server acknowledgement adds an unload warning', () => {
  const f = fixture();
  try {
    for (const state of ['pending', 'saved', 'error']) for (const cloud of ['local', 'error', 'checking', 'synced']) {
      assert.equal(f.warnForDeletedLocalSave(state, cloud), false);
    }
    f.remove();
    // Recheck the marker even before the storage event has arrived.
    assert.equal(f.warnForDeletedLocalSave('saved', 'local'), true);
    assert.equal(f.warnForDeletedLocalSave('deleted', 'error'), true);
    assert.equal(f.warnForDeletedLocalSave('deleted', 'synced'), false);
    assert.equal(f.warnForDeletedLocalSave('saved', 'synced'), false);
  } finally { f.dispose(); }
});

test('an authoritative server save is not blocked by a deleted browser copy', async () => {
  const f = fixture();
  try {
    f.remove();
    const requests: any[] = [];
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, init }); return Response.json({ rev: '2', savedAt: 10 });
    });
    const result = await f.sendCloudDoc({ collabSocket: { current: null }, clientId: 'test', savedAt: () => null }, f.useEditor.getState().doc, '1');
    assert.equal(result.ok, true); assert.equal(requests.length, 1);
    assert.equal(requests[0].init.method, 'PUT');
    assert.ok(requests[0].url.includes('site=autosave-test'));
    assert.equal(f.isLocalSiteDeleted(), true);
    assert.equal(f.values.has(f.key), false);
  } finally { f.dispose(); }
});

test("a stale browser tab cannot overwrite a newer tab's document", () => {
  const f = fixture();
  try {
    const original = f.useEditor.getState().doc;
    assert.equal(f.persistDoc(original), "saved");
    const remote = { ...original, siteName: "Remote tab change" };
    f.storage.setItem(f.key, JSON.stringify(remote));
    const local = { ...original, siteName: "Local unsaved edit" };
    assert.equal(f.persistDoc(local), "error");
    assert.deepEqual(JSON.parse(f.storage.getItem(f.key)!), remote);
    assert.equal(f.useEditor.getState().doc, original, "an unsafe save does not discard in-memory work");
  } finally { f.dispose(); }
});

for (const [label, malformed] of [
  ["unparseable", "{not-json"],
  ["invalid structure", JSON.stringify({ pages: {}, pageOrder: ["lost"], nodes: {}, assets: {} })],
] as const) {
  test(`${label} browser JSON is preserved instead of being overwritten`, () => {
    const f = fixture(malformed);
    try {
      const fresh = f.useEditor.getState().doc;
      assert.ok(fresh.pageOrder.length);
      assert.equal(f.persistDoc(fresh), "error");
      assert.equal(f.storage.getItem(f.key), malformed);
    } finally { f.dispose(); }
  });
}
