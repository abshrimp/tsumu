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
import { JsonBodyTooLargeError, readJsonLimited } from "../../../lib/api-json";

export const maxDuration = 30;

// Bound untrusted input and validate fixed-size components (no repeated regex groups).
const validEmail = (email: string): boolean => {
  if (email.length < 3 || email.length > 254) return false;
  const at = email.indexOf("@");
  if (at < 1 || at > 64 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (/\s/.test(local) || domain.length > 253 || !domain.includes(".")) return false;
  return domain.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9-]+$/i.test(label));
};

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
  const identity = session?.user?.email;
  if (typeof identity !== "string" || !identity.trim()) {
    return NextResponse.json({ error: tr("ログインが必要です") }, { status: 401 });
  }
  return identity.toLowerCase();
}

async function listResponse(me: string): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    me,
    fixed: allowedEmails(),
    extra: await listAllowedEmails(),
  }, { headers: { "Cache-Control": "private, no-store" } });
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
    const input = await readJsonLimited(req, 16 * 1024, false);
    // 配列やオブジェクトを String(...) でメールアドレスに変換しない。
    if (!input || typeof input !== "object" || Array.isArray(input) || !("email" in input) || typeof input.email !== "string") {
      throw new TypeError("Invalid email type");
    }
    email = input.email.trim().toLowerCase();
  } catch (error) {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, {
      status: error instanceof JsonBodyTooLargeError ? 413 : 400,
    });
  }
  if (!validEmail(email)) {
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
    return await listResponse(me);
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

  const addresses = new URL(req.url).searchParams.getAll("email");
  if (addresses.length !== 1) {
    return NextResponse.json({ error: tr("指定が正しくありません") }, { status: 400 });
  }
  const email = addresses[0].trim().toLowerCase();
  if (!validEmail(email)) {
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
    return await listResponse(me);
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "削除できませんでした")) },
      { status: 502 }
    );
  }
}
