import { NextResponse } from "next/server";
import { dbConfigured, getDb } from "../../../../lib/db";
import { publishProvider } from "../../../../lib/publish-provider";
import { requireNetlifyUser } from "../../../../lib/netlify-user";
import { requireAuth } from "../../../../lib/server";
import { requireSiteAccess } from "../../../../lib/site-access";
import { isSiteId } from "../../../../lib/sites";
import { readJsonLimited } from "../../../../lib/api-json";
import {
  bindNetlifyTeam, decryptNetlifyToken, getNetlifyBinding, listNetlifyTeams,
  netlifyConnection, removeNetlifyBinding, removeNetlifyConnection,
} from "../../../../lib/netlify-account";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function siteRequest(req: Request) {
  const authorized = await requireAuth("editor-user");
  if (authorized instanceof NextResponse) return { error: authorized } as const;
  const user = requireNetlifyUser(authorized);
  if (user instanceof NextResponse) return { error: user } as const;
  if (publishProvider() !== "netlify" || !dbConfigured()) {
    return { error: NextResponse.json({ error: "Netlify hosting requires server storage and an authorized Tsumu account." },
      { status: 503 }) } as const;
  }
  const id = new URL(req.url).searchParams.get("site");
  if (!isSiteId(id)) return { error: NextResponse.json({ error: "Invalid site." }, { status: 400 }) } as const;
  const denied = await requireSiteAccess(id, "manage", user.email);
  if (denied) return { error: denied } as const;
  return { siteId: id, user, db: await getDb() } as const;
}

export async function GET(req: Request) {
  const ctx = await siteRequest(req);
  if ("error" in ctx) return ctx.error;
  const { db, siteId, user } = ctx;
  try {
    const connection = await netlifyConnection(db, user.email);
    const binding = await getNetlifyBinding(db, siteId);
    const sameOwner = !!binding && binding.ownerEmail === user.email.toLowerCase();
    let teams: Awaited<ReturnType<typeof listNetlifyTeams>> = [];
    if (connection) {
      const token = await decryptNetlifyToken(connection.encryptedToken, user.email);
      teams = await listNetlifyTeams(token);
    }
    return NextResponse.json({
      connected: !!connection,
      netlifyEmail: connection?.netlifyEmail ?? null,
      teams,
      binding: binding ? {
        teamName: teams.find((team) => team.id === binding.teamId)?.name ?? binding.teamSlug,
        teamSlug: binding.teamSlug,
        ownerIsYou: sameOwner,
        published: !!binding.productionSiteId || !!binding.previewSiteId,
        productionUrl: binding.productionUrl,
        previewUrl: binding.previewUrl,
      } : null,
    }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Could not load Netlify account. Reconnect if your token has expired." },
      { status: 502, headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  const ctx = await siteRequest(req);
  if ("error" in ctx) return ctx.error;
  let body: { action?: unknown; teamSlug?: unknown };
  try { body = await readJsonLimited(req, 2048) as typeof body; }
  catch { return NextResponse.json({ error: "Invalid settings request." }, { status: 400 }); }
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid settings request." }, { status: 400 });
  }
  const { db, siteId, user } = ctx;
  try {
    if (body.action === "unbind") {
      await removeNetlifyBinding(db, siteId);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }
    if (body.action !== "team" || typeof body.teamSlug !== "string") {
      return NextResponse.json({ error: "Invalid settings request." }, { status: 400 });
    }
    const connection = await netlifyConnection(db, user.email);
    if (!connection) return NextResponse.json({ error: "Connect Netlify first." }, { status: 409 });
    const token = await decryptNetlifyToken(connection.encryptedToken, user.email);
    const teams = await listNetlifyTeams(token);
    const team = teams.find((entry) => entry.slug === body.teamSlug);
    if (!team) return NextResponse.json({ error: "You do not have access to this Netlify team." }, { status: 403 });
    await bindNetlifyTeam(db, siteId, user.email, team);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error && error.message.startsWith("This site has already been deployed")
        ? error.message : "Could not save Netlify site settings.",
    }, { status: 409, headers: NO_STORE });
  }
}

/** Disconnect only the caller's Netlify credential, not other users' accounts or remote sites. */
export async function DELETE(req: Request) {
  const ctx = await siteRequest(req);
  if ("error" in ctx) return ctx.error;
  await removeNetlifyConnection(ctx.db, ctx.user.email);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
