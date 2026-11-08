"use client";

/**
 * AI client plugin links shown in the MCP connection dialog. The relay publishes
 * the published plugins at <endpoint>/plugins.json, so a newly published plugin
 * appears here without redeploying the editor. If the list can't be loaded, the
 * dialog keeps a single link to the relay's connection guide.
 */
import { useEffect, useState } from "react";
import { resolveMcpEndpoint } from "./config";

export interface McpPlugin {
  id: string;
  name: string;
  icon: string;
  /** Public plugin listing. */
  url: string;
}

export interface McpPluginCatalog {
  guideUrl: string;
  plugins: McpPlugin[];
}

const ENDPOINT = resolveMcpEndpoint(process.env.NEXT_PUBLIC_TSUMU_MCP_URL);
const MAX_PLUGINS = 12;

/** The connection guide, used when the catalog is unavailable. */
export const MCP_GUIDE_URL = ENDPOINT + "/";

/** Only web URLs may become links or images; anything else is dropped. */
function webUrl(value: unknown, httpsOnly: boolean): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.href;
    // A local relay (wrangler dev) serves over http on loopback.
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return !httpsOnly && url.protocol === "http:" && loopback ? url.href : null;
  } catch {
    return null;
  }
}

/** Validate the relay's response. Invalid entries are skipped rather than trusted. */
export function parsePluginCatalog(data: unknown, fallbackGuide = MCP_GUIDE_URL): McpPluginCatalog {
  const source = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const guideUrl = webUrl(source.guideUrl, false) ?? fallbackGuide;
  const list = Array.isArray(source.plugins) ? source.plugins.slice(0, MAX_PLUGINS) : [];
  const plugins: McpPlugin[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === "string" && /^[a-z0-9-]{1,40}$/.test(entry.id) ? entry.id : null;
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 60) : "";
    const icon = webUrl(entry.icon, false);
    // Listings are third-party pages, so they must be https.
    const url = webUrl(entry.url, true);
    if (!id || !name || !icon || !url) continue;
    plugins.push({ id, name, icon, url });
  }
  return { guideUrl, plugins };
}

let cached: Promise<McpPluginCatalog> | null = null;

function loadCatalog(): Promise<McpPluginCatalog> {
  cached ??= fetch(ENDPOINT + "/plugins.json", { credentials: "omit", cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => parsePluginCatalog(data))
    .catch(() => {
      cached = null; // Try again next time the dialog opens.
      return parsePluginCatalog(null);
    });
  return cached;
}

export function useMcpPlugins(): McpPluginCatalog | null {
  const [catalog, setCatalog] = useState<McpPluginCatalog | null>(null);
  useEffect(() => {
    let alive = true;
    void loadCatalog().then((value) => { if (alive) setCatalog(value); });
    return () => { alive = false; };
  }, []);
  return catalog;
}
