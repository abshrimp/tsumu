import assert from "node:assert/strict";
import { test } from "node:test";
import { isCrossSiteWrite } from "../lib/csrf";

const request = (method: string, headers: Record<string, string> = {}, protocol = "https:") => ({
  method,
  nextUrl: { host: "editor.example.test", protocol },
  headers: new Headers(headers),
});

test("state-changing API requests reject cross-origin schemes and authorities", () => {
  for (const origin of [
    "http://editor.example.test",
    "https://evil.example.test",
    "https://editor.example.test:8443",
    "null",
    "https://editor.example.test/path",
    "https://user@editor.example.test",
  ]) {
    assert.equal(isCrossSiteWrite(request("POST", { origin })), true, origin);
  }
  assert.equal(isCrossSiteWrite(request("POST", { origin: "https://editor.example.test" })), false);
  assert.equal(isCrossSiteWrite(request("POST", { origin: "http://editor.example.test" }, "http:")), false);
});

test("Fetch Metadata does not override a contradictory Origin", () => {
  for (const site of ["same-origin", "none"]) {
    assert.equal(isCrossSiteWrite(request("POST", {
      origin: "https://evil.example.test", "sec-fetch-site": site,
    })), true, site);
  }
  for (const site of ["cross-site", "same-site", "unknown"]) {
    assert.equal(isCrossSiteWrite(request("POST", {
      origin: "https://editor.example.test", "sec-fetch-site": site,
    })), true, site);
  }
  assert.equal(isCrossSiteWrite(request("POST", { "sec-fetch-site": "none" })), false);
  assert.equal(isCrossSiteWrite(request("PUT", { "sec-fetch-site": "same-origin" })), false);
});

test("proxied editor writes use the externally visible scheme and host", () => {
  assert.equal(isCrossSiteWrite(request("POST", {
    host: "localhost:3000", origin: "https://editor.example.test",
    "sec-fetch-site": "same-origin",
  })), false);
  assert.equal(isCrossSiteWrite({
    method: "PATCH",
    nextUrl: { host: "127.0.0.1:3000", protocol: "http:" },
    headers: new Headers({
      host: "127.0.0.1:3000", "x-forwarded-host": "editor.example.test",
      "x-forwarded-proto": "https", origin: "https://editor.example.test",
    }),
  }), false);
  assert.equal(isCrossSiteWrite(request("POST", {
    "x-forwarded-proto": "https", "x-forwarded-host": "editor.example.test",
    origin: "http://editor.example.test",
  })), true);
});

test("safe methods are not treated as CSRF writes and non-browser requests work", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isCrossSiteWrite(request(method, {
      origin: "https://evil.example.test", "sec-fetch-site": "cross-site",
    })), false, method);
  }
  assert.equal(isCrossSiteWrite(request("DELETE")), false);
});

test("empty security headers are invalid, not evidence of a non-browser request", () => {
  const cases: Record<string, string>[] = [
    { origin: "" },
    { origin: "   " },
    { origin: "", "sec-fetch-site": "same-origin" },
    { "sec-fetch-site": "" },
    { "sec-fetch-site": "", origin: "https://editor.example.test" },
  ];
  for (const headers of cases) {
    assert.equal(isCrossSiteWrite(request("POST", headers)), true, JSON.stringify(headers));
  }
});

test("forwarded hosts must be authorities, not URLs that normalize to a trusted origin", () => {
  for (const host of [
    "ignored@editor.example.test",
    "editor.example.test/ignored",
    "editor.example.test?ignored",
    "editor.example.test#ignored",
    "editor.example.test\\ignored",
    "ed\titor.example.test",
  ]) {
    assert.equal(isCrossSiteWrite(request("PATCH", {
      origin: "https://editor.example.test",
      "x-forwarded-host": host,
      "x-forwarded-proto": "https",
    })), true, host);
  }
});

test("valid proxy authorities retain case, port and IPv6 normalization", () => {
  for (const [host, origin] of [
    ["EDITOR.EXAMPLE.TEST", "https://editor.example.test"],
    ["editor.example.test:443", "https://editor.example.test"],
    ["editor.example.test:8443", "https://editor.example.test:8443"],
    ["[::1]:8443", "https://[::1]:8443"],
  ]) {
    assert.equal(isCrossSiteWrite(request("POST", {
      origin, "x-forwarded-host": host, "x-forwarded-proto": "https",
    })), false, host);
  }
});
