import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { allowedEmails, auth, authConfigured } from "../../../auth";
import {
  addAllowedEmail,
  listAllowedEmails,
  removeAllowedEmail,
} from "../../../lib/allowlist";
import { dbConfigured } from "../../../lib/db";
import { userMessage } from "../../../lib/errors";

export const maxDuration = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 認証済みの自分のメールアドレスを返す。使えない場合はレスポンスを返す */
async function requireMe(): Promise<string | NextResponse> {
  const tr = await serverTr();
  if (!authConfigured()) {
    return NextResponse.json(
      { error: tr("ログインが設定されていないため、アカウント管理は使えません") },
      { status: 503 }
    );
  }
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: tr("ログインが必要です") }, { status: 401 });
  }
  return email;
}

async function listResponse(me: string): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    me,
    fixed: allowedEmails(),
    extra: await listAllowedEmails(),
  });
}

/** 許可アカウントの一覧（固定 = 環境変数、追加 = D1の動的リスト） */
export async function GET() {
  const tr = await serverTr();
  const me = await requireMe();
  if (me instanceof NextResponse) return me;
  if (!dbConfigured()) return await dbUnavailable();

  try {
    return await listResponse(me);
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "読み込めませんでした")) },
      { status: 502 }
    );
  }
}

/** アカウントを追加 */
export async function POST(req: Request) {
  const tr = await serverTr();
  const me = await requireMe();
  if (me instanceof NextResponse) return me;
  if (!dbConfigured()) return await dbUnavailable();

  let email: string;
  try {
    email = String((await req.json()).email ?? "")
      .trim()
      .toLowerCase();
  } catch {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: tr("メールアドレスの形式が正しくありません") },
      { status: 400 }
    );
  }

  try {
    const extra = await listAllowedEmails();
    if (allowedEmails().includes(email) || extra.includes(email)) {
      return NextResponse.json(
        { error: tr("このアカウントはすでに許可されています") },
        { status: 400 }
      );
    }
    await addAllowedEmail(email);
    return listResponse(me);
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "保存できませんでした")) },
      { status: 502 }
    );
  }
}

/** アカウントを削除（自分自身・環境変数の固定分は不可） */
export async function DELETE(req: Request) {
  const tr = await serverTr();
  const me = await requireMe();
  if (me instanceof NextResponse) return me;
  if (!dbConfigured()) return await dbUnavailable();

  const email = (new URL(req.url).searchParams.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json({ error: tr("指定が正しくありません") }, { status: 400 });
  }
  if (email === me) {
    return NextResponse.json(
      { error: tr("自分自身のアカウントは削除できません") },
      { status: 400 }
    );
  }
  if (allowedEmails().includes(email)) {
    return NextResponse.json(
      {
        error:
          tr("サーバーの設定で許可されているため、ここからは削除できません"),
      },
      { status: 400 }
    );
  }

  try {
    const removed = await removeAllowedEmail(email);
    if (!removed) {
      return NextResponse.json(
        { error: tr("このアカウントは見つかりません") },
        { status: 404 }
      );
    }
    return listResponse(me);
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "削除できませんでした")) },
      { status: 502 }
    );
  }
}
