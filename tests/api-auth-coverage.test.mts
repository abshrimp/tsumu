import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const apiDir = join(root, "app/api");

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? routes(path) : entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

test("every API route has a declared authorization boundary", () => {
  const found = routes(apiDir);
  assert.ok(found.length >= 18, "unexpectedly missing route files");
  for (const path of found) {
    const name = relative(root, path).replaceAll("\\", "/");
    const source = readFileSync(path, "utf8");
    if (name === "app/api/auth/[...nextauth]/route.ts") {
      assert.match(source, /authConfigured\s*\(/, name);
      assert.match(source, /handlers\.(?:GET|POST)/, name);
    } else if (name === "app/api/allowed-users/route.ts") {
      assert.match(source, /requireMe\s*\(/, name);
      assert.match(source, /authConfigured\s*\(/, name);
      assert.match(source, /await auth\s*\(/, name);
    } else {
      assert.match(source, /requireAuth\s*\(/, name);
    }
    if (name === "app/api/assets/file/route.ts") {
      assert.match(source, /verifyAssetToken\s*\(/, name);
    }
  }
});

test("HTTP and WebSocket public entrypoints keep separate CSRF/origin checks", () => {
  const middleware = readFileSync(join(root, "middleware.ts"), "utf8");
  const worker = readFileSync(join(root, "custom-worker.ts"), "utf8");
  assert.match(middleware, /pathname\.startsWith\("\/api\/"\)\s*&&\s*isCrossSiteWrite\s*\(/);
  assert.match(worker, /request\.headers\.get\("Origin"\)\s*!==\s*url\.origin/);
});
