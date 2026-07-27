import type { NextRequest } from "next/server";
import { authConfigured, handlers } from "../../../../auth";
import { serverTr } from "../../../../lib/i18n-server";

async function handle(req: NextRequest) {
  if (!authConfigured()) {
    const tr = await serverTr();
    return Response.json({ error: tr("ログインが設定されていません") }, { status: 503 });
  }
  return req.method === "POST" ? handlers.POST(req) : handlers.GET(req);
}

export { handle as GET, handle as POST };
