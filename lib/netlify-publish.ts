import { envVar } from "./env";
import { hostingProjectName, publishProvider } from "./publish-provider";
import type { PublishTarget } from "./generator";
import { isSiteId } from "./sites";

const API = "https://api.netlify.com/api/v1";
const ACCOUNT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ID_RE = /^[a-z0-9-]{8,100}$/i;

export interface NetlifyTeam { id: string; slug: string; name: string }
export interface NetlifySite { id: string; account_id: string; ssl_url?: string; url?: string; name?: string }
export interface NetlifyDeployment {
  id: string;
  url: string;
  state: string;
}
export interface NetlifyHistoryEntry extends NetlifyDeployment {
  date: string;
  canRestore: boolean;
}

export function netlifyOAuthConfig(): { clientId: string; redirectUri: string } {
  if (publishProvider() !== "netlify") throw new Error("Netlify publishing is disabled.");
  const clientId = envVar("NETLIFY_OAUTH_CLIENT_ID") || "";
  const redirectUri = envVar("NETLIFY_OAUTH_REDIRECT_URI") || "";
  const uri = URL.canParse(redirectUri) ? new URL(redirectUri) : null;
  if (!/^[a-zA-Z0-9_-]{8,200}$/.test(clientId) || !uri ||
      uri.pathname !== "/netlify/callback" || uri.search || uri.hash ||
      uri.protocol !== "https:" && !(uri.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(uri.hostname)) ||
      uri.username || uri.password) {
    throw new Error("Configure NETLIFY_OAUTH_CLIENT_ID and NETLIFY_OAUTH_REDIRECT_URI.");
  }
  return { clientId, redirectUri: uri.toString() };
}

export function validNetlifyId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

function safeToken(value: string): string {
  if (value.length < 12 || value.length > 4096 || /[^\x21-\x7e]/.test(value)) {
    throw new Error("Invalid Netlify access token.");
  }
  return value;
}

export async function netlifyApi<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path)) {
    throw new Error("Invalid Netlify API path.");
  }
  const response = await fetch(API + path, {
    // Workers does not implement redirect: "error". "manual" prevents
    // forwarding a browser-owned bearer token to an untrusted redirect URL.
    ...init, redirect: "manual",
    headers: { Authorization: "Bearer " + safeToken(token), ...init.headers },
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Netlify unexpectedly redirected an API request.");
  }
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Netlify authorization expired or does not permit this operation. Connect again."
      : "Netlify request failed (HTTP " + response.status + ").");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function netlifyAccount(token: string): Promise<{
  user: { id: string; email: string }; teams: NetlifyTeam[];
}> {
  const [user, accounts] = await Promise.all([
    netlifyApi<{ id?: unknown; email?: unknown }>(token, "/user"),
    netlifyApi<Array<{ id?: unknown; slug?: unknown; name?: unknown }>>(token, "/accounts"),
  ]);
  if (typeof user.id !== "string" || !validNetlifyId(user.id) ||
      typeof user.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email) ||
      !Array.isArray(accounts)) {
    throw new Error("Netlify did not return a valid account.");
  }
  const teams = accounts.filter(account =>
    validNetlifyId(account.id) &&
    typeof account.slug === "string" && ACCOUNT_RE.test(account.slug)
  ).map(account => ({
    id: account.id as string, slug: account.slug as string,
    name: typeof account.name === "string" ? account.name : account.slug as string,
  }));
  return { user: { id: user.id, email: user.email }, teams };
}

function checkedSite(site: NetlifySite, expectedId: string, teamId: string): NetlifySite {
  if (!validNetlifyId(site.id) || site.id !== expectedId || site.account_id !== teamId) {
    throw new Error("Netlify project does not belong to the selected team.");
  }
  return site;
}

/** Reuse a pinned remote project ID only after verifying team ownership with Netlify. */
export async function verifyNetlifySite(
  token: string, siteId: string, teamId: string
): Promise<NetlifySite> {
  if (!validNetlifyId(siteId) || !validNetlifyId(teamId)) throw new Error("Invalid Netlify project.");
  const remote = await netlifyApi<NetlifySite>(token, "/sites/" + encodeURIComponent(siteId));
  return checkedSite(remote, siteId, teamId);
}

function siteUrl(site: NetlifySite): string {
  const candidate = site.ssl_url || site.url || (site.name ? "https://" + site.name + ".netlify.app" : "");
  if (!URL.canParse(candidate) || new URL(candidate).protocol !== "https:") {
    throw new Error("Netlify did not return a valid project URL.");
  }
  return candidate;
}

/** The browser saves the returned site ID before uploading, so an interrupted deploy is retryable. */
export async function createNetlifyProject(
  token: string, localSiteId: string, target: PublishTarget, teamSlug: string
): Promise<{ id: string; url: string; teamId: string }> {
  if (!isSiteId(localSiteId) || !["test", "production"].includes(target) ||
      !ACCOUNT_RE.test(teamSlug)) throw new Error("Invalid Netlify destination.");
  const { teams } = await netlifyAccount(token);
  const team = teams.find(entry => entry.slug === teamSlug);
  if (!team) throw new Error("You do not have permission to create a site in this Netlify team.");
  const prefix = hostingProjectName(localSiteId, "netlify", target);
  const suffix = "-" + crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const name = prefix.slice(0, 63 - suffix.length) + suffix;
  const site = await netlifyApi<NetlifySite>(token, "/" + encodeURIComponent(team.slug) + "/sites", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!validNetlifyId(site.id) || site.account_id !== team.id) {
    throw new Error("Netlify returned a project outside the selected team.");
  }
  return { id: site.id, url: siteUrl(site), teamId: team.id };
}

export async function deployNetlifyZip(
  token: string, siteId: string, teamId: string, zip: ArrayBuffer
): Promise<NetlifyDeployment & { siteUrl: string; projectName?: string }> {
  const site = await verifyNetlifySite(token, siteId, teamId);
  const deployment = await netlifyApi<{
    id?: unknown; state?: string; deploy_ssl_url?: string; ssl_url?: string;
  }>(token, "/sites/" + encodeURIComponent(site.id) + "/deploys", {
    method: "POST", headers: { "Content-Type": "application/zip" }, body: zip,
  });
  if (!validNetlifyId(deployment.id)) throw new Error("Netlify did not return a deployment ID.");
  return {
    id: deployment.id, state: deployment.state || "processing",
    url: deployment.deploy_ssl_url || deployment.ssl_url || siteUrl(site),
    siteUrl: siteUrl(site),
    // Dashboard URLs use the project name, not the API's opaque project ID.
    ...(typeof site.name === "string" && ACCOUNT_RE.test(site.name)
      ? { projectName: site.name } : {}),
  };
}

export async function netlifyHistory(
  token: string, siteId: string, teamId: string,
): Promise<NetlifyHistoryEntry[]> {
  const site = await verifyNetlifySite(token, siteId, teamId);
  const deployments = await netlifyApi<Array<{
    id?: string; state?: string; created_at?: string; deploy_ssl_url?: string; ssl_url?: string;
  }>>(token, "/sites/" + encodeURIComponent(site.id) + "/deploys?per_page=25");
  if (!Array.isArray(deployments)) throw new Error("Invalid Netlify deployment history.");
  return deployments.filter(entry => validNetlifyId(entry.id)).map(entry => ({
    id: entry.id!, state: entry.state || "unknown", date: entry.created_at || "",
    url: entry.deploy_ssl_url || entry.ssl_url || siteUrl(site),
    canRestore: entry.state === "ready",
  }));
}

export async function restoreNetlifyDeployment(
  token: string, siteId: string, teamId: string, deploymentId: string
): Promise<void> {
  if (!validNetlifyId(deploymentId)) throw new Error("Invalid deployment ID.");
  const history = await netlifyHistory(token, siteId, teamId);
  if (!history.some(deploy => deploy.id === deploymentId && deploy.canRestore)) {
    throw new Error("The deployment is not available for restoration.");
  }
  await netlifyApi<unknown>(token,
    "/sites/" + encodeURIComponent(siteId) + "/deploys/" + encodeURIComponent(deploymentId) + "/restore",
    { method: "POST" });
}
