import { NextResponse } from "next/server";
import type { Db } from "./db";
import { dbConfigured, getDb } from "./db";
import { allowedEmails } from "./allowlist";
import { auth, authConfigured } from "../auth";
import { anonymousAllowed } from "./anonymous";
import { serverTr } from "./i18n-server";
import { isValidEmail } from "./email";
import { isSiteRole, type SiteRole } from "./site-model";

type SiteAction = "view" | "edit" | "manage";

export function permits(role: SiteRole | null, action: SiteAction): boolean {
  return role === "owner" || (role === "editor" && action !== "manage") || (role === "viewer" && action === "view");
}

/** Fixed ALLOWED_EMAILS entries administer all sites; other users need explicit membership. */
export async function siteRole(db: Db, siteId: string, email: string | null): Promise<SiteRole | null> {
  if (!authConfigured() && anonymousAllowed()) return "owner";
  if (!isValidEmail(email)) return null;
  const normalized = email.toLowerCase();
  if (allowedEmails().includes(normalized)) return "owner";
  const rs = await db.execute({ sql: "SELECT role FROM site_members WHERE site_id=? AND email=? LIMIT 1", args: [siteId, normalized] });
  const value = rs.rows[0]?.role;
  return isSiteRole(value) ? value : null;
}

/** Called after requireAuth(); never infer site permission from client input or a stale session. */
export async function requireSiteAccess(siteId: string, action: SiteAction, email?: string | null): Promise<NextResponse | null> {
  // Browser-only storage has no shared site identity or server-side membership data.
  if (!dbConfigured()) return null;
  const db = await getDb();
  const tr = await serverTr();
  const existing = await db.execute({ sql: "SELECT 1 FROM sites WHERE id=? LIMIT 1", args: [siteId] });
  if (!existing.rows.length) return NextResponse.json({ error: tr("Site not found") }, { status: 404 });
  const identity = email === undefined && authConfigured() ? (await auth())?.user?.email ?? null : email ?? null;
  const role = await siteRole(db, siteId, identity);
  if (!role) return NextResponse.json({ error: tr("Site not found") }, { status: 404 });
  if (!permits(role, action)) return NextResponse.json({ error: tr("You have view-only access") }, { status: 403 });
  return null;
}

export async function listSiteMembers(db: Db, siteId: string): Promise<{ email: string; role: SiteRole }[]> {
  const rs = await db.execute({
    sql: "SELECT email, role FROM site_members WHERE site_id=? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, email",
    args: [siteId],
  });
  return rs.rows.filter(row => isSiteRole(row.role)).map(row => ({ email: String(row.email), role: row.role as SiteRole }));
}
