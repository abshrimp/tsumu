import { NextResponse } from "next/server";
import { serverTr } from "../../../../lib/i18n-server";
import { requireAuth } from "../../../../lib/server";
import { dbConfigured, getDb } from "../../../../lib/db";
import { siteIdOf } from "../../../../lib/site-server";
import { requireSiteAccess } from "../../../../lib/site-access";
import { siteHasAsset } from "../../../../lib/site-asset-access";
import { signAssetPaths } from "../../../../lib/asset-token";
import { jsonErrorStatus, readJsonObjectLimited } from "../../../../lib/api-json";

/**
 * アセットの期限付きURLを作る（HTMLページのプレビュー用。lib/asset-token.ts）。
 * ログインを使っていなければ、署名なしのURLをそのまま返す（アセットはログインなしで読める）
 */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  let body: { paths?: unknown; site?: unknown };
  try {
    body = await readJsonObjectLimited(req, 1024 * 1024);
  } catch (error) {
    return NextResponse.json({ error: tr("Invalid request (request body)") }, {
      status: jsonErrorStatus(error),
    });
  }
  const paths = Array.isArray(body.paths) ? body.paths : null;
  if (!paths || paths.length > 500 || !paths.every((p) => typeof p === "string" && p.startsWith("assets/") && p.length < 500)) {
    return NextResponse.json({ error: tr("Invalid request (request body)") }, { status: 400 });
  }
  if (dbConfigured()) {
    const siteId = await siteIdOf(body?.site);
    if (siteId instanceof NextResponse) return siteId;
    const deniedSite = await requireSiteAccess(siteId, "view");
    if (deniedSite) return deniedSite;
    const db = await getDb();
    for (const path of paths as string[]) {
      if (!await siteHasAsset(db, siteId, path)) {
        return NextResponse.json({ error: tr("Not found") }, { status: 404 });
      }
    }
  }
  const urls: Record<string, string> = Object.create(null);
  const tokens = await signAssetPaths(paths as string[]);
  for (const [path, token] of tokens) {
    urls[path] = `/api/assets/file?path=${encodeURIComponent(path)}${token ? `&${token}` : ""}`;
  }
  return NextResponse.json({ urls });
}
