import assert from "node:assert/strict";
import { test } from "node:test";
import { requiredChecksForBranch, summarizeRequiredChecks, summarizeIndependentReview }
  from "../scripts/audit/merge-gates.mjs";

const SHA = "a".repeat(40);
const ruleset = {
  target: "branch", enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [{ type: "required_status_checks", parameters: {
    required_status_checks: [
      { context: "check", integration_id: 15368 },
      { context: "e2e-shard (1)", integration_id: 15368 },
    ],
  } }],
};

test("M identifies only applicable active default-branch rules", () => {
  const required = requiredChecksForBranch([
    { ...ruleset, enforcement: "disabled" },
    { ...ruleset, conditions: { ref_name: { include: ["refs/heads/other"], exclude: [] } } },
    ruleset,
  ]);
  assert.deepEqual(required.contexts?.map(item => item.context), ["check", "e2e-shard (1)"]);
  assert.equal(requiredChecksForBranch([]).contexts, null);
  assert.equal(requiredChecksForBranch([{ ...ruleset, conditions: {} }]).contexts, null);
  assert.equal(requiredChecksForBranch([{
    ...ruleset, conditions: { ref_name: {
      include: ["~DEFAULT_BRANCH"], exclude: ["~DEFAULT_BRANCH"],
    } },
  }]).contexts, null);
});

test("M never accepts missing, running, wrong-app or failed required checks", () => {
  const contexts = requiredChecksForBranch([ruleset]).contexts;
  const success = { name: "check", app: { id: 15368 },
    status: "completed", conclusion: "success", started_at: "2026-11-09T00:01:00Z" };
  const shard = { ...success, name: "e2e-shard (1)" };
  assert.equal(summarizeRequiredChecks([success, shard], contexts, 2).state, "passed");
  assert.deepEqual(summarizeRequiredChecks([success], contexts, 1).missing, ["e2e-shard (1)"]);
  assert.equal(summarizeRequiredChecks([success, shard], contexts, 3).state, "unknown");
  assert.equal(summarizeRequiredChecks([success, { ...shard, status: "in_progress",
    conclusion: null }], contexts).state, "not-passed");
  assert.equal(summarizeRequiredChecks([success, { ...shard, app: { id: 99 } }],
    contexts).state, "not-passed");
  assert.equal(summarizeRequiredChecks([success, { ...shard, conclusion: "failure" }],
    contexts).state, "not-passed");
  assert.equal(summarizeRequiredChecks([], null).state, "unknown");
});

test("all-branch rules cannot be omitted from an otherwise green main branch", () => {
  const required = requiredChecksForBranch([ruleset, {
    ...ruleset,
    conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
    rules: [{ type: "required_status_checks", parameters: {
      required_status_checks: [{ context: "security", integration_id: 15368 }],
    } }],
  }]);
  const runs = ["check", "e2e-shard (1)"].map(name => ({
    name, app: { id: 15368 }, status: "completed", conclusion: "success",
  }));
  assert.deepEqual(summarizeRequiredChecks(runs, required.contexts).missing, ["security"]);
  assert.equal(summarizeRequiredChecks(runs, required.contexts).state, "not-passed");
});

for (const scope of [
  { include: ["refs/heads/*"], exclude: [] },
  { include: ["refs/heads/main"], exclude: ["refs/heads/ma?n"] },
  { include: ["~ALL"], exclude: ["refs/heads/[a-z]*"] },
  { include: ["~UNKNOWN"], exclude: [] },
]) test(`unresolved branch scope cannot produce a partial required-check pass: ${JSON.stringify(scope)}`, () => {
  const required = requiredChecksForBranch([ruleset, {
    ...ruleset, conditions: { ref_name: scope },
  }]);
  assert.equal(required.contexts, null);
  const runs = ["check", "e2e-shard (1)"].map(name => ({
    name, app: { id: 15368 }, status: "completed", conclusion: "success",
  }));
  assert.equal(summarizeRequiredChecks(runs, required.contexts).state, "unknown");
});

test("an all-branch exclusion skips a rule even if its include pattern is unresolved", () => {
  const required = requiredChecksForBranch([ruleset, {
    ...ruleset,
    conditions: { ref_name: { include: ["refs/heads/*"], exclude: ["~ALL"] } },
    rules: [{ type: "required_status_checks", parameters: {
      required_status_checks: [{ context: "excluded" }],
    } }],
  }]);
  assert.deepEqual(required.contexts?.map(item => item.context), ["check", "e2e-shard (1)"]);
});

test("M treats a new failed run as superseding an older passing run", () => {
  const contexts = [{ context: "check", integration_id: 15368 }];
  const oldRun = { name: "check", app: { id: 15368 }, status: "completed",
    conclusion: "success", started_at: "2026-11-09T00:01:00Z" };
  const currentRun = { ...oldRun, conclusion: "failure",
    started_at: "2026-11-09T00:03:00Z" };
  assert.deepEqual(summarizeRequiredChecks([oldRun, currentRun], contexts).failing,
    [{ context: "check", conclusion: "failure" }]);
});

test("M rejects self, stale, dismissed and change-requested reviews", () => {
  const valid = { user: { login: "reviewer" }, state: "APPROVED", commit_id: SHA,
    submitted_at: "2026-11-09T00:02:00Z" };
  assert.equal(summarizeIndependentReview([valid], "author", SHA).state, "verified");
  assert.equal(summarizeIndependentReview([{ ...valid, user: { login: "author" } }],
    "author", SHA).state, "not-verified");
  assert.equal(summarizeIndependentReview([{ ...valid, commit_id: "b".repeat(40) }],
    "author", SHA).state, "not-verified");
  assert.equal(summarizeIndependentReview([valid, { ...valid, state: "CHANGES_REQUESTED",
    submitted_at: "2026-11-09T00:03:00Z" }], "author", SHA).state, "not-verified");
  assert.equal(summarizeIndependentReview(null, "author", SHA).state, "unknown");
});
