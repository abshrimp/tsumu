import { NextResponse } from "next/server";
import { collaborationIdentityAllowed } from "../../../../lib/anonymous";
import { requireAuth } from "../../../../lib/server";
import { isEmailAllowed } from "../../../../lib/allowlist";
import { authConfigured } from "../../../../auth";
import { siteIdOf } from "../../../../lib/site-server";
import { subscribeDocUpdates } from "../../../../lib/collab-events";
import { collabRoomAvailable } from "../../../../lib/collab";

export const dynamic = "force-dynamic";

/** 接続を保つための空のコメントを送る間隔（プロキシの無通信の切断を避ける） */
const HEARTBEAT_MS = 25_000;
const MAX_PENDING_MESSAGES = 32;
// 文書保存 API の本文の上限と同じ値。遅い接続ごとに通知を無制限に溜め込まない。
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

/**
 * WebSocket（Durable Object）が使えないときに、保存の通知を受け取る口（Server-Sent Events）。
 * 他の人が保存すると、WebSocket と同じ変更通知を送る。
 * 自分の保存（?clientId= と同じ送り主のもの）は送らない
 */
export async function GET(req: Request) {
  const user = await requireAuth("user");
  if (user instanceof NextResponse) return user;
  // Cloudflare では、通知は Durable Object から WebSocket で届くため、ここには来ない。
  // 204 を返すと、ブラウザは SSE に再接続せず、WebSocket の再接続とポーリングで変更を待つ
  if (collabRoomAvailable()) return new Response(null, { status: 204 });
  const params = new URL(req.url).searchParams;
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const clientId = params.get("clientId") ?? "";

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const pending: Uint8Array[] = [];
      let pendingBytes = 0;
      let sending = false;
      const close = () => {
        cleanup();
        try { controller.close(); } catch { /* すでに閉じている */ }
      };
      const overflow = () => {
        cleanup();
        // 古い差分を捨てて接続し直させる。クライアントは再接続のときに最新版と照合する。
        try { controller.error(new Error("Collaboration stream buffer exceeded")); } catch { /* すでに閉じている */ }
      };
      const drain = async () => {
        sending = true;
        try {
          while (!closed && pending.length) {
            // 通知の順序を保ちつつ、接続後に権限を外された人には本文を送らない。
            if (!collaborationIdentityAllowed(!!user, authConfigured())) return close();
            if (user && !await isEmailAllowed(user.email)) return close();
            if (closed) return;
            const bytes = pending.shift()!;
            pendingBytes -= bytes.byteLength;
            if (bytes.byteLength > (controller.desiredSize ?? 0)) return overflow();
            controller.enqueue(bytes);
          }
        } catch { close(); }
        finally { sending = false; }
      };
      const send = (text: string) => {
        if (closed) return;
        // UTF-8 に変換する前にも大まかな上限を設け、巨大な通知を余分にコピーしないようにする。
        if (pending.length >= MAX_PENDING_MESSAGES ||
            text.length + pendingBytes > (controller.desiredSize ?? 0)) return overflow();
        const bytes = encoder.encode(text);
        if (bytes.byteLength + pendingBytes > (controller.desiredSize ?? 0)) return overflow();
        pending.push(bytes);
        pendingBytes += bytes.byteLength;
        if (!sending) void drain();
      };
      const unsubscribe = subscribeDocUpdates(siteId, (message, raw) => {
        if (clientId && message.senderId === clientId) return;
        send(`data: ${raw}\n\n`);
      });
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        pending.length = 0;
        pendingBytes = 0;
        req.signal.removeEventListener("abort", close);
        cleanup = () => {};
      };
      req.signal.addEventListener("abort", close, { once: true });
      if (req.signal.aborted) close();
      // 接続できたことをすぐに伝える（ブラウザの open を早める）
      send(": connected\n\n");
    },
    cancel() {
      cleanup();
    },
  }, { highWaterMark: MAX_BUFFERED_BYTES, size: chunk => chunk.byteLength });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx などで応答をためずに流す
      "X-Accel-Buffering": "no",
    },
  });
}
