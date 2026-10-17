import { NextResponse } from "next/server";
import { requireAuth, sessionUser } from "../../../../lib/server";
import { isEmailAllowed } from "../../../../lib/allowlist";
import { authConfigured } from "../../../../auth";
import { siteIdOf } from "../../../../lib/site-server";
import { subscribeDocUpdates } from "../../../../lib/collab-events";
import { collabRoomAvailable } from "../../../../lib/collab";

export const dynamic = "force-dynamic";

/** 接続を保つための空のコメントを送る間隔（プロキシの無通信の切断を避ける） */
const HEARTBEAT_MS = 25_000;

/**
 * WebSocket（Durable Object）が使えないときの、保存の通知の受け取り口（Server-Sent Events）。
 * ほかの人が保存すると、WebSocket と同じ doc-updated のメッセージを送る。
 * 自分の保存（?clientId= と同じ送り主）は送らない
 */
export async function GET(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  // Cloudflare では通知は Durable Object から WebSocket で届き、ここには来ない。
  // 204 を返すとブラウザは再接続せず、WebSocket の再接続とポーリングで待つ
  if (collabRoomAvailable()) return new Response(null, { status: 204 });
  const params = new URL(req.url).searchParams;
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const clientId = params.get("clientId") ?? "";
  const user = await sessionUser();
  if (authConfigured() && !user) return new Response(null, { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pending = Promise.resolve();
      const close = () => {
        cleanup();
        try { controller.close(); } catch { /* すでに閉じている */ }
      };
      const send = (text: string) => {
        // 通知の順序を保ち、接続後に権限を外された人へ本文を送らない。
        pending = pending.then(async () => {
          if (closed) return;
          if (user && !await isEmailAllowed(user.email)) return close();
          if (!closed) controller.enqueue(encoder.encode(text));
        }).catch(close);
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
  });

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
