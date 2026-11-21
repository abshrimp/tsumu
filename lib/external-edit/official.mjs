/**
 * Hosted MCP site selection is opt-in. The editor origin must be provided at
 * build time; independently deployed Tsumu instances retain manual pairing.
 */
export const OFFICIAL_MCP_ORIGIN = "https://mcp.tsumu.ebii.net";
export const OFFICIAL_SITE_DIRECTORY_PATH = "/mcp/sites-bridge";

/** Accept an exact HTTPS origin, or a loopback HTTP origin for local development. */
function trustedOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.origin === "null" || url.username || url.password || url.pathname !== "/" ||
        url.search || url.hash) return null;
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.origin;
  } catch { /* Malformed configuration disables the hosted integration. */ }
  return null;
}

export function configuredHostedEditorOrigin(value = typeof process === "undefined" ? undefined : process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN) {
  return trustedOrigin(value);
}

/** Keep the frame policy and postMessage recipient on the same trusted relay. */
export function trustedMcpOrigin(value = typeof process === "undefined" ? undefined : process.env.NEXT_PUBLIC_TSUMU_MCP_URL) {
  return trustedOrigin(typeof value === "string" && value.trim() ? value : OFFICIAL_MCP_ORIGIN);
}

export function isOfficialEditorHost(host, configured = typeof process === "undefined" ? undefined : process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN) {
  const origin = configuredHostedEditorOrigin(configured);
  if (typeof host !== "string" || !origin) return false;
  const url = new URL(origin);
  const actual = host.trim().toLowerCase().replace(/\.$/, "");
  const expected = url.host.toLowerCase();
  return actual === expected ||
    (url.protocol === "https:" && !url.port && actual === expected + ":443");
}

export function isOfficialEditorOrigin(origin, configured = typeof process === "undefined" ? undefined : process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN) {
  const expected = configuredHostedEditorOrigin(configured);
  return expected !== null && origin === expected;
}
