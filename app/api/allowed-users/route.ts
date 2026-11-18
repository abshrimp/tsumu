import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { isValidEmail } from "../../../lib/email";
import { auth, authConfigured } from "../../../lib/auth";
import {
  addAllowedEmail,
  allowedEmails,
  listAllowedAccounts,
  removeAllowedEmail,
  updateAllowedAccountRole,
  isAccountRole,
  type AccountRole,
} from "../../../lib/allowlist";
import { dbConfigured } from "../../../lib/db";
import { userMessage } from "../../../lib/errors";
import { jsonErrorStatus, readJsonObjectLimited } from "../../../lib/api-json";

export const maxDuration = 30;

/** 認証済みの自分のメールアドレスを返す。確認できない場合はエラーのレスポンスを返す */
async function requireMe(): Promise<string | NextResponse> {
  const tr = await serverTr();
  if (!authConfigured()) {
    return NextResponse.json(
      { error: tr("Account management isn't available because sign-in isn't configured") },
      { status: 503 }
    );
  }
  const session = await auth();
  const identity = session?.user?.email;
  if (!isValidEmail(identity)) {
    return NextResponse.json({ error: tr("You need to sign in") }, { status: 401 });
  }
  const email = identity.toLowerCase();
  if (!allowedEmails().includes(email)) {
    return NextResponse.json({ error: tr("You have view-only access") }, { status: 403 });
  }
  return email;
}

async function listResponse(me: string): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    me,
    fixed: allowedEmails(),
    extra: await listAllowedAccounts(),
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
      { error: tr(userMessage(e, "Couldn't load")) },
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
  let role: AccountRole;
  try {
    const input = await readJsonObjectLimited(req, 16 * 1024);
    // 配列やオブジェクトを String(...) でメールアドレスに変換しない。
    if (typeof input.email !== "string") {
      throw new TypeError("Invalid email type");
    }
    if (!isAccountRole(input.role)) throw new TypeError("Invalid account role");
    email = input.email.trim().toLowerCase();
    role = input.role;
  } catch (error) {
    return NextResponse.json({ error: tr("Invalid request (request body)") }, {
      status: jsonErrorStatus(error),
    });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: tr("Invalid email address") },
      { status: 400 }
    );
  }

  try {
    const extra = await listAllowedAccounts();
    if (allowedEmails().includes(email) || extra.some((account) => account.email === email)) {
      return NextResponse.json(
        { error: tr("This account already has access") },
        { status: 400 }
      );
    }
    await addAllowedEmail(email, role);
    return await listResponse(me);
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "Couldn't save")) },
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
    return NextResponse.json({ error: tr("Invalid parameters") }, { status: 400 });
  }
  const email = addresses[0].trim().toLowerCase();
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: tr("Invalid parameters") }, { status: 400 });
  }
  if (email === me) {
    return NextResponse.json(
      { error: tr("You can't remove your own account") },
      { status: 400 }
    );
  }
  if (allowedEmails().includes(email)) {
    return NextResponse.json(
      {
        error:
          tr("Allowed by the server settings, so it can't be removed here"),
      },
      { status: 400 }
    );
  }

  try {
    const removed = await removeAllowedEmail(email);
    if (removed === "sole-owner") {
      return NextResponse.json(
        { error: tr("A site must always have at least one owner") },
        { status: 409 }
      );
    }
    if (!removed) {
      return NextResponse.json(
        { error: tr("Account not found") },
        { status: 404 }
      );
    }
    return await listResponse(me);
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "Couldn't delete")) },
      { status: 502 }
    );
  }
}

/** Change a dynamic account's role without revoking its session. */
export async function PATCH(req: Request) {
  const tr = await serverTr();
  const me = await requireMe();
  if (me instanceof NextResponse) return me;
  if (!dbConfigured()) return await dbUnavailable();
  let email: string;
  let role: AccountRole;
  try {
    const value = await readJsonObjectLimited(req, 16 * 1024);
    if (typeof value.email !== "string" || !isAccountRole(value.role)) throw new TypeError("Invalid role update");
    email = value.email.trim().toLowerCase();
    role = value.role;
  } catch (error) {
    return NextResponse.json({ error: tr("Invalid request (request body)") }, {
      status: jsonErrorStatus(error),
    });
  }
  if (!isValidEmail(email)) return NextResponse.json({ error: tr("Invalid email address") }, { status: 400 });
  if (email === me || allowedEmails().includes(email)) {
    return NextResponse.json({ error: tr("This account's role cannot be changed") }, { status: 400 });
  }
  try {
    if (!await updateAllowedAccountRole(email, role)) {
      return NextResponse.json({ error: tr("Account not found") }, { status: 404 });
    }
    return await listResponse(me);
  } catch (error) {
    return NextResponse.json({ error: tr(userMessage(error, "Couldn't save")) }, { status: 502 });
  }
}
