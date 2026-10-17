import { NextResponse } from "next/server";
import { serverTr } from "../../../../lib/i18n-server";
import { requireAuth } from "../../../../lib/server";
import { signAssetPath } from "../../../../lib/asset-token";

/**
 * アセットの期限付きURLを作る（HTMLページのプレビュー用。lib/asset-token.ts）。
 * ログインを使っていなければ、署名なしのURLをそのまま返す（アセットはログインなしで読める）
 */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { paths?: unknown } | null;
  const paths = Array.isArray(body?.paths) ? body.paths : null;
  if (!paths || paths.length > 500 || !paths.every((p) => typeof p === "string" && p.startsWith("assets/") && p.length < 500)) {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  const urls: Record<string, string> = {};
  for (const path of paths as string[]) {
    const token = await signAssetPath(path);
    urls[path] = `/api/assets/file?path=${encodeURIComponent(path)}${token ? `&${token}` : ""}`;
  }
  return NextResponse.json({ urls });
}
