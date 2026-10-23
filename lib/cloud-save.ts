import type { CollabServerMessage } from "./collab";
import { createDocPatch, type DocPatch } from "./doc-patch";
import { mergeDocs } from "./merge";
import { siteApi } from "./site";
import type { EditorStore } from "./store";
import type { SiteDoc } from "./types";

export const CLOUD_SAVE_DEBOUNCE_MS = 800;

type Ref<T> = { current: T };

export type CollabRequestInput =
  | { type: "load" }
  | { type: "patch"; base: string; patch: DocPatch }
  | { type: "save"; base: string | null; doc: SiteDoc };

export interface CloudRequestResult {
  ok: boolean;
  status: number;
  data: Record<string, any>;
}

export interface CloudSaveTransport {
  deltaSupported: Ref<boolean>;
  collabSocket: Ref<Pick<WebSocket, "readyState"> | null>;
  clientId: string;
  requestViaWebSocket: (input: CollabRequestInput) => Promise<CollabServerMessage>;
  /** 差分が無いときに返す、最後に保存した時刻 */
  savedAt: () => number | null;
}

/** ドキュメントをサーバーへ保存する（WebSocket を優先し、だめなら HTTP の API） */
export async function sendCloudDoc(
  t: CloudSaveTransport,
  snapshot: SiteDoc,
  base: string | null,
  baseDoc?: SiteDoc
): Promise<CloudRequestResult> {
  const patch = t.deltaSupported.current && base && baseDoc ? createDocPatch(baseDoc, snapshot) : null;
  if (patch?.length === 0) {
    return { ok: true, status: 200, data: { rev: base, savedAt: t.savedAt() } };
  }
  if (t.collabSocket.current?.readyState === WebSocket.OPEN) {
    try {
      const message = await t.requestViaWebSocket(patch && base
        ? { type: "patch", base, patch }
        : { type: "save", base, doc: snapshot });
      if (message.type === "saved") {
        return { ok: true, status: 200, data: message };
      }
      if (message.type === "conflict") {
        return { ok: false, status: 409, data: message };
      }
      if (message.type === "error") throw new Error(message.message);
    } catch {
      // タイムアウト・切断時は HTTP の API へフォールバック
    }
  }

  let response = await fetch(
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
  // 段階的なデプロイ中、HTTP側が旧版なら版照合付きの全体保存に戻す。
  if (patch && response.status === 405) {
    t.deltaSupported.current = false;
    response = await fetch(siteApi("/api/doc", base ? { base } : {}), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Collab-Client-Id": t.clientId },
      body: JSON.stringify(snapshot),
    });
  }
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => ({})),
  };
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
  getState: () => Pick<EditorStore, "doc" | "cloudState" | "editingText" | "setCloud" | "applyRemoteDoc">;
  saveCloudDoc: (snapshot: SiteDoc, base: string | null, baseDoc?: SiteDoc) => Promise<CloudRequestResult>;
  setUnsyncedFlag: (on: boolean) => void;
  /** 変更が無くても自動保存をもう一度動かす */
  requestRetry: () => void;
}

/** doc の変更を受けて自動保存を予約する（デバウンス付き）。戻り値は予約の取り消し。 */
export function scheduleCloudSave(a: CloudAutosave, doc: SiteDoc): (() => void) | undefined {
  const changed = a.observedDoc.current !== doc;
  a.observedDoc.current = doc;
  // サーバーから取り込んだ変更は保存し直さない（編集者間のエコー防止）
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
  const s = a.getState();
  if (s.cloudState === "local") return;
  a.cloudDirty.current = true;
  a.setUnsyncedFlag(true);
  if (a.cloudTimer.current) clearTimeout(a.cloudTimer.current);
  a.cloudTimer.current = setTimeout(() => {
    if (!a.cloudReady.current) return;
    if (a.activeCloudSave.current) {
      a.cloudSaveQueued.current = true;
      return;
    }
    a.activeCloudSave.current = (async () => {
      const st = a.getState();
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
        return;
      }
      st.setCloud("saving");
      try {
        // base 付き = 楽観ロック。他の編集者が先に保存していれば 409 が返る
        const res = await a.saveCloudDoc(snapshot, base, baseDoc);
        if (res.ok) {
          const data = res.data;
          a.lastSyncedRev.current = data.rev ?? a.lastSyncedRev.current;
          a.lastSyncedDoc.current = snapshot;
          // 保存中にさらに編集されていなければ「未保存の変更なし」に戻す
          if (a.getState().doc === snapshot) {
            a.cloudDirty.current = false;
            a.setUnsyncedFlag(false);
          }
          st.setCloud(a.cloudDirty.current ? "saving" : "synced", data.savedAt ?? Date.now());
        } else if (res.status === 409) {
          // 競合: 相手の最新と三方向マージして、次の自動保存で保存し直す
          const data = res.data;
          const now = a.getState();
          if (data?.doc && baseDoc && now.editingText) {
            // テキスト編集中のマージは入力が失われるため、確定（blur）後の
            // 再保存時に解決する（base は据え置き → もう一度409になる）。
            // 文字を変えずに編集を終えても保存し直せるよう、終わったときに知らせる
            a.retrySaveAfterEdit.current = true;
            st.setCloud("saving");
          } else if (data?.doc && baseDoc) {
            const merged = mergeDocs(baseDoc, now.doc, data.doc);
            a.lastSyncedRev.current = data.rev ?? a.lastSyncedRev.current;
            a.lastSyncedDoc.current = data.doc;
            // dirty のまま適用 → 保存エフェクトが再スケジュールされる
            st.applyRemoteDoc(merged);
            st.setCloud("saving");
          } else {
            // ベース不明のまま最新版の番号だけ採用すると、次の保存が全体を上書きする。
            a.cloudReady.current = false;
            st.setCloud("error");
          }
        } else {
          st.setCloud("error");
        }
      } catch {
        st.setCloud("error");
      }
    })().finally(() => {
      a.activeCloudSave.current = null;
      if (a.cloudSaveQueued.current) {
        a.cloudSaveQueued.current = false;
        // テキストの確定待ちは専用の再保存処理へ任せる。
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
