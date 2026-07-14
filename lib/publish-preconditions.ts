import type { PublishTarget } from "./generator";
import type { TargetConfig } from "./github";

/**
 * The destination shown when the user chose this operation, never an override.
 * Validation binds a request to its resolved settings; it is not a transaction
 * spanning D1 settings and GitHub. Later settings edits cannot retarget that request.
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
