import { NextResponse } from "next/server";
import { authConfigured } from "../../../../../auth";
import { requireAuth } from "../../../../../lib/server";
import { dbConfigured, getDb } from "../../../../../lib/db";
import { allowedEmails, getAccountRole, isEmailAllowed } from "../../../../../lib/allowlist";
import { isValidEmail } from "../../../../../lib/email";
import { serverTr } from "../../../../../lib/i18n-server";
import { isSiteId } from "../../../../../lib/sites";
import { isSiteRole, listSiteMembers, requireSiteAccess } from "../../../../../lib/site-access";
import { jsonErrorStatus, readJsonObjectLimited } from "../../../../../lib/api-json";

type Ctx = { params: Promise<{ id: string }> };
const noStore = { "Cache-Control": "private, no-store" };

async function authorize(ctx: Ctx): Promise<{ siteId: string } | NextResponse> {
  const tr = await serverTr();
  const denied = await requireAuth("editor-user");
  if (denied instanceof NextResponse) return denied;
  if (!authConfigured() || !dbConfigured()) {
    return NextResponse.json({ error: tr("Site permissions need server storage and sign-in") }, { status: 503 });
  }
  const { id } = await ctx.params;
  if (!isSiteId(id)) return NextResponse.json({ error: tr("Invalid site") }, { status: 400 });
  const siteDenied = await requireSiteAccess(id, "manage", denied?.email ?? null);
  return siteDenied ?? { siteId: id };
}

async function response(siteId: string) {
  return NextResponse.json({ members: await listSiteMembers(await getDb(), siteId), fixed: allowedEmails() }, { headers: noStore });
}

export async function GET(_req: Request, ctx: Ctx) {
  const access = await authorize(ctx);
  if (access instanceof NextResponse) return access;
  return response(access.siteId);
}

export async function PUT(req: Request, ctx: Ctx) {
  const tr = await serverTr();
  const access = await authorize(ctx);
  if (access instanceof NextResponse) return access;
  let input: { email?: unknown; role?: unknown };
  try {
    input = await readJsonObjectLimited(req, 4096);
  } catch (error) {
    return NextResponse.json({ error: tr("Invalid request (request body)") }, {
      status: jsonErrorStatus(error),
    });
  }
  const { email: rawEmail, role } = input;
  if (typeof rawEmail !== "string" || !isSiteRole(role)) {
    return NextResponse.json({ error: tr("Invalid request (request body)") }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();
  if (!isValidEmail(email)) return NextResponse.json({ error: tr("Invalid email address") }, { status: 400 });
  if (!await isEmailAllowed(email)) {
    return NextResponse.json({ error: tr("Add this account under Settings before granting site access") }, { status: 400 });
  }
  if (role !== "viewer" && await getAccountRole(email) !== "editor") {
    return NextResponse.json({ error: tr("This account needs the Editor account role before it can edit sites") }, { status: 400 });
  }
  const db = await getDb();
  const rs = await db.execute({
    sql: `INSERT INTO site_members(site_id,email,role)
      VALUES(?,?,?)
      ON CONFLICT(site_id,email) DO UPDATE SET role=excluded.role
      WHERE site_members.role <> 'owner' OR
        (SELECT COUNT(*) FROM site_members WHERE site_id=? AND role='owner') > 1
        OR excluded.role='owner'`,
    args: [access.siteId, email, role, access.siteId],
  });
  if (!rs.rowsAffected) {
    const old = await db.execute({ sql: "SELECT role FROM site_members WHERE site_id=? AND email=?", args: [access.siteId,email] });
    if (old.rows[0]?.role !== role) {
      return NextResponse.json({ error: tr("A site must always have at least one owner") }, { status: 409 });
    }
  }
  return response(access.siteId);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const tr = await serverTr();
  const access = await authorize(ctx);
  if (access instanceof NextResponse) return access;
  const addresses = new URL(req.url).searchParams.getAll("email");
  if (addresses.length !== 1 || !isValidEmail(addresses[0])) {
    return NextResponse.json({ error: tr("Invalid parameters") }, { status: 400 });
  }
  const email = addresses[0].trim().toLowerCase();
  const db = await getDb();
  const result = await db.execute({
    sql: `DELETE FROM site_members WHERE site_id=? AND email=? AND
      (role <> 'owner' OR
       (SELECT COUNT(*) FROM site_members WHERE site_id=? AND role='owner') > 1)`,
    args: [access.siteId, email, access.siteId],
  });
  if (!result.rowsAffected) {
    const member = await db.execute({ sql: "SELECT role FROM site_members WHERE site_id=? AND email=?", args: [access.siteId, email] });
    return NextResponse.json({ error: tr(member.rows.length ? "A site must always have at least one owner" : "Account not found") }, { status: member.rows.length ? 409 : 404 });
  }
  return response(access.siteId);
}
