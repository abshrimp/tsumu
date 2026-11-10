import { NextResponse } from "next/server";
import { dbUnavailable, storeUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { requireAuth } from "../../../lib/server";
import { assetStore, MAX_ASSET_BYTES } from "../../../lib/kv";
import { userMessage } from "../../../lib/errors";
import { dbConfigured, getDb } from "../../../lib/db";
import { readAssetForm } from "../../../lib/asset-upload";
import { siteIdOf } from "../../../lib/site-server";
import { documentAssetReferences } from "../../../lib/site-document-service";

/**
 * Read each other site's asset index directly from its SQLite-backed DO.
 * This is intentionally conservative: a failed query aborts deletion rather
 * than risk erasing a file referenced by another site. Concurrency is limited
 * to avoid exhausting the per-request outgoing connection budget.
 */
async function otherSiteAssetReferences(db: Awaited<ReturnType<typeof getDb>>, siteId: string) {
  const sites = await db.execute({ sql: "SELECT id FROM sites WHERE id != ?", args: [siteId] });
  const others = new Map<string, number | null>();
  for (let offset = 0; offset < sites.rows.length; offset += 4) {
    const chunk = sites.rows.slice(offset, offset + 4);
    const results = await Promise.all(chunk.map(row => documentAssetReferences(db, String(row.id))));
    for (const refs of results) {
      for (const ref of refs) {
        const previous = others.get(ref.path);
        others.set(ref.path, previous == null ? ref.bytes
          : ref.bytes == null ? previous : Math.max(previous, ref.bytes));
      }
    }
  }
  return others;
}

/** 画像・動画・音声アセットをアップロード */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  const store = assetStore();
  if (!store) return await storeUnavailable();

  let form;
  try {
    // Leave space for multipart headers and fields in addition to the file.
    form = await readAssetForm(req, MAX_ASSET_BYTES + 1024 * 1024);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return NextResponse.json({ error: tr("ファイルが大きすぎます（25MBまで）") }, { status: 413 });
  }
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
  // 同じ名前（日本語だけの名前はどれも "asset"）が同時に届いても上書きしないよう、乱数も入れる
  const path = `assets/${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}-${safeName}`;

  try {
    await store.put(path, await file.arrayBuffer(), {
      metadata: { contentType: file.type, bytes: file.size },
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
 * 使用状況は各サイトの保存先から取得する。確認できないときは削除を中止する。
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
    const refs = await otherSiteAssetReferences(db, siteId);
    return NextResponse.json({
      others: [...refs].map(([path, bytes]) => ({ path, bytes })),
    }, { headers: { "Cache-Control": "private, no-store" } });
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
      if (db.backend === "d1") {
        // DO metadata and KV are not one transaction. Physical deletion here
        // can race a concurrent save/copy in another site. Keep immutable KV
        // objects; orphan collection must use a separate, fenced GC protocol.
        return NextResponse.json({ ok: true, kept: true });
      }
      const refs = await otherSiteAssetReferences(db, siteId);
      if (refs.has(path)) return NextResponse.json({ ok: true, kept: true });
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
