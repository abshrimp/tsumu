// @ts-ignore .open-next/worker.js はビルド時に生成される
import nextHandler from "./.open-next/worker.js";
import { DurableObject } from "cloudflare:workers";
import { getDbFromBinding, type D1LikeDatabase } from "./lib/db";
import { runAssetGc, type AssetGcDocumentNamespace } from "./lib/asset-gc";
import type { KVLikeNamespace } from "./lib/kv";
export { DocumentRoom } from "./document-room";
import {
  readCurrentDoc,
  saveCurrentDoc,
  saveDocPatch,
  validateDocBody,
} from "./lib/doc-storage";
import type {
  CollabClientMessage,
  DocChangeMessage,
} from "./lib/collab";
import { parseActivityUser, recordActivity, type ActivityUser } from "./lib/activity";
import { isSiteId, getSiteRoomKey, recordSiteSavedAt } from "./lib/sites";
import { isEmailAllowed, parseAllowedEmails } from "./lib/allowlist";
import { isDocPatch } from "./lib/doc-patch";

interface WorkerEnv {
  COLLAB_ROOM: DurableObjectNamespace<CollaborationRoom>;
  DOC_STORE: DurableObjectNamespace;
  ASSETS_KV?: KVLikeNamespace;
  ASSET_GC_ENABLED?: string;
  ASSET_GC_GRACE_DAYS?: string;
  ASSET_GC_MAX_DELETES?: string;
  /** 未設定なら編集データはブラウザ内に保存する（クライアントがHTTPの503を見て切り替える） */
  DB?: D1LikeDatabase;
  ALLOWED_EMAILS?: string;
  AUTH_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
}

function signInConfigured(env: WorkerEnv): boolean {
  return Boolean(env.AUTH_SECRET && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
}

/** siteId は接続時の ?site=、user は Worker が認証の結果から渡すログイン中の人 */
type SocketAttachment = { clientId: string; siteId: string; roomKey?: string; user?: ActivityUser | null };

/** Worker から部屋へ、ログイン中の人を渡すヘッダー（ブラウザから来た同名のヘッダーは捨てる） */
const USER_HEADER = "X-Editor-User";
const ROOM_KEY_HEADER = "X-Editor-Room-Key";

// 保存層の例外には本文が含まれうるため、固定の案内文だけを公開する。
// 日本語かどうかや部分一致では判定せず、未知の例外はログにも残さない。
const PUBLIC_DOCUMENT_ERRORS = new Set([
  "保存先が設定されていません",
  "サイトが指定されていません",
  "サイトが見つかりません",
  "DOC_STORE binding is missing",
  "未対応のメッセージです",
  "不正なリクエスト",
  "JSONが壊れています",
  "ドキュメントが大きすぎて、保存先に入りきりません",
  "編集データの1項目が大きすぎます",
  "保存済み編集データが破損しています",
  "バックアップが破損しています",
  "Unsupported document storage schema",
  "Unsupported storage schema",
  "D1バインディング（DB）がありません",
  "Invalid document path",
  "Invalid document patch",
  "Missing patch collection",
  "Invalid patch key",
]);

type AttachableSocket = WebSocket & {
  serializeAttachment(value: SocketAttachment): void;
  deserializeAttachment(): SocketAttachment | null;
};

/** 1サイト分の接続を集約し、保存完了通知を配信する（部屋の名前 = サイトID）。 */
export class CollaborationRoom extends DurableObject<WorkerEnv> {
  private async readAllowedEmails(): Promise<string[]> {
    if (!this.env.DB) return [];
    const db = await getDbFromBinding(this.env.DB);
    const rs = await db.execute("SELECT email FROM allowed_emails");
    return rs.rows.map((r) => String(r.email));
  }

  private async authorized(
    socket: WebSocket,
    readExtra = () => this.readAllowedEmails()
  ): Promise<boolean> {
    const user = (socket as AttachableSocket).deserializeAttachment()?.user;
    const allowed = user
      ? await isEmailAllowed(user.email, parseAllowedEmails(this.env.ALLOWED_EMAILS), readExtra)
      : !signInConfigured(this.env);
    if (!allowed) socket.close(1008, "Access revoked");
    return allowed;
  }

  private async broadcast(raw: string, except?: WebSocket, senderId?: string): Promise<void> {
    // 同じ配信内だけ共有する。次の配信では取り直し、許可削除を反映する。
    let allowedEmails: Promise<string[]> | undefined;
    const readExtra = () => allowedEmails ??= this.readAllowedEmails();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        const attachment = (socket as AttachableSocket).deserializeAttachment();
        if (senderId && attachment?.clientId === senderId) continue;
        if (!await this.authorized(socket, readExtra)) continue;
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
      await this.broadcast(raw, undefined, senderId);
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

    const rawUser = request.headers.get(USER_HEADER);
    let user: ActivityUser | null = null;
    if (rawUser !== null) {
      try {
        user = parseActivityUser(JSON.parse(decodeURIComponent(rawUser)));
      } catch {
        return new Response("Invalid user", { status: 401 });
      }
    }
    if (!user && (rawUser !== null || signInConfigured(this.env))) {
      return new Response("Invalid user", { status: 401 });
    }

    const roomKey = request.headers.get(ROOM_KEY_HEADER) ?? undefined;
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    (server as AttachableSocket).serializeAttachment({ clientId, siteId, roomKey, user });

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
    // A sender may disconnect while an awaited save is committing. Failure to
    // acknowledge it must not skip the activity record or notify other editors
    // of a failure after the write already succeeded.
    const reply = (raw: string) => {
      try { socket.send(raw); } catch { /* The peer disconnected. */ }
    };
    if (!await this.authorized(socket)) return;
    if (message === "ping") {
      reply("pong");
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
      reply(
        JSON.stringify({
          type: "error",
          requestId: "",
          message: "不正なメッセージです",
        })
      );
      return;
    }
    if (!decoded || typeof decoded !== "object") {
      reply(
        JSON.stringify({
          type: "error",
          requestId: "",
          message: "不正なメッセージです",
        })
      );
      return;
    }
    const input = decoded as CollabClientMessage;
    // JSON input has no runtime TypeScript guarantees. Check the type before
    // RegExp.test can coerce arrays/numbers or throw on an object.
    if (typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId)) {
      reply(
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
      const site = await db.execute({ sql: "SELECT 1 FROM sites WHERE id=? LIMIT 1", args: [siteId] });
      if (!site.rows.length) throw new Error("サイトが見つかりません");
      const roomKey = await getSiteRoomKey(db, siteId);
      if (this.env.DB.__tsumuBackend !== "sqlite" &&
        (!roomKey || attachment?.roomKey !== roomKey)) {
        socket.close(1008, "Site generation changed");
        return;
      }
      const remote = roomKey && this.env.DOC_STORE
        ? this.env.DOC_STORE.get(this.env.DOC_STORE.idFromName(roomKey)) as unknown as
        | {
            getSnapshot(): Promise<{ body: string; rev: string; savedAt: number } | null>;
            getMetadata(): Promise<{ rev: string; savedAt: number } | null>;
            replaceDocument(raw: string, base: string | null): Promise<import("./lib/doc-storage").SaveDocResult>;
            patchDocument(patch: import("./lib/doc-patch").DocPatch, base: string): Promise<import("./lib/doc-storage").SaveDocResult>;
          } : undefined;
      if (!remote && this.env.DB.__tsumuBackend !== "sqlite") {
        throw new Error("DOC_STORE binding is missing");
      }
      if (input.type === "load") {
        // Reconnecting editors already hold this revision. A metadata lookup
        // avoids rebuilding and transferring the entire document on every
        // WebSocket reconnect (and avoids parsing it again on the main thread).
        if (remote && typeof input.knownRev === "string" && input.knownRev.length <= 30) {
          const meta = await remote.getMetadata();
          if (meta?.rev === input.knownRev) {
            // Even a metadata-only response must fence deleted/recreated sites.
            if (roomKey && await getSiteRoomKey(db, siteId) !== roomKey) {
              socket.close(1008, "Site generation changed");
              return;
            }
            reply(JSON.stringify({
              type: "snapshot",
              requestId: input.requestId,
              exists: true,
              rev: meta.rev,
              savedAt: meta.savedAt,
            }));
            return;
          }
        }
        const current = remote ? await remote.getSnapshot() : await readCurrentDoc(db, siteId);
        // The site can be deleted/recreated while the document RPC is in flight.
        // Fence empty results too: exists:false starts an initial client save.
        if (roomKey && await getSiteRoomKey(db, siteId) !== roomKey) {
          socket.close(1008, "Site generation changed");
          return;
        }
        if (!current) {
          reply(
            JSON.stringify({
              type: "snapshot",
              requestId: input.requestId,
              exists: false,
            })
          );
          return;
        }
        reply(
          `{"type":"snapshot","requestId":"${input.requestId}","exists":true,"rev":"${current.rev}","savedAt":${current.savedAt},"doc":${current.body}}`
        );
        return;
      }

      if (input.type !== "save" && input.type !== "patch") {
        throw new Error("未対応のメッセージです");
      }
      let result;
      if (input.type === "patch") {
        if (typeof input.base !== "string" || !isDocPatch(input.patch)) throw new Error("不正なリクエスト");
        result = remote ? await remote.patchDocument(input.patch, input.base)
          : await saveDocPatch(db, siteId, input.patch, input.base);
      } else {
        if (!input.doc || (input.base !== null && typeof input.base !== "string")) {
          throw new Error("不正なリクエスト");
        }
        const raw = JSON.stringify(input.doc);
        const validationError = validateDocBody(raw);
        if (validationError) throw new Error(validationError);
        result = remote ? await remote.replaceDocument(raw, input.base)
          : await saveCurrentDoc(db, siteId, raw, input.base);
      }
      let generationChanged = false;
      let generationCheckFailed = false;
      if (roomKey) {
        try {
          generationChanged = await getSiteRoomKey(db, siteId) !== roomKey;
        } catch (error) {
          // 保存は確定済み。後続の照会失敗で失敗扱いにせず、元の部屋だけへ通知する。
          // 競合結果は本文を含むため、世代を確認できなければ返さない。
          if (result.kind !== "saved") throw error;
          generationCheckFailed = true;
          console.error("[collab] committed save generation check failed");
        }
      }
      if (generationChanged) {
        socket.close(1008, "Site generation changed");
        return;
      }
      if (result.kind === "missing") throw new Error("サイトが見つかりません");
      if (result.kind === "saved") {
        // ホーム画面の「〜に編集」は D1 の saved_at/updated_at を読むので、ここでも反映する
        try {
          await recordSiteSavedAt(db, siteId, remote ? roomKey : null, result.savedAt);
        } catch (error) {
          // 本体の保存は成功しているので、時刻の反映失敗は保存失敗扱いにしない
          console.error("Failed to record site savedAt", error);
        }
      }
      if (result.kind === "conflict") {
        const current = result.current;
        reply(
          `{"type":"conflict","requestId":"${input.requestId}","rev":"${current.rev}","savedAt":${current.savedAt},"doc":${current.body}}`
        );
        return;
      }

      reply(
        JSON.stringify({
          type: "saved",
          requestId: input.requestId,
          rev: result.rev,
          savedAt: result.savedAt,
        })
      );
      // 右下の「保存」にホバーしたときに出す、最近編集した人
      // 照会に失敗したときは、同じIDで作り直されたサイトへ履歴を書き込まない。
      if (!generationCheckFailed) {
        await recordActivity(db, siteId, "edit", attachment?.user ?? null, result.savedAt, roomKey);
      }
      const metadata = { rev: result.rev, savedAt: result.savedAt };
      const update: DocChangeMessage = input.type === "patch"
        ? { ...metadata, type: "doc-patched", base: input.base, patch: input.patch }
        : { ...metadata, type: "doc-updated", doc: input.doc };
      await this.broadcast(JSON.stringify(update), socket);
    } catch (error) {
      reply(
        JSON.stringify({
          type: "error",
          requestId: input.requestId,
          message: error instanceof Error && PUBLIC_DOCUMENT_ERRORS.has(error.message)
            ? error.message : "処理に失敗しました",
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
  scheduled(event: { cron?: string }, env: WorkerEnv, ctx: ExecutionContext): void {
    // Every day: only expired D1 candidates. Weekly: reconcile one KV page
    // to find failed uploads or assets orphaned by deleted sites.
    const discoverUntracked = event.cron === "0 19 * * 0";
    if (!env.DB || !env.ASSETS_KV || !env.DOC_STORE ||
        (discoverUntracked && !env.ASSETS_KV.list)) return;
    ctx.waitUntil((async () => {
      try {
        const db = await getDbFromBinding(env.DB!);
        await runAssetGc({
          db, kv: env.ASSETS_KV!,
          rooms: env.DOC_STORE as unknown as AssetGcDocumentNamespace,
          graceDays: env.ASSET_GC_GRACE_DAYS === undefined ? undefined : Number(env.ASSET_GC_GRACE_DAYS),
          maxDeletes: env.ASSET_GC_MAX_DELETES === undefined ? undefined : Number(env.ASSET_GC_MAX_DELETES),
          dryRun: env.ASSET_GC_ENABLED !== "true",
          discoverUntracked,
        });
      } catch {
        // A failed run records the number of completed deletes in D1.
        console.error("[asset-gc] run aborted or failed; see asset_gc_runs");
      }
    })());
  },
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
    if (!user && (auth?.user !== null || signInConfigured(env))) {
      return new Response("Invalid user", { status: 401 });
    }

    const siteId = url.searchParams.get("site");
    if (!isSiteId(siteId)) {
      return new Response("Invalid site", { status: 400 });
    }
    // Collaboration WebSockets are isolated by the same per-creation key as
    // document storage. Old sockets never join a recreated site's new room.
    let roomName = siteId;
    if (env.DB && env.DB.__tsumuBackend !== "sqlite") {
      const db = await getDbFromBinding(env.DB);
      const key = await getSiteRoomKey(db, siteId);
      if (!key) return new Response("Site storage not initialized", { status: 404 });
      roomName = key;
    }
    const room = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(roomName));
    const headers = new Headers(request.headers);
    headers.delete(USER_HEADER);
    headers.delete(ROOM_KEY_HEADER);
    if (user) headers.set(USER_HEADER, encodeURIComponent(JSON.stringify(user)));
    if (roomName !== siteId) headers.set(ROOM_KEY_HEADER, roomName);
    return room.fetch(new Request(request, { headers }));
  },
};

// OpenNext側でこれらを有効化した場合にもカスタムWorkerから公開できるようにする
// @ts-ignore .open-next/worker.js はビルド時に生成される
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
