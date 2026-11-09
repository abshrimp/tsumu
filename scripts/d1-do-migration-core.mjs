/**
 * One-time D1 docs -> DocumentRoom preparation helpers.
 * This module is a CLI dependency, never imported by the deployed editor.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const SITE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_SAFE_DOC_BYTES = 64 * 1024 * 1024;
export const MAX_DO_ROW_BYTES = 7_000_000;

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function safeTime(value, name) {
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < 0) throw new Error(`Invalid ${name} in D1 export`);
  return num;
}

/**
 * Feed the SQL dump to an in-memory SQLite database. Never parse SQLite
 * INSERT statements by splitting semicolons or unescaping quotes yourself.
 * No production database is opened or mutated by this function.
 */
export function readD1Export(sql, validateDoc, { overrides = new Map() } = {}) {
  if (typeof sql !== 'string' || !sql.includes('CREATE TABLE')) {
    throw new Error('Expected a Wrangler D1 .sql export containing tables');
  }
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all().map(row => row.name));
    if (!tables.has('docs') || !tables.has('sites')) {
      throw new Error('The export must contain both docs and sites tables');
    }
    const sites = db.prepare('SELECT id, name, created_at FROM sites ORDER BY id').all().map(row => {
      const id = String(row.id);
      if (!SITE_ID.test(id)) throw new Error(`Invalid site ID in export: ${JSON.stringify(id)}`);
      return { id, name: String(row.name), createdAt: safeTime(row.created_at, 'created_at') };
    });
    const ids = new Set(sites.map(site => site.id));
    const documents = new Map();
    for (const row of db.prepare('SELECT id, rev, saved_at, body FROM docs ORDER BY id').all()) {
      const id = String(row.id);
      if (!ids.has(id)) throw new Error(`Document ${id} has no corresponding site row`);
      if (typeof row.body !== 'string') throw new Error(`Document ${id} is not UTF-8 JSON text`);
      if (Buffer.byteLength(row.body, 'utf8') > MAX_SAFE_DOC_BYTES) {
        throw new Error(`Document ${id} is larger than the 64 MiB migration limit`);
      }
      const overridden = overrides.has(id);
      let data;
      if (overridden) {
        data = overrides.get(id);
      } else {
        try { data = JSON.parse(row.body); }
        catch { throw new Error(`Document ${id} contains invalid JSON`); }
      }
      if (!validateDoc(data)) {
        throw new Error(`Document ${id} is not a valid current SiteDoc. Use an explicit --override-doc site=converted.json.`);
      }
      // DocumentRoom stores each collection entry in one SQLite row (<= 8 MB).
      // Reject oversized entries before mapping any D1 site to a new room.
      const { pages, nodes, assets, components, ...props } = data;
      for (const [bucket, section] of Object.entries({ pages, nodes, assets, components: components ?? {} })) {
        for (const [entryId, value] of Object.entries(section)) {
          if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_DO_ROW_BYTES) {
            throw new Error(`Document ${id}: ${bucket}/${entryId} exceeds the DO 7 MB row safety limit`);
          }
        }
      }
      if (Buffer.byteLength(JSON.stringify(props), 'utf8') > MAX_DO_ROW_BYTES) {
        throw new Error(`Document ${id}: top-level settings exceed the DO 7 MB row safety limit`);
      }
      const normalized = JSON.stringify(data);
      if (Buffer.byteLength(normalized, 'utf8') > MAX_SAFE_DOC_BYTES) {
        throw new Error(`Document ${id} is larger than the 64 MiB upload safety limit`);
      }
      const rev = safeTime(row.rev, 'rev');
      if (!rev) throw new Error(`Document ${id} has invalid revision`);
      const savedAt = safeTime(row.saved_at, 'saved_at');
      documents.set(id, {
        id, rev, savedAt, overridden, normalized, sha256: sha256(normalized),
        bytes: Buffer.byteLength(normalized, 'utf8'),
        pages: Object.keys(data.pages).length, nodes: Object.keys(data.nodes).length,
        assets: Object.keys(data.assets).length,
      });
    }
    return { sites, documents };
  } finally {
    db.close();
  }
}

export function sqlLiteral(value) {
  if (typeof value !== 'string') throw new Error('SQL literal must be a string');
  return "'" + value.replace(/'/g, "''") + "'";
}

/** Generated room key is random; insertion is fenced to the exported site creation. */
export function buildRoomMappingSql(site, roomKey) {
  if (!SITE_ID.test(site.id) || !/^[0-9a-f-]{36}$/i.test(roomKey)) {
    throw new Error('Unsafe site or room key');
  }
  const created = safeTime(site.createdAt, 'createdAt');
  return `INSERT INTO site_document_rooms(site_id, room_key)\n` +
    `SELECT id, ${sqlLiteral(roomKey)} FROM sites\n` +
    `WHERE id=${sqlLiteral(site.id)} AND created_at=${created}\n` +
    `AND NOT EXISTS(SELECT 1 FROM site_document_rooms WHERE site_id=${sqlLiteral(site.id)});`;
}

export function parseWranglerRows(output) {
  let data;
  try { data = JSON.parse(output); }
  catch { throw new Error('Wrangler did not return JSON. Check --json and your Wrangler version.'); }
  const payloads = Array.isArray(data) ? data : [data];
  if (!payloads.length) throw new Error('Empty Wrangler result');
  const rows = [];
  for (const item of payloads) {
    if (!item || typeof item !== 'object' || item.success === false) {
      throw new Error('D1 command failed');
    }
    const result = Array.isArray(item.results) ? item.results : item.result?.results;
    if (!Array.isArray(result)) throw new Error('Unexpected Wrangler D1 result shape');
    rows.push(...result);
  }
  return rows;
}

export function sameJson(left, right) {
  return isDeepStrictEqual(left, right);
}

export function verifySourceRows(expectedSites, expectedDocs, remoteSites, remoteDocs) {
  const bySite = new Map(remoteSites.map(site => [String(site.id), site]));
  const byDoc = new Map(remoteDocs.map(doc => [String(doc.id), doc]));
  for (const site of expectedSites) {
    const got = bySite.get(site.id);
    if (!got || Number(got.created_at) !== site.createdAt) {
      throw new Error(`Site ${site.id} differs from the saved D1 export. Stop all edits and re-export.`);
    }
  }
  for (const site of expectedSites) {
    if (!expectedDocs.some(doc => doc.id === site.id) && byDoc.has(site.id)) {
      throw new Error(`D1 document ${site.id} appeared after export. Re-export before continuing.`);
    }
  }
  for (const doc of expectedDocs) {
    const got = byDoc.get(doc.id);
    if (!got || Number(got.rev) !== doc.rev || Number(got.saved_at) !== doc.savedAt) {
      throw new Error(`D1 document ${doc.id} changed after export. Re-export before continuing.`);
    }
  }
  return true;
}
