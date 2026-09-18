/**
 * 公開先のリポジトリで、Tsumu が書き出したファイルと、手動で追加したファイルを見分ける。
 *
 * 公開のたびに、書き出したファイルの一覧（パス → blob の SHA）を GENERATED_MANIFEST_PATH に
 * 含める。次の公開では、この一覧に無いファイルを手動で追加したものとしてそのまま残し、
 * 一覧と SHA が違うファイルを、GitHub 上で直接編集されたものとして公開の前に知らせる。
 */

/** エディタが管理するファイルの置き場所（手動で追加したファイルとしては扱わない） */
const MANAGED_DIR = "_tsumu/";
/** 復元用の編集データ */
export const DOC_PATH = `${MANAGED_DIR}doc.json`;
/** アセットの取得元（KV のキー）→ blob の SHA の対応表 */
export const ASSET_MANIFEST_PATH = `${MANAGED_DIR}assets.json`;
/** 書き出したファイルのパス → blob の SHA の一覧 */
export const GENERATED_MANIFEST_PATH = `${MANAGED_DIR}generated.json`;

export interface PublishPlan {
  /** 前回の公開後に直接変更された生成ファイル。今回の公開で再作成する削除済みファイルも含む */
  edited: string[];
  /** 手動で追加したファイルのうち、今回書き出すファイルと同じパスのもの（上書きされる） */
  clashing: string[];
  /** 手動で追加したファイル（パス → blob の SHA）。今回のコミットにそのまま残す */
  kept: Record<string, string>;
}

/**
 * @param blobs 公開先のブランチにあるファイル（パス → blob の SHA）
 * @param generated 前回の公開で書き出したファイルの一覧。初回は null。
 *   一覧に無いファイルは手動で追加したものとして残し、同じパスへの書き出しは確認する
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
    // Tsumu の公開用のメタデータはエディタが管理するもので、利用者が書いたファイルではない。
    if (!isSafeCommitPath(path) || path.startsWith(MANAGED_DIR)) continue;
    if (generated && Object.hasOwn(generated, path)) {
      if (generated[path] !== sha) plan.edited.push(path);
    } else if (outputs.has(path)) {
      plan.clashing.push(path);
    } else {
      Object.defineProperty(plan.kept, path, { value: sha, enumerable: true, configurable: true, writable: true });
    }
  }
  // 直接削除されたファイルは現在のツリーにない。再び書き出す場合にだけ確認する。
  if (generated) {
    for (const path of outputs) {
      if (!Object.hasOwn(blobs, path) && Object.hasOwn(generated, path) &&
          !path.startsWith(MANAGED_DIR) && isSafeCommitPath(path)) plan.edited.push(path);
    }
  }
  plan.edited.sort();
  plan.clashing.sort();
  return plan;
}

/** コミットしてよいパスか（先頭の「/」、「.」「..」、空の区切り、バックスラッシュを含まない） */
export function isSafeCommitPath(path: string): boolean {
  if (!path || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/**
 * Git のツリーには、ファイルと、そのファイルの子を同時に置けない。たとえば
 * `public/assets`（シンボリックリンク）と `public/assets/logo.svg` は共存できない。
 * GitHub の入れ子のツリーの API は、項目の順序によってどちらかを置き換えることがあるため、
 * ツリーを組み立てる前に、接頭辞の衝突を拒否する。
 */
export function conflictingCommitPaths(paths: Iterable<string>): [string, string] | null {
  const all = new Set(paths);
  for (const path of all) {
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      const parent = path.slice(0, slash);
      if (all.has(parent)) return [parent, path];
    }
  }
  return null;
}

/**
 * 書き出しには使わず、手動で追加したものをそのまま引き継ぐときだけコミットを許す場所。
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
 * ロールバック先のツリー（src）の .github/ を、現在の先端（head）のものに置き換える項目。
 * ロールバックは任意のコミット（他のブランチやフォークのものも指せる）の内容を積むため、
 * そのままでは .github/ の保護（isProtectedPath）を迂回して、ワークフローを書き込めてしまう。
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

/** 書き出したファイルの一覧（JSON）を読む。壊れているか、対応していない版なら null を返す */
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

/** 手動で追加したファイル・シンボリックリンク・サブモジュールを、Git の属性ごと引き継ぐ。 */
export function keptTreeEntries(entries: TreeEntry[], paths: string[]): TreeEntry[] | null {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const kept: TreeEntry[] = [];
  for (const path of new Set(paths)) {
    const entry = byPath.get(path);
    if (!entry?.sha || (entry.type !== "blob" && entry.type !== "commit")) return null;
    kept.push({ path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha });
  }
  return kept;
}
