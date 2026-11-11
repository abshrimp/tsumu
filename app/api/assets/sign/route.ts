import { NextResponse } from "next/server";
import { serverTr } from "../../../../lib/i18n-server";
import { requireAuth } from "../../../../lib/server";
import { signAssetPaths } from "../../../../lib/asset-token";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../../../lib/api-json";

/**
 * アセットの期限付きURLを作る（HTMLページのプレビュー用。lib/asset-token.ts）。
 * ログインを使っていなければ、署名なしのURLをそのまま返す（アセットはログインなしで読める）
 */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  let body: { paths?: unknown } | null;
  try {
    body = await readJsonLimited(req, 1024 * 1024) as { paths?: unknown } | null;
  } catch (error) {
    return NextResponse.json({ error: trc("invalid_request_variant_1", "Invalid request") }, {
      status: error instanceof JsonBodyTooLargeError ? 413 : error instanceof JsonContentTypeError ? 415 : 400,
    });
  }
  const paths = Array.isArray(body?.paths) ? body.paths : null;
  if (!paths || paths.length > 500 || !paths.every((p) => typeof p === "string" && p.startsWith("assets/") && p.length < 500)) {
    return NextResponse.json({ error: trc("invalid_request_variant_1", "Invalid request") }, { status: 400 });
  }
  const urls: Record<string, string> = Object.create(null);
  const tokens = await signAssetPaths(paths as string[]);
  for (const [path, token] of tokens) {
    urls[path] = `/api/assets/file?path=${encodeURIComponent(path)}${token ? `&${token}` : ""}`;
  }
  return NextResponse.json({ urls });
}
