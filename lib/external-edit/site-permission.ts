import type { ServerStatus } from "../status";
import type { SiteRole } from "../site-model";

/**
 * A long-lived MCP grant is not proof that the signed-in user's per-site role
 * is unchanged. Recheck the current server permission before every bridged
 * read or mutation; never trust the site's role captured when OAuth paired.
 */
export async function externalEditSiteRole(
  siteId: string,
  status: Pick<ServerStatus, "db">,
  request: typeof fetch = fetch,
): Promise<SiteRole | null> {
  if (!status.db) return null; // Browser-only sites have no per-user server roles.
  const response = await request("/api/sites/" + encodeURIComponent(siteId), {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Site access is no longer authorized");
  const data: unknown = await response.json();
  const role = data && typeof data === "object" && "site" in data &&
    data.site && typeof data.site === "object" && "accessRole" in data.site
    ? data.site.accessRole : null;
  if (role !== "owner" && role !== "editor" && role !== "viewer") {
    throw new Error("Site access is no longer authorized");
  }
  return role;
}
