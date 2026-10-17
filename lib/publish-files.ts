/**
 * 公開先のリポジトリで、Tsumu が書き出したファイルと手で追加したファイルを見分ける。
 *
 * 公開のたびに、書き出したファイルの一覧（パス → blob SHA）を GENERATED_MANIFEST_PATH に
 * 同梱する。次の公開では、この一覧に無いファイルを手で追加したものとしてそのまま残し、
 * 一覧と SHA が違うファイルを GitHub 上で直接編集されたものとして公開前に知らせる。
 */

/** エディタが管理するファイルの置き場所（手で追加したファイルとしては扱わない） */
const TSUMU_DIR = "_tsumu/";
/** 復元用の編集データ */
export const DOC_PATH = `${TSUMU_DIR}doc.json`;
/** アセットの取得元（KV キー）→ blob SHA の対応表 */
export const ASSET_MANIFEST_PATH = `${TSUMU_DIR}assets.json`;
/** 書き出したファイルのパス → blob SHA の一覧 */
export const GENERATED_MANIFEST_PATH = `${TSUMU_DIR}generated.json`;

export interface PublishPlan {
  /** 前回の公開のあとに直接編集された、書き出したファイル（今回の公開で上書きされる） */
  edited: string[];
  /** 手で追加したファイルのうち、今回書き出すファイルと同じパスのもの（上書きされる） */
  clashing: string[];
  /** 手で追加したファイル（パス → blob SHA）。今回のコミットにそのまま残す */
  kept: Record<string, string>;
}

/**
 * @param blobs 公開先のブランチにあるファイル（パス → blob SHA）
 * @param generated 前回の公開で書き出したファイルの一覧。初回は null。
 *   一覧に無いファイルは手で追加したものとして保持し、同じパスへの書き出しは確認する
 * @param output 今回書き出すファイルのパス
 */
export function planPublish(
  blobs: Record<string, string>,
  generated: Record<string, string> | null,
  output: Iterable<string>
): PublishPlan {
  const plan: PublishPlan = { edited: [], clashing: [], kept: {} };
  const outputs = new Set(output);
  for (const [path, sha] of Object.entries(blobs)) {
    if (path === GENERATED_MANIFEST_PATH) continue;
    if (generated && Object.hasOwn(generated, path)) {
      if (generated[path] !== sha) plan.edited.push(path);
    } else if (outputs.has(path)) {
      plan.clashing.push(path);
    } else if (!path.startsWith(TSUMU_DIR)) {
      plan.kept[path] = sha;
    }
  }
  plan.edited.sort();
  plan.clashing.sort();
  return plan;
}

/** コミットしてよいパスか（先頭の「/」・「.」「..」・空の区切り・バックスラッシュを含まない） */
export function isSafeCommitPath(path: string): boolean {
  if (!path || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/**
 * 書き出しには使わず、手で追加したものをそのまま引き継ぐときだけコミットを許す場所。
 * .github/ のワークフローはリポジトリのシークレットで動くため、エディタの利用者が
 * サーバーのトークンで書き込めないようにする
 */
export function isProtectedPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower === ".github" || lower.startsWith(".github/");
}

/** ツリーの直下の項目（GitHub の Git Trees API の形） */
export interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string | null;
}

/**
 * ロールバック先のツリー（src）の .github/ を、いまの先端（head）のものに置き換える項目。
 * ロールバックは任意のコミット（ほかのブランチ・フォークのものも指せる）の内容を積むため、
 * そのままでは .github/ の保護（isProtectedPath）を迂回してワークフローを書き込めてしまう。
 * 置き換えが要らなければ空（src のツリーをそのまま使える）
 */
export function protectedTreeEdits(src: TreeEntry[], head: TreeEntry[]): TreeEntry[] {
  const key = (e: TreeEntry) => `${e.mode} ${e.type} ${e.sha}`;
  const srcProtected = new Map(src.filter((e) => isProtectedPath(e.path)).map((e) => [e.path, e]));
  const headProtected = new Map(head.filter((e) => isProtectedPath(e.path)).map((e) => [e.path, e]));
  const edits: TreeEntry[] = [];
  for (const [path, e] of srcProtected) {
    if (!headProtected.has(path)) edits.push({ path, mode: e.mode, type: e.type, sha: null });
  }
  for (const [path, e] of headProtected) {
    const old = srcProtected.get(path);
    if (!old || key(old) !== key(e)) edits.push({ path, mode: e.mode, type: e.type, sha: e.sha });
  }
  return edits;
}

/** 書き出したファイルの一覧（JSON）を読む。壊れているか未対応の版なら null */
export function parseGeneratedManifest(text: string): Record<string, string> | null {
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if ((data as { version?: unknown }).version !== 1) return null;
    const files = (data as { files?: unknown }).files;
    if (!files || typeof files !== "object" || Array.isArray(files)) return null;
    const out: Record<string, string> = {};
    for (const [path, sha] of Object.entries(files)) {
      if (!isSafeCommitPath(path) || typeof sha !== "string" || !sha) return null;
      Object.defineProperty(out, path, { value: sha, enumerable: true, configurable: true, writable: true });
    }
    return out;
  } catch {
    return null;
  }
}

/** 書き出したファイルの一覧を JSON にする */
export function serializeGeneratedManifest(files: Record<string, string>): string {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify({ version: 1, files: sorted }, null, 2) + "\n";
}
