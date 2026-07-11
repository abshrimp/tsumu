import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publishDocUpdate } from "./collab-events";
import type { SiteDoc } from "./types";
import type { DocPatch } from "./doc-patch";


export interface DocUpdatedMessage {
  type: "doc-updated";
  rev: string;
  savedAt: number;
  senderId?: string;
  doc: SiteDoc;
}

export interface DocPatchedMessage {
  type: "doc-patched";
  base: string;
  patch: DocPatch;
  rev: string;
  savedAt: number;
  senderId?: string;
}
export type DocChangeMessage = DocUpdatedMessage | DocPatchedMessage;

export type CollabClientMessage =
  | { type: "load"; requestId: string }
  | {
      type: "save";
      requestId: string;
      base: string | null;
      doc: SiteDoc;
    }
  | {
      type: "patch";
      requestId: string;
      base: string;
      patch: DocPatch;
    };

export type CollabServerMessage =
  | (DocChangeMessage & { requestId?: never })
  | {
      type: "snapshot";
      requestId: string;
      exists: boolean;
      deltaVersion?: 1;
      rev?: string;
      savedAt?: number;
      doc?: SiteDoc;
    }
  | {
      type: "saved";
      requestId: string;
      rev: string;
      savedAt: number;
    }
  | {
      type: "conflict";
      requestId: string;
      rev: string;
      savedAt: number;
      doc: SiteDoc;
    }
  | { type: "error"; requestId: string; message: string };

interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

/** Durable Object（WebSocket の部屋）が使える環境か。Cloudflare Workers のときだけ true */
export function collabRoomAvailable(): boolean {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    return !!env.COLLAB_ROOM;
  } catch {
    return false;
  }
}

/**
 * D1への保存が完了したことを、接続中の共同編集クライアントへ通知する。
 * WebSocket/DOが未設定でも保存自体は成功させる。
 * Durable Object の無い環境（Node.js・Docker・next dev）では、同じプロセスの
 * /api/collab/events の接続へ届ける（lib/collab-events.ts）
 */
export function notifyDocUpdated(siteId: string, message: DocChangeMessage): void {
  publishDocUpdate(siteId, message);
  try {
    const cloudflare = getCloudflareContext();
    const env = cloudflare.env as unknown as Record<string, unknown>;
    const namespace = env.COLLAB_ROOM as
      | DurableObjectNamespaceLike
      | undefined;
    if (!namespace) return;

    // 共同編集の部屋はサイトごと（名前 = サイトID）
    const stub = namespace.get(namespace.idFromName(siteId));
    const notification = stub
      .fetch("https://collab.internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      })
      .then(() => undefined)
      .catch(() => undefined);

    cloudflare.ctx.waitUntil(notification);
  } catch {
    // next devやDO未設定時は、/api/collab/events（無ければポーリング）で届ける
  }
}
