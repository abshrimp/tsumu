import type { CollabServerMessage } from "./collab";
import { createDocPatch, type DocPatch } from "./doc-patch";
import { mergeDocs } from "./merge";
import { siteApi } from "./site";
import type { EditorStore } from "./store";
import type { SiteDoc } from "./types";

export const CLOUD_SAVE_DEBOUNCE_MS = 800;

type Ref<T> = { current: T };

export type CollabRequestInput =
  | { type: "load"; knownRev?: string }
  | { type: "patch"; base: string; patch: DocPatch }
  | { type: "save"; base: string | null; doc: SiteDoc };

export interface CloudRequestResult {
  ok: boolean;
  status: number;
  data: Record<string, any>;
}

export interface CloudSaveTransport {
  collabSocket: Ref<Pick<WebSocket, "readyState"> | null>;
  clientId: string;
  requestViaWebSocket: (input: CollabRequestInput) => Promise<CollabServerMessage>;
  /** 差分が無いときに返す、最後に保存した時刻 */
  savedAt: () => number | null;
}

/** 文書をサーバーへ保存する（WebSocket を優先し、使えなければ HTTP の API を使う） */
export async function sendCloudDoc(
  t: CloudSaveTransport,
  snapshot: SiteDoc,
  base: string | null,
  baseDoc?: SiteDoc
): Promise<CloudRequestResult> {
  const patch = base && baseDoc ? createDocPatch(baseDoc, snapshot) : null;
  if (patch?.length === 0) {
    return { ok: true, status: 200, data: { rev: base, savedAt: t.savedAt() } };
  }
  // どちらの保存先でも、書き込みが確定すると楽観ロックの版が1つ進む。
  const expectedRev = String(Number(base) + 1);
  if (t.collabSocket.current?.readyState === WebSocket.OPEN) {
    try {
      const message = await t.requestViaWebSocket(patch && base
        ? { type: "patch", base, patch }
        : { type: "save", base, doc: snapshot });
      if (message.type === "saved" && message.rev === expectedRev && Number.isFinite(message.savedAt)) {
        return { ok: true, status: 200, data: message };
      }
      if (message.type === "conflict") {
        return { ok: false, status: 409, data: message };
      }
      if (message.type === "error") throw new Error(message.message);
    } catch {
      // タイムアウトや切断のときは、HTTP の API に切り替える
    }
  }

  const response = await fetch(
    siteApi("/api/doc", base ? { base } : {}),
    {
      method: patch ? "PATCH" : "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Collab-Client-Id": t.clientId,
      },
      body: JSON.stringify(patch ?? snapshot),
    }
  );
  const data = await response.json().catch(() => null);
  if (response.ok && (data?.ok !== true || data.rev !== expectedRev || !Number.isFinite(data.savedAt))) {
    throw new Error("Invalid document save acknowledgment");
  }
  return { ok: response.ok, status: response.status, data: data ?? {} };
}

export interface DeferredCloudConflict {
  base: string;
  baseDoc: SiteDoc;
  snapshot: SiteDoc;
  remoteDoc: SiteDoc;
  remoteRev: string;
}

function reconcileConflict(conflict: DeferredCloudConflict, local: SiteDoc): SiteDoc {
  const reconciled = mergeDocs(conflict.baseDoc, conflict.snapshot, conflict.remoteDoc);
  return local === conflict.snapshot ? reconciled : mergeDocs(conflict.snapshot, local, reconciled);
}

export interface CloudAutosave {
  observedDoc: Ref<SiteDoc>;
  cloudReady: Ref<boolean>;
  cloudDirty: Ref<boolean>;
  skipNextCloudSave: Ref<boolean>;
  cloudTimer: Ref<ReturnType<typeof setTimeout> | null>;
  activeCloudSave: Ref<Promise<void> | null>;
  cloudSaveQueued: Ref<boolean>;
  lastSyncedRev: Ref<string | null>;
  lastSyncedDoc: Ref<SiteDoc | null>;
  retrySaveAfterEdit: Ref<boolean>;
  deferredCloudConflict: Ref<DeferredCloudConflict | null>;
  getState: () => Pick<EditorStore, "doc" | "cloudState" | "editingText" | "setCloud" | "applyRemoteDoc">;
  saveCloudDoc: (snapshot: SiteDoc, base: string | null, baseDoc?: SiteDoc) => Promise<CloudRequestResult>;
  setUnsyncedFlag: (on: boolean) => void;
  /** 変更が無くても自動保存をもう一度動かす */
  requestRetry: () => void;
  /** 回線やサーバーの一時的な失敗の後に、間隔をあけて保存し直す */
  retryLater: () => void;
}

/** サーバーが返した、保存できなかった理由（右下の保存の状態に表示する） */
export function errorOf(res: CloudRequestResult): string | undefined {
  return typeof res.data?.error === "string" ? res.data.error : undefined;
}

/** 時間をおけば成功する見込みのある失敗か（大きすぎる・サイトが無いなどは、やり直しても同じ） */
const isTransient = (status: number) => status >= 500 || status === 408 || status === 429;

/** doc の変更を受けて、自動保存を予約する（デバウンス付き）。戻り値は予約の取り消し。 */
export function scheduleCloudSave(a: CloudAutosave, doc: SiteDoc): (() => void) | undefined {
  const changed = a.observedDoc.current !== doc;
  a.observedDoc.current = doc;
  // サーバーから取り込んだ変更は保存し直さない（編集者の間で同じ変更を送り返し合わないため）
  if (a.skipNextCloudSave.current) {
    a.skipNextCloudSave.current = false;
    return;
  }
  if (!a.cloudReady.current) {
    if (changed) {
      a.cloudDirty.current = true;
      a.setUnsyncedFlag(true);
    }
    return;
  }
  // サーバーが受け付けた最初のスナップショットは、編集ではない。特に、読み込み画面が
  // 閉じたというだけで、未同期のフラグを残してはいけない。
  // 本当に未保存の編集があるときは、明示的な再試行はそのまま動く。
  if (!changed && !a.cloudDirty.current) return;
  const s = a.getState();
  if (s.cloudState === "local") return;
  a.cloudDirty.current = true;
  a.setUnsyncedFlag(true);
  // デバウンスを待っている間も未保存。直前の版の「保存済み」の表示を残すと、保存される前にページを閉じられてしまう。
  if (doc !== a.lastSyncedDoc.current && s.cloudState === "synced") s.setCloud("saving");
  if (a.cloudTimer.current) clearTimeout(a.cloudTimer.current);
  a.cloudTimer.current = setTimeout(() => {
    if (!a.cloudReady.current) return;
    if (a.activeCloudSave.current) {
      a.cloudSaveQueued.current = true;
      return;
    }
    a.activeCloudSave.current = (async () => {
      let st = a.getState();
      try {
        const deferred = a.deferredCloudConflict.current;
        if (deferred) {
          // 入力中は、競合と送信したときの版を保ち、保存を何度予約しても上書きしない。
          if (st.editingText) {
            a.retrySaveAfterEdit.current = true;
            return;
          }
          // 再読み込みなどで同期済みの版が変わった場合は、古い競合を適用しない。
          if (a.lastSyncedRev.current === deferred.base && a.lastSyncedDoc.current === deferred.baseDoc) {
            const merged = reconcileConflict(deferred, st.doc);
            st.applyRemoteDoc(merged);
            st = a.getState();
            a.lastSyncedRev.current = deferred.remoteRev;
            a.lastSyncedDoc.current = deferred.remoteDoc;
          }
          // 合成や適用に失敗した場合は、送信したときの版を残して安全に再試行する。
          a.deferredCloudConflict.current = null;
          a.retrySaveAfterEdit.current = false;
        }
        const base = a.lastSyncedRev.current;
        const baseDoc = a.lastSyncedDoc.current;
        if (!base || !baseDoc) {
          a.cloudReady.current = false;
          st.setCloud("error");
          return;
        }
        const snapshot = st.doc;
        if (snapshot === baseDoc) {
          a.cloudDirty.current = false;
          a.setUnsyncedFlag(false);
          // 保存に失敗した後、元に戻すなどで同期済みの内容に戻ったときは、表示も戻す
          if (st.cloudState === "error" || st.cloudState === "saving") st.setCloud("synced");
          return;
        }
        st.setCloud("saving");
        // base 付き = 楽観ロック。他の編集者が先に保存していれば 409 が返る
        const res = await a.saveCloudDoc(snapshot, base, baseDoc);
        if (res.ok) {
          const data = res.data;
          a.lastSyncedRev.current = data.rev ?? a.lastSyncedRev.current;
          a.lastSyncedDoc.current = snapshot;
          // 保存中にさらに編集されていなければ、「未保存の変更なし」に戻す
          if (a.getState().doc === snapshot) {
            a.cloudDirty.current = false;
            a.setUnsyncedFlag(false);
          }
          st.setCloud(a.cloudDirty.current ? "saving" : "synced", data.savedAt ?? Date.now());
        } else if (res.status === 409) {
          // 競合: 相手の最新版と3方向マージし、次の自動保存で保存し直す
          const data = res.data;
          const now = a.getState();
          if (data?.doc && baseDoc && now.editingText) {
            // 入力を失わないよう、確定した後に合成する。送信中や確定を待っている間の元に戻す操作も
            // 戻せるよう、送信したときの版と受け取った競合を一緒に残す。
            a.deferredCloudConflict.current = {
              base, baseDoc, snapshot, remoteDoc: data.doc, remoteRev: data.rev ?? base,
            };
            a.retrySaveAfterEdit.current = true;
            st.setCloud("saving");
          } else if (data?.doc && baseDoc) {
            // 送ろうとしたスナップショットは、すでに確定していることがある（たとえば、
            // WebSocket の受領の通知が失われた後に、HTTP で 409 が返った場合）。まず
            // その送信の結果と照合し、それから送信中に行った編集を再生する。
            // now.doc と baseDoc だけを比べると、base まで元に戻した操作を「手元の変更なし」と
            // 取り違え、その編集を復活させてしまう。
            const merged = reconcileConflict({
              base, baseDoc, snapshot, remoteDoc: data.doc, remoteRev: data.rev ?? base,
            }, now.doc);
            a.lastSyncedRev.current = data.rev ?? a.lastSyncedRev.current;
            a.lastSyncedDoc.current = data.doc;
            // 未保存のまま適用する → 保存の effect が予約し直される
            st.applyRemoteDoc(merged);
            st.setCloud("saving");
          } else {
            // 基準が分からないまま最新版の番号だけを採用すると、次の保存が全体を上書きしてしまう。
            a.cloudReady.current = false;
            st.setCloud("error");
          }
        } else {
          st.setCloud("error", undefined, errorOf(res));
          if (isTransient(res.status)) a.retryLater();
        }
      } catch {
        st.setCloud("error");
        a.retryLater();
      }
    })().finally(() => {
      a.activeCloudSave.current = null;
      if (a.cloudSaveQueued.current) {
        a.cloudSaveQueued.current = false;
        // テキストの確定を待っている場合は、専用の保存し直しの処理に任せる。
        if (a.cloudReady.current && !a.retrySaveAfterEdit.current) {
          a.requestRetry();
        }
      }
    });
  }, CLOUD_SAVE_DEBOUNCE_MS);
  return () => {
    if (a.cloudTimer.current) clearTimeout(a.cloudTimer.current);
  };
}
