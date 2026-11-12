import { currentSiteId, isLocalSiteDeleted, LOCAL_SITE_DELETED_KEY, siteKey } from "./site";
import type { SiteDoc } from "./types";

export type LocalSaveResult = "saved" | "error" | "deleted";
export type LocalSaveState = LocalSaveResult | "pending";
export type LocalSaveSnapshot = { doc: SiteDoc; result: LocalSaveResult };

/** 一覧に無いというだけでは止めない。削除の記録を読めないときも、成功としては扱わない。 */
export function localSaveBlock(): Exclude<LocalSaveResult, "saved"> | null {
  try {
    return isLocalSiteDeleted() ? "deleted" : null;
  } catch {
    return "error";
  }
}

export function localSaveState(saved: LocalSaveSnapshot | null, doc: SiteDoc): LocalSaveState {
  // 削除した後の編集や元に戻す操作では「保存中」に戻し、保存先がまだあるようには見せない。
  if (saved?.result === "deleted") return "deleted";
  return saved?.doc === doc ? saved.result : "pending";
}

/** 別のタブでの削除は、次の編集を待たずに、前回の「保存済み」を無効にする。 */
export function watchLocalSaveBlock(onBlocked: (reason: "deleted" | "error") => void): () => void {
  const markerKey = siteKey(LOCAL_SITE_DELETED_KEY, currentSiteId());
  const check = () => {
    const reason = localSaveBlock();
    if (reason) onBlocked(reason);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== markerKey) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
    } catch { /* check が読み込み失敗として通知する。 */ }
    check();
  };
  const onVisible = () => { if (!document.hidden) check(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisible);
  check();
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** サーバーに保存済みなら、ブラウザ側の削除だけでは、ページを離れるのを妨げない。 */
export function warnForDeletedLocalSave(state: LocalSaveState, cloudState: string): boolean {
  return cloudState !== "synced" && (state === "deleted" || localSaveBlock() === "deleted");
}
