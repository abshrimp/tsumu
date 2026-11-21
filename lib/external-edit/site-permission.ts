import type { ServerStatus } from "../status";
import { isSiteRole, type SiteRole } from "../site-model";

/**
 * A long-lived MCP grant is not proof that the signed-in user's per-site role
 * is unchanged. Recheck the current server permission before every bridged
 * read or mutation; never trust the site's role captured when OAuth paired.
 */
export async function externalEditSiteRole(
  siteId: string,
  status: Pick<ServerStatus, "auth" | "db" | "user">,
  request: typeof fetch = fetch,
): Promise<SiteRole | null> {
  const init: RequestInit = { method: "GET", cache: "no-store", credentials: "same-origin" };
  let accountReadOnly = false;
  if (status.auth) {
    const response = await request("/api/status", init);
    const account = response.ok ? await response.json() : null;
    if (!account?.auth || account.db !== status.db || !status.user?.email ||
        account.user?.email !== status.user.email || !["editor", "viewer"].includes(account.role)) {
      throw new Error("Site access is no longer authorized");
    }
    accountReadOnly = account.role === "viewer";
  }
  if (!status.db) return accountReadOnly ? "viewer" : null;
  const response = await request("/api/sites/" + encodeURIComponent(siteId), init);
  const data = response.ok ? await response.json() : null;
  const role = data?.site?.accessRole;
  if (!isSiteRole(role)) throw new Error("Site access is no longer authorized");
  return accountReadOnly ? "viewer" : role;
}
