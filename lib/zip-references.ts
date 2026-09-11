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
  const archivePath = normalized.join("/");
  // ZIPを親フォルダごと圧縮した場合、HTML内の /images/... は
  // ZIP全体のルートではなく、その親フォルダを起点とする。
  // アーカイブ直下に同名ファイルがあるときは、そちらを優先する。
  const wrapper = htmlPath.includes("/") ? htmlPath.split("/")[0] : "";
  const mapped = urls.get(archivePath) ??
    (decodedPath.startsWith("/") && wrapper ? urls.get(wrapper + "/" + archivePath) : undefined);
  if (!mapped) return value;
  // Asset proxy URLs already have a path query. Keep archive query parameters
  // separate from that path, and preserve the complete query and fragment.
  return appendAssetSuffix(mapped, suffix);
}

/** The asset identity and suffix are kept separate, including when a dependency is deduplicated. */
export function zipDependency(value: string, path: string, ids: Map<string, string>) {
  const mapped = resolveZipReference(value, path, ids);
  if (mapped === value) return undefined;
  const suffixAt = mapped.search(/[?#]/);
  return { assetId: suffixAt < 0 ? mapped : mapped.slice(0, suffixAt), suffix: suffixAt < 0 ? "" : mapped.slice(suffixAt) };
}

/** Queries on data URLs would become CSS/image bytes; cache-busting queries have no role there. */
export function appendAssetSuffix(url: string, suffix: string): string {
  if (url.startsWith("data:")) {
    const hash = suffix.indexOf("#");
    return url + (hash < 0 ? "" : suffix.slice(hash));
  }
  return url + (suffix.startsWith("?") && url.includes("?") ? `&${suffix.slice(1)}` : suffix);
}

// Keep externally based references external. Resolve a local base inside the
// archive without interpreting relative URLs against the editor origin.
export function archiveBaseUrl(htmlPath: string, href: string | undefined | null): URL | undefined {
  if (href) {
    try {
      const text = href.trim();
      const value = new URL(/^[\\/]{2}/.test(text) ? "https:" + text : text, new URL(htmlPath.split("/").map(encodeURIComponent).join("/"), "file:///"));
      if (["http:", "https:"].includes(value.protocol) ||
          (value.protocol === "file:" && !/^[a-z][a-z0-9+.-]*:/i.test(href.trim()))) return value;
    } catch { /* Invalid bases use the HTML entry's directory. */ }
  }
}

export function archiveResolver(htmlPath: string, base: URL | undefined, urls: Map<string, string>) {
  return (raw: string): string => {
    const ref = raw.trim();
    if (!base || !ref || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) return resolveZipReference(ref, htmlPath, urls);
    let url: URL;
    try { url = new URL(ref, base); } catch { return raw; }
    if (url.protocol !== "file:") return url.href;
    const path = url.pathname + url.search + url.hash;
    const target = resolveZipReference(path, htmlPath, urls);
    return target === path ? raw : target;
  };
}
