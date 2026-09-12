import type { PublishTarget } from "./generator";
import type { TargetConfig } from "./github";

/**
 * 利用者がこの操作を選んだときに表示していた公開先（上書きの指定ではない）。
 * 検証は、リクエストを解決済みの設定に結び付けるもので、D1 の設定と GitHub にまたがる
 * トランザクションではない。後から設定を編集しても、そのリクエストの公開先は変わらない。
 */
export interface ExpectedPublishTarget {
  site: string;
  target: PublishTarget;
  repo: string | null;
  branch: string;
  productionBranch: string;
}

export function matchesPublishTarget(value: unknown, site: string, target: PublishTarget, conf: TargetConfig, productionBranch: string): boolean {
  if (!value || typeof value !== "object") return false;
  const expected = value as ExpectedPublishTarget;
  return expected.site === site && expected.target === target &&
    expected.repo === (conf.repo ?? null) && expected.branch === conf.branch && expected.productionBranch === productionBranch;
}

export const publishConflictMessage = "公開先の設定または内容が変更されました。画面を閉じて開き直し、公開先と変更内容を確認してから、もう一度お試しください";
