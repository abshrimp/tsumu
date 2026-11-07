"use client";

import { isSiteId } from "./sites";
import { siteKey } from "./site";
import { storageKey } from "./storage-keys";

const ACCOUNT_KEY = storageKey("netlify-account-v1");
const SITE_KEY = storageKey("netlify-publish-v1");
const OAUTH_KEY = storageKey("netlify-oauth-pending-v1");

export interface BrowserNetlifyAccount {
  token: string;
  userId: string | null;
  email: string | null;
}
export interface BrowserNetlifyProject { id: string; url: string }
export interface BrowserNetlifySite {
  userId: string;
  teamId: string;
  teamSlug: string;
  production: BrowserNetlifyProject | null;
  test: BrowserNetlifyProject | null;
}
type Target = "test" | "production";

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{8,100}$/i.test(value);
}
function validProject(value: unknown): value is BrowserNetlifyProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Record<string, unknown>;
  return validId(project.id) && typeof project.url === "string" &&
    URL.canParse(project.url) && new URL(project.url).protocol === "https:";
}

function safeGetItem(storage: "localStorage" | "sessionStorage", key: string): string | null {
  try {
    return globalThis[storage]?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSetItem(storage: "localStorage" | "sessionStorage", key: string, value: string): void {
  try {
    if (!globalThis[storage]) throw new Error("Storage unavailable");
    globalThis[storage].setItem(key, value);
  } catch {
    throw new Error("Browser storage is unavailable. Allow site data in your browser settings to connect Netlify.");
  }
}

function safeRemoveItem(storage: "localStorage" | "sessionStorage", key: string): void {
  try {
    globalThis[storage]?.removeItem(key);
  } catch {
    // Ignore cleanup failures when storage access is blocked.
  }
}

export function readNetlifyAccount(): BrowserNetlifyAccount | null {
  const data = parseObject(safeGetItem("localStorage", ACCOUNT_KEY));
  if (!data || typeof data.token !== "string" || data.token.length < 12 ||
      data.token.length > 4096) return null;
  return { token: data.token,
    userId: validId(data.userId) ? data.userId : null,
    email: typeof data.email === "string" ? data.email : null,
  };
}

/** The token is deliberately browser-owned, never included in the editable document. */
export function saveNetlifyAccount(account: BrowserNetlifyAccount): void {
  safeSetItem("localStorage", ACCOUNT_KEY, JSON.stringify(account));
}

export function disconnectNetlifyAccount(): void {
  safeRemoveItem("localStorage", ACCOUNT_KEY);
}

export function readNetlifySite(siteId: string): BrowserNetlifySite | null {
  if (!isSiteId(siteId)) return null;
  const data = parseObject(safeGetItem("localStorage", siteKey(SITE_KEY, siteId)));
  if (!data || !validId(data.userId) || !validId(data.teamId) ||
      typeof data.teamSlug !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(data.teamSlug) ||
      !(data.production === null || validProject(data.production)) ||
      !(data.test === null || validProject(data.test))) return null;
  return data as unknown as BrowserNetlifySite;
}

export function saveNetlifySite(siteId: string, value: BrowserNetlifySite): void {
  if (!isSiteId(siteId) || !validId(value.userId) || !validId(value.teamId) ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value.teamSlug) ||
      !(value.test === null || validProject(value.test)) ||
      !(value.production === null || validProject(value.production))) {
    throw new Error("Invalid Netlify site settings.");
  }
  safeSetItem("localStorage", siteKey(SITE_KEY, siteId), JSON.stringify(value));
}

export function disconnectNetlifySite(siteId: string): void {
  if (!isSiteId(siteId)) return;
  safeRemoveItem("localStorage", siteKey(SITE_KEY, siteId));
}

export function saveNetlifyProject(siteId: string, target: Target, project: BrowserNetlifyProject): void {
  const site = readNetlifySite(siteId);
  if (!site || !validProject(project)) throw new Error("Netlify site settings were lost.");
  const existing = site[target];
  if (existing && existing.id !== project.id) {
    throw new Error("This site is already linked to another Netlify project.");
  }
  saveNetlifySite(siteId, { ...site, [target]: project });
}

export function startNetlifyOAuth(siteId: string, config: { clientId: string; redirectUri: string }): void {
  if (!isSiteId(siteId) || !/^[a-zA-Z0-9_-]{8,200}$/.test(config.clientId) ||
      !URL.canParse(config.redirectUri)) throw new Error("Invalid Netlify OAuth settings.");
  const redirect = new URL(config.redirectUri);
  if (redirect.origin !== window.location.origin || redirect.pathname !== "/netlify/callback") {
    throw new Error("The registered Netlify callback URL does not match this Tsumu origin.");
  }
  const state = crypto.randomUUID();
  safeSetItem("sessionStorage", OAUTH_KEY, JSON.stringify({ siteId, state, at: Date.now() }));
  const url = new URL("https://app.netlify.com/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirect.toString());
  url.searchParams.set("response_type", "token");
  url.searchParams.set("state", state);
  window.location.assign(url.toString());
}

/** Accept one login redirect, bound to the initiating tab and local site. */
export function finishNetlifyOAuth(state: string, token: string): string {
  const pending = parseObject(safeGetItem("sessionStorage", OAUTH_KEY));
  safeRemoveItem("sessionStorage", OAUTH_KEY);
  if (!pending || typeof pending.state !== "string" || pending.state !== state ||
      !isSiteId(pending.siteId) || typeof pending.at !== "number" ||
      Date.now() - pending.at > 10 * 60_000 || Date.now() < pending.at ||
      token.length < 12 || token.length > 4096 || /[^\x21-\x7e]/.test(token)) {
    throw new Error("Netlify authorization expired or did not match the original request.");
  }
  // A different Netlify identity may sign in; do not reuse any previous user's bindings.
  saveNetlifyAccount({ token, userId: null, email: null });
  return pending.siteId;
}

export async function requestNetlify<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/publish/netlify/operations", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Netlify request failed.");
  return data as T;
}

export async function readNetlifyOAuthConfig(): Promise<{ clientId: string; redirectUri: string }> {
  const response = await fetch("/api/publish/netlify/oauth-config", { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Netlify OAuth is not configured.");
  return data as { clientId: string; redirectUri: string };
}
