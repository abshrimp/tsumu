import { NextResponse } from "next/server";
import { dbConfigured, getDb } from "../../../../../lib/db";
import { publishProvider } from "../../../../../lib/publish-provider";
import { requireNetlifyUser } from "../../../../../lib/netlify-user";
import { requireAuth } from "../../../../../lib/server";
import { netlifyOAuthSettings, netlifyOAuthUrl, startNetlifyOAuth } from "../../../../../lib/netlify-account";
import { requireSiteAccess } from "../../../../../lib/site-access";
import { isSiteId } from "../../../../../lib/sites";

export async function GET(request: Request) {
  const authorized = await requireAuth("editor-user");
  if (authorized instanceof NextResponse) return authorized;
  const user = requireNetlifyUser(authorized);
  if (user instanceof NextResponse) return user;
  if (publishProvider() !== "netlify" || !dbConfigured()) {
    return NextResponse.json({ error: "Netlify OAuth is not enabled." }, { status: 503 });
  }
  const siteId = new URL(request.url).searchParams.get("site");
  if (!isSiteId(siteId)) return NextResponse.json({ error: "Invalid site." }, { status: 400 });
  const denied = await requireSiteAccess(siteId, "manage", user.email);
  if (denied) return denied;
  try {
    const { redirectUri } = netlifyOAuthSettings();
    const state = crypto.randomUUID();
    await startNetlifyOAuth(await getDb(), user.email, siteId, state);
    const response = NextResponse.redirect(netlifyOAuthUrl(state), 302);
    response.cookies.set("tsumu-netlify-oauth", state, {
      httpOnly: true, secure: new URL(redirectUri).protocol === "https:",
      sameSite: "lax", maxAge: 600, path: "/",
    });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return NextResponse.json({
      error: "Netlify OAuth is not configured. Check NETLIFY_OAUTH_CLIENT_ID, NETLIFY_OAUTH_REDIRECT_URI and NETLIFY_TOKEN_ENCRYPTION_KEY.",
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
