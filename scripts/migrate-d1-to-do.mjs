#!/usr/bin/env node
/**
 * One-time migration of Cloudflare D1 docs.body to DocumentRoom SQLite.
 * Does not modify the deployed application's routes or add admin endpoints.
 * Commands: prepare (read-only D1 export), apply (explicit, resumable upload).
 * Run using: node --import tsx scripts/migrate-d1-to-do.mjs ...
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync,
  readFileSync, renameSync, statSync, writeFileSync, constants,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validSiteDoc } from '../lib/doc-tree.ts';
import {
  SITE_ID, readD1Export, sha256, sqlLiteral, buildRoomMappingSql,
  parseWranglerRows, sameJson, verifySourceRows,
} from './d1-do-migration-core.mjs';

const EXPORT_FILE = 'd1-sites-and-docs.sql';
const MANIFEST_FILE = 'manifest.json';

function usage() {
  return `Usage:
  node --import tsx scripts/migrate-d1-to-do.mjs prepare \\
    --database tsumu --config wrangler.local.jsonc --out ./private-d1-export \\
    [--site current] [--input-sql ./previous-export.sql] \
    [--override-doc current=./converted-current.json]

  node --import tsx scripts/migrate-d1-to-do.mjs apply \\
    --database tsumu --config wrangler.local.jsonc --dir ./private-d1-export \\
    --base-url https://YOUR-EDITOR-HOST --cookie-file ./session-cookie.txt

prepare only reads D1, writes local private backup and validates current SiteDoc JSON.
apply writes new room-key mappings to D1 and uploads documents using the EXISTING
authenticated /api/doc endpoint; it never overwrites a non-empty DocumentRoom.
Stop all editing, use a protected cookie file (chmod 600), and deploy PR #39 first.
`;
}

function options(args) {
  const allowed = new Set(['database', 'config', 'out', 'dir', 'base-url', 'cookie-file', 'input-sql', 'site', 'override-doc']);
  const out = { sites: [], overrides: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--') || !allowed.has(arg.slice(2))) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    const value = args[++i];
    const key = arg.slice(2);
    if (key === 'site') {
      if (!SITE_ID.test(value)) throw new Error(`Invalid --site: ${value}`);
      out.sites.push(value);
    } else if (key === 'override-doc') {
      const offset = value.indexOf('=');
      const id = value.slice(0, offset), file = value.slice(offset + 1);
      if (offset < 1 || !SITE_ID.test(id) || !file) throw new Error(`Expected --override-doc site=path`);
      out.overrides.push({ id, file });
    } else {
      if (Object.hasOwn(out, key)) throw new Error(`Duplicate option ${arg}`);
      out[key] = value;
    }
  }
  return out;
}

function required(opts, name) {
  if (!opts[name]) throw new Error(`Missing --${name}\n${usage()}`);
  return opts[name];
}

function wrangler(db, config, commandArgs) {
  const [action, ...flags] = commandArgs;
  const args = ['--no-install', 'wrangler', 'd1', action, db, '--config', resolve(config), '--remote', ...flags];
  const result = spawnSync('npx', args, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60_000,
    // All children create files readable only by this OS user.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Wrangler D1 command failed (${commandArgs[0]}, exit=${result.status ?? 'error'}). Verify Cloudflare login, --config and remote database.`);
  }
  return result.stdout;
}

function remoteQuery(database, config, sql) {
  const args = ['execute', '--json', '--command', sql, '--yes'];
  return parseWranglerRows(wrangler(database, config, args));
}

function privateDir(path, create) {
  const full = resolve(path);
  if (create) {
    if (existsSync(full)) throw new Error(`Output directory already exists: ${full}`);
    mkdirSync(full, { recursive: true, mode: 0o700 });
  }
  if (!lstatSync(full).isDirectory()) throw new Error('Not a directory');
  chmodSync(full, 0o700);
  return full;
}

function privateWrite(path, content, { replace = false } = {}) {
  const full = resolve(path);
  if (!replace) {
    writeFileSync(full, content, { flag: 'wx', mode: 0o600 });
  } else {
    const tmp = join(dirname(full), `.write-${randomUUID()}`);
    writeFileSync(tmp, content, { flag: 'wx', mode: 0o600 });
    renameSync(tmp, full);
  }
  chmodSync(full, 0o600);
}

function jsonFile(path) { return JSON.parse(readFileSync(path, 'utf8')); }

function prepare(opts) {
  const database = required(opts, 'database');
  const config = resolve(required(opts, 'config'));
  const dir = privateDir(required(opts, 'out'), true);
  mkdirSync(join(dir, 'converted'), { mode: 0o700 });
  const sqlPath = join(dir, EXPORT_FILE);
  if (opts['input-sql']) {
    copyFileSync(resolve(opts['input-sql']), sqlPath, constants.COPYFILE_EXCL);
  } else {
    // Export CURRENT docs and sites, not history, auth data or file bytes.
    wrangler(database, config, ['export', '--table', 'docs', '--table', 'sites',
      '--output', sqlPath, '--skip-confirmation']);
  }
  chmodSync(sqlPath, 0o600);
  const sql = readFileSync(sqlPath, 'utf8');
  const overrides = new Map();
  for (const override of opts.overrides) {
    if (overrides.has(override.id)) throw new Error(`Duplicate override for ${override.id}`);
    overrides.set(override.id, jsonFile(resolve(override.file)));
  }
  const { sites, documents } = readD1Export(sql, validSiteDoc, { overrides });
  const selected = opts.sites.length ? sites.filter(site => opts.sites.includes(site.id)) : sites;
  if (selected.length !== new Set(opts.sites).size && opts.sites.length) {
    throw new Error('At least one --site is missing from the D1 export');
  }
  if (!selected.length) throw new Error('No sites were found');
  const entries = selected.map(site => {
    const doc = documents.get(site.id);
    if (doc) privateWrite(join(dir, 'converted', `${site.id}.json`), doc.normalized);
    return {
      ...site,
      document: doc ? {
        rev: doc.rev, savedAt: doc.savedAt, sha256: doc.sha256,
        overridden: doc.overridden,
        bytes: doc.bytes, pages: doc.pages, nodes: doc.nodes, assets: doc.assets,
      } : null,
    };
  });
  const plan = {
    format: 'tsumu-d1-to-do-v1',
    createdAt: new Date().toISOString(), database,
    exportSha256: sha256(sql),
    siteCount: entries.length,
    documentCount: entries.filter(e => e.document).length,
    sites: entries,
  };
  privateWrite(join(dir, MANIFEST_FILE), JSON.stringify(plan, null, 2) + '\n');
  console.log(`Prepared ${plan.siteCount} site(s), ${plan.documentCount} document(s).`);
  console.log(`Local backup: ${sqlPath}`);
  console.log(`Review ${join(dir, MANIFEST_FILE)} before running apply.`);
}

function readPlan(dir, dbName) {
  const plan = jsonFile(join(dir, MANIFEST_FILE));
  if (plan.format !== 'tsumu-d1-to-do-v1' || plan.database !== dbName || !Array.isArray(plan.sites)) {
    throw new Error('Invalid migration manifest or database mismatch');
  }
  const sql = readFileSync(join(dir, EXPORT_FILE), 'utf8');
  if (sha256(sql) !== plan.exportSha256) throw new Error('The exported D1 SQL was modified');
  // Re-check both the source SQL and every converted SiteDoc before applying.
  const overrides = new Map();
  for (const site of plan.sites) {
    if (site.document?.overridden) {
      overrides.set(site.id, jsonFile(join(dir, 'converted', `${site.id}.json`)));
    }
  }
  const { sites, documents } = readD1Export(sql, validSiteDoc, { overrides });
  for (const site of plan.sites) {
    const original = sites.find(x => x.id === site.id);
    if (!original || original.createdAt !== site.createdAt) {
      throw new Error(`Site ${site.id} metadata does not match the SQL export`);
    }
    const doc = documents.get(site.id);
    if (!site.document && doc) throw new Error(`Manifest for ${site.id} is missing a document`);
    if (site.document) {
      if (!doc || doc.sha256 !== site.document.sha256 || doc.rev !== site.document.rev ||
          doc.overridden !== site.document.overridden) {
        throw new Error(`Document ${site.id} differs from its manifest`);
      }
      const converted = readFileSync(join(dir, 'converted', `${site.id}.json`), 'utf8');
      if (sha256(converted) !== doc.sha256) throw new Error(`Converted ${site.id}.json was modified`);
    }
  }
  return plan;
}

function cookieFromFile(file) {
  const st = statSync(file);
  if (!st.isFile() || (process.platform !== 'win32' && (st.mode & 0o077) !== 0)) {
    throw new Error('Cookie file must be a regular private file (chmod 600)');
  }
  const raw = readFileSync(file, 'utf8').trim().replace(/^Cookie:\s*/i, '');
  if (!raw || /[\r\n\x00-\x1f\x7f]/.test(raw) || !/=/.test(raw)) {
    throw new Error('Cookie file must contain one valid Cookie header line');
  }
  return raw;
}

function targetUrl(address) {
  const url = new URL(address);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Use an origin URL only, without path, credentials or query');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('HTTPS is required to protect the session cookie');
  }
  return url.origin;
}

async function api(origin, cookie, path, init = {}) {
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error('Cross-origin request blocked');
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: { Cookie: cookie, Origin: origin,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    redirect: 'manual', signal: AbortSignal.timeout(120_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`HTTP ${response.status} redirect, likely expired login; re-authenticate`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} at ${url.pathname}. Check authentication and target deployment.`);
  }
  const data = await response.json().catch(() => { throw new Error(`Expected JSON from ${url.pathname}`); });
  if (!data || typeof data !== 'object') throw new Error(`Unexpected response from ${url.pathname}`);
  return data;
}

async function checkLiveSource(plan, db, config) {
  const expectedDocs = plan.sites.filter(site => site.document).map(site => ({
    id: site.id, rev: site.document.rev, savedAt: site.document.savedAt,
  }));
  const sites = remoteQuery(db, config, 'SELECT id,created_at FROM sites ORDER BY id');
  const docs = remoteQuery(db, config, 'SELECT id,rev,saved_at FROM docs ORDER BY id');
  verifySourceRows(plan.sites, expectedDocs, sites, docs);
}

async function apply(opts) {
  const database = required(opts, 'database');
  const config = resolve(required(opts, 'config'));
  const dir = privateDir(required(opts, 'dir'), false);
  const origin = targetUrl(required(opts, 'base-url'));
  const cookie = cookieFromFile(resolve(required(opts, 'cookie-file')));
  const plan = readPlan(dir, database);
  console.log(`Checking source D1 and ${origin} before making changes...`);
  const server = await api(origin, cookie, '/api/sites');
  if (!Array.isArray(server.sites)) throw new Error('Target is not the expected Tsumu /api/sites endpoint');
  const hosted = new Map(server.sites.map(site => [site.id, site]));
  for (const site of plan.sites) {
    const found = hosted.get(site.id);
    if (!found || Number(found.createdAt) !== site.createdAt) {
      throw new Error(`Target API does not match the exported site ${site.id}`);
    }
  }
  await checkLiveSource(plan, database, config);
  // A missing site_document_rooms means the new Worker has not initialized.
  const mappingRows = remoteQuery(database, config,
    'SELECT site_id,room_key,saved_at FROM site_document_rooms');
  const mapping = new Map(mappingRows.map(row => [String(row.site_id), row]));
  // The former D1-backed application reports old docs.saved_at for sites with
  // documents. A deployed DocumentRoom app reports null until it saves to its
  // new generation map. Refuse to upload to the old application's /api/doc.
  for (const site of plan.sites) {
    if (!mapping.has(site.id) && site.document && hosted.get(site.id).savedAt != null) {
      throw new Error(`Target still appears to read legacy D1 docs for ${site.id}. Deploy the DocumentRoom version first.`);
    }
  }

  const progressFile = join(dir, 'progress.json');
  const prior = existsSync(progressFile) ? jsonFile(progressFile) : null;
  if (prior && (prior.exportSha256 !== plan.exportSha256 || prior.origin !== origin)) {
    throw new Error('This directory was already used with a different source or target');
  }
  const progress = prior ?? { format: 'tsumu-d1-to-do-progress-v1', origin,
    exportSha256: plan.exportSha256, sites: {} };
  privateWrite(progressFile, JSON.stringify(progress, null, 2) + '\n', { replace: !!prior });
  let uploaded = 0, identical = 0, empty = 0;
  for (const site of plan.sites) {
    // No live editor may advance the source docs after the export.
    await checkLiveSource({ sites: [site] }, database, config);
    const keyRows = remoteQuery(database, config,
      `SELECT room_key FROM site_document_rooms WHERE site_id=${sqlLiteral(site.id)}`);
    if (!keyRows.length) {
      const roomKey = randomUUID();
      remoteQuery(database, config, buildRoomMappingSql(site, roomKey));
      const confirm = remoteQuery(database, config,
        `SELECT room_key FROM site_document_rooms WHERE site_id=${sqlLiteral(site.id)}`);
      if (confirm.length !== 1 || typeof confirm[0].room_key !== 'string') {
        throw new Error(`Could not create a DocumentRoom mapping for site ${site.id}`);
      }
    }
    const path = `/api/doc?site=${encodeURIComponent(site.id)}`;
    const before = await api(origin, cookie, path);
    if (site.document && before.exists) {
      const currentMap = remoteQuery(database, config,
        `SELECT saved_at FROM site_document_rooms WHERE site_id=${sqlLiteral(site.id)}`);
      if (currentMap.length !== 1 || currentMap[0].saved_at == null || before.rev !== '1') {
        throw new Error(`Site ${site.id} has a document but no verified DO migration metadata; refusing overwrite.`);
      }
    }
    let status;
    if (!site.document) {
      if (before.exists) throw new Error(`Site ${site.id} has an unexpected target document; refusing overwrite`);
      empty++;
      status = 'empty';
    } else {
      const local = jsonFile(join(dir, 'converted', `${site.id}.json`));
      if (before.exists) {
        if (!sameJson(before.doc, local)) {
          throw new Error(`Site ${site.id} already has DIFFERENT DocumentRoom data. Nothing was overwritten.`);
        }
        identical++;
        status = 'identical';
      } else {
        const sent = await api(origin, cookie, path, { method: 'PUT', body: JSON.stringify(local) });
        if (sent.ok !== true || sent.rev !== '1') {
          throw new Error(`Site ${site.id} was not initialized at revision 1`);
        }
        uploaded++;
        status = 'uploaded';
      }
      const after = await api(origin, cookie, path);
      if (!after.exists || !sameJson(after.doc, local)) {
        throw new Error(`Read-back verification failed for site ${site.id}`);
      }
    }
    await checkLiveSource({ sites: [site] }, database, config);
    progress.sites[site.id] = { status, verifiedAt: new Date().toISOString() };
    privateWrite(progressFile, JSON.stringify(progress, null, 2) + '\n', { replace: true });
    console.log(`${site.id}: ${status} (verified)`);
  }
  console.log(`Migration verified: ${uploaded} uploaded, ${identical} identical, ${empty} empty.`);
  console.log('Original D1 docs and all non-document D1 tables were left untouched.');
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!['prepare', 'apply'].includes(command)) {
    throw new Error(usage());
  }
  const opts = options(rest);
  if (command === 'prepare') return prepare(opts);
  return apply(opts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Never print session cookies, document payloads or private SQL rows.
    console.error(`Migration stopped: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  });
}
