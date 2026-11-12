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
import { recordAssetGcCandidates } from "../../../lib/asset-gc";
import { readAssetLedger, recordUploadedAsset } from "../../../lib/asset-ledger";

/**
 * 他のサイトのアセット一覧を、各サイトの SQLite 版 Durable Object から直接読む。
 * 安全側に倒し、1件でも読めなければ削除を中止する（他サイトが使うファイルを消さないため）。
 * リクエストごとの外部接続数の上限を超えないよう、同時に読む数を制限する。
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
    // ファイル本体に加えて、multipart のヘッダーと他の項目の分の余裕を持たせる。
    form = await readAssetForm(req, MAX_ASSET_BYTES + 1024 * 1024);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return NextResponse.json({ error: tr("The file is too large (max 25MB)") }, { status: 413 });
  }
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: tr("No file was provided") },
      { status: 400 }
    );
  }
  if (
    !file.type ||
    /^(?:text\/html|application\/xhtml\+xml|(?:text|application)\/xml)\b/i.test(file.type.trim()) ||
    /\.(?:x?html?|mhtml|shtml|xml)$/i.test(file.name.trim())
  ) {
    return NextResponse.json(
      { error: tr("This file type can't be uploaded") },
      { status: 400 }
    );
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json(
      { error: tr("The file is too large (max 25MB)") },
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
    if (dbConfigured()) {
      try {
        await recordUploadedAsset(await getDb(), path, file.size);
      } catch {
        // ファイル自体は保存できている。台帳に載らなかった分は、週1回の KV の棚卸しで追加される。
        console.warn("Uploaded asset was not recorded in the storage ledger");
      }
    }
    return NextResponse.json({ ok: true, name: safeName, path });
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "Couldn't upload")) },
      { status: 502 }
    );
  }
}

/**
 * 全サイトのアセットの使用量（ストレージは全サイト共通）。
 * Cloudflare では、KV に置いたファイルの台帳（D1）を ledger として返す。
 * 台帳が揃っていれば、それだけで KV の実際の使用量になる。
 * 揃うまで（最初の週次の棚卸しが終わるまで）と Node/Docker では、
 * ?site= のサイト以外が使っているファイルの一覧も返す（そのサイトの分は、ブラウザが編集中の内容から足す）。
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
    const ledger = await readAssetLedger(db);
    // 台帳が揃っていれば全ファイルを数えられるため、サイトごとの Durable Object の呼び出しを省く。
    const refs = ledger?.complete ? null : await otherSiteAssetReferences(db, siteId);
    return NextResponse.json({
      ...(ledger ? { ledger } : {}),
      ...(refs ? { others: [...refs].map(([path, bytes]) => ({ path, bytes })) } : {}),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "Couldn't load")) }, { status: 502 });
  }
}

/**
 * アセットを削除する（path 指定）。Cloudflare では削除の候補として登録するだけで、
 * 猶予期間の後に全サイトの現在の参照を確認する。Node.js・Docker では、その場で他のサイトの参照を調べる。
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
    return NextResponse.json({ error: tr("Invalid parameters") }, { status: 400 });
  }
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  try {
    const db = dbConfigured() ? await getDb() : null;
    if (db?.backend === "d1") {
      // エディタは、手元の文書からすでにアセットを外している。毎晩 KV の全件を列挙する代わりに、
      // ここで削除の候補として登録する。他のサイトの参照と保存待ちの変更は、
      // 猶予期間（既定7日）の後に改めて確認する。
      const site = await db.execute({ sql: "SELECT 1 FROM sites WHERE id=? LIMIT 1", args: [siteId] });
      if (!site.rows.length) return NextResponse.json({ error: tr("Site not found") }, { status: 404 });
      const scheduled = await recordAssetGcCandidates(db, [path]);
      return NextResponse.json({ ok: true, kept: true, scheduled: scheduled > 0 });
    }
    // ブラウザ内に保存したサイトは、サーバーのデータベースの有無にかかわらずアセットを参照し得る。
    // その場で削除する経路では、必ずそれらのサイトと共有しているファイルを残す。
    if (params.get("browserReferenced") === "1") {
      return NextResponse.json({ ok: true, kept: true });
    }
    if (db) {
      const refs = await otherSiteAssetReferences(db, siteId);
      if (refs.has(path)) return NextResponse.json({ ok: true, kept: true });
    }
    await store.delete(path);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "Couldn't delete")) },
      { status: 502 }
    );
  }
}
