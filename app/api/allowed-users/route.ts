import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { isValidEmail } from "../../../lib/email";
import { allowedEmails, auth, authConfigured } from "../../../auth";
import {
  addAllowedEmail,
  listAllowedEmails,
  removeAllowedEmail,
} from "../../../lib/allowlist";
import { dbConfigured } from "../../../lib/db";
import { userMessage } from "../../../lib/errors";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../../lib/api-json";

export const maxDuration = 30;

/** 認証済みの自分のメールアドレスを返す。使えない場合はレスポンスを返す */
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
  try {
    const input = await readJsonLimited(req, 16 * 1024);
    // 配列やオブジェクトを String(...) でメールアドレスに変換しない。
    if (!input || typeof input !== "object" || Array.isArray(input) || !("email" in input) || typeof input.email !== "string") {
      throw new TypeError("Invalid email type");
    }
    email = input.email.trim().toLowerCase();
  } catch (error) {
    return NextResponse.json({ error: trc("invalid_request_variant_1", "Invalid request") }, {
      status: error instanceof JsonBodyTooLargeError ? 413 : error instanceof JsonContentTypeError ? 415 : 400,
    });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: tr("Invalid email address") },
      { status: 400 }
    );
  }

  try {
    const extra = await listAllowedEmails();
    if (allowedEmails().includes(email) || extra.includes(email)) {
      return NextResponse.json(
        { error: tr("This account already has access") },
        { status: 400 }
      );
    }
    await addAllowedEmail(email);
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
