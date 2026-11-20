import { OFFICIAL_MCP_ORIGIN } from "./official.mjs";

/** Base URL of the independently deployed MCP relay, without the /mcp path. */
export const DEFAULT_MCP_ENDPOINT = OFFICIAL_MCP_ORIGIN;

export function resolveMcpEndpoint(configured: string | undefined): string {
  return (configured?.trim() || DEFAULT_MCP_ENDPOINT).replace(/\/+$/, "");
}
