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

// NEXT_PUBLIC values are replaced by Next.js/esbuild at build time. Checking
// typeof process before reading them breaks that replacement in real browsers.
// Try/catch also permits independent browser fixtures with no process global.
function hostedEditorSetting() {
  try { return process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN; }
  catch { return undefined; }
}

function mcpRelaySetting() {
  try { return process.env.NEXT_PUBLIC_TSUMU_MCP_URL; }
  catch { return undefined; }
}

export function configuredHostedEditorOrigin(value = hostedEditorSetting()) {
  return trustedOrigin(value);
}

/** Keep the frame policy and postMessage recipient on the same trusted relay. */
export function trustedMcpOrigin(value = mcpRelaySetting()) {
  return trustedOrigin(typeof value === "string" && value.trim() ? value : OFFICIAL_MCP_ORIGIN);
}

export function isOfficialEditorHost(host, configured = hostedEditorSetting()) {
  const origin = configuredHostedEditorOrigin(configured);
  if (typeof host !== "string" || !origin) return false;
  const url = new URL(origin);
  const actual = host.trim().toLowerCase().replace(/\.$/, "");
  const expected = url.host.toLowerCase();
  return actual === expected ||
    (url.protocol === "https:" && !url.port && actual === expected + ":443");
}

export function isOfficialEditorOrigin(origin, configured = hostedEditorSetting()) {
  const expected = configuredHostedEditorOrigin(configured);
  return expected !== null && origin === expected;
}
