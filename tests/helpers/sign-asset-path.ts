import { signAssetPaths } from "../../lib/asset-token";

/** 1 件だけ署名する（本番は複数をまとめて署名する signAssetPaths だけを使う）。 */
export async function signAssetPath(path: string, now = Date.now()): Promise<string | null> {
  return (await signAssetPaths([path], now)).get(path) ?? null;
}
