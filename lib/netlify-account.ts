import type { Db } from "./db";
import { envVar } from "./env";
import { isSiteId } from "./sites";

const NETLIFY_API = "https://api.netlify.com/api/v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const NETLIFY_ID_RE = /^[a-z0-9-]{8,100}$/i;

export interface NetlifyTeam { id: string; slug: string; name: string }
export interface NetlifyUser { id: string; email: string }
export interface NetlifyConnection { email: string; userId: string; netlifyEmail: string; encryptedToken: string }
export interface NetlifyBinding {
  siteId: string;
  ownerEmail: string;
  teamId: string;
  teamSlug: string;
  productionSiteId: string | null;
  previewSiteId: string | null;
  productionUrl: string | null;
  previewUrl: string | null;
}

export function netlifyOAuthSettings(): { clientId: string; redirectUri: string } {
  const clientId = envVar("NETLIFY_OAUTH_CLIENT_ID") ?? "";
  const redirectUri = envVar("NETLIFY_OAUTH_REDIRECT_URI") ?? "";
  const parsed = URL.canParse(redirectUri) ? new URL(redirectUri) : null;
  if (!clientId || !/^[a-zA-Z0-9_-]{8,200}$/.test(clientId) ||
      !parsed || parsed.pathname !== "/netlify/callback" || parsed.search || parsed.hash ||
      parsed.username || parsed.password || !(parsed.protocol === "https:" ||
        (parsed.protocol === "http:" && ["localhost","127.0.0.1"].includes(parsed.hostname)))) {
    throw new Error("Netlify OAuth requires NETLIFY_OAUTH_CLIENT_ID and a valid NETLIFY_OAUTH_REDIRECT_URI.");
  }
  getEncryptionKeyMaterial();
  return { clientId, redirectUri: parsed.toString() };
}

export function netlifyOAuthUrl(state: string): string {
  if (!/^[a-f0-9-]{36}$/.test(state)) throw new Error("Invalid OAuth state.");
  const { clientId, redirectUri } = netlifyOAuthSettings();
  const url = new URL("https://app.netlify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

function getEncryptionKeyMaterial(): Uint8Array<ArrayBuffer> {
  const value = envVar("NETLIFY_TOKEN_ENCRYPTION_KEY");
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("NETLIFY_TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded in base64.");
  }
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (bytes.byteLength !== 32) throw new Error("NETLIFY_TOKEN_ENCRYPTION_KEY must be 32 bytes.");
  // Web Crypto requires an ArrayBuffer-backed view, not a generic ArrayBufferLike.
  return new Uint8Array(bytes);
}

async function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", getEncryptionKeyMaterial(), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}

export async function encryptNetlifyToken(token: string, email: string): Promise<string> {
  if (!EMAIL_RE.test(email) || token.length < 12 || token.length > 4096 || /[^\x21-\x7e]/.test(token)) {
    throw new Error("Invalid Netlify identity or access token.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM", iv,
    additionalData: new TextEncoder().encode("tsumu-netlify:" + email.toLowerCase()),
  }, await aesKey(), new TextEncoder().encode(token));
  return base64(iv) + "." + base64(new Uint8Array(encrypted));
}

export async function decryptNetlifyToken(encrypted: string, email: string): Promise<string> {
  const parts = encrypted.split(".");
  if (parts.length !== 2) throw new Error("Invalid encrypted credential.");
  const iv = fromBase64(parts[0]);
  const data = fromBase64(parts[1]);
  if (iv.byteLength !== 12 || data.byteLength < 17) throw new Error("Invalid encrypted credential.");
  const plain = await crypto.subtle.decrypt({
    name: "AES-GCM", iv,
    additionalData: new TextEncoder().encode("tsumu-netlify:" + email.toLowerCase()),
  }, await aesKey(), data);
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}

export async function netlifyApi<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path)) throw new Error("Invalid Netlify API path.");
  const response = await fetch(NETLIFY_API + path, {
    ...init,
    redirect: "error",
    headers: { Authorization: "Bearer " + token, ...init.headers },
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Netlify denied access. Reconnect your account or check your team's permissions."
      : "Netlify request failed (HTTP " + response.status + ").");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function identifyNetlifyUser(token: string): Promise<NetlifyUser> {
  const data = await netlifyApi<{ id?: unknown; email?: unknown }>(token, "/user");
  if (typeof data.id !== "string" || !data.id || typeof data.email !== "string" || !EMAIL_RE.test(data.email)) {
    throw new Error("Netlify did not return a valid user.");
  }
  return { id: data.id, email: data.email };
}

export async function listNetlifyTeams(token: string): Promise<NetlifyTeam[]> {
  const data = await netlifyApi<Array<{ id?: unknown; slug?: unknown; name?: unknown }>>(token, "/accounts");
  if (!Array.isArray(data)) throw new Error("Netlify did not return a team list.");
  return data.filter((team) =>
    typeof team.id === "string" && NETLIFY_ID_RE.test(team.id) &&
    typeof team.slug === "string" && TEAM_SLUG_RE.test(team.slug)
  ).map((team) => ({
    id: team.id as string,
    slug: team.slug as string,
    name: typeof team.name === "string" ? team.name : team.slug as string,
  }));
}

export async function netlifyConnection(db: Db, email: string): Promise<NetlifyConnection | null> {
  const result = await db.execute({
    sql: "SELECT email, netlify_user_id, netlify_email, encrypted_token FROM netlify_connections WHERE email=?",
    args: [email.toLowerCase()],
  });
  const row = result.rows[0];
  return row ? {
    email: String(row.email), userId: String(row.netlify_user_id),
    netlifyEmail: String(row.netlify_email), encryptedToken: String(row.encrypted_token),
  } : null;
}

export async function saveNetlifyConnection(db: Db, email: string, token: string, user: NetlifyUser): Promise<void> {
  const normalized = email.toLowerCase();
  const encrypted = await encryptNetlifyToken(token, normalized);
  const existing = await netlifyConnection(db, normalized);
  if (existing && existing.userId !== user.id) {
    // Reauthorizing a different Netlify identity must never reuse the old site IDs.
    await db.execute({ sql: "DELETE FROM site_netlify_projects WHERE owner_email=?", args: [normalized] });
  }
  await db.execute({
    sql: "INSERT INTO netlify_connections(email,netlify_user_id,netlify_email,encrypted_token,connected_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET netlify_user_id=excluded.netlify_user_id, netlify_email=excluded.netlify_email, encrypted_token=excluded.encrypted_token, connected_at=excluded.connected_at",
    args: [normalized, user.id, user.email, encrypted, Date.now()],
  });
}

export async function removeNetlifyConnection(db: Db, email: string): Promise<void> {
  // Keep bindings for reconnecting the same Netlify identity; never delete hosted websites.
  await db.execute({ sql: "DELETE FROM netlify_connections WHERE email=?", args: [email.toLowerCase()] });
}

export async function getNetlifyBinding(db: Db, siteId: string): Promise<NetlifyBinding | null> {
  const result = await db.execute({
    sql: "SELECT site_id,owner_email,team_id,team_slug,production_site_id,preview_site_id,production_url,preview_url FROM site_netlify_projects WHERE site_id=?",
    args: [siteId],
  });
  const row = result.rows[0];
  return row ? {
    siteId: String(row.site_id), ownerEmail: String(row.owner_email),
    teamId: String(row.team_id), teamSlug: String(row.team_slug),
    productionSiteId: row.production_site_id === null ? null : String(row.production_site_id),
    previewSiteId: row.preview_site_id === null ? null : String(row.preview_site_id),
    productionUrl: row.production_url === null ? null : String(row.production_url),
    previewUrl: row.preview_url === null ? null : String(row.preview_url),
  } : null;
}

export async function bindNetlifyTeam(db: Db, siteId: string, email: string, team: NetlifyTeam): Promise<void> {
  if (!isSiteId(siteId) || !EMAIL_RE.test(email) || !TEAM_SLUG_RE.test(team.slug) || !NETLIFY_ID_RE.test(team.id)) {
    throw new Error("Invalid Netlify team binding.");
  }
  const existing = await getNetlifyBinding(db, siteId);
  if (existing && (existing.productionSiteId || existing.previewSiteId) &&
      (existing.ownerEmail !== email.toLowerCase() || existing.teamId !== team.id)) {
    throw new Error("This site has already been deployed. Disconnect its old Netlify projects before choosing another team.");
  }
  await db.execute({
    sql: "INSERT INTO site_netlify_projects(site_id,owner_email,team_id,team_slug,created_at) SELECT id,?,?,?,? FROM sites WHERE id=? ON CONFLICT(site_id) DO UPDATE SET owner_email=excluded.owner_email, team_id=excluded.team_id, team_slug=excluded.team_slug",
    args: [siteId, email.toLowerCase(), team.id, team.slug, Date.now(), siteId],
  });
}

export async function removeNetlifyBinding(db: Db, siteId: string): Promise<void> {
  await db.execute({ sql: "DELETE FROM site_netlify_projects WHERE site_id=?", args: [siteId] });
}

export async function boundNetlifyCredential(db: Db, siteId: string): Promise<{
  binding: NetlifyBinding; token: string;
} | null> {
  const binding = await getNetlifyBinding(db, siteId);
  if (!binding) return null;
  const connection = await netlifyConnection(db, binding.ownerEmail);
  if (!connection) return null;
  return { binding, token: await decryptNetlifyToken(connection.encryptedToken, binding.ownerEmail) };
}

export async function saveNetlifyProjectId(
  db: Db, binding: NetlifyBinding, target: "test" | "production", id: string, url: string
): Promise<string> {
  if (!NETLIFY_ID_RE.test(id) || !URL.canParse(url)) throw new Error("Invalid Netlify project.");
  const location = new URL(url);
  if (location.protocol !== "https:" || location.username || location.password) throw new Error("Invalid Netlify URL.");
  const column = target === "test" ? "preview_site_id" : "production_site_id";
  const urlColumn = target === "test" ? "preview_url" : "production_url";
  const updated = await db.execute({
    sql: "UPDATE site_netlify_projects SET " + column + "=?, " + urlColumn + "=? WHERE site_id=? AND owner_email=? AND team_id=? AND " + column + " IS NULL",
    args: [id, url, binding.siteId, binding.ownerEmail, binding.teamId],
  });
  if (updated.rowsAffected > 0) return id;
  const current = await getNetlifyBinding(db, binding.siteId);
  const assigned = target === "test" ? current?.previewSiteId : current?.productionSiteId;
  if (current?.ownerEmail === binding.ownerEmail && current.teamId === binding.teamId && assigned === id) return id;
  throw new Error("The Netlify project binding changed during publication.");
}

export async function startNetlifyOAuth(db: Db, email: string, siteId: string, state: string): Promise<void> {
  await db.execute({ sql: "DELETE FROM netlify_oauth_states WHERE expires_at < ?", args: [Date.now()] });
  await db.execute({
    sql: "INSERT INTO netlify_oauth_states(state,email,site_id,expires_at) VALUES(?,?,?,?)",
    args: [state, email.toLowerCase(), siteId, Date.now() + 10 * 60_000],
  });
}

export async function consumeNetlifyOAuth(db: Db, email: string, state: string): Promise<string | null> {
  if (!/^[a-f0-9-]{36}$/.test(state)) return null;
  const result = await db.execute({
    sql: "SELECT site_id FROM netlify_oauth_states WHERE state=? AND email=? AND expires_at>=?",
    args: [state, email.toLowerCase(), Date.now()],
  });
  const siteId = result.rows[0]?.site_id;
  const consumed = await db.execute({
    sql: "DELETE FROM netlify_oauth_states WHERE state=? AND email=? AND expires_at>=?",
    args: [state, email.toLowerCase(), Date.now()],
  });
  return consumed.rowsAffected === 1 && isSiteId(siteId) ? siteId : null;
}
