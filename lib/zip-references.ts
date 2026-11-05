/** Resolve archive-relative asset references without changing external or missing URLs. */
export function resolveZipReference(value: string, htmlPath: string, urls: Map<string, string>): string {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(value)) return value;
  const suffixAt = value.search(/[?#]/);
  const path = suffixAt < 0 ? value : value.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? "" : value.slice(suffixAt);
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(path); }
  catch { return value; }
  const baseDir = htmlPath.includes("/") ? htmlPath.slice(0, htmlPath.lastIndexOf("/") + 1) : "";
  const normalized: string[] = [];
  for (const part of `${decodedPath.startsWith("/") ? "" : baseDir}${decodedPath}`.replace(/\\/g, "/").split("/")) {
    if (part === "..") normalized.pop();
    else if (part && part !== ".") normalized.push(part);
  }
  const mapped = urls.get(normalized.join("/"));
  if (!mapped) return value;
  // Asset proxy URLs already have a path query. Keep archive query parameters
  // separate from that path, and preserve the complete query and fragment.
  return mapped + (suffix.startsWith("?") && mapped.includes("?") ? `&${suffix.slice(1)}` : suffix);
}
