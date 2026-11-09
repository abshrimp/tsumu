import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Db } from "./db";
import type { DocPatch } from "./doc-patch";
import {
  readCurrentDoc as readLocalDocument,
  saveCurrentDoc as saveLocalDocument,
  saveDocPatch as patchLocalDocument,
  type CurrentDoc, type SaveDocResult,
} from "./doc-storage";

/**
 * Cloudflare uses the site-specific DocumentRoom's SQLite. Node/Docker use
 * their native SQLite document store. No old D1 snapshot migration is attempted.
 */
interface DocumentStub {
  getSnapshot(): Promise<CurrentDoc | null>;
  getMetadata(): Promise<{ rev: string; savedAt: number } | null>;
  replaceDocument(raw: string, base: string | null): Promise<SaveDocResult>;
  patchDocument(patch: DocPatch, base: string): Promise<SaveDocResult>;
  listAssetReferences(): Promise<Array<{ path: string; bytes: number | null }>>;
  eraseDocument(): Promise<void>;
}
interface DocumentNamespace {
  idFromName(siteId: string): unknown;
  get(id: unknown): DocumentStub;
}
function cloudNamespace(): DocumentNamespace | null {
  let env: Record<string, unknown>;
  try {
    env = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    // Running without Cloudflare (Node/Docker local SQLite).
    return null;
  }
  if (env.DB && !env.DOC_STORE) {
    throw new Error("DOC_STORE binding is required for Cloudflare persistence");
  }
  return (env.DOC_STORE as DocumentNamespace | undefined) ?? null;
}

function room(siteId: string): DocumentStub | null {
  const namespace = cloudNamespace();
  return namespace ? namespace.get(namespace.idFromName(siteId)) : null;
}

export function usesDocumentRooms(): boolean {
  return cloudNamespace() !== null;
}

export async function readSiteDocument(db: Db, siteId: string): Promise<CurrentDoc | null> {
  const stub = room(siteId);
  return stub ? stub.getSnapshot() : readLocalDocument(db, siteId);
}

export async function readSiteDocumentMeta(
  db: Db, siteId: string,
): Promise<{ rev: string; savedAt: number } | null> {
  const stub = room(siteId);
  if (stub) return stub.getMetadata();
  const rs = await db.execute({ sql: "SELECT rev,saved_at FROM docs WHERE id=?", args: [siteId] });
  const row = rs.rows[0];
  return row ? { rev: String(row.rev), savedAt: Number(row.saved_at) } : null;
}

async function markEdited(db: Db, siteId: string, result: SaveDocResult): Promise<void> {
  if (result.kind !== "saved") return;
  // Display ordering is metadata only: never turn a persisted document into
  // an apparent save failure when this cross-store timestamp update fails.
  await db.execute({
    sql: "UPDATE sites SET updated_at = ? WHERE id = ?",
    args: [result.savedAt, siteId],
  }).catch(() => undefined);
}

export async function saveSiteDocument(
  db: Db, siteId: string, raw: string, base: string | null,
): Promise<SaveDocResult> {
  const stub = room(siteId);
  const result = stub ? await stub.replaceDocument(raw, base) : await saveLocalDocument(db, siteId, raw, base);
  await markEdited(db, siteId, result);
  return result;
}

export async function patchSiteDocument(
  db: Db, siteId: string, patch: DocPatch, base: string,
): Promise<SaveDocResult> {
  const stub = room(siteId);
  const result = stub ? await stub.patchDocument(patch, base) : await patchLocalDocument(db, siteId, patch, base);
  await markEdited(db, siteId, result);
  return result;
}

export async function eraseSiteDocument(siteId: string): Promise<void> {
  await room(siteId)?.eraseDocument();
}

export async function documentAssetReferences(
  db: Db, siteId: string,
): Promise<Array<{ path: string; bytes: number | null }>> {
  const stub = room(siteId);
  if (stub) return stub.listAssetReferences();
  const rs = await db.execute({
    sql: "SELECT json_extract(a.value, '$.path') AS path, json_extract(a.value, '$.bytes') AS bytes FROM docs d, json_each(d.body, '$.assets') a WHERE d.id=?",
    args: [siteId],
  });
  return rs.rows.filter(row => typeof row.path === "string").map(row => ({
    path: String(row.path), bytes: row.bytes == null ? null : Number(row.bytes),
  }));
}
