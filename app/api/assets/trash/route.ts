import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { assetStore } from "../../../../lib/kv";
import { permanentlyDeleteTrashedAsset } from "../../../../lib/asset-trash-delete";
import type { AssetGcDocumentNamespace } from "../../../../lib/asset-gc";
import { getDb, dbConfigured } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/server";
import { requireSiteAccess } from "../../../../lib/site-access";
import { allowedEmails } from "../../../../lib/allowlist";
import { sessionUser } from "../../../../lib/server";
import { authConfigured } from "../../../../lib/auth";
import { siteIdOf } from "../../../../lib/site-server";
import { assetUploadedAt } from "../../../../lib/asset-gc-plan";
import { serverTr, type Tr } from "../../../../lib/i18n-server";
import { userMessage } from "../../../../lib/errors";
import { jsonErrorStatus, readJsonLimited } from "../../../../lib/api-json";

// 本文は、サイトの ID とアセットのパス1件だけ。
const MAX_REQUEST_BYTES = 4 * 1024;

type TrashRequest = { site?: unknown; path: string };

/** 本文を上限付きで読み、アセットのパスの形まで確かめる。 */
async function readTrashRequest(req: Request, tr: Tr): Promise<TrashRequest | NextResponse> {
  let body: unknown;
  try {
    body = await readJsonLimited(req, MAX_REQUEST_BYTES);
  } catch (error) {
    return NextResponse.json({ error: tr("Invalid request (request body)") }, {
      status: jsonErrorStatus(error),
    });
  }
  const { site, path } = (body !== null && typeof body === "object" ? body : {}) as { site?: unknown; path?: unknown };
  if (typeof path !== "string" || assetUploadedAt(path) === null) {
    return NextResponse.json({ error: tr("Invalid path") }, { status: 400 });
  }
  return { site, path };
}

const trashUnavailable = (tr: Tr) => NextResponse.json({ error: tr("Trash is not available") }, { status: 503 });
const gcRunning = (tr: Tr) =>
  NextResponse.json({ error: tr("Garbage collection is running. Try again."), code: "asset_trash_busy" }, { status: 409 });
/** 画面は code で判定する（すでに消えたファイルの削除は、成功として扱う）。 */
const notInTrash = (tr: Tr) =>
  NextResponse.json({ error: tr("File is no longer in trash."), code: "asset_trash_missing" }, { status: 404 });

async function authorizeSite(value: unknown, tr: Tr, action: "view" | "edit") {
  const siteId = await siteIdOf(value);
  if (siteId instanceof NextResponse) return siteId;
  const deniedSite = await requireSiteAccess(siteId, action);
  if (deniedSite) return deniedSite;
  const db = await getDb();
  const site = await db.execute({ sql: "SELECT 1 FROM sites WHERE id=? LIMIT 1", args: [siteId] });
  return site.rows.length ? { db, siteId } : NextResponse.json({ error: tr("Site not found") }, { status: 404 });
}

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };
/** D1 以外の保存先では、ゴミ箱を使わない。この応答も、設定を変えた後まで残さない。 */
const trashDisabled = () => NextResponse.json({ items: [], enabled: false }, { headers: PRIVATE_NO_STORE });

/** Read the list of files awaiting the existing 7-day garbage collection. */
export async function GET(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return trashDisabled();
  const tr = await serverTr();
  try {
    const checked = await authorizeSite(new URL(req.url).searchParams.get("site"), tr, "view");
    if (checked instanceof NextResponse) return checked;
    if (checked.db.backend !== "d1") return trashDisabled();
    const offsetRaw = new URL(req.url).searchParams.get("offset") ?? "0";
    const offset = Number(offsetRaw);
    if (!/^\d+$/.test(offsetRaw) || !Number.isSafeInteger(offset) || offset > 1_000_000) {
      return NextResponse.json({ error: tr("Invalid parameters") }, { status: 400 });
    }
    const limit = 100;
    const email = (await sessionUser())?.email?.toLowerCase();
    const admin = !authConfigured() || (!!email && allowedEmails().includes(email));
    const result = await checked.db.execute({
      sql: `SELECT c.path,c.first_unreferenced_at AS deletedAt,
          COALESCE(c.bytes,o.bytes) AS bytes
       FROM asset_gc_candidates c LEFT JOIN asset_objects o ON o.path=c.path
       ${admin ? "" : "JOIN site_asset_uploads u ON u.path=c.path AND u.site_id=?"}
       ORDER BY c.first_unreferenced_at DESC LIMIT ? OFFSET ?`,
      args: admin ? [limit + 1, offset] : [checked.siteId, limit + 1, offset],
    });
    return NextResponse.json({
      enabled: true,
      hasMore: result.rows.length > limit,
      items: result.rows.slice(0, limit).map((row) => ({
        path: String(row.path),
        deletedAt: Number(row.deletedAt),
        bytes: row.bytes == null ? null : Number(row.bytes),
      })),
    }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: tr(userMessage(error, "Couldn't load")) }, { status: 502 });
  }
}

/** Restore a file by removing its GC candidate, without rewriting the KV object. */
export async function POST(req: Request) {
  const denied = await requireAuth("editor");
  if (denied) return denied;
  const tr = await serverTr();
  if (!dbConfigured()) return trashUnavailable(tr);
  const body = await readTrashRequest(req, tr);
  if (body instanceof NextResponse) return body;
  const { path } = body;
  try {
    const checked = await authorizeSite(body.site, tr, "edit");
    if (checked instanceof NextResponse) return checked;
    if (checked.db.backend !== "d1") return trashUnavailable(tr);
    const owner = await checked.db.execute({ sql: "SELECT 1 FROM site_asset_uploads WHERE site_id=? AND path=?", args: [checked.siteId, path] });
    const email = (await sessionUser())?.email?.toLowerCase();
    if (!owner.rows.length && authConfigured() && (!email || !allowedEmails().includes(email))) return notInTrash(tr);
    // Only restore when the GC lease is free. Otherwise GC could delete the KV
    // file just after this request removes its candidate.
    const released = await checked.db.execute({
      sql: `DELETE FROM asset_gc_candidates
        WHERE path=? AND COALESCE((SELECT lease_until FROM asset_gc_state WHERE id=1),0) < ?
        RETURNING path`,
      args: [path, Date.now()],
    });
    if (!released.rows.length) {
      const exists = await checked.db.execute({
        sql: "SELECT 1 FROM asset_gc_candidates WHERE path=? LIMIT 1", args: [path],
      });
      return exists.rows.length ? gcRunning(tr) : notInTrash(tr);
    }
    return NextResponse.json({ ok: true }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: tr(userMessage(error, "Couldn't restore")) }, { status: 502 });
  }
}

/** Explicit irreversible deletion from Trash, without waiting seven days. */
export async function DELETE(req: Request) {
  const denied = await requireAuth("editor");
  if (denied) return denied;
  const tr = await serverTr();
  if (!dbConfigured()) return trashUnavailable(tr);
  const body = await readTrashRequest(req, tr);
  if (body instanceof NextResponse) return body;
  try {
    const checked = await authorizeSite(body.site, tr, "edit");
    if (checked instanceof NextResponse) return checked;
    if (checked.db.backend !== "d1") return trashUnavailable(tr);
    const owner = await checked.db.execute({ sql: "SELECT 1 FROM site_asset_uploads WHERE site_id=? AND path=?", args: [checked.siteId, body.path] });
    const email = (await sessionUser())?.email?.toLowerCase();
    if (!owner.rows.length && authConfigured() && (!email || !allowedEmails().includes(email))) return notInTrash(tr);
    const kv = assetStore();
    let rooms: AssetGcDocumentNamespace | null = null;
    try {
      rooms = (getCloudflareContext().env as unknown as {
        DOC_STORE?: AssetGcDocumentNamespace;
      }).DOC_STORE ?? null;
    } catch { /* Not running with a Cloudflare document namespace. */ }
    if (!kv || !rooms) return NextResponse.json({ error: tr("Server storage is unavailable") }, { status: 503 });

    const outcome = await permanentlyDeleteTrashedAsset({ db: checked.db, kv, rooms, path: body.path });
    if (outcome === "missing") return notInTrash(tr);
    if (outcome === "busy") return gcRunning(tr);
    if (outcome === "in-use") return NextResponse.json({
      error: tr("The asset is still used by a saved site and cannot be permanently deleted."),
    }, { status: 409 });
    return NextResponse.json({ ok: true }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: tr(userMessage(error, "Couldn't delete permanently")) }, { status: 502 });
  }
}
