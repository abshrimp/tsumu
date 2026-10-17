/**
 * Durable Object が無いとき（Node.js・Docker・next dev）の、保存の通知の配り先。
 * 同じプロセスの中で、サイトごとに購読している接続（/api/collab/events）へ届ける。
 * エディタは1つのプロセスで動かす前提（Node.js・Docker の README を参照）
 */

import type { DocUpdatedMessage } from "./collab";

type Listener = (message: DocUpdatedMessage, raw: string) => void;

// 開発時のモジュールの再読み込みでも、購読の一覧を1つに保つ
const store = globalThis as typeof globalThis & {
  __tsumuCollabListeners?: Map<string, Set<Listener>>;
};

function listeners(): Map<string, Set<Listener>> {
  return (store.__tsumuCollabListeners ??= new Map());
}

/** サイトの保存の通知を受け取る。戻り値で購読をやめる */
export function subscribeDocUpdates(siteId: string, listener: Listener): () => void {
  const all = listeners();
  let set = all.get(siteId);
  if (!set) all.set(siteId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size && all.get(siteId) === set) all.delete(siteId);
  };
}

/** サイトの購読者へ保存を知らせる（購読者がいなければ何もしない） */
export function publishDocUpdate(siteId: string, message: DocUpdatedMessage): void {
  const set = listeners().get(siteId);
  if (!set?.size) return;
  const raw = JSON.stringify(message);
  for (const listener of [...set]) {
    try {
      listener(message, raw);
    } catch {
      // 切れた接続は、その接続の後始末で一覧から外れる
    }
  }
}
