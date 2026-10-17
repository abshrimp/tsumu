"use client";

import { useEffect, useState } from "react";
import type { ActivityUser } from "./activity";

/** サーバーの設定状況（/api/status） */
export interface ServerStatus {
  /** Google認証を使っているか（false ならログインなしで開ける） */
  auth: boolean;
  /** 編集データの保存先（D1）があるか */
  db: boolean;
  /** アセット（画像・動画・音声）の保存先（KV）があるか */
  assets: boolean;
  /** ログインしている人（Google認証を使っていなければ null） */
  user?: ActivityUser | null;
}

let cached: Promise<ServerStatus | null> | null = null;

/** 設定状況を1回だけ取りに行く（読み込み中・失敗時は null） */
export function useServerStatus(): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  useEffect(() => {
    let alive = true;
    cached ??= fetch("/api/status")
      .then((res) => (res.ok ? (res.json() as Promise<ServerStatus>) : null))
      .catch(() => null);
    void cached.then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}
