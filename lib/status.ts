"use client";

import { useEffect, useState } from "react";
import type { ActivityUser } from "./activity";

/** サーバーの設定状況（/api/status） */
export interface ServerStatus {
  /** Google認証を使っているか（false ならログインなしで開ける） */
  auth: boolean;
  /** サーバーの保存先（Cloudflare の D1、または TSUMU_DATA_DIR の SQLite）があるか */
  db: boolean;
  /** アセット（画像・動画・音声）の保存先（KV）があるか */
  assets: boolean;
  /** アセットを削除したとき、サーバーのファイルをどうするか（保存先が無ければ null） */
  assetDeletion?: AssetDeletion | null;
  /** ログインしている人（Google認証を使っていなければ null） */
  user?: ActivityUser | null;
}

/**
 * immediate: すぐ削除する（Node.js・Docker。ほかのサイトが使っていれば残す）。
 * scheduled: days 日後に削除する（Cloudflare。それまでに元に戻すか、ほかのサイトが使っていれば残す）。
 * kept: 削除しない（Cloudflare で ASSET_GC_ENABLED が未設定）。
 */
export type AssetDeletion =
  | { mode: "immediate" }
  | { mode: "scheduled"; days: number }
  | { mode: "kept" };

let cached: Promise<ServerStatus | null> | null = null;

/** 設定状況を1回だけ取りに行く（失敗時は null）。フックを使えない処理の途中から読む */
export function loadServerStatus(): Promise<ServerStatus | null> {
  cached ??= fetch("/api/status")
    .then((res) => (res.ok ? (res.json() as Promise<ServerStatus>) : null))
    .catch(() => null);
  return cached;
}

/** 設定状況を1回だけ取りに行く（読み込み中・失敗時は null） */
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
