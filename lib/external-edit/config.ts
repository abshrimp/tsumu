/** Base URL of the independently deployed MCP relay, without the /mcp path. */
export const DEFAULT_MCP_ENDPOINT = "https://mcp.tsumu.ebii.net";

export function resolveMcpEndpoint(configured: string | undefined): string {
  return (configured?.trim() || DEFAULT_MCP_ENDPOINT).replace(/\/+$/, "");
}
