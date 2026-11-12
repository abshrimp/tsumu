/** アーカイブからの相対的なアセットの参照を解決する。外部の URL や見つからない URL は変えない。 */
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
  // アーカイブ直下を優先し、なければ浅い階層から順に探す。
  // project/dist/index.html のような多重ラッパーにも対応する。
  let mapped = urls.get(archivePath);
  if (!mapped && decodedPath.startsWith("/")) {
    const parents = htmlPath.split("/").slice(0, -1);
    for (let depth = 1; depth <= parents.length && !mapped; depth++) {
      mapped = urls.get(parents.slice(0, depth).join("/") + "/" + archivePath);
    }
  }
  if (!mapped) return value;
  // アセットのプロキシの URL は、すでにパスを示すクエリを持つ。アーカイブのクエリのパラメーターは
  // そのパスと分けて扱い、クエリとフラグメントは完全な形で残す。
  return appendAssetSuffix(mapped, suffix);
}

/** アセットの識別子と末尾は分けて持つ。依存するものの重複を除くときも同じ。 */
export function zipDependency(value: string, path: string, ids: Map<string, string>) {
  const mapped = resolveZipReference(value, path, ids);
  if (mapped === value) return undefined;
  const suffixAt = mapped.search(/[?#]/);
  return { assetId: suffixAt < 0 ? mapped : mapped.slice(0, suffixAt), suffix: suffixAt < 0 ? "" : mapped.slice(suffixAt) };
}

/** data URL に付けたクエリは、CSS や画像のバイト列の一部になってしまう。キャッシュを避けるためのクエリは、そこでは役に立たない。 */
export function appendAssetSuffix(url: string, suffix: string): string {
  if (url.startsWith("data:")) {
    const hash = suffix.indexOf("#");
    return url + (hash < 0 ? "" : suffix.slice(hash));
  }
  return url + (suffix.startsWith("?") && url.includes("?") ? `&${suffix.slice(1)}` : suffix);
}

// 外部を基準とする参照は、外部のまま保つ。ローカルの基準はアーカイブの中で解決し、
// 相対 URL をエディタのオリジンを基準に解釈することはしない。
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
