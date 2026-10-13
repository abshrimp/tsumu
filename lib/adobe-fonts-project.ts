/** Published Adobe Fonts Web Project discovery. No user credentials or pasted scripts. */

export interface AdobeProjectFamily {
  name: string;
  family: string;
  loading: "css" | "dynamic";
}
export type AdobeProjectResult =
  | { status: "available"; fonts: AdobeProjectFamily[]; loading?: "css" | "dynamic" }
  | { status: "reachable"; fonts: AdobeProjectFamily[]; loading: "css" | "dynamic" }
  | { status: "missing" | "unknown"; fonts: AdobeProjectFamily[] };

type Fetcher = typeof fetch;
const FAMILY = /^[A-Za-z][A-Za-z0-9 _-]{0,79}$/;
const MAX_METADATA = 96_000;
const MAX_CSS = 256_000;
const TIMEOUT = 6_000;

/** Unknown means unknown, not an expired subscription or an invalid Web Project. */
function request(url: string, fetcher: Fetcher, method: "GET" | "HEAD" = "GET") {
  return fetcher(url, {
    method, redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT),
  });
}

export function adobePublishedFamilies(value: unknown): AdobeProjectFamily[] | null {
  if (!value || typeof value !== "object" || !("kit" in value)) return null;
  const kit = (value as { kit?: unknown }).kit;
  if (!kit || typeof kit !== "object" || !("families" in kit) ||
      !Array.isArray((kit as { families: unknown }).families)) return null;
  const results: AdobeProjectFamily[] = [];
  const seen = new Set<string>();
  for (const entry of (kit as { families: unknown[] }).families.slice(0, 100)) {
    if (!entry || typeof entry !== "object") continue;
    const family = entry as Record<string, unknown>;
    if (!Array.isArray(family.css_names)) continue;
    const display = typeof family.name === "string" ? family.name.slice(0, 100) : "";
    const dynamic = typeof family.subset === "string" &&
      /dynamic|japanese|chinese|korean/i.test(family.subset);
    for (const cssName of family.css_names) {
      if (typeof cssName !== "string" || !FAMILY.test(cssName) || seen.has(cssName)) continue;
      seen.add(cssName);
      results.push({ name: display || cssName, family: cssName, loading: dynamic ? "dynamic" : "css" });
    }
  }
  // Japanese and non-Japanese families in a single project must share a loader.
  if (results.some(family => family.loading === "dynamic")) {
    for (const family of results) family.loading = "dynamic";
  }
  return results;
}

/** A CSS kit exposes its family names inside @font-face rules. */
export function adobeCssFamilies(css: string): AdobeProjectFamily[] {
  const results: AdobeProjectFamily[] = [];
  const seen = new Set<string>();
  for (const match of css.matchAll(/@font-face\s*{([^{}]{0,10000})}/gi)) {
    const family = /(?:^|;)\s*font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;]+))\s*;?/i.exec(match[1]);
    const name = (family?.[1] ?? family?.[2] ?? family?.[3] ?? "").trim();
    if (!FAMILY.test(name) || seen.has(name)) continue;
    seen.add(name);
    results.push({ name, family: name, loading: "css" });
    if (results.length >= 100) break;
  }
  return results;
}

export async function inspectAdobeProject(kitId: string, fetcher: Fetcher = fetch): Promise<AdobeProjectResult> {
  if (!/^[a-z0-9]{7}$/.test(kitId)) return { status: "unknown", fonts: [] };

  let metadataMissing = false;
  try {
    const response = await request(
      "https://typekit.com/api/v1/json/kits/" + kitId + "/published", fetcher,
    );
    metadataMissing = response.status === 404 || response.status === 410;
    if (response.ok && Number(response.headers.get("content-length") ?? 0) <= MAX_METADATA) {
      const text = await response.text();
      if (text.length <= MAX_METADATA) {
        const fonts = adobePublishedFamilies(JSON.parse(text));
        if (fonts) {
          // Adobe's published metadata may not expose dynamic subsetting directly.
          // A CSS endpoint returning 412 is the supported indication that the kit
          // requires the JavaScript loader (common with Japanese font projects).
          if (fonts.length && fonts.every(font => font.loading === "css")) {
            try {
              const css = await request("https://use.typekit.net/" + kitId + ".css", fetcher, "HEAD");
              if (css.status === 412) {
                for (const font of fonts) font.loading = "dynamic";
                return { status: "available", fonts, loading: "dynamic" };
              }
            } catch {
              // Metadata remains useful even when the CDN probe is unavailable.
            }
          }
          return { status: "available", fonts };
        }
      }
    }
  } catch {
    // The older metadata endpoint can fail independently of font delivery.
  }

  // A failed metadata request is not proof that Adobe's CDN no longer serves the project.
  let cssMissing = false;
  let cssReachable = false;
  try {
    const response = await request("https://use.typekit.net/" + kitId + ".css", fetcher);
    cssMissing = response.status === 404 || response.status === 410;
    if (response.ok) {
      cssReachable = true;
      const size = Number(response.headers.get("content-length") ?? 0);
      if (size <= MAX_CSS) {
        const css = await response.text();
        if (css.length <= MAX_CSS) {
          const fonts = adobeCssFamilies(css);
          if (fonts.length) return { status: "available", fonts, loading: "css" };
        }
      }
    }
  } catch {
    // Try the JavaScript CDN route as well, which is essential for Japanese fonts.
  }

  let jsMissing = false;
  try {
    const response = await request("https://use.typekit.net/" + kitId + ".js", fetcher, "HEAD");
    jsMissing = response.status === 404 || response.status === 410;
    if (response.ok) return { status: "reachable", fonts: [], loading: "dynamic" };
  } catch {
    // Even if this request fails, no subscription conclusion can be drawn.
  }

  if (cssReachable) return { status: "reachable", fonts: [], loading: "css" };
  return metadataMissing && cssMissing && jsMissing
    ? { status: "missing", fonts: [] }
    : { status: "unknown", fonts: [] };
}
