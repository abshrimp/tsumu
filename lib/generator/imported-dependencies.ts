import { assetSrc, fetchWithRetry, readAssetBytes } from "../assets";
import type { Asset, SiteDoc } from "../types";
import { zipDependency } from "../zip-references";
import { zipStylesheet } from "../zip-css";
import { importedAssetPath, isZipJavascript } from "./imported-assets";

/** 以前に保存したサイトも含め、登録したアーカイブのファイルからモジュールの依存関係を見つける。 */
export async function retainImportedDependencies(scoped: SiteDoc, assets: Record<string, Asset>) {
  const pending = Object.values(scoped.assets);
  if (!pending.some(isZipJavascript)) return;
  const paths = new Map<string, Map<string, string>>();
  const ambiguous = new Set<string>();
  for (const asset of Object.values(assets)) {
    if (!asset.zip || !importedAssetPath(asset)) continue;
    let group = paths.get(asset.zip.group);
    if (!group) { group = new Map(); paths.set(asset.zip.group, group); }
    const previous = group.get(asset.zip.path);
    if (previous !== undefined) ambiguous.add(previous);
    else group.set(asset.zip.path, asset.id);
  }
  const seen = new Set<string>();
  const { parse } = await import("es-module-lexer/minimal/js");
  let remaining = 48 * 1024 * 1024, references = 0;
  while (pending.length) {
    const asset = pending.pop()!;
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    if (seen.size > 2048) throw new Error("Too many imported dependencies in this partial export.");
    const zip = asset.zip;
    if (!zip || !importedAssetPath(asset)) continue;
    const ids = new Set(zipStylesheet(asset)?.references.map(ref => ref.assetId));
    if (isZipJavascript(asset)) {
      const src = assetSrc(asset);
      const limit = Math.min(remaining, 4 * 1024 * 1024);
      if (!src || (asset.path && !asset.path.startsWith("assets/")) ||
          (!asset.path && src.length > limit * 3 + 256)) {
        throw new Error("Cannot read the imported module within the partial export limits.");
      }
      const response = asset.path
        ? await fetchWithRetry(src, 3, { credentials: "same-origin", redirect: "error" })
        : await fetch(src, { credentials: "omit" });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Could not read the imported module: " + zip.path);
      }
      const bytes = await readAssetBytes(response, limit);
      remaining -= bytes.length;
      const [imports] = parse(new TextDecoder().decode(bytes));
      references += imports.length;
      if (references > 100000) throw new Error("Too many imported module references in this partial export.");
      for (const ref of imports) {
        if (ref.n === undefined) throw new Error("This module resolves dependencies at runtime. Export the whole HTML ZIP project.");
        if (!/^(?:\.{1,2}\/|\/(?!\/))/.test(ref.n)) continue;
        const target = zipDependency(ref.n, zip.path, paths.get(zip.group)!);
        if (target && ambiguous.has(target.assetId)) throw new Error("Ambiguous module path in imported ZIP: " + ref.n);
        if (target) ids.add(target.assetId);
      }
    }
    for (const id of ids) {
      if (!Object.hasOwn(assets, id) || seen.has(id)) continue;
      scoped.assets[id] = assets[id];
      pending.push(assets[id]);
    }
  }
}
