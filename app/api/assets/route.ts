import { NextResponse } from "next/server";
import { dbUnavailable, storeUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { requireAuth } from "../../../lib/server";
import { assetStore, MAX_ASSET_BYTES } from "../../../lib/kv";
import { userMessage } from "../../../lib/errors";
import { dbConfigured, getDb } from "../../../lib/db";
import { siteIdOf } from "../../../lib/site-server";

/** 画像・動画・音声アセットをアップロード */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  const store = assetStore();
  if (!store) return await storeUnavailable();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: tr("ファイルがありません") },
      { status: 400 }
    );
  }
  if (
    !file.type ||
    /^(?:text\/html|application\/xhtml\+xml|(?:text|application)\/xml)\b/i.test(file.type.trim()) ||
    /\.(?:x?html?|mhtml|shtml|xml)$/i.test(file.name.trim())
  ) {
    return NextResponse.json(
      { error: tr("この種類のファイルはアップロードできません") },
      { status: 400 }
    );
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json(
      { error: tr("ファイルが大きすぎます（25MBまで）") },
      { status: 400 }
    );
  }

  // 保存先のパスに使う名前（英数字だけ。日本語などだけの名前は "asset" にする）
  const ext = /\.[a-zA-Z0-9]{1,5}$/.exec(file.name)?.[0] ?? "";
  const stem = file.name
    .slice(0, file.name.length - ext.length)
    .replace(/[^a-zA-Z0-9.\-_]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|-+$/g, "");
  // 保存先のキー（KV は512バイト・ファイルに保存するときは名前が255バイトまで）に収まる長さにする
  const safeName = `${(stem || "asset").slice(0, 80).replace(/-+$/, "") || "asset"}${ext}`;
  const path = `assets/${Date.now().toString(36)}-${safeName}`;

  try {
    await store.put(path, await file.arrayBuffer(), {
      metadata: { contentType: file.type },
    });
    return NextResponse.json({ ok: true, name: safeName, path });
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "アップロードできませんでした")) },
      { status: 502 }
    );
  }
}

/**
 * 全サイトのアセットの使用量（ストレージは全サイト共通）。
 * ?site= のサイト以外が使っているファイルの一覧を返す（そのサイトの分は、ブラウザが編集中の内容から足す）。
 * 中身の JSON は D1 の中で読む（Workers の CPU 時間を使わない）
 */
export async function GET(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();
  const siteId = await siteIdOf(new URL(req.url).searchParams.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  try {
    const db = await getDb();
    const rs = await db.execute({
      // json_each にも path という列があるため、別名は asset_path にする（path だとそちらでまとめてしまう）
      sql: `SELECT json_extract(a.value, '$.path') AS asset_path, MAX(json_extract(a.value, '$.bytes')) AS bytes
        FROM docs d, json_each(d.body, '$.assets') a
        WHERE d.id != ? AND json_extract(a.value, '$.path') IS NOT NULL
        GROUP BY asset_path`,
      args: [siteId],
    });
    return NextResponse.json({
      others: rs.rows.map((r) => ({
        path: String(r.asset_path),
        bytes: r.bytes === null || r.bytes === undefined ? null : Number(r.bytes),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "読み込めませんでした")) }, { status: 502 });
  }
}

/**
 * アセットを削除（path 指定）。
 * ほかのサイトが同じファイルを使っていれば（サイトをまたいでコピーしたとき）、ファイルは残す
 */
export async function DELETE(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  const store = assetStore();
  if (!store) return await storeUnavailable();

  const params = new URL(req.url).searchParams;
  const path = params.get("path");
  if (!path?.startsWith("assets/")) {
    return NextResponse.json({ error: tr("指定が正しくありません") }, { status: 400 });
  }
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  try {
    if (dbConfigured()) {
      const db = await getDb();
      const rs = await db.execute({
        sql: "SELECT 1 FROM docs WHERE id != ? AND instr(body, ?) > 0 LIMIT 1",
        args: [siteId, `"${path}"`],
      });
      if (rs.rows.length) return NextResponse.json({ ok: true, kept: true });
    }
    await store.delete(path);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "削除できませんでした")) },
      { status: 502 }
    );
  }
}
