import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authConfigured } from "../../../../auth";
import { dbConfigured, getDb } from "../../../../lib/db";
import { envVar } from "../../../../lib/env";
import { requireAuth, sessionUser } from "../../../../lib/server";
import { runAssetGc, type AssetGcDocumentNamespace } from "../../../../lib/asset-gc";
import type { KVLikeNamespace } from "../../../../lib/kv";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function setting(name: string): number | undefined {
  const raw = envVar(name);
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new RangeError("Invalid GC configuration");
  return Number(raw);
}

/**
 * Administrator-only, non-destructive GC inventory.
 *
 * There is deliberately no live delete route. A normal authenticated editor
 * (and anonymous mode) must never acquire storage-wide admin capabilities.
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const denied = await requireAuth();
  if (denied) return denied;
  // Anonymous mode can pass requireAuth(), but never authorizes GC inventory.
  if (!authConfigured()) {
    return NextResponse.json({ error: "Administrator authentication required" }, { status: 403 });
  }
  const user = await sessionUser();
  const admins = new Set((envVar("ASSET_GC_ADMIN_EMAILS") ?? "")
    .split(",").map(email => email.trim().toLowerCase()).filter(Boolean));
  if (!user?.email || !admins.has(user.email.toLowerCase())) {
    return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  if (params.get("dryRun") !== "1" || params.size !== 1) {
    return NextResponse.json({
      error: "Only dryRun=1 is supported until historical restoration and concurrent saves are fenced",
    }, { status: 409 });
  }
  if (!dbConfigured()) return NextResponse.json({ error: "D1 not configured" }, { status: 503 });
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const kv = env.ASSETS_KV as KVLikeNamespace | undefined;
    const rooms = env.DOC_STORE as AssetGcDocumentNamespace | undefined;
    const db = await getDb();
    if (db.backend !== "d1" || !kv?.list || !rooms) {
      return NextResponse.json({ error: "Workers storage unavailable" }, { status: 503 });
    }
    const report = await runAssetGc({
      db, kv, rooms,
      graceDays: setting("ASSET_GC_GRACE_DAYS"),
      maxDeletes: setting("ASSET_GC_MAX_DELETES"),
    });
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "GC inventory aborted; no KV objects were deleted" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
