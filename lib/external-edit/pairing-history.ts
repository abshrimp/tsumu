/** UI-only hint shared with the official MCP authorization subdomain.
 * Never store pairing codes, session IDs, or authorization tokens in this cookie.
 */
export const MCP_PAIRING_HISTORY_COOKIE = "tsumu_mcp_code_issued";

export function rememberMcpPairingCodeIssued(
  hostname: string,
  setCookie: (value: string) => void,
): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host !== "tsumu.ebii.net" && !host.endsWith(".tsumu.ebii.net")) return false;
  try {
    setCookie(
      `${MCP_PAIRING_HISTORY_COOKIE}=1; Domain=tsumu.ebii.net; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
    return true;
  } catch {
    // Browser privacy settings may reject writes; connection still works.
    return false;
  }
}
