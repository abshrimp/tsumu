/**
 * 保存先（D1・KV）が設定されていないときのAPIの応答。
 * 訳の辞書を読み込むため、middleware から読み込まれる lib/db.ts・lib/kv.ts とは分けている
 */

import { NextResponse } from "next/server";
import { serverTr } from "./i18n-server";

export async function dbUnavailable(): Promise<NextResponse> {
  const tr = await serverTr();
  console.error("Database is not configured: set database_id on the DB binding in wrangler.jsonc, or TSUMU_DATA_DIR outside Cloudflare");
  return NextResponse.json(
    { error: tr("データベースが設定されていません。管理者に確認してください") },
    { status: 503 }
  );
}

export async function storeUnavailable(): Promise<NextResponse> {
  const tr = await serverTr();
  console.error("Asset storage is not configured: set id on the ASSETS_KV binding in wrangler.jsonc, or TSUMU_DATA_DIR outside Cloudflare");
  return NextResponse.json(
    { error: tr("アセットの保存先が設定されていません。管理者に確認してください") },
    { status: 503 }
  );
}
