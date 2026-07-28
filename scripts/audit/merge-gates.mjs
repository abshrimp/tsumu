/**
 * Fail-closed evidence helpers for human-reviewed audit merges.
 *
 * GitHub's observed green jobs are not the repository's current branch rules.
 * A successful workflow is not proof that code-scanning alerts are all closed.
 */

/** Return the active default-branch Ruleset requirements, not every historical rule. */
export function requiredChecksForBranch(rulesets, branch = "main") {
  if (!Array.isArray(rulesets)) return { contexts: null, note: "Rulesets unavailable" };
  const contexts = new Map();
  let relevant = 0;
  for (const ruleset of rulesets) {
    if (ruleset?.target !== "branch" || ruleset.enforcement !== "active") continue;
    const refs = ruleset.conditions?.ref_name;
    if (!refs || !Array.isArray(refs.include) || !Array.isArray(refs.exclude))
      return { contexts: null, note: "Ruleset branch scope cannot be established" };
    const matches = refs.include.includes("~DEFAULT_BRANCH") ||
      refs.include.includes("refs/heads/" + branch) ||
      refs.include.includes(branch);
    const excluded = refs.exclude.includes("~DEFAULT_BRANCH") ||
      refs.exclude.includes("refs/heads/" + branch) ||
      refs.exclude.includes(branch);
    if (!matches || excluded) continue;
    relevant++;
    for (const rule of ruleset.rules || []) {
      if (rule.type !== "required_status_checks") continue;
      const items = rule.parameters?.required_status_checks;
      if (!Array.isArray(items)) return { contexts: null, note: "Malformed required-check rule" };
      for (const item of items) {
        if (typeof item?.context !== "string" || !item.context)
          return { contexts: null, note: "Required-check context missing" };
        const id = item.integration_id == null ? null : Number(item.integration_id);
        if (id !== null && !Number.isInteger(id))
          return { contexts: null, note: "Invalid required-check integration id" };
        contexts.set(item.context + ":" + String(id), { context: item.context, integration_id: id });
      }
    }
  }
  if (!relevant || !contexts.size)
    return { contexts: null, note: "No applicable required-status-check rules could be verified" };
  return { contexts: [...contexts.values()], note: "Active default-branch rulesets verified" };
}

/**
 * Check the *required* job names, integration owner and latest attempt.
 * Missing/incomplete API pages cannot yield a merge-ready status.
 */
export function summarizeRequiredChecks(runs, contexts, totalCount = null) {
  if (!Array.isArray(contexts) || !contexts.length || !Array.isArray(runs) ||
      totalCount != null && (!Number.isInteger(totalCount) || totalCount > runs.length))
    return { state: "unknown", missing: [], pending: [], failing: [], passed: 0 };
  const missing = [], pending = [], failing = [];
  let passed = 0;
  for (const required of contexts) {
    const matching = runs.filter(run => run?.name === required.context &&
      (required.integration_id == null || Number(run.app?.id) === required.integration_id));
    // GitHub returns newest checks first. Compare timestamps to survive arbitrary API ordering.
    matching.sort((a, b) => String(b.started_at || b.completed_at || b.created_at || "")
      .localeCompare(String(a.started_at || a.completed_at || a.created_at || "")));
    const check = matching[0];
    if (!check) missing.push(required.context);
    else if (check.status !== "completed") pending.push(required.context);
    else if (check.conclusion === "success") passed++;
    else failing.push({ context: required.context, conclusion: check.conclusion || "unknown" });
  }
  return {
    state: missing.length || pending.length || failing.length ? "not-passed" : "passed",
    missing, pending, failing, passed,
  };
}

/**
 * A review must be from a distinct GitHub user and review the exact PR HEAD.
 * Same-account agent comments and older approvals are not independent evidence.
 */
export function summarizeIndependentReview(reviews, author, head) {
  if (!Array.isArray(reviews) || !author || !head)
    return { state: "unknown", reviewers: [], reason: "Review data unavailable" };
  const byReviewer = new Map();
  for (const review of reviews) {
    const login = review.user?.login || review.author?.login;
    if (!login || login.toLowerCase() === author.toLowerCase()) continue;
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) continue;
    const previous = byReviewer.get(login.toLowerCase());
    if (!previous || String(review.submitted_at || "") >= String(previous.submitted_at || ""))
      byReviewer.set(login.toLowerCase(), review);
  }
  const approvers = [...byReviewer.values()]
    .filter(review => review.state === "APPROVED" && review.commit_id === head)
    .map(review => review.user?.login || review.author?.login);
  return { state: approvers.length ? "verified" : "not-verified",
    reviewers: approvers,
    reason: approvers.length ? "Independent approval on exact head" :
      "No independent GitHub approval on the exact head" };
}
