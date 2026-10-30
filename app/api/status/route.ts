import { NextResponse } from "next/server";
import { authConfigured } from "../../../auth";
import { requireAuth } from "../../../lib/server";
import { dbConfigured, getDb } from "../../../lib/db";
import { assetStore } from "../../../lib/kv";
import { envVar } from "../../../lib/env";
import type { AssetDeletion } from "../../../lib/status";
import { allowedEmails, getAccountRole } from "../../../lib/allowlist";
import { collabRoomAvailable } from "../../../lib/collab";

/**
 * エディタでアセットを削除したときに、保存したファイルがどうなるか。
 * Cloudflare では削除を予約するだけで、猶予期間の後に GC が削除する。
 * それも ASSET_GC_ENABLED=true のときだけで、それ以外はファイルが残る。
 */
async function assetDeletion(): Promise<AssetDeletion | null> {
  if (assetStore() === null) return null;
  const backend = dbConfigured() ? (await getDb().catch(() => null))?.backend : undefined;
  if (backend !== "d1") return { mode: "immediate" };
  if (envVar("ASSET_GC_ENABLED") !== "true") return { mode: "kept" };
  const days = Number(envVar("ASSET_GC_GRACE_DAYS") ?? 7);
  return { mode: "scheduled", days: Number.isSafeInteger(days) && days >= 1 && days <= 3650 ? days : 7 };
}

/** サーバーの設定状況（ログインの有無・保存先）。画面の表示を切り替えるために使う */
export async function GET() {
  const user = await requireAuth("user");
  if (user instanceof NextResponse) return user;
  const hasDatabase = dbConfigured();
  return NextResponse.json({
    auth: authConfigured(),
    role: user ? (await getAccountRole(user.email) ?? "viewer") : "editor",
    manageAccounts: !!user && (envVar("ALLOW_PUBLIC_SIGNUP") !== "true" ||
      allowedEmails().includes(user.email.toLowerCase())),
    db: hasDatabase,
    collabTransport: !hasDatabase ? "none" : collabRoomAvailable() ? "websocket" : "sse",
    assets: assetStore() !== null,
    assetDeletion: await assetDeletion(),
    // ログインしている人（コメントのうち、自分が書いたものを見分けるために使う）
    user,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
