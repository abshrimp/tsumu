import assert from "node:assert/strict";
import { test } from "node:test";
import { MCP_PAIRING_HISTORY_COOKIE, rememberMcpPairingCodeIssued } from "../lib/external-edit/pairing-history";

test("remember a successful pairing code on official Tsumu domains", () => {
  const written: string[] = [];
  assert.equal(rememberMcpPairingCodeIssued("tsumu.ebii.net", (cookie) => written.push(cookie)), true);
  assert.equal(rememberMcpPairingCodeIssued("EDITOR.TSUMU.EBII.NET", (cookie) => written.push(cookie)), true);
  assert.equal(rememberMcpPairingCodeIssued("tsumu.ebii.net.", (cookie) => written.push(cookie)), true);
  assert.equal(rememberMcpPairingCodeIssued("mcp.tsumu.ebii.net", (cookie) => written.push(cookie)), true);
  assert.equal(written.length, 4);
  for (const cookie of written) {
    assert.match(cookie, new RegExp(`^${MCP_PAIRING_HISTORY_COOKIE}=1;`));
    assert.match(cookie, /Domain=tsumu\.ebii\.net; Path=\/; Max-Age=31536000; SameSite=Lax; Secure/);
    assert.doesNotMatch(cookie, /pairingCode|sessionId|connectToken/);
  }
});

test("do not set a parent-domain cookie on self-hosted or unrelated origins", () => {
  let written = false;
  for (const hostname of ["localhost", "example.org", "tsumu.ebii.net.evil.test", "nottsumu.ebii.net", "ebii.net"]) {
    assert.equal(rememberMcpPairingCodeIssued(hostname, () => { written = true; }), false, hostname);
  }
  assert.equal(written, false);
});

test("a rejected cookie write must not block connecting", () => {
  assert.equal(rememberMcpPairingCodeIssued("tsumu.ebii.net", () => { throw new Error("Cookies disabled"); }), false);
});
