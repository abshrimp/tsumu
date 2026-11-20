/**
 * Integration contract for the hosted Tsumu editor and the public MCP relay.
 * Ordinary MCP pairing and reconnecting are intentionally not restricted to
 * these hosts, so independently deployed Tsumu installations still work.
 */
export const OFFICIAL_EDITOR_ORIGIN = "https://tsumu.ebii.net";
export const OFFICIAL_EDITOR_HOST = "tsumu.ebii.net";
export const OFFICIAL_MCP_ORIGIN = "https://mcp.tsumu.ebii.net";

export const OFFICIAL_SITE_DIRECTORY_PATH = "/mcp/sites-bridge";
export const OFFICIAL_SITE_CHOOSER_PATH = "/mcp/choose";

/** The official-only OAuth UX is unavailable on independently hosted editors. */
export function isOfficialEditorHost(host) {
  if (typeof host !== "string") return false;
  // Hosts in request headers may contain the default HTTPS port.
  return /^(?:tsumu\.ebii\.net)(?::443)?$/i.test(host.replace(/\.$/, ""));
}

export function isOfficialEditorOrigin(origin) {
  return origin === OFFICIAL_EDITOR_ORIGIN;
}
