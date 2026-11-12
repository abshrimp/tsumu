"use client";

import { useEffect, useState } from "react";
import type { ActivityUser } from "./activity";

/** サーバーの設定の状況（/api/status） */
export interface ServerStatus {
  /** Google 認証を使っているか（false なら、ログインなしで開ける） */
  auth: boolean;
  /** サーバーの保存先（Cloudflare の D1、または TSUMU_DATA_DIR の SQLite）があるか */
  db: boolean;
  /** アセット（画像・動画・音声）の保存先（KV）があるか */
  assets: boolean;
  /** アセットを削除したとき、サーバーのファイルをどうするか（保存先が無ければ null） */
  assetDeletion?: AssetDeletion | null;
  /** ログインしている人（Google 認証を使っていなければ null） */
  user?: ActivityUser | null;
}

/**
 * immediate: すぐに削除する（Node.js・Docker。他のサイトが使っていれば残す）。
 * scheduled: days 日後に削除する（Cloudflare。それまでに元に戻すか、他のサイトが使っていれば残す）。
 * kept: 削除しない（Cloudflare で ASSET_GC_ENABLED が未設定のとき）。
 */
export type AssetDeletion =
  | { mode: "immediate" }
  | { mode: "scheduled"; days: number }
  | { mode: "kept" };

let cached: Promise<ServerStatus | null> | null = null;
let loaded: ServerStatus | null = null;

function loadServerStatus(): Promise<ServerStatus | null> {
  cached ??= fetch("/api/status")
    .then((res) => (res.ok ? (res.json() as Promise<ServerStatus>) : null))
    .catch(() => null)
    .then((s) => (loaded = s));
  return cached;
}

/**
 * 読み込み済みの設定の状況（まだなら null）。クリックの処理など、待たずに読む場所で使う。
 * 確認のダイアログは操作の直後に表示する必要があるため、ここで通信を待たない
 */
export function serverStatusSnapshot(): ServerStatus | null {
  return loaded;
}

/** 設定の状況を1回だけ取得する（読み込み中や失敗したときは null） */
export function useServerStatus(): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void loadServerStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}
