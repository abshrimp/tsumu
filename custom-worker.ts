// @ts-ignore .open-next/worker.js はビルド時に生成される
import nextHandler from "./.open-next/worker.js";
import { DurableObject } from "cloudflare:workers";
import { getDbFromBinding, type D1LikeDatabase } from "./lib/db";
import {
  readCurrentDoc,
  saveCurrentDoc,
  validateDocBody,
} from "./lib/doc-storage";
import type {
  CollabClientMessage,
  DocUpdatedMessage,
} from "./lib/collab";
import { parseActivityUser, recordActivity, type ActivityUser } from "./lib/activity";
import { isSiteId } from "./lib/sites";
import { isEmailAllowed, parseAllowedEmails } from "./lib/allowlist";

interface WorkerEnv {
  COLLAB_ROOM: DurableObjectNamespace<CollaborationRoom>;
  /** 未設定なら編集データはブラウザ内に保存する（クライアントがHTTPの503を見て切り替える） */
  DB?: D1LikeDatabase;
  ALLOWED_EMAILS?: string;
  AUTH_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
}

/** siteId は接続時の ?site=、user は Worker が認証の結果から渡すログイン中の人 */
type SocketAttachment = { clientId: string; siteId: string; user?: ActivityUser | null };

/** Worker から部屋へ、ログイン中の人を渡すヘッダー（ブラウザから来た同名のヘッダーは捨てる） */
const USER_HEADER = "X-Editor-User";

type AttachableSocket = WebSocket & {
  serializeAttachment(value: SocketAttachment): void;
  deserializeAttachment(): SocketAttachment | null;
};

/** 1サイト分の接続を集約し、保存完了通知を配信する（部屋の名前 = サイトID）。 */
export class CollaborationRoom extends DurableObject<WorkerEnv> {
  private async authorized(socket: WebSocket): Promise<boolean> {
    const user = (socket as AttachableSocket).deserializeAttachment()?.user;
    const allowed = user
      ? await isEmailAllowed(user.email, parseAllowedEmails(this.env.ALLOWED_EMAILS), async () => {
          if (!this.env.DB) return [];
          const db = await getDbFromBinding(this.env.DB);
          const rs = await db.execute("SELECT email FROM allowed_emails");
          return rs.rows.map((r) => String(r.email));
        })
      : !(this.env.AUTH_SECRET && this.env.AUTH_GOOGLE_ID && this.env.AUTH_GOOGLE_SECRET);
    if (!allowed) socket.close(1008, "Access revoked");
    return allowed;
  }

  private async broadcast(raw: string, except?: WebSocket): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        if (!await this.authorized(socket)) continue;
        socket.send(raw);
      } catch {
        // 切断済みソケットはランタイムが一覧から除外する
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const raw = await request.text();
      let senderId: string | undefined;
      try {
        senderId = (JSON.parse(raw) as { senderId?: string }).senderId;
      } catch {
        return new Response("Invalid message", { status: 400 });
      }
      for (const socket of this.ctx.getWebSockets()) {
        try {
          const attachment = (
            socket as WebSocket & {
              deserializeAttachment(): SocketAttachment | null;
            }
          ).deserializeAttachment();
          if (senderId && attachment?.clientId === senderId) continue;
          if (!await this.authorized(socket)) continue;
          socket.send(raw);
        } catch {
          // 切断済みソケットはランタイムが一覧から除外する
        }
      }
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const clientId = url.searchParams.get("clientId") ?? "";
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(clientId)) {
      return new Response("Invalid client id", { status: 400 });
    }
    const siteId = url.searchParams.get("site");
    if (!isSiteId(siteId)) {
      return new Response("Invalid site", { status: 400 });
    }

    let user: ActivityUser | null = null;
    try {
      const raw = request.headers.get(USER_HEADER);
      user = raw ? parseActivityUser(JSON.parse(decodeURIComponent(raw))) : null;
    } catch {
      user = null;
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    (server as AttachableSocket).serializeAttachment({ clientId, siteId, user });

    return new Response(null, {
      status: 101,
      // Cloudflare Workers固有のResponse拡張
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (!await this.authorized(socket)) return;
    if (message === "ping") {
      socket.send("pong");
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message)
      );
    } catch {
      socket.send(
        JSON.stringify({
          type: "error",
          requestId: "",
          message: "不正なメッセージです",
        })
      );
      return;
    }
    if (!decoded || typeof decoded !== "object") {
      socket.send(
        JSON.stringify({
          type: "error",
          requestId: "",
          message: "不正なメッセージです",
        })
      );
      return;
    }
    const input = decoded as CollabClientMessage;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId ?? "")) {
      socket.send(
        JSON.stringify({
          type: "error",
          requestId: "",
          message: "不正なリクエストIDです",
        })
      );
      return;
    }

    try {
      if (!this.env.DB) {
        console.error("D1 database is not configured: set database_id on the DB binding in wrangler.jsonc");
        throw new Error("保存先が設定されていません");
      }
      const db = await getDbFromBinding(this.env.DB);
      const attachment = (socket as AttachableSocket).deserializeAttachment();
      const siteId = attachment?.siteId;
      if (!siteId) throw new Error("サイトが指定されていません");
      if (input.type === "load") {
        const current = await readCurrentDoc(db, siteId);
        if (!current) {
          socket.send(
            JSON.stringify({
              type: "snapshot",
              requestId: input.requestId,
              exists: false,
            })
          );
          return;
        }
        socket.send(
          `{"type":"snapshot","requestId":"${input.requestId}","exists":true,"rev":"${current.rev}","savedAt":${current.savedAt},"doc":${current.body}}`
        );
        return;
      }

      if (input.type !== "save" || !input.doc) {
        throw new Error("未対応のメッセージです");
      }
      const raw = JSON.stringify(input.doc);
      const validationError = validateDocBody(raw);
      if (validationError) throw new Error(validationError);

      const result = await saveCurrentDoc(db, siteId, raw, input.base);
      if (result.kind === "missing") throw new Error("サイトが見つかりません");
      if (result.kind === "conflict") {
        const current = result.current;
        socket.send(
          `{"type":"conflict","requestId":"${input.requestId}","rev":"${current.rev}","savedAt":${current.savedAt},"doc":${current.body}}`
        );
        return;
      }

      socket.send(
        JSON.stringify({
          type: "saved",
          requestId: input.requestId,
          rev: result.rev,
          savedAt: result.savedAt,
        })
      );
      // 右下の「保存」にホバーしたときに出す、最近編集した人
      await recordActivity(db, siteId, "edit", attachment?.user ?? null, result.savedAt);
      const update: DocUpdatedMessage = {
        type: "doc-updated",
        rev: result.rev,
        savedAt: result.savedAt,
        doc: input.doc,
      };
      await this.broadcast(JSON.stringify(update), socket);
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "error",
          requestId: input.requestId,
          message: error instanceof Error ? error.message : "処理に失敗しました",
        })
      );
    }
  }

  webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string
  ): void {
    socket.close(code, reason);
  }
}

async function authorizeWebSocket(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext
): Promise<Response> {
  const authUrl = new URL("/api/collab/authorize", request.url);
  const headers = new Headers(request.headers);
  headers.delete("Upgrade");
  headers.delete("Connection");
  headers.delete("Sec-WebSocket-Key");
  headers.delete("Sec-WebSocket-Version");
  headers.delete("Sec-WebSocket-Extensions");

  return nextHandler.fetch(
    new Request(authUrl, { method: "GET", headers }),
    env,
    ctx
  );
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/collab") {
      return nextHandler.fetch(request, env, ctx);
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    // Cookieが自動送信されるWebSocketのクロスサイト乗っ取りを防ぐ
    if (request.headers.get("Origin") !== url.origin) {
      return new Response("Invalid origin", { status: 403 });
    }

    const authorized = await authorizeWebSocket(request, env, ctx);
    if (!authorized.ok) return authorized;
    const auth = (await authorized.json().catch(() => null)) as { user?: unknown } | null;
    const user = parseActivityUser(auth?.user);

    const siteId = url.searchParams.get("site");
    if (!isSiteId(siteId)) {
      return new Response("Invalid site", { status: 400 });
    }
    const room = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(siteId));
    const headers = new Headers(request.headers);
    headers.delete(USER_HEADER);
    if (user) headers.set(USER_HEADER, encodeURIComponent(JSON.stringify(user)));
    return room.fetch(new Request(request, { headers }));
  },
};

// OpenNext側でこれらを有効化した場合にもカスタムWorkerから公開できるようにする
// @ts-ignore .open-next/worker.js はビルド時に生成される
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
