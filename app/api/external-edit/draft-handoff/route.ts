import { NextRequest, NextResponse } from "next/server";
import { authConfigured } from "../../../../auth";
import { readJsonObjectLimited, jsonErrorStatus } from "../../../../lib/api-json";
import { envVar } from "../../../../lib/env";
import { requireAuth } from "../../../../lib/server";
import {
  DRAFT_HANDOFF_COOKIE, DRAFT_HANDOFF_TTL, isDraftLink, openDraftHandoff, sealDraftHandoff,
} from "../../../../lib/external-edit/draft-handoff";

const HEADERS = { "Cache-Control": "private, no-store" };

function clearCookie(response: NextResponse, request: NextRequest): void {
  response.cookies.set(DRAFT_HANDOFF_COOKIE, "", {
    httpOnly: true, secure: request.nextUrl.protocol === "https:",
    sameSite: "lax", path: "/", maxAge: 0,
  });
}

/** Called before sign-in: only an encrypted, short-lived HttpOnly cookie crosses OAuth. */
export async function POST(request: NextRequest) {
  if (!authConfigured()) return NextResponse.json({ error: "Sign-in is not configured" }, { status: 503, headers: HEADERS });
  let draft: unknown;
  try {
    draft = await readJsonObjectLimited(request, 512);
  } catch (error) {
    return NextResponse.json({ error: "Invalid draft" }, { status: jsonErrorStatus(error), headers: HEADERS });
  }
  if (!isDraftLink(draft)) return NextResponse.json({ error: "Invalid draft" }, { status: 400, headers: HEADERS });
  const secret = envVar("AUTH_SECRET");
  if (!secret) return NextResponse.json({ error: "Sign-in is not configured" }, { status: 503, headers: HEADERS });
  const encrypted = await sealDraftHandoff(draft, secret);
  const response = NextResponse.json({ ok: true }, { headers: HEADERS });
  response.cookies.set(DRAFT_HANDOFF_COOKIE, encrypted, {
    httpOnly: true, secure: request.nextUrl.protocol === "https:",
    sameSite: "lax", path: "/", maxAge: DRAFT_HANDOFF_TTL,
  });
  return response;
}

/** Only an authorized editor can retrieve the credential; reading consumes the cookie. */
export async function PATCH(request: NextRequest) {
  const denied = await requireAuth("editor");
  if (denied) return denied;
  const encrypted = request.cookies.get(DRAFT_HANDOFF_COOKIE)?.value;
  const secret = envVar("AUTH_SECRET");
  const draft = encrypted && secret ? await openDraftHandoff(encrypted, secret) : null;
  const response = NextResponse.json({ draft }, { headers: HEADERS });
  clearCookie(response, request);
  return response;
}

/** An ordinary sign-in must not revive an abandoned draft on a later error page. */
export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ ok: true }, { headers: HEADERS });
  clearCookie(response, request);
  return response;
}
