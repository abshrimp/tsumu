import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createInitialDoc } from '../lib/presets';
import { validSiteDoc } from '../lib/doc-tree';
import {
  readD1Export, sqlLiteral, buildRoomMappingSql, parseWranglerRows,
  sameJson, verifySourceRows,
} from '../scripts/d1-do-migration-core.mjs';

function sqlDoc({ body = JSON.stringify(createInitialDoc()), site = 'current', rev = 42 } = {}) {
  return `CREATE TABLE sites(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE docs(id TEXT PRIMARY KEY,rev INTEGER NOT NULL,saved_at INTEGER NOT NULL,body TEXT NOT NULL);
    INSERT INTO sites(id,name,created_at) VALUES(${sqlLiteral(site)},'Site',1234);
    INSERT INTO docs(id,rev,saved_at,body) VALUES(${sqlLiteral(site)},${rev},5678,${sqlLiteral(body)});`;
}

test('preparing a D1 export parses embedded SQL quotes, Japanese and line breaks losslessly', () => {
  const original = createInitialDoc();
  original.siteName = "Quotes '; -- 日本語\n文字列";
  const data = readD1Export(sqlDoc({ body: JSON.stringify(original) }), validSiteDoc);
  assert.deepEqual(data.sites, [{ id: 'current', name: 'Site', createdAt: 1234 }]);
  assert.equal(data.documents.get('current')!.rev, 42);
  assert.equal(data.documents.get('current')!.savedAt, 5678);
  assert.deepEqual(JSON.parse(data.documents.get('current')!.normalized), original);
});

test('invalid documents are refused until explicitly converted outside the application', () => {
  const legacy = sqlDoc({ body: JSON.stringify({ somePreviousFormat: true }) });
  assert.throws(() => readD1Export(legacy, validSiteDoc), /not a valid current SiteDoc/);
  const transformed = createInitialDoc();
  const result = readD1Export(legacy, validSiteDoc, {
    overrides: new Map([['current', transformed]]),
  });
  assert.equal(result.documents.get('current')!.overridden, true);
  assert.deepEqual(JSON.parse(result.documents.get('current')!.normalized), transformed);
});

test('orphan documents and invalid site IDs fail before any remote write', () => {
  assert.throws(() => readD1Export(sqlDoc({ site: '../x' }), validSiteDoc), /Invalid site ID/);
  const original = sqlDoc();
  assert.throws(() => readD1Export(original.replace(
    "VALUES('current',42,5678,", "VALUES('missing',42,5678,"), validSiteDoc), /no corresponding site/);
});

test('generation mapping is idempotent and rejects a deleted/recreated site', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec("CREATE TABLE sites(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);");
    sqlite.exec("CREATE TABLE site_document_rooms(site_id TEXT PRIMARY KEY,room_key TEXT NOT NULL UNIQUE);");
    sqlite.exec("INSERT INTO sites VALUES('current',1234)");
    const site = { id: 'current', createdAt: 1234 };
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    sqlite.exec(buildRoomMappingSql(site, first));
    sqlite.exec(buildRoomMappingSql(site, second));
    assert.equal(sqlite.prepare("SELECT room_key FROM site_document_rooms WHERE site_id='current'").get()!.room_key, first);
    sqlite.exec("DELETE FROM site_document_rooms; UPDATE sites SET created_at=9999 WHERE id='current'");
    sqlite.exec(buildRoomMappingSql(site, second));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM site_document_rooms').get()!.count, 0);
  } finally { sqlite.close(); }
});

test('Wrangler JSON response handling and source revision fences reject drift', () => {
  assert.deepEqual(parseWranglerRows('[{"results":[{"id":"current"}],"success":true}]'), [{ id: 'current' }]);
  assert.deepEqual(parseWranglerRows('{"results":[],"success":true}'), []);
  assert.throws(() => parseWranglerRows('[{"success":false,"results":[]}]'), /failed/);
  const sites = [{ id: 'current', createdAt: 1234 }];
  const docs = [{ id: 'current', rev: 42, savedAt: 5678 }];
  assert.equal(verifySourceRows(sites, docs, [{ id: 'current', created_at: 1234 }],
    [{ id: 'current', rev: 42, saved_at: 5678 }]), true);
  assert.throws(() => verifySourceRows(sites, docs, [{ id: 'current', created_at: 1234 }],
    [{ id: 'current', rev: 43, saved_at: 5678 }]), /changed after export/);
  assert.throws(() => verifySourceRows(sites, [], [{ id: 'current', created_at: 1234 }],
    [{ id: 'current', rev: 1, saved_at: 5678 }]), /appeared after export/);
  assert.ok(sameJson({ a: 1, b: [2] }, { b: [2], a: 1 }));
  assert.equal(sameJson({ a: 1 }, { a: 2 }), false);
});

test('prepare CLI writes immutable private exports and normalized documents without contacting D1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsumu-do-export-test-'));
  try {
    const input = join(dir, 'sample.sql');
    const output = join(dir, 'private-export');
    const doc = createInitialDoc();
    writeFileSync(input, sqlDoc({ body: JSON.stringify(doc) }));
    const result = spawnSync(process.execPath,
      ['--import', 'tsx', 'scripts/migrate-d1-to-do.mjs', 'prepare',
        '--database', 'tsumu', '--config', 'wrangler.local.jsonc',
        '--out', output, '--input-sql', input],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 40_000 });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.documentCount, 1);
    assert.equal(manifest.sites[0].document.rev, 42);
    assert.equal(manifest.sites[0].document.overridden, false);
    assert.deepEqual(JSON.parse(readFileSync(join(output, 'converted', 'current.json'), 'utf8')), doc);
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(output, 'manifest.json')).mode & 0o077, 0);
      assert.equal(statSync(join(output, 'd1-sites-and-docs.sql')).mode & 0o077, 0);
    }
    const retry = spawnSync(process.execPath,
      ['--import', 'tsx', 'scripts/migrate-d1-to-do.mjs', 'prepare',
        '--database', 'tsumu', '--config', 'wrangler.local.jsonc',
        '--out', output, '--input-sql', input],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 40_000 });
    assert.notEqual(retry.status, 0, 'must not overwrite an existing local D1 backup');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migration rejects a node too large for a single DO SQLite row', () => {
  const doc = createInitialDoc();
  const node = Object.values(doc.nodes).find(n => n.text !== undefined && n.text !== null)!;
  node.text!.content = 'x'.repeat(7_000_100);
  assert.equal(validSiteDoc(doc), true);
  assert.throws(() => readD1Export(sqlDoc({ body: JSON.stringify(doc) }), validSiteDoc),
    /exceeds the DO 7 MB row safety limit/);
});
