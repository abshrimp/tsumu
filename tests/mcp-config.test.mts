import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MCP_ENDPOINT, resolveMcpEndpoint } from "../lib/external-edit/config";

test("MCP relay defaults to the official endpoint", () => {
  assert.equal(DEFAULT_MCP_ENDPOINT, "https://mcp.tsumu.ebii.net");
  assert.equal(resolveMcpEndpoint(undefined), DEFAULT_MCP_ENDPOINT);
  assert.equal(resolveMcpEndpoint(""), DEFAULT_MCP_ENDPOINT);
  assert.equal(resolveMcpEndpoint("  "), DEFAULT_MCP_ENDPOINT);
});

test("MCP relay uses the configured base URL without trailing slashes", () => {
  assert.equal(resolveMcpEndpoint("https://mcp.example.com"), "https://mcp.example.com");
  assert.equal(resolveMcpEndpoint(" https://mcp.example.com/// "), "https://mcp.example.com");
  assert.equal(resolveMcpEndpoint("http://localhost:8787/"), "http://localhost:8787");
});
