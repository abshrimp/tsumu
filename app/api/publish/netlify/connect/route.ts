import { NextResponse } from "next/server";
import { dbConfigured, getDb } from "../../../../../lib/db";
import { readJsonLimited } from "../../../../../lib/api-json";
import { publishProvider } from "../../../../../lib/publish-provider";
import { requireNetlifyUser } from "../../../../../lib/netlify-user";
import { requireAuth } from "../../../../../lib/server";
import { bindNetlifyTeam, consumeNetlifyOAuth, getNetlifyBinding, identifyNetlifyUser, listNetlifyTeams, netlifyOAuthSettings, saveNetlifyConnection } from "../../../../../lib/netlify-account";
import { requireSiteAccess } from "../../../../../lib/site-access";

export async function POST(request: Request) {
  const authorized = await requireAuth("editor-user");
  if (authorized instanceof NextResponse) return authorized;
  const user = requireNetlifyUser(authorized);
  if (user instanceof NextResponse) return user;
  if (publishProvider() !== "netlify" || !dbConfigured()) {
    return NextResponse.json({ error: "Netlify OAuth is not enabled." }, { status: 503 });
  }
  let data: { state?: unknown; accessToken?: unknown };
  try {
    data = await readJsonLimited(request, 5000) as typeof data;
  } catch {
    return NextResponse.json({ error: "Invalid OAuth response." }, { status: 400 });
  }
  if (!data || typeof data.state !== "string" || typeof data.accessToken !== "string") {
    return NextResponse.json({ error: "Invalid OAuth response." }, { status: 400 });
  }
  const cookie = request.headers.get("cookie")?.split(";").map((value) => value.trim())
    .find((value) => value.startsWith("tsumu-netlify-oauth="))?.slice("tsumu-netlify-oauth=".length);
  const origin = request.headers.get("origin");
  const callbackOrigin = new URL(netlifyOAuthSettings().redirectUri).origin;
  if (!cookie || cookie !== data.state || !origin || origin !== callbackOrigin) {
    return NextResponse.json({ error: "Netlify authorization state did not match." }, { status: 403 });
  }
  const db = await getDb();
  // The state is one-time-use, server-generated, bound to the Tsumu login and site.
  const siteId = await consumeNetlifyOAuth(db, user.email, data.state);
  if (!siteId) return NextResponse.json({ error: "Netlify authorization expired. Reconnect." }, { status: 403 });
  const denied = await requireSiteAccess(siteId, "manage", user.email);
  if (denied) return denied;
  try {
    const identity = await identifyNetlifyUser(data.accessToken);
    const teams = await listNetlifyTeams(data.accessToken);
    await saveNetlifyConnection(db, user.email, data.accessToken, identity);
    // The normal one-team account needs no further dialog. Multiple teams are
    // chosen from Publish so no deployment is silently billed to an arbitrary team.
    if (teams.length === 1 && !(await getNetlifyBinding(db, siteId))) {
      await bindNetlifyTeam(db, siteId, user.email, teams[0]);
    }
    const response = NextResponse.json({ ok: true, siteId }, {
      headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
    response.cookies.set("tsumu-netlify-oauth", "", {
      httpOnly: true, secure: new URL(request.url).protocol === "https:",
      sameSite: "lax", path: "/", maxAge: 0,
    });
    return response;
  } catch {
    return NextResponse.json({
      error: "Could not verify or securely save your Netlify account connection.",
    }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}
