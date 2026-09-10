import { NextResponse } from "next/server";
import { authConfigured } from "../../../auth";
import { requireAuth } from "../../../lib/server";
import { dbConfigured, getDb } from "../../../lib/db";
import { assetStore } from "../../../lib/kv";
import { envVar } from "../../../lib/env";
import type { AssetDeletion } from "../../../lib/status";

/**
 * What happens to a stored file when an asset is deleted in the editor.
 * Cloudflare only schedules deletion; the GC deletes it after the grace
 * period, and only when ASSET_GC_ENABLED=true (otherwise files stay).
 */
async function assetDeletion(): Promise<AssetDeletion | null> {
  if (assetStore() === null) return null;
  const backend = dbConfigured() ? (await getDb().catch(() => null))?.backend : undefined;
  if (backend !== "d1") return { mode: "immediate" };
  if (envVar("ASSET_GC_ENABLED") !== "true") return { mode: "kept" };
  const days = Number(envVar("ASSET_GC_GRACE_DAYS") ?? 7);
  return { mode: "scheduled", days: Number.isSafeInteger(days) && days >= 1 && days <= 3650 ? days : 7 };
}

/** サーバーの設定状況（ログインの有無・保存先）。画面の出し分けに使う */
export async function GET() {
  const user = await requireAuth("user");
  if (user instanceof NextResponse) return user;
  return NextResponse.json({
    auth: authConfigured(),
    db: dbConfigured(),
    assets: assetStore() !== null,
    assetDeletion: await assetDeletion(),
    // ログインしている人（コメントで、自分の書いたものを見分ける）
    user,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
