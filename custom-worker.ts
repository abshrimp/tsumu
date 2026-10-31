// @ts-ignore .open-next/worker.js はビルド時に生成される
import nextHandler from "./.open-next/worker.js";
import { DurableObject } from "cloudflare:workers";
import { getDbFromBinding, type D1LikeDatabase } from "./lib/db";
import { runAssetGc, type AssetGcDocumentNamespace } from "./lib/asset-gc";
import type { KVLikeNamespace } from "./lib/kv";
export { DocumentRoom } from "./document-room";
import { validateDocBody, type SaveDocResult } from "./lib/doc-storage";
import type {
  CollabClientMessage,
  DocChangeMessage,
} from "./lib/collab";
import { parseActivityUser, recordActivity, type ActivityUser } from "./lib/activity";
import { isSiteId, getSiteRoomKey, recordSiteSavedAt } from "./lib/sites";
import { getAccountRole, isEmailAllowed, parseAllowedEmails } from "./lib/allowlist";
import { collaborationIdentityAllowed } from "./lib/anonymous";
import { isDocPatch } from "./lib/doc-patch";

interface WorkerEnv {
  COLLAB_ROOM: DurableObjectNamespace<CollaborationRoom>;
  DOC_STORE: DurableObjectNamespace;
  ASSETS_KV?: KVLikeNamespace;
  ASSET_GC_ENABLED?: string;
  ASSET_GC_GRACE_DAYS?: string;
  ASSET_GC_MAX_DELETES?: string;
  /** 未設定なら、編集データはブラウザ内に保存する（クライアントが HTTP の 503 を見て切り替える） */
  DB?: D1LikeDatabase;
  ALLOWED_EMAILS?: string;
  ALLOW_ANONYMOUS?: string;
  TSUMU_STORAGE_MODE?: string;
  AUTH_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
}

async function siteRoleForSocket(db: Awaited<ReturnType<typeof getDbFromBinding>>, siteId: string, email: string | null, env: WorkerEnv): Promise<"owner" | "editor" | "viewer" | null> {
  if (!signInConfigured(env) && env.ALLOW_ANONYMOUS === "true") return "owner";
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (parseAllowedEmails(env.ALLOWED_EMAILS).includes(normalized)) return "owner";
  const result = await db.execute({ sql: "SELECT role FROM site_members WHERE site_id=? AND email=?", args: [siteId, normalized] });
  const role = result.rows[0]?.role;
  return role === "owner" || role === "editor" || role === "viewer" ? role : null;
}

function signInConfigured(env: WorkerEnv): boolean {
  return Boolean(env.AUTH_SECRET && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
}

/** siteId は接続時の ?site=、user は Worker が認証の結果から渡すログイン中の人 */
type SocketAttachment = { clientId: string; siteId: string; roomKey?: string; user?: ActivityUser | null };

/** Worker から部屋へログイン中の人を渡すヘッダー（ブラウザから来た同じ名前のヘッダーは捨てる） */
const USER_HEADER = "X-Editor-User";
const ROOM_KEY_HEADER = "X-Editor-Room-Key";

// 保存層の例外には本文が含まれることがあるため、公開するのは固定の案内文だけにする。
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

/** 1サイト分の接続をまとめ、保存の完了を通知する（部屋の名前 = サイト ID）。 */
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
    const attachment = (socket as AttachableSocket).deserializeAttachment();
    const user = attachment?.user;
    const allowed = collaborationIdentityAllowed(!!user, signInConfigured(this.env), this.env) &&
      (!user || await isEmailAllowed(user.email, parseAllowedEmails(this.env.ALLOWED_EMAILS), readExtra)) &&
      (!this.env.DB || (!!attachment?.siteId &&
        await siteRoleForSocket(await getDbFromBinding(this.env.DB), attachment.siteId, user?.email ?? null, this.env) !== null));
    if (!allowed) socket.close(1008, "Access revoked");
    return allowed;
  }

  private async broadcast(raw: string, except?: WebSocket, senderId?: string): Promise<void> {
    // 同じ配信の中だけで共有する。次の配信では取得し直し、許可の削除を反映する。
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
        // 切断済みのソケットは、ランタイムが一覧から除く
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
    if ((!user && rawUser !== null) || !collaborationIdentityAllowed(!!user, signInConfigured(this.env), this.env)) {
      return new Response("Invalid user", { status: 401 });
    }

    const roomKey = request.headers.get(ROOM_KEY_HEADER) ?? undefined;
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    (server as AttachableSocket).serializeAttachment({ clientId, siteId, roomKey, user });

    return new Response(null, {
      status: 101,
      // Cloudflare Workers 固有の Response の拡張
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    // 保存の確定を待っている間に、送り手が切断することがある。その返信に失敗しても、
    // 編集の記録を省いたり、書き込みがすでに成功した後で他の編集者に失敗を
    // 知らせたりしてはいけない。
    const reply = (raw: string) => {
      try { socket.send(raw); } catch { /* The peer disconnected. */ }
    };
    if (!await this.authorized(socket)) return;
    if (message === "ping") {
      reply("pong");
      return;
    }

    if ((typeof message === "string" ? message.length : message.byteLength) > 64 * 1024 * 1024) {
      reply(JSON.stringify({ type: "error", requestId: "", message: "リクエストが大きすぎます" }));
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
    // JSON の入力は、実行時には TypeScript の型が保証されない。RegExp.test が配列や数値を
    // 文字列に変換したり、オブジェクトで例外を投げたりしないよう、先に型を確かめる。
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
      if (!roomKey || attachment?.roomKey !== roomKey) {
        socket.close(1008, "Site generation changed");
        return;
      }
      if (!this.env.DOC_STORE) {
        throw new Error("DOC_STORE binding is missing");
      }
      const remote = this.env.DOC_STORE.get(this.env.DOC_STORE.idFromName(roomKey)) as unknown as {
        getSnapshot(): Promise<{ body: string; rev: string; savedAt: number } | null>;
        getMetadata(): Promise<{ rev: string; savedAt: number } | null>;
        replaceDocument(raw: string, base: string | null): Promise<SaveDocResult>;
        patchDocument(patch: import("./lib/doc-patch").DocPatch, base: string): Promise<SaveDocResult>;
      };
      if (input.type === "load") {
        // 再接続した編集者は、すでにこの版を持っている。メタデータだけを照会すれば、
        // WebSocket の再接続のたびに文書全体を組み立てて送ることも、
        // メインスレッドで改めてパースすることも避けられる。
        if (typeof input.knownRev === "string" && input.knownRev.length <= 30) {
          const meta = await remote.getMetadata();
          if (meta?.rev === input.knownRev) {
            // メタデータだけの応答でも、削除されたサイトや作り直されたサイトは遮断しなければならない。
            if (await getSiteRoomKey(db, siteId) !== roomKey) {
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
        const current = await remote.getSnapshot();
        // 文書の RPC の処理中に、サイトが削除されたり作り直されたりすることがある。
        // 空の結果も遮断する。exists:false を返すと、クライアントが最初の保存を始めてしまう。
        if (await getSiteRoomKey(db, siteId) !== roomKey) {
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
      // Recheck permissions on every write, including after an open socket is downgraded.
      const identity = attachment?.user?.email;
      const role = identity
        ? await getAccountRole(identity, parseAllowedEmails(this.env.ALLOWED_EMAILS), async (email) => {
            const result = await db.execute({
              sql: "SELECT role FROM allowed_emails WHERE email = ? LIMIT 1", args: [email],
            });
            return result.rows[0]?.role as "editor" | "viewer" | null ?? null;
          })
        : signInConfigured(this.env) ? null : "editor";
      const scoped = await siteRoleForSocket(db, siteId, identity ?? null, this.env);
      if (role !== "editor" || (scoped !== "owner" && scoped !== "editor")) {
        reply(JSON.stringify({ type: "error", requestId: input.requestId, message: "You have view-only access" }));
        return;
      }
      let result: SaveDocResult;
      if (input.type === "patch") {
        if (typeof input.base !== "string" || !isDocPatch(input.patch)) throw new Error("不正なリクエスト");
        result = await remote.patchDocument(input.patch, input.base);
      } else {
        if (!input.doc || (input.base !== null && typeof input.base !== "string")) {
          throw new Error("不正なリクエスト");
        }
        const raw = JSON.stringify(input.doc);
        const validationError = validateDocBody(raw);
        if (validationError) throw new Error(validationError);
        result = await remote.replaceDocument(raw, input.base);
      }
      let generationChanged = false;
      let generationCheckFailed = false;
      try {
        generationChanged = await getSiteRoomKey(db, siteId) !== roomKey;
      } catch (error) {
        // 保存は確定している。その後の照会に失敗しても失敗とはせず、元の部屋にだけ通知する。
        // 競合の結果は本文を含むため、世代を確認できなければ返さない。
        if (result.kind !== "saved") throw error;
        generationCheckFailed = true;
        console.error("[collab] committed save generation check failed");
      }
      if (generationChanged) {
        socket.close(1008, "Site generation changed");
        return;
      }
      if (result.kind === "missing") throw new Error("サイトが見つかりません");
      if (result.kind === "saved") {
        // ホーム画面の「〜に編集」は D1 の saved_at / updated_at を読むため、ここでも反映する
        try {
          await recordSiteSavedAt(db, siteId, remote ? roomKey : null, result.savedAt);
        } catch (error) {
          // 本体の保存は成功しているため、時刻の反映に失敗しても保存の失敗とはしない
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
      // 右下の「保存」にホバーしたときに表示する、最近編集した人を記録する。
      // 照会に失敗したときは、同じ ID で作り直されたサイトに履歴を書き込まない。
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
    // Browser-only instances never write shared KV assets or maintain shared GC.
    if (env.TSUMU_STORAGE_MODE === "local") return;
    // 毎日の処理: 期限切れの D1 の候補だけを扱う。週1回の処理: KV の1ページ分を照合し、
    // アップロードの失敗や、削除したサイトに残ったアセットを見つける。
    const discoverUntracked = event.cron === "0 19 * * SUN";
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
        // 失敗した処理では、完了した削除の件数が D1 に記録される。
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

    // The WebSocket endpoint accesses D1 directly, bypassing Next.js DB checks.
    // Never expose existing shared site rooms when this instance is anonymous/local.
    if (env.TSUMU_STORAGE_MODE === "local") {
      return new Response("Collaboration requires server-backed site storage", { status: 503 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    // Cookie が自動で送られる WebSocket を、別のサイトから乗っ取られないようにする
    if (request.headers.get("Origin") !== url.origin) {
      return new Response("Invalid origin", { status: 403 });
    }

    const authorized = await authorizeWebSocket(request, env, ctx);
    if (!authorized.ok) return authorized;
    const auth = (await authorized.json().catch(() => null)) as { user?: unknown } | null;
    const user = parseActivityUser(auth?.user);
    if ((!user && auth?.user !== null) || !collaborationIdentityAllowed(!!user, signInConfigured(env), env)) {
      return new Response("Invalid user", { status: 401 });
    }

    const siteId = url.searchParams.get("site");
    if (!isSiteId(siteId)) {
      return new Response("Invalid site", { status: 400 });
    }
    // 同時編集の WebSocket は、文書の保存と同じサイト作成ごとのキーで分ける。
    // 古いソケットが、作り直したサイトの新しい部屋に加わることはない。
    if (!env.DB) return new Response("Database not configured", { status: 503 });
    const db = await getDbFromBinding(env.DB);
    const access = await siteRoleForSocket(db, siteId, user?.email ?? null, env);
    if (!access) return new Response("Site not found", { status: 404 });
    const roomName = await getSiteRoomKey(db, siteId);
    if (!roomName) return new Response("Site storage not initialized", { status: 404 });
    const room = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(roomName));
    const headers = new Headers(request.headers);
    headers.delete(USER_HEADER);
    headers.delete(ROOM_KEY_HEADER);
    if (user) headers.set(USER_HEADER, encodeURIComponent(JSON.stringify(user)));
    headers.set(ROOM_KEY_HEADER, roomName);
    return room.fetch(new Request(request, { headers }));
  },
};

// OpenNext 側でこれらを有効にした場合も、カスタム Worker から公開できるようにする
// @ts-ignore .open-next/worker.js はビルド時に生成される
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
