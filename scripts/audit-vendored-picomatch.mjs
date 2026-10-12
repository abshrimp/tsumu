import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const endpoint = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const patchedAdvisory = "GHSA-fc5q-39xc-vjpf";
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateVendoredManifest(manifest) {
  const metadata = manifest?.tsumu;
  if (manifest?.name !== "@tsumu/picomatch" ||
      typeof metadata?.upstreamVersion !== "string" ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(metadata.upstreamVersion) ||
      manifest.version !== metadata.upstreamVersion + "+tsumu.1" ||
      !Array.isArray(metadata.patchedAdvisories) ||
      metadata.patchedAdvisories.length !== 1 || metadata.patchedAdvisories[0] !== patchedAdvisory) {
    throw new Error("Invalid vendored picomatch provenance or patch metadata");
  }
  return metadata.upstreamVersion;
}

/** Keep upstream advisories visible after replacing the registry package with our patched source. */
export function checkUpstreamAdvisories(payload) {
  if (!isRecord(payload) || Object.keys(payload).some(key => key !== "picomatch") ||
      (Object.hasOwn(payload, "picomatch") && !Array.isArray(payload.picomatch))) {
    throw new Error("Invalid npm advisory response");
  }
  const covered = new Set();
  for (const advisory of payload.picomatch ?? []) {
    if (!isRecord(advisory) || !Number.isSafeInteger(advisory.id) || advisory.id <= 0 ||
        (Object.hasOwn(advisory, "name") && advisory.name !== "picomatch") ||
        typeof advisory.title !== "string" || !advisory.title.trim() ||
        !["info", "low", "moderate", "high", "critical"].includes(advisory.severity) ||
        typeof advisory.vulnerable_versions !== "string" || !advisory.vulnerable_versions.trim() ||
        typeof advisory.url !== "string" ||
        !/^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(advisory.url)) {
      throw new Error("Invalid npm advisory entry");
    }
    const id = advisory.url.slice(advisory.url.lastIndexOf("/") + 1);
    if (id !== patchedAdvisory) {
      throw new Error("Unpatched upstream picomatch advisory: " + advisory.url);
    }
    // A changed scope requires reviewing whether the shipped fix still covers this advisory.
    if (advisory.vulnerable_versions.replace(/\s/g, "") !== "<=4.0.7" || covered.has(id)) {
      throw new Error("Changed or duplicate upstream picomatch advisory: " + advisory.url);
    }
    covered.add(id);
  }
  return [...covered];
}

// npm's documented Bulk Advisory endpoint accepts package names and their installed versions.
// https://docs.npmjs.com/cli/v11/commands/npm-audit/#bulk-advisory-endpoint
export async function fetchUpstreamAdvisories(upstreamVersion, request = fetch) {
  const response = await request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ picomatch: [upstreamVersion] }),
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200) {
    throw new Error("npm advisory request failed: HTTP " + response.status);
  }
  return checkUpstreamAdvisories(await response.json());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const files = JSON.parse(await readFile(new URL("../lib/generator/vendor/picomatch.json", import.meta.url), "utf8"));
    const version = validateVendoredManifest(JSON.parse(files["package.json"].join("\n")));
    const covered = await fetchUpstreamAdvisories(version);
    console.log(`Vendored picomatch (upstream ${version}): ${covered.length} upstream advisory covered by the shipped patch` +
      (covered.length ? ` (${covered.join(", ")}).` : "."));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
